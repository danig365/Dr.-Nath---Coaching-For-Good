"""
Server-side session transcription worker (E7, Phase 3).

A LiveKit Agents worker that joins each 1:1 session room, transcribes EVERY
participant's audio server-side (so Safari/Firefox are covered and accuracy is
better than the browser Web Speech API), and stores the AI summary directly via
Django — no dependency on any participant's browser posting.

WHY IT RUNS SEPARATELY
----------------------
livekit-agents pulls in the LiveKit RTC SDK and heavy media deps that can clash
with the API server's pinned `livekit-api`. So this runs as its OWN process in
its OWN virtualenv (see transcription_worker.README.md). It is NEVER imported by
Django, so it cannot affect the running API/daphne.

ACTIVATION (summary — full steps in the README)
-----------------------------------------------
  1. python -m venv venv-worker && venv-worker/bin/pip install -r requirements-worker.txt
  2. In .env set:  TRANSCRIPTION_ENABLED=true, STT_PROVIDER=deepgram,
     DEEPGRAM_API_KEY=...   (or STT_PROVIDER=openai + OPENAI_API_KEY=...)
  3. Run:  venv-worker/bin/python transcription_worker.py start
     (or enable the transcription-worker.service systemd unit)

The worker auto-dispatches to every room; it only acts on rooms named
`booking-<id>` and no-ops for anything else.
"""
import asyncio
import logging
import os
import time

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.conf import settings  # noqa: E402
from asgiref.sync import sync_to_async  # noqa: E402

from livekit import rtc  # noqa: E402
from livekit.agents import JobContext, WorkerOptions, cli, stt as agents_stt  # noqa: E402

logger = logging.getLogger("transcription_worker")
logging.basicConfig(level=logging.INFO)


def _build_stt():
    """Instantiate the configured streaming STT engine, or None if unavailable."""
    provider = (settings.STT_PROVIDER or "deepgram").lower()
    if provider == "deepgram":
        if not settings.DEEPGRAM_API_KEY:
            logger.error("STT_PROVIDER=deepgram but DEEPGRAM_API_KEY is not set.")
            return None
        from livekit.plugins import deepgram
        return deepgram.STT(
            api_key=settings.DEEPGRAM_API_KEY,
            model=settings.DEEPGRAM_MODEL,
            language=settings.STT_LANGUAGE,
        )
    if provider == "openai":
        if not settings.OPENAI_API_KEY:
            logger.error("STT_PROVIDER=openai but OPENAI_API_KEY is not set.")
            return None
        from livekit.plugins import openai as lk_openai
        return lk_openai.STT(api_key=settings.OPENAI_API_KEY, language=settings.STT_LANGUAGE)
    logger.error("Unknown STT_PROVIDER=%r", provider)
    return None


def _parse_booking_id(room_name):
    """`booking-42` → 42, else None (group rooms etc. are ignored)."""
    if room_name and room_name.startswith("booking-"):
        try:
            return int(room_name.split("-", 1)[1])
        except (ValueError, IndexError):
            return None
    return None


@sync_to_async
def _load_booking(booking_id):
    from bookings.models import SessionBooking
    return SessionBooking.objects.select_related("mentor__user", "learner").filter(id=booking_id).first()


@sync_to_async
def _label_for(booking, identity):
    from bookings.ai_summary import speaker_label_for_identity
    return speaker_label_for_identity(booking, identity)


@sync_to_async
def _store_summary(booking, transcript_text):
    from bookings.ai_summary import generate_and_store_summary
    return generate_and_store_summary(booking, transcript_text)


async def entrypoint(ctx: JobContext):
    booking_id = _parse_booking_id(ctx.room.name)
    if not settings.TRANSCRIPTION_ENABLED or booking_id is None:
        # Nothing to do for this room — connect briefly is unnecessary; just return.
        logger.info("Skipping room %s (enabled=%s, booking=%s)",
                    ctx.room.name, settings.TRANSCRIPTION_ENABLED, booking_id)
        return

    booking = await _load_booking(booking_id)
    if not booking:
        logger.warning("No booking for room %s", ctx.room.name)
        return

    stt_engine = _build_stt()
    if stt_engine is None:
        logger.error("STT not configured — worker cannot transcribe room %s", ctx.room.name)
        return

    transcript = []          # [{speaker, text, ts}]
    tasks = set()

    async def transcribe_track(track, participant):
        speaker = await _label_for(booking, participant.identity)
        audio_stream = rtc.AudioStream(track)
        stt_stream = stt_engine.stream()

        async def pump_audio():
            async for ev in audio_stream:
                stt_stream.push_frame(ev.frame)
            await stt_stream.aclose()

        async def read_events():
            async for ev in stt_stream:
                if ev.type == agents_stt.SpeechEventType.FINAL_TRANSCRIPT and ev.alternatives:
                    text = (ev.alternatives[0].text or "").strip()
                    if text:
                        transcript.append({"speaker": speaker, "text": text, "ts": time.time()})

        await asyncio.gather(pump_audio(), read_events())

    @ctx.room.on("track_subscribed")
    def on_track_subscribed(track, publication, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            t = asyncio.create_task(transcribe_track(track, participant))
            tasks.add(t)
            t.add_done_callback(tasks.discard)

    async def finalize():
        # Merge time-ordered segments and hand off to the shared summariser.
        ordered = sorted(transcript, key=lambda s: s.get("ts", 0))
        text = "\n".join(f"{s['speaker']}: {s['text']}" for s in ordered)
        if text.strip():
            try:
                await _store_summary(booking, text)
                logger.info("Stored summary for booking %s (%d chars)", booking_id, len(text))
            except Exception as exc:  # noqa: BLE001
                logger.error("Failed to store summary for booking %s: %s", booking_id, exc)

    ctx.add_shutdown_callback(finalize)
    await ctx.connect(auto_subscribe=rtc.AutoSubscribe.AUDIO_ONLY)
    logger.info("Transcribing room %s (booking %s)", ctx.room.name, booking_id)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))

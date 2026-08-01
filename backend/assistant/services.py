"""
Provider-agnostic AI assistant for the public website chatbot.

The active provider is chosen from settings.AI_PROVIDER:
  - 'auto'      → Anthropic if ANTHROPIC_API_KEY is set, else OpenAI if
                  OPENAI_API_KEY is set, else "not configured".
  - 'anthropic' → Anthropic (Claude)
  - 'openai'    → OpenAI (GPT)

Switching providers is a .env change only — no code edits. If no key is set,
`get_assistant_reply` returns a friendly fallback so the widget still works.
"""
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

# Per the Anthropic model guidance, default to Opus 4.8. Override with
# ASSISTANT_MODEL in .env (e.g. claude-haiku-4-5 for a cheaper website bot).
DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8'
DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

MAX_TOKENS = 500  # assistant replies are short, on-topic guidance

SYSTEM_PROMPT = (
    "You are the friendly virtual assistant for Dr. Nath Coaching (dr-nath.com), "
    "a professional coaching platform. Your job is to help visitors as they browse: "
    "answer questions about the platform and Dr. Nathalie, and guide them toward "
    "getting started.\n\n"

    "About the coach — Dr. Nathalie B Chinje-N Bodiong:\n"
    "- An experienced executive, business and wellness coach. For over a decade she "
    "has coached senior executives across South Africa's top banking institutions, "
    "entrepreneurs across the African continent, and corporate leaders navigating "
    "high-stakes career transitions.\n"
    "- Qualifications: PhD in Business Administration (Wits Business School); MBA "
    "(University of Stellenbosch Business School); executive development at the "
    "Harvard Kennedy School; the Health & Wellness Coaching Program at Emory "
    "University (USA); and she is a Full member of the Institute of Coaching at "
    "McLean Hospital, a Harvard Medical School affiliate.\n"
    "- Coaching specialties: Executive & Leadership Coaching, Business & "
    "Entrepreneurship Coaching, and Health & Wellness Coaching.\n"
    "- Industries she works across: Banking & Insurance, Education, Healthcare, ICT "
    "and Manufacturing. She coaches in English and French.\n"
    "- LinkedIn: linkedin.com/in/drnathchinje/\n\n"

    "Offerings on the platform:\n"
    "- Executive & Leadership Coaching — one-on-one sessions to build clarity, "
    "confidence and momentum for career, leadership and life goals.\n"
    "- 6-month Health and Wellness Program — a client-centred journey combining "
    "coaching, accountability and practical tools to build lasting habits around "
    "wellbeing, energy and balance.\n\n"

    "How the platform works:\n"
    "- Visitors create a free account, then browse the coach directory or use Smart "
    "Match (a short quiz that suggests a suitable fit) and book a session.\n"
    "- Sessions are held securely on the platform with built-in video and chat. "
    "Clients also get milestones, habit tracking, shared resources and documents, "
    "e-signature agreements, and automatic session reminders.\n"
    "- To book: sign up, pick an offering and an available time slot, and confirm.\n\n"

    "Helping someone who CAN'T book or sign in (common issue):\n"
    "- The most common reason is that they don't have an account yet. The booking "
    "page requires signing in, so they must FIRST create a free account (Register / "
    "Sign up), even if Dr. Nathalie invited them by email — they register with that "
    "same email, set a password, then the booking page opens.\n"
    "- If they're signed in but still stuck: make sure they've completed their short "
    "profile, then choose a time slot shown as available and click Confirm.\n"
    "- If it still doesn't work, ask them to reach the team via the Contact page and "
    "Dr. Nathalie can help or book them in directly.\n"
    "- Walk them through these steps warmly and simply.\n\n"

    "Common visitor questions you CAN answer:\n"
    "- Are sessions online or in person? Online — held securely on the platform "
    "with built-in video and chat, so clients can join from anywhere.\n"
    "- What languages? Dr. Nathalie coaches in English and French; you may reply in "
    "either.\n"
    "- 1:1 or group? Both are available — one-on-one coaching and the 6-month "
    "Health and Wellness Program.\n"
    "- How do I reschedule or cancel a booking? Sign in and manage it from your "
    "sessions, or use the Contact page if you need help.\n"
    "- Trouble logging in or forgot password? Use the Login page, or reach the team "
    "via the Contact page.\n"
    "- Is my information private? Sessions and data are held securely on the "
    "platform over encrypted connections. (Do not claim any formal certification.)\n"
    "- How do I stay updated? They can sign up for the newsletter on the site.\n\n"

    "Questions you must NOT answer from guesswork — say you don't have that to hand "
    "and point them to the booking pages or the Contact page:\n"
    "- Exact prices, session length/duration, whether there's a free discovery call, "
    "refund or cancellation terms, and specific available dates/times.\n\n"

    "Language: If the visitor writes in another language (e.g., French), reply in "
    "that same language.\n\n"

    "Safety: You are a coaching assistant, not a doctor or therapist, and coaching "
    "is not medical or crisis care. If someone describes a medical emergency, "
    "self-harm, or a mental-health crisis, respond with care and encourage them to "
    "contact a qualified professional or their local emergency services right away — "
    "do not try to counsel or diagnose.\n\n"

    "Guidelines:\n"
    "- Be warm, concise and encouraging. Keep replies short (2-4 sentences).\n"
    "- Reply in plain, conversational text. Do NOT use Markdown formatting — no "
    "**asterisks** for bold, no # headings, no bullet symbols. If you list steps, "
    "write them as plain numbered lines (e.g. '1) ...').\n"
    "- Nudge interested visitors toward creating an account or reaching out to book.\n"
    "- You do NOT have access to live data — current prices, a coach's availability, "
    "or anyone's account, bookings or payments — and you cannot book, cancel or "
    "change anything. For those, point them to the relevant page (browse/book) or "
    "the Contact page.\n"
    "- Never state or guess a price, a specific available time, or any policy (refunds, "
    "cancellations, session length) you weren't given here. If unsure, say so and "
    "point them to the Contact page.\n"
    "- If asked something unrelated to coaching or this platform, politely steer back."
)

# Keep the payload bounded regardless of what the client sends.
MAX_HISTORY_MESSAGES = 20
MAX_MESSAGE_CHARS = 2000

NOT_CONFIGURED_REPLY = (
    "Hi! I'm the Dr. Nath assistant. I'm not fully set up yet, but you can explore "
    "coaches, try Smart Match, or reach out via the Contact page to get started."
)


def _active_provider():
    """Return ('anthropic'|'openai'|None, api_key). None means not configured."""
    provider = (settings.AI_PROVIDER or 'auto').lower()
    anthropic_key = settings.ANTHROPIC_API_KEY
    openai_key = settings.OPENAI_API_KEY

    if provider == 'anthropic':
        return ('anthropic', anthropic_key) if anthropic_key else (None, '')
    if provider == 'openai':
        return ('openai', openai_key) if openai_key else (None, '')
    # auto
    if anthropic_key:
        return 'anthropic', anthropic_key
    if openai_key:
        return 'openai', openai_key
    return None, ''


def _sanitize(history):
    """Clamp history length and coerce to {role, content} with valid roles."""
    cleaned = []
    for m in (history or [])[-MAX_HISTORY_MESSAGES:]:
        role = m.get('role')
        content = (m.get('content') or '').strip()[:MAX_MESSAGE_CHARS]
        if role in ('user', 'assistant') and content:
            cleaned.append({'role': role, 'content': content})
    return cleaned


def _reply_anthropic(messages, api_key):
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    model = settings.ASSISTANT_MODEL or DEFAULT_ANTHROPIC_MODEL
    resp = client.messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    parts = [block.text for block in resp.content if getattr(block, 'type', None) == 'text']
    return ''.join(parts).strip()


def _reply_openai(messages, api_key):
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    model = settings.ASSISTANT_MODEL or DEFAULT_OPENAI_MODEL
    resp = client.chat.completions.create(
        model=model,
        max_tokens=MAX_TOKENS,
        messages=[{'role': 'system', 'content': SYSTEM_PROMPT}, *messages],
    )
    return (resp.choices[0].message.content or '').strip()


def get_assistant_reply(history):
    """Return the assistant's reply text for a conversation history.

    Never raises — on any provider error it logs and returns a friendly message,
    so the public widget degrades gracefully.
    """
    messages = _sanitize(history)
    if not messages or messages[-1]['role'] != 'user':
        return "Ask me anything about Dr. Nath Coaching and how to get started!"

    provider, api_key = _active_provider()
    if not provider:
        return NOT_CONFIGURED_REPLY

    try:
        if provider == 'anthropic':
            return _reply_anthropic(messages, api_key) or NOT_CONFIGURED_REPLY
        return _reply_openai(messages, api_key) or NOT_CONFIGURED_REPLY
    except Exception as exc:  # noqa: BLE001 — never break the public endpoint
        logger.error("AI assistant (%s) failed: %s", provider, exc)
        return (
            "Sorry, I'm having trouble responding right now. Please try again in a "
            "moment, or reach us via the Contact page."
        )


# ---------------------------------------------------------------------------
# In-session AI summary (E7)
#
# Given a transcript of a live coaching session, produce a short structured
# summary. Reuses the same provider/key as the website assistant. Returns a
# dict {summary, key_points, action_items} or None if it can't summarise.
# ---------------------------------------------------------------------------

SUMMARY_MAX_TOKENS = 1000
SUMMARY_TRANSCRIPT_LIMIT = 20000  # chars fed to the model (keeps cost bounded)
MIN_TRANSCRIPT_CHARS = 40         # below this there's nothing to summarise

SUMMARY_SYSTEM_PROMPT = (
    "You summarise one-on-one professional coaching sessions from their "
    "transcript. Be objective, warm and concise; never invent details that are "
    "not supported by the transcript. Write in the third person about \"the "
    "coach\" and \"the client\".\n\n"
    "Return ONLY a valid JSON object (no markdown, no prose outside it) with "
    "exactly these keys:\n"
    "  \"summary\": a 2-4 sentence paragraph of what the session covered.\n"
    "  \"key_points\": an array of 3-6 short strings — the main topics, "
    "insights or decisions.\n"
    "  \"action_items\": an array of short strings — concrete next steps the "
    "client agreed to or should take (empty array if none were discussed).\n"
    "  \"reflection_points\": an array of 2-4 short strings — open questions or "
    "prompts for the client to reflect on before the next session (empty array "
    "if none apply).\n"
    "If the transcript is short or unclear, still return the JSON with your "
    "best-effort content."
)


def _parse_summary_json(text):
    """Extract the {summary, key_points, action_items} dict from model output,
    tolerating code fences or stray prose around the JSON."""
    import json
    import re

    raw = (text or "").strip()
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        raw = match.group(0)
    try:
        data = json.loads(raw)
    except Exception:  # noqa: BLE001 — fall back to a plain-text summary
        return {"summary": (text or "").strip()[:4000], "key_points": [], "action_items": [], "reflection_points": []}

    def _clean_list(value):
        out = []
        for item in value or []:
            s = str(item).strip()
            if s:
                out.append(s[:300])
        return out[:12]

    return {
        "summary": str(data.get("summary", "")).strip()[:4000],
        "key_points": _clean_list(data.get("key_points")),
        "action_items": _clean_list(data.get("action_items")),
        "reflection_points": _clean_list(data.get("reflection_points")),
    }


def summarize_session(transcript):
    """Summarise a session transcript. Returns a dict or None.

    None means: not enough content, no provider configured, or a provider error
    — callers should treat it as "no summary available" rather than an error.
    """
    transcript = (transcript or "").strip()
    if len(transcript) < MIN_TRANSCRIPT_CHARS:
        return None

    provider, api_key = _active_provider()
    if not provider:
        return None

    user_msg = (
        "Transcript of a coaching session (speaker labels may be approximate):\n\n"
        f"{transcript[:SUMMARY_TRANSCRIPT_LIMIT]}\n\n"
        "Summarise it as instructed, returning only the JSON object."
    )

    try:
        if provider == "anthropic":
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)
            model = (
                getattr(settings, "SUMMARY_MODEL", "")
                or getattr(settings, "ASSISTANT_MODEL", "")
                or DEFAULT_ANTHROPIC_MODEL
            )
            resp = client.messages.create(
                model=model,
                max_tokens=SUMMARY_MAX_TOKENS,
                system=SUMMARY_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            text = "".join(
                b.text for b in resp.content if getattr(b, "type", None) == "text"
            ).strip()
        else:
            from openai import OpenAI

            client = OpenAI(api_key=api_key)
            model = (
                getattr(settings, "SUMMARY_MODEL", "")
                or getattr(settings, "ASSISTANT_MODEL", "")
                or DEFAULT_OPENAI_MODEL
            )
            resp = client.chat.completions.create(
                model=model,
                max_tokens=SUMMARY_MAX_TOKENS,
                messages=[
                    {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
            )
            text = (resp.choices[0].message.content or "").strip()
    except Exception as exc:  # noqa: BLE001 — never surface as a hard error
        logger.error("Session summary (%s) failed: %s", provider, exc)
        return None

    result = _parse_summary_json(text)
    return result if result.get("summary") or result.get("key_points") else None


def complete_text(system_prompt, user_msg, *, max_tokens=600):
    """Generic single-shot completion via the active provider. Returns the text,
    or '' if no provider is configured or on any error. Never raises."""
    provider, api_key = _active_provider()
    if not provider:
        return ''
    try:
        if provider == "anthropic":
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)
            model = (
                getattr(settings, "SUMMARY_MODEL", "")
                or getattr(settings, "ASSISTANT_MODEL", "")
                or DEFAULT_ANTHROPIC_MODEL
            )
            resp = client.messages.create(
                model=model, max_tokens=max_tokens, system=system_prompt,
                messages=[{"role": "user", "content": user_msg}],
            )
            return "".join(
                b.text for b in resp.content if getattr(b, "type", None) == "text"
            ).strip()
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        model = (
            getattr(settings, "SUMMARY_MODEL", "")
            or getattr(settings, "ASSISTANT_MODEL", "")
            or DEFAULT_OPENAI_MODEL
        )
        resp = client.chat.completions.create(
            model=model, max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception as exc:  # noqa: BLE001 — never surface as a hard error
        logger.error("complete_text (%s) failed: %s", provider, exc)
        return ''


TOPICS_SYSTEM_PROMPT = (
    "You are analysing a coach's recent coaching sessions. From the material "
    "provided (each block is one session's summary and key points), identify the "
    "themes that came up MOST across the sessions. Return ONLY a JSON object of "
    'the form {"topics": ["short topic phrase", ...]} — 3 to 8 concise phrases '
    "(2-5 words each), ordered from most to least discussed. Merge similar ideas "
    'into one phrase. If there is not enough material, return {"topics": []}.'
)


def summarize_topics(texts):
    """Given an iterable of short text blocks (recent session summaries / key
    points), return a ranked list of the most-discussed topic phrases.

    Returns [] on no content, no provider, or any error — never raises.
    """
    blocks = [str(t).strip() for t in (texts or []) if str(t).strip()]
    if not blocks:
        return []

    provider, api_key = _active_provider()
    if not provider:
        return []

    material = "\n\n---\n\n".join(blocks)[:SUMMARY_TRANSCRIPT_LIMIT]
    user_msg = (
        "Material from the coach's recent sessions (one block per session):\n\n"
        f"{material}\n\n"
        "Return only the JSON object with the most-discussed topics."
    )

    try:
        if provider == "anthropic":
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)
            model = (
                getattr(settings, "SUMMARY_MODEL", "")
                or getattr(settings, "ASSISTANT_MODEL", "")
                or DEFAULT_ANTHROPIC_MODEL
            )
            resp = client.messages.create(
                model=model,
                max_tokens=400,
                system=TOPICS_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_msg}],
            )
            text = "".join(
                b.text for b in resp.content if getattr(b, "type", None) == "text"
            ).strip()
        else:
            from openai import OpenAI

            client = OpenAI(api_key=api_key)
            model = (
                getattr(settings, "SUMMARY_MODEL", "")
                or getattr(settings, "ASSISTANT_MODEL", "")
                or DEFAULT_OPENAI_MODEL
            )
            resp = client.chat.completions.create(
                model=model,
                max_tokens=400,
                messages=[
                    {"role": "system", "content": TOPICS_SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
            )
            text = (resp.choices[0].message.content or "").strip()
    except Exception as exc:  # noqa: BLE001 — never surface as a hard error
        logger.error("Topic summary (%s) failed: %s", provider, exc)
        return []

    import json
    import re

    raw = (text or "").strip()
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        raw = match.group(0)
    try:
        data = json.loads(raw)
    except Exception:  # noqa: BLE001
        return []

    out = []
    for item in (data.get("topics") or []):
        s = str(item).strip()
        if s:
            out.append(s[:120])
    return out[:8]

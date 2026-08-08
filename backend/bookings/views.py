from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.decorators import action # Required for @action decorator
from rest_framework.status import HTTP_200_OK, HTTP_403_FORBIDDEN, HTTP_400_BAD_REQUEST, HTTP_404_NOT_FOUND # Explicitly import status codes
from rest_framework.exceptions import ValidationError as DRFValidationError # Use DRF's ValidationError for API responses

# Import all models used in this file
from .models import SessionBooking, Review, Milestone, TimeSlot, GroupSession, GroupEnrollment, SlotInvite, Habit, HabitCheckIn
# Import models from other apps
from profiles.models import UserProfile, CustomUser
# Import all serializers used in this file
from .serializers import (
    ReviewSerializer, SessionBookingSerializer, TimeSlotSerializer,
    GroupSessionSerializer, GroupEnrollmentSerializer, MyGroupEnrollmentSerializer,
    SlotInviteSerializer,
)
from .services import generate_slots_for_coach, release_expired_holds, HOLD_MINUTES, reserve_seat, SeatUnavailable
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone as dj_tz
from datetime import timedelta, date as date_cls
from django.utils.dateparse import parse_date
# Note: DjangoValidationError is not directly used in this file's logic, but can be kept if needed elsewhere.
# from django.core.exceptions import ValidationError as DjangoValidationError


def cancel_booking(booking, new_status='declined', refund=True, cancelled_by=None):
    """
    Cancel a booking: free its slot back to 'open' and refund payment if any,
    and tell BOTH parties. Shared by client and coach cancellation paths.
    `cancelled_by` is the User who cancelled (so each side is told who did it).
    Returns the booking.
    """
    # Capture the start BEFORE the slot is released below — cancelling unlinks
    # booking.slot, and the cancellation email needs the time that was booked.
    from .notifications import session_start_utc
    start_utc = session_start_utc(booking)

    with transaction.atomic():
        # Release the linked slot AND any other slots this booking consumed for
        # its full length (a session may span several base slots) so the whole
        # window becomes bookable again.
        slot = booking.slot
        if slot:
            window_end = slot.start_datetime + timedelta(minutes=booking.duration or slot.duration_minutes)
            TimeSlot.objects.filter(
                coach_id=slot.coach_id, status__in=('booked', 'held'),
                start_datetime__gte=slot.start_datetime,
                start_datetime__lt=window_end,
            ).update(status='open', held_until=None, held_by=None)
            # Release the OneToOne link so the reopened slot can be re-booked.
            booking.slot = None

        # Refund a paid session (best-effort; never block cancellation on Stripe).
        if refund and booking.payment_status == 'paid' and booking.payment_intent_id:
            try:
                import stripe as _stripe
                _stripe.api_key = settings.STRIPE_SECRET_KEY
                _stripe.Refund.create(payment_intent=booking.payment_intent_id)
                booking.payment_status = 'refunded'
            except Exception as e:
                print(f"Refund failed for booking {booking.id}: {e}")

        booking.status = new_status
        booking.save()

    # Cancel any pending reminders so a dead session stops emailing people.
    try:
        from .notifications import cancel_booking_notifications
        cancel_booking_notifications(booking)
    except Exception as notify_err:  # noqa: BLE001
        print(f"Failed to cancel notifications for booking {booking.id}: {notify_err}")
    # Tell BOTH parties the session is off — whoever cancelled, the other side
    # must never be left waiting for a session that isn't happening.
    try:
        from .notifications import send_booking_cancelled
        send_booking_cancelled(booking, start_utc=start_utc, cancelled_by=cancelled_by)
    except Exception as notify_err:  # noqa: BLE001
        print(f"Failed to send cancellation emails for booking {booking.id}: {notify_err}")
    # Remove the event from any connected Google Calendars (best-effort).
    try:
        from integrations.sync import sync_booking_cancelled
        sync_booking_cancelled(booking)
    except Exception:  # noqa: BLE001
        pass
    return booking


# Cap the total size of documents attached to an invite email so it stays under
# common provider limits (Office365 rejects messages over ~25 MB incl. encoding).
MAX_INVITE_ATTACH_BYTES = 15 * 1024 * 1024


def _build_invite_attachments(resources):
    """Read attachable resource files into email attachments, capped in total
    size. Returns (attachments, attached_names, skipped_names).

    Resources without a stored file (link-only) or that push the total over the
    cap are skipped and reported so the caller can tell the coach.
    """
    import mimetypes
    attachments, attached_names, skipped = [], [], []
    total = 0
    for r in resources or []:
        f = getattr(r, 'file', None)
        if not f:
            skipped.append(r.title)
            continue
        try:
            f.open('rb')
            data = f.read()
        except Exception:  # noqa: BLE001 — a missing/unreadable file just skips
            skipped.append(r.title)
            continue
        finally:
            try:
                f.close()
            except Exception:  # noqa: BLE001
                pass
        if total + len(data) > MAX_INVITE_ATTACH_BYTES:
            skipped.append(r.title)
            continue
        total += len(data)
        fname = f.name.split('/')[-1] or r.title
        mimetype = mimetypes.guess_type(fname)[0] or 'application/octet-stream'
        attachments.append((fname, data, mimetype))
        attached_names.append(r.title)
    return attachments, attached_names, skipped


def send_slot_invite_email(slot, skill, addr, note, resources=None):
    """Email one recipient an invite to book `slot` for `skill`.

    Shared by the initial invite send and the history "resend" action so both
    produce an identical email. Any `resources` (coach library documents) are
    attached to the email so an unregistered invitee gets them directly.
    Returns True on success.
    """
    from notifications.services import send_email
    from .notifications import _display_name, _fmt_when
    coach_name = _display_name(slot.coach.user)
    when = _fmt_when(slot.start_datetime, getattr(slot.coach, 'timezone', 'UTC'))
    link = f"{settings.SITE_URL}/book/{skill.id}?slot={slot.id}"
    coach_email = slot.coach.user.email
    reply_to = [coach_email] if coach_email else None
    attachments, attached_names, _ = _build_invite_attachments(resources)
    return send_email(
        to=addr,
        subject=f"You're invited to a coaching session with {coach_name}",
        template='slot_invite',
        context={
            'coach_name': coach_name,
            'skill_name': skill.name,
            'when': when,
            'link': link,
            'note': note,
            'attachments': attached_names,
        },
        reply_to=reply_to,
        attachments=attachments or None,
        # Blind-copy the coach so they get a record of every invite/resend in
        # their own inbox (the invitee doesn't see this).
        bcc=[coach_email] if coach_email else None,
    )


class SessionBookingViewSet(viewsets.ModelViewSet):
    serializer_class = SessionBookingSerializer
    permission_classes = [IsAuthenticated]

    def _base_queryset(self):
        """Everything the serializer touches, pulled in up front.

        Without this the list is a textbook N+1: each booking separately fetched
        its learner, coach, skill, reflection, summary and unread count — ~10
        queries per row. The navbar polls this endpoint every 30s for every
        signed-in user, so it's the hottest query in the app.
        """
        return (
            SessionBooking.objects
            .select_related(
                'learner',            # learner_name
                'mentor', 'mentor__user',  # mentor_name / permissions
                'skill',              # skill_title, price
                'slot',               # slot_start / slot_end
                'reflection',         # has_reflection (OneToOne reverse)
                'ai_summary',         # has_summary (OneToOne reverse)
            )
            .annotate(
                # Mirrors SessionBookingSerializer.get_unread_messages exactly.
                _unread_count=Count(
                    'messages',
                    filter=Q(messages__receiver=self.request.user, messages__is_read=False),
                    distinct=True,
                ),
            )
        )

    def get_queryset(self):
        # Ensure the user has a profile before attempting to filter by role
        if not hasattr(self.request.user, 'profile') or not self.request.user.is_authenticated:
            return SessionBooking.objects.none()

        user_profile = self.request.user.profile
        qs = self._base_queryset()
        # If the user is a coach, they see sessions where they are the mentor
        if user_profile.role == 'coach':
            return qs.filter(mentor=user_profile).order_by('-created_at')
        # If the user is a client, they see sessions where they are the learner
        elif user_profile.role == 'client':
            return qs.filter(learner=self.request.user).order_by('-created_at')
        # For any other role or if no role is defined, return an empty queryset
        return SessionBooking.objects.none()

    def create(self, request, *args, **kwargs):
        # Direct booking creation is disabled: bookings are created only through
        # the slot + payment flow (see ConfirmBookingPaymentView), which reserves
        # a TimeSlot and prevents double-booking. Allowing free-datetime creation
        # here would let a caller book a time with no slot reservation.
        raise DRFValidationError(
            "Direct booking creation is disabled. Please book an available time slot."
        )

    def perform_update(self, serializer):
        user = self.request.user
        
        # Ensure user has a profile
        if not hasattr(user, 'profile'):
            raise DRFValidationError("User profile not found.")
        
        # Only coaches can update booking status
        if user.profile.role != 'coach':
            raise DRFValidationError("Only coaches can update booking status.")
        
        # Ensure the mentor can only update their own bookings
        booking = serializer.instance
        if booking.mentor != user.profile:
            raise DRFValidationError("You can only update your own booking requests.")
        
        # Only allow status updates (for security)
        # Allow mentors to update booking status and add a meeting link
        allowed_fields = ['status', 'meeting_link']
        for field in serializer.validated_data:
            if field not in allowed_fields:
                raise DRFValidationError(f"Cannot update field: {field}")
        
        try:
            # If a coach declines a booking that occupies a slot, free the slot + refund.
            if serializer.validated_data.get('status') == 'declined' and booking.slot:
                cancel_booking(booking, new_status='declined', cancelled_by=self.request.user)
            else:
                serializer.save()
        except Exception as e:
            print(f"Error during perform_update save: {e}") # Keep this print for server-side debugging
            raise DRFValidationError({'detail': f"Error updating booking: {str(e)}"})

    def perform_destroy(self, instance):
        user = self.request.user
        # Security check: Only the mentor for the booking can delete it
        if instance.mentor.user != user:
            raise DRFValidationError("You do not have permission to delete this booking.")
        
        instance.delete()

    @action(detail=True, methods=['patch'])
    def complete(self, request, pk=None):
        booking = self.get_object()
        user = request.user
        is_mentor = booking.mentor.user == user
        is_learner = booking.learner == user
        if not (is_mentor or is_learner):
            return Response({'detail': 'Permission denied.'}, status=HTTP_403_FORBIDDEN)
        if booking.status != 'accepted':
            return Response({'detail': 'Only accepted bookings can be completed.'}, status=HTTP_400_BAD_REQUEST)

        # `force` = a participant deliberately ended the session (e.g. the coach
        # chose "End & save summary"), as opposed to an automatic timeout / a
        # momentary drop. A deliberate end may finish early — but only once the
        # session has actually STARTED (so a not-yet-happened session can't be
        # completed by accident during testing).
        from datetime import datetime as _dt, timezone as _tz, timedelta
        force = bool(request.data.get('force'))
        start_dt = end_dt = None
        if booking.slot and booking.slot.start_datetime:
            start_dt = booking.slot.start_datetime
            end_dt = booking.slot.end_datetime
        elif booking.session_date and booking.session_time:
            start_dt = _dt.combine(booking.session_date, booking.session_time).replace(tzinfo=_tz.utc)
            end_dt = start_dt + timedelta(minutes=booking.duration or 60)

        now = dj_tz.now()
        if force:
            if start_dt and now < start_dt:
                return Response(
                    {'detail': "This session hasn't started yet, so it can't be completed."},
                    status=HTTP_400_BAD_REQUEST,
                )
        elif end_dt and now < end_dt + timedelta(minutes=settings.SESSION_REJOIN_MINUTES):
            # Automatic / accidental: the same link stays live through the whole
            # rejoin window (N3), so a session is only auto-finalised once that
            # window has fully closed. Until then it's rejoinable and continues.
            return Response(
                {'detail': 'This session is still within its rejoin window and can be reconnected.'},
                status=HTTP_400_BAD_REQUEST,
            )

        # Completed only if both parties actually joined; otherwise a no-show.
        from .services import finalize_status
        booking.status = finalize_status(booking)
        booking.save()
        # Completed → thank-you + rebook invite. No-show → tell both parties and
        # invite the client to reschedule.
        try:
            if booking.status == 'completed':
                from .notifications import send_session_thankyou, send_session_summary_email
                send_session_thankyou(booking)
                # If the summary was already generated (e.g. by the server-side
                # worker during the call), email it now that the session is
                # finalised. If it's not ready yet, generation will email it.
                send_session_summary_email(booking)
            elif booking.status == 'no_show':
                from .notifications import send_session_missed
                send_session_missed(booking)
        except Exception:  # noqa: BLE001
            pass
        return Response(self.get_serializer(booking).data)

    @action(detail=True, methods=['patch'], url_path='set-outcome')
    def set_outcome(self, request, pk=None):
        """Coach corrects a finished session's outcome — the platform's automatic
        completed/no-show guess is often wrong (a session that ran on WhatsApp
        gets flagged 'no show'; one that never happened gets 'completed'). The
        coach can set: completed, held_offline (took place elsewhere), no_show,
        or not_held (didn't happen). Only the coach, only on a session whose time
        has already passed."""
        booking = self.get_object()
        if booking.mentor.user_id != request.user.id:
            return Response({'detail': 'Only the coach can change a session outcome.'},
                            status=HTTP_403_FORBIDDEN)
        outcome = request.data.get('outcome')
        if outcome not in SessionBooking.OUTCOME_CHOICES:
            return Response({'detail': 'Invalid outcome.'}, status=HTTP_400_BAD_REQUEST)
        # Only for sessions that have concluded (already finalised, or an accepted
        # session whose booked time has passed) — never rewrite a future booking.
        from .services import booking_end_dt
        end = booking_end_dt(booking)
        already_final = booking.status in ('completed', 'no_show', 'held_offline', 'not_held')
        if not already_final and not (end and dj_tz.now() >= end):
            return Response({'detail': 'This session has not taken place yet.'},
                            status=HTTP_400_BAD_REQUEST)
        booking.status = outcome
        booking.save(update_fields=['status'])
        return Response(self.get_serializer(booking).data)

    @action(detail=True, methods=['post'], url_path='mark-joined')
    def mark_joined(self, request, pk=None):
        """Record that the requesting participant actually connected to the call.
        Called by the call page once the LiveKit room connects — this is the
        signal that decides completed vs no-show. Merely opening the lobby to
        check camera/mic (no connect) does NOT count."""
        booking = self.get_object()
        user = request.user
        is_coach = booking.mentor.user_id == user.id
        is_learner = booking.learner_id == user.id
        if not (is_coach or is_learner):
            return Response({'detail': 'Permission denied.'}, status=HTTP_403_FORBIDDEN)
        field = 'coach_joined_at' if is_coach else 'client_joined_at'
        if getattr(booking, field) is None:
            setattr(booking, field, dj_tz.now())
            booking.save(update_fields=[field])
        return Response({'ok': True})

    @action(detail=True, methods=['post'], url_path='reopen')
    def reopen(self, request, pk=None):
        """Resume a session that was ended/finalised but is still within its
        rejoin window (N3): flip completed/no_show back to 'accepted' so the SAME
        link works again and the meeting can continue. Attendance timestamps are
        preserved (they still decide completed vs no-show at the real end); the
        client must be re-admitted through the waiting room on resume."""
        booking = self.get_object()
        user = request.user
        is_coach = booking.mentor.user_id == user.id
        is_learner = booking.learner_id == user.id
        if not (is_coach or is_learner):
            return Response({'detail': 'Permission denied.'}, status=HTTP_403_FORBIDDEN)
        if booking.status == 'accepted':
            return Response(self.get_serializer(booking).data)  # already open
        if booking.status not in ('completed', 'no_show'):
            return Response({'detail': "This session can't be resumed."}, status=HTTP_400_BAD_REQUEST)

        from datetime import datetime as _dt, timezone as _tz, timedelta
        end_dt = None
        if booking.slot and booking.slot.end_datetime:
            end_dt = booking.slot.end_datetime
        elif booking.session_date and booking.session_time:
            start_dt = _dt.combine(booking.session_date, booking.session_time).replace(tzinfo=_tz.utc)
            end_dt = start_dt + timedelta(minutes=booking.duration or 60)
        now = dj_tz.now()
        if end_dt and now > end_dt + timedelta(minutes=settings.SESSION_REJOIN_MINUTES):
            return Response({'detail': 'The rejoin window for this session has closed.'},
                            status=HTTP_400_BAD_REQUEST)

        booking.status = 'accepted'
        booking.client_admit_status = ''  # waiting room is non-persistent — re-admit on resume
        booking.save(update_fields=['status', 'client_admit_status'])
        return Response(self.get_serializer(booking).data)

    # ── Waiting room (coach is host; client needs admitting) ────────────────
    @action(detail=True, methods=['post'], url_path='request-join')
    def request_join(self, request, pk=None):
        """Client asks the coach to let them in. Admission is NOT persistent —
        every fresh join goes through the coach again, so this always resets to
        'requested' (any prior admit is cleared). A mid-session LiveKit reconnect
        reuses the existing token and never calls this, so it won't re-prompt."""
        booking = self.get_object()
        if booking.learner_id != request.user.id:
            return Response({'detail': 'Only the client requests admission.'}, status=HTTP_403_FORBIDDEN)
        from .livekit_views import coach_in_room
        booking.client_admit_status = 'requested'
        booking.save(update_fields=['client_admit_status'])
        return Response({'status': 'requested', 'coach_present': coach_in_room(booking)})

    @action(detail=True, methods=['get'], url_path='join-status')
    def join_status(self, request, pk=None):
        """Client polls whether the coach has admitted them yet."""
        booking = self.get_object()
        if booking.learner_id != request.user.id:
            return Response({'detail': 'Permission denied.'}, status=HTTP_403_FORBIDDEN)
        from .livekit_views import coach_in_room
        return Response({'status': booking.client_admit_status or 'none',
                         'coach_present': coach_in_room(booking)})

    @action(detail=True, methods=['get'], url_path='pending-joins')
    def pending_joins(self, request, pk=None):
        """Coach polls for a client waiting to be let in."""
        booking = self.get_object()
        if booking.mentor.user_id != request.user.id:
            return Response({'detail': 'Permission denied.'}, status=HTTP_403_FORBIDDEN)
        waiting = booking.client_admit_status == 'requested'
        name = f"{booking.learner.first_name} {booking.learner.last_name}".strip() or booking.learner.username
        return Response({'waiting': waiting, 'client_name': name if waiting else None})

    @action(detail=True, methods=['post'], url_path='admit')
    def admit(self, request, pk=None):
        booking = self.get_object()
        if booking.mentor.user_id != request.user.id:
            return Response({'detail': 'Only the coach can admit.'}, status=HTTP_403_FORBIDDEN)
        booking.client_admit_status = 'admitted'
        booking.save(update_fields=['client_admit_status'])
        return Response({'status': 'admitted'})

    @action(detail=True, methods=['post'], url_path='deny')
    def deny(self, request, pk=None):
        booking = self.get_object()
        if booking.mentor.user_id != request.user.id:
            return Response({'detail': 'Only the coach can deny.'}, status=HTTP_403_FORBIDDEN)
        booking.client_admit_status = 'denied'
        booking.save(update_fields=['client_admit_status'])
        return Response({'status': 'denied'})

    # ── Guest invites (N4: add a 3rd/4th person to a 1:1 call) ──────────────
    @action(detail=True, methods=['post', 'delete'], url_path='guest-invite')
    def guest_invite(self, request, pk=None):
        """Coach turns the shareable guest link on (POST → returns a signed token
        to share) or off (DELETE). Guests still have to be admitted individually."""
        booking = self.get_object()
        if booking.mentor.user_id != request.user.id:
            return Response({'detail': 'Only the coach can invite guests.'}, status=HTTP_403_FORBIDDEN)
        if request.method == 'DELETE':
            booking.guest_link_active = False
            booking.save(update_fields=['guest_link_active'])
            booking.call_guests.filter(status='requested').update(status='denied')
            return Response({'active': False})
        from .services import booking_is_joinable
        if not booking_is_joinable(booking):
            return Response({'detail': 'This session is not open right now.'}, status=HTTP_400_BAD_REQUEST)
        booking.guest_link_active = True
        booking.save(update_fields=['guest_link_active'])
        from .livekit_views import make_guest_link_token
        return Response({'active': True, 'token': make_guest_link_token(booking)})

    @action(detail=True, methods=['get'], url_path='guest-pending')
    def guest_pending(self, request, pk=None):
        """Coach polls for guests waiting to be admitted + the link state."""
        booking = self.get_object()
        if booking.mentor.user_id != request.user.id:
            return Response({'detail': 'Permission denied.'}, status=HTTP_403_FORBIDDEN)
        waiting = [{'guest_uid': g.guest_uid, 'name': g.name}
                   for g in booking.call_guests.filter(status='requested').order_by('created_at')]
        return Response({'waiting': waiting, 'link_active': booking.guest_link_active})

    @action(detail=True, methods=['post'], url_path='guest-admit')
    def guest_admit(self, request, pk=None):
        booking = self.get_object()
        if booking.mentor.user_id != request.user.id:
            return Response({'detail': 'Only the coach can admit.'}, status=HTTP_403_FORBIDDEN)
        uid = request.data.get('guest_uid')
        updated = booking.call_guests.filter(guest_uid=uid, status='requested').update(status='admitted')
        if not updated:
            return Response({'detail': 'Guest not found.'}, status=HTTP_404_NOT_FOUND)
        return Response({'status': 'admitted'})

    @action(detail=True, methods=['post'], url_path='guest-deny')
    def guest_deny(self, request, pk=None):
        booking = self.get_object()
        if booking.mentor.user_id != request.user.id:
            return Response({'detail': 'Only the coach can deny.'}, status=HTTP_403_FORBIDDEN)
        uid = request.data.get('guest_uid')
        booking.call_guests.filter(guest_uid=uid).update(status='denied')
        return Response({'status': 'denied'})

    @action(detail=True, methods=['post'], url_path='guest-remove')
    def guest_remove(self, request, pk=None):
        """Coach removes a participant (an invited guest) from the live room."""
        booking = self.get_object()
        if booking.mentor.user_id != request.user.id:
            return Response({'detail': 'Only the coach can remove someone.'}, status=HTTP_403_FORBIDDEN)
        identity = request.data.get('identity') or ''
        from .livekit_views import remove_room_participant
        remove_room_participant(booking, identity)
        # If it's a guest, mark them denied so they can't immediately rejoin.
        if identity.startswith('guest-'):
            booking.call_guests.filter(guest_uid=identity[len('guest-'):]).update(status='denied')
        return Response({'ok': True})

    # Custom action for clients to cancel a booking
    @action(detail=True, methods=['patch'])
    def cancel(self, request, pk=None):
        booking = self.get_object()
        user = request.user

        # Security Check 1: Ensure it's a client who is cancelling
        if user.profile.role != 'client':
            return Response({'detail': 'Only a client can cancel a booking.'}, status=HTTP_403_FORBIDDEN)

        # Security Check 2: Ensure the learner owns this booking
        if booking.learner != user:
            return Response({'detail': 'You do not have permission to cancel this booking.'}, status=HTTP_403_FORBIDDEN)

        # Security Check 3: Only allow cancellation of pending or accepted bookings
        if booking.status not in ['pending', 'accepted']:
            return Response({'detail': 'This booking cannot be cancelled.'}, status=HTTP_400_BAD_REQUEST)

        # Late-cancellation policy: a PAID session cancelled within the notice
        # window (default 24h) is NOT refunded — the client is charged for the
        # late cancellation. Free sessions are always cancellable at no charge,
        # and a paid session cancelled early is refunded as normal.
        from django.conf import settings
        from .notifications import session_start_utc
        late_hours = getattr(settings, 'LATE_CANCEL_HOURS', 24)
        is_paid = booking.payment_status == 'paid' and (booking.amount_paid or 0) > 0
        start = session_start_utc(booking)
        within_window = bool(start and (start - dj_tz.now()).total_seconds() / 3600 < late_hours)
        late_charge = is_paid and within_window

        # Release the slot; refund unless it's a paid late cancellation. Both
        # parties are emailed (the coach must know their client dropped out).
        cancel_booking(booking, new_status='declined', refund=not late_charge, cancelled_by=user)

        data = self.get_serializer(booking).data
        data['late_cancellation'] = late_charge
        data['detail'] = (
            f'Your session was cancelled. As it was within {late_hours} hours of a paid session, '
            'the late-cancellation policy applies and it was not refunded.'
            if late_charge else 'Your session has been cancelled.'
        )
        return Response(data, status=HTTP_200_OK)

    @action(detail=True, methods=['patch'], url_path='coach-cancel')
    def coach_cancel(self, request, pk=None):
        """Coach cancels a confirmed session: releases the slot and refunds the client."""
        booking = self.get_object()
        user = request.user

        if user.profile.role != 'coach':
            return Response({'detail': 'Only a coach can cancel here.'}, status=HTTP_403_FORBIDDEN)
        if booking.mentor != user.profile:
            return Response({'detail': 'You can only cancel your own sessions.'}, status=HTTP_403_FORBIDDEN)
        if booking.status not in ['pending', 'accepted']:
            return Response({'detail': 'This session cannot be cancelled.'}, status=HTTP_400_BAD_REQUEST)

        cancel_booking(booking, new_status='declined', cancelled_by=user)

        serializer = self.get_serializer(booking)
        return Response(serializer.data, status=HTTP_200_OK)

    @action(detail=True, methods=['patch'], url_path='change-program')
    def change_program(self, request, pk=None):
        """Coach reassigns a booking to a different offering (program/service).

        Keeps the same slot/time and updates any pending reminders to show the
        new program name — without sending a new email. Self-service so the
        coach can correct a mis-booked program herself.
        """
        from skills.models import Skill
        booking = self.get_object()
        user = request.user

        if getattr(getattr(user, 'profile', None), 'role', None) != 'coach':
            return Response({'detail': "Only a coach can change a booking's program."}, status=HTTP_403_FORBIDDEN)
        if booking.mentor != user.profile:
            return Response({'detail': 'You can only change your own sessions.'}, status=HTTP_403_FORBIDDEN)
        if booking.status not in ['pending', 'accepted']:
            return Response({'detail': 'Only pending or accepted bookings can be changed.'}, status=HTTP_400_BAD_REQUEST)

        try:
            new_skill = Skill.objects.get(id=request.data.get('skill_id'), profile=user.profile)
        except Skill.DoesNotExist:
            return Response({'detail': 'Pick a valid offering of yours.'}, status=HTTP_400_BAD_REQUEST)
        if new_skill.id == booking.skill_id:
            return Response({'detail': "That is already this booking's program."}, status=HTTP_400_BAD_REQUEST)

        # Don't silently change the fee on a booking that was actually paid.
        old_price = float(booking.skill.price) if booking.skill else 0
        if float(new_skill.price) != old_price and float(booking.amount_paid or 0) > 0:
            return Response(
                {'detail': 'This booking was paid at a different price. Handle payment/refund before switching to a program with a different fee.'},
                status=HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            booking.skill = new_skill
            booking.save(update_fields=['skill'])
            from .notifications import retarget_booking_reminders
            retarget_booking_reminders(booking)

        # Reflect the new programme on any connected Google Calendars.
        try:
            from integrations.sync import sync_booking_updated
            sync_booking_updated(booking)
        except Exception:  # noqa: BLE001
            pass

        return Response(self.get_serializer(booking).data, status=HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def nudge(self, request, pk=None):
        """Coach pings the client 'I'm waiting — join now' with a one-click join
        link. Allowed near/after the start time, rate-limited to avoid spam."""
        from datetime import datetime as _dt, timezone as _tz, timedelta
        booking = self.get_object()
        user = request.user

        if getattr(getattr(user, 'profile', None), 'role', None) != 'coach' or booking.mentor != user.profile:
            return Response({'detail': 'Only the session coach can send this reminder.'}, status=HTTP_403_FORBIDDEN)
        if booking.status != 'accepted':
            return Response({'detail': 'You can only remind for a confirmed, active session.'}, status=HTTP_400_BAD_REQUEST)

        # Resolve the scheduled start/end.
        if booking.slot and booking.slot.start_datetime:
            start_dt, end_dt = booking.slot.start_datetime, booking.slot.end_datetime
        elif booking.session_date and booking.session_time:
            start_dt = _dt.combine(booking.session_date, booking.session_time).replace(tzinfo=_tz.utc)
            end_dt = start_dt + timedelta(minutes=booking.duration or 60)
        else:
            start_dt = end_dt = None

        now = dj_tz.now()
        if start_dt and now < start_dt - timedelta(minutes=30):
            return Response({'detail': "You can remind the client once the session is close to starting."},
                            status=HTTP_400_BAD_REQUEST)
        if end_dt and now > end_dt + timedelta(minutes=10):
            return Response({'detail': 'This session has already ended.'}, status=HTTP_400_BAD_REQUEST)

        # Rate-limit: one nudge per booking per 2 minutes.
        from django.core.cache import cache
        key = f'nudge:{booking.id}'
        if cache.get(key):
            return Response({'detail': 'You just reminded them — please wait a moment before trying again.'},
                            status=status.HTTP_429_TOO_MANY_REQUESTS)
        cache.set(key, True, 120)

        try:
            from .notifications import send_join_nudge
            send_join_nudge(booking)
        except Exception:  # noqa: BLE001
            return Response({'detail': 'Could not send the reminder. Please try again.'},
                            status=status.HTTP_502_BAD_GATEWAY)
        return Response({'detail': f'Reminder sent to {booking.learner.first_name or booking.learner.username}.'})


class TimeSlotViewSet(viewsets.ModelViewSet):
    """
    Coach-managed bookable time slots.

    Coaches see and manage only their own slots. Auto-generation from recurring
    availability is exposed via the `generate` action. Slots that are booked or
    held cannot be edited or deleted.
    """
    serializer_class = TimeSlotSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated or not hasattr(user, 'profile'):
            return TimeSlot.objects.none()
        if user.profile.role in ('coach', 'admin'):
            # select_related: the serializer reads coach.user.username per row.
            return (
                TimeSlot.objects
                .filter(coach=user.profile)
                .select_related('coach', 'coach__user', 'skill')
                .prefetch_related('invites')
            )
        return TimeSlot.objects.none()

    def _ensure_coach(self):
        user = self.request.user
        if not hasattr(user, 'profile') or user.profile.role not in ('coach', 'admin'):
            raise DRFValidationError("Only coaches can manage time slots.")
        return user.profile

    def perform_create(self, serializer):
        profile = self._ensure_coach()
        serializer.save(coach=profile, source='manual')

    def perform_update(self, serializer):
        self._ensure_coach()
        slot = serializer.instance
        if slot.coach.user != self.request.user:
            raise DRFValidationError("You can only manage your own slots.")
        if slot.status in ('booked', 'held'):
            raise DRFValidationError("A booked or held slot cannot be modified.")
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_coach()
        if instance.coach.user != self.request.user:
            raise DRFValidationError("You can only delete your own slots.")
        if instance.status in ('booked', 'held'):
            raise DRFValidationError("A booked or held slot cannot be deleted.")
        instance.delete()

    @action(detail=True, methods=['patch'])
    def block(self, request, pk=None):
        """Close an open slot (e.g. for time off) without deleting it."""
        slot = self.get_object()
        if slot.status not in ('open', 'blocked'):
            return Response({'detail': 'Only open slots can be blocked.'}, status=HTTP_400_BAD_REQUEST)
        slot.status = 'blocked'
        slot.save(update_fields=['status', 'updated_at'])
        return Response(self.get_serializer(slot).data)

    @action(detail=True, methods=['patch'])
    def unblock(self, request, pk=None):
        """Re-open a previously blocked slot."""
        slot = self.get_object()
        if slot.status != 'blocked':
            return Response({'detail': 'Only blocked slots can be unblocked.'}, status=HTTP_400_BAD_REQUEST)
        slot.status = 'open'
        slot.save(update_fields=['status', 'updated_at'])
        return Response(self.get_serializer(slot).data)

    @action(detail=False, methods=['post'])
    def generate(self, request):
        """
        Generate open slots from the coach's recurring availability windows.

        Optional body params:
          - horizon_days: rolling-horizon length (ignored if a date range is given).
          - start_date / end_date (YYYY-MM-DD): generate across this fixed local
            date range inclusive. Both must be supplied together.
        """
        profile = self._ensure_coach()
        horizon = request.data.get('horizon_days')
        start_raw = request.data.get('start_date')
        end_raw = request.data.get('end_date')

        if bool(start_raw) ^ bool(end_raw):
            return Response(
                {'detail': 'Provide both start_date and end_date, or neither.'},
                status=HTTP_400_BAD_REQUEST,
            )

        start_date = end_date = None
        if start_raw and end_raw:
            try:
                start_date = date_cls.fromisoformat(start_raw)
                end_date = date_cls.fromisoformat(end_raw)
            except ValueError:
                return Response(
                    {'detail': 'Dates must be in YYYY-MM-DD format.'},
                    status=HTTP_400_BAD_REQUEST,
                )
            if end_date < start_date:
                return Response(
                    {'detail': 'end_date cannot be before start_date.'},
                    status=HTTP_400_BAD_REQUEST,
                )

        result = generate_slots_for_coach(
            profile,
            horizon_days=int(horizon) if horizon else None,
            start_date=start_date,
            end_date=end_date,
        )
        return Response(result, status=HTTP_200_OK)

    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def available(self, request):
        """
        Public listing of bookable slots for a coach or skill.

        Open to guests so an un-authenticated visitor (e.g. someone who followed
        a coach's slot invite link) can browse times before signing in. Only
        future, open slots are returned; holding/booking still requires auth.
        """
        release_expired_holds()
        coach_id = request.query_params.get('coach')
        skill_id = request.query_params.get('skill')
        # The serializer reads coach.user.username on every row — pull the coach
        # and skill in with the slots instead of one lookup per slot.
        base = TimeSlot.objects.select_related('coach', 'coach__user', 'skill')

        from .services import min_notice_cutoff, locked_skill_id
        # E2: a programme-locked client only ever sees their own offering's slots.
        if request.user.is_authenticated:
            locked = locked_skill_id(request.user)
            if locked:
                if skill_id and int(skill_id) != int(locked):
                    return Response([])
                skill_id = skill_id or str(locked)
                coach_id = None  # skill implies the coach
        qs = base.filter(status='open')
        if skill_id:
            from skills.models import Skill
            try:
                skill = Skill.objects.select_related('profile').get(id=skill_id)
            except Skill.DoesNotExist:
                return Response({'detail': 'Skill not found.'}, status=status.HTTP_404_NOT_FOUND)
            coach = skill.profile
            # Slots tied to this coach, restricted to this skill or skill-agnostic.
            from django.db.models import Q
            qs = qs.filter(coach=coach).filter(Q(skill=skill) | Q(skill__isnull=True))
        elif coach_id:
            from profiles.models import UserProfile
            try:
                coach = UserProfile.objects.get(id=coach_id)
            except UserProfile.DoesNotExist:
                return Response({'detail': 'Coach not found.'}, status=status.HTTP_404_NOT_FOUND)
            qs = qs.filter(coach=coach)
        else:
            return Response({'detail': 'A coach or skill query param is required.'}, status=HTTP_400_BAD_REQUEST)

        # Enforce the coach's minimum-notice rule (e.g. no booking within 24h).
        qs = qs.filter(start_datetime__gt=min_notice_cutoff(coach))
        # Hide slots that clash with the coach's external Google Calendar
        # (best-effort — no-op if they haven't connected / disabled it).
        from integrations.availability import filter_open_slots
        slots = list(filter_open_slots(coach, qs))
        # When booking a specific skill, only offer start times where enough
        # contiguous open slots cover the skill's session length.
        if skill_id and skill and getattr(skill, 'duration_minutes', None):
            from .services import open_start_slots
            slots = open_start_slots(slots, skill.duration_minutes)
        serializer = self.get_serializer(slots, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def hold(self, request, pk=None):
        """Temporarily reserve an open slot while the client completes checkout."""
        release_expired_holds()
        with transaction.atomic():
            try:
                slot = TimeSlot.objects.select_for_update().get(pk=pk)
            except TimeSlot.DoesNotExist:
                return Response({'detail': 'Slot not found.'}, status=status.HTTP_404_NOT_FOUND)
            if slot.status != 'open':
                return Response({'detail': 'This slot is no longer available.'}, status=HTTP_400_BAD_REQUEST)
            # E2: a programme-locked client can only hold their own coach's slots.
            from .services import locked_skill_id
            locked = locked_skill_id(request.user)
            if locked:
                from skills.models import Skill
                locked_skill = Skill.objects.select_related('profile').filter(id=locked).first()
                if locked_skill and slot.coach_id != locked_skill.profile_id:
                    return Response(
                        {'detail': "You're enrolled in a specific programme and can only book that one."},
                        status=HTTP_403_FORBIDDEN,
                    )
            from .services import min_notice_cutoff
            if slot.start_datetime < min_notice_cutoff(slot.coach):
                hrs = slot.coach.min_notice_hours or 24
                return Response({'detail': f'This time is too soon — sessions must be booked at least {hrs} hours in advance.'},
                                status=HTTP_400_BAD_REQUEST)
            slot.status = 'held'
            slot.held_until = dj_tz.now() + timedelta(minutes=HOLD_MINUTES)
            slot.held_by = request.user
            slot.save(update_fields=['status', 'held_until', 'held_by', 'updated_at'])
        return Response(self.get_serializer(slot).data, status=HTTP_200_OK)

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def release(self, request, pk=None):
        """Release a held slot back to open (e.g. client abandoned checkout)."""
        with transaction.atomic():
            try:
                slot = TimeSlot.objects.select_for_update().get(pk=pk)
            except TimeSlot.DoesNotExist:
                return Response({'detail': 'Slot not found.'}, status=status.HTTP_404_NOT_FOUND)
            # Only the client holding the slot may release it.
            if slot.status == 'held' and slot.held_by_id == request.user.id:
                slot.status = 'open'
                slot.held_until = None
                slot.held_by = None
                slot.save(update_fields=['status', 'held_until', 'held_by', 'updated_at'])
        return Response(self.get_serializer(slot).data, status=HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def invite(self, request, pk=None):
        """Email a slot invite link to a recipient (coach-only)."""
        self._ensure_coach()
        slot = self.get_object()  # queryset restricts to this coach's own slots
        if slot.coach.user != request.user:
            return Response({'detail': 'You can only share your own slots.'}, status=HTTP_403_FORBIDDEN)
        if slot.status != 'open':
            return Response({'detail': 'Only open slots can be shared.'}, status=HTTP_400_BAD_REQUEST)

        note = (request.data.get('message') or '').strip()

        # Recipients may be a list, or one string with addresses separated by
        # ';', ',' or newlines. Dedupe (case-insensitive) and validate.
        import re
        from django.core.validators import validate_email
        from django.core.exceptions import ValidationError
        raw = request.data.get('emails', request.data.get('email', ''))
        candidates = raw if isinstance(raw, list) else re.split(r'[;,\n]+', str(raw))
        seen, valid, invalid = set(), [], []
        for e in candidates:
            e = (e or '').strip()
            if not e or e.lower() in seen:
                continue
            seen.add(e.lower())
            try:
                validate_email(e)
                valid.append(e)
            except ValidationError:
                invalid.append(e)
        if not valid:
            return Response({'detail': 'Enter at least one valid recipient email.'}, status=HTTP_400_BAD_REQUEST)

        from skills.models import Skill
        try:
            skill = Skill.objects.get(id=request.data.get('skill_id'), profile=slot.coach)
        except Skill.DoesNotExist:
            return Response({'detail': 'Pick a valid offering for this invite.'}, status=HTTP_400_BAD_REQUEST)

        # Optional documents to attach (D3). Only the coach's own library files
        # are eligible; unknown/foreign ids are silently ignored.
        from resources.models import Resource
        raw_ids = request.data.get('resource_ids', [])
        if not isinstance(raw_ids, list):
            raw_ids = [raw_ids]
        resource_ids = [i for i in raw_ids if i not in (None, '')]
        resources = list(
            Resource.objects.filter(id__in=resource_ids, coach=slot.coach)
        ) if resource_ids else []

        # Send each recipient their own copy (so addresses aren't exposed to others).
        sent_addrs, failed = [], []
        for addr in valid:
            if send_slot_invite_email(slot, skill, addr, note, resources=resources):
                sent_addrs.append(addr)
            else:
                failed.append(addr)

        sent = len(sent_addrs)
        if sent == 0:
            return Response({'detail': 'Could not send the invite. Please try again.'},
                            status=status.HTTP_502_BAD_GATEWAY)

        # Record the invites so the calendar can show this slot has pending
        # invites, and so the history/resend can reproduce this exact email.
        from django.utils import timezone as dj_timezone
        from django.db.models import F
        from .models import SlotInvite
        now = dj_timezone.now()
        for addr in sent_addrs:
            invite, created = SlotInvite.objects.update_or_create(
                slot=slot, email=addr,
                defaults={'skill': skill, 'note': note, 'last_sent_at': now},
            )
            if not created:
                SlotInvite.objects.filter(pk=invite.pk).update(sent_count=F('sent_count') + 1)
            # Record which documents went out so a resend reproduces them.
            invite.attached_resources.set(resources)

        # Confirmation summary to the coach: who they just invited (best-effort).
        if slot.coach.user.email:
            from notifications.services import send_email
            from .notifications import _display_name, _fmt_when
            coach_name = _display_name(slot.coach.user)
            when = _fmt_when(slot.start_datetime, getattr(slot.coach, 'timezone', 'UTC'))
            link = f"{settings.SITE_URL}/book/{skill.id}?slot={slot.id}"
            send_email(
                to=slot.coach.user.email,
                subject=f"Invitations sent — {skill.name}",
                template='slot_invite_summary',
                context={
                    'coach_name': coach_name,
                    'skill_name': skill.name,
                    'when': when,
                    'link': link,
                    'recipients': sent_addrs,
                    'count': sent,
                    'note': note,
                },
            )

        detail = f"Invite sent to {sent} recipient{'s' if sent != 1 else ''}."
        if invalid:
            detail += f" Skipped invalid: {', '.join(invalid)}."
        if failed:
            detail += f" Failed: {', '.join(failed)}."
        return Response({'detail': detail, 'sent': sent}, status=HTTP_200_OK)


class SlotInviteViewSet(viewsets.ReadOnlyModelViewSet):
    """The coach's "Sent Invites" history, plus one-click resend.

    Lists every invite the coach has emailed (newest send first) and lets them
    re-send a still-pending invite without re-typing the recipient or message.
    """
    serializer_class = SlotInviteSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated or not hasattr(user, 'profile'):
            return SlotInvite.objects.none()
        if user.profile.role in ('coach', 'admin'):
            return (
                SlotInvite.objects
                .filter(slot__coach=user.profile)
                .select_related('skill', 'slot', 'slot__skill', 'slot__booking', 'slot__booking__learner', 'slot__coach__user')
                .prefetch_related('attached_resources')
            )
        return SlotInvite.objects.none()

    def get_serializer_context(self):
        # Whether the coach has any offering — lets the serializer mark legacy
        # (skill-less) invites resendable without a per-row query.
        ctx = super().get_serializer_context()
        user = self.request.user
        from skills.models import Skill
        ctx['coach_has_skills'] = (
            user.is_authenticated and hasattr(user, 'profile')
            and Skill.objects.filter(profile=user.profile).exists()
        )
        return ctx

    @action(detail=True, methods=['post'])
    def resend(self, request, pk=None):
        """Re-email a pending invite, reproducing the original skill + note.

        Resolves the booking link's offering from the invite, the slot, or — for
        legacy invites that predate skill capture — the coach's first offering,
        then persists it so the row shows the offering from then on.
        """
        from skills.models import Skill
        invite = self.get_object()  # queryset already restricts to this coach
        slot = invite.slot

        if slot.status != 'open':
            return Response({'detail': 'This slot is no longer open, so the invite can\'t be resent.'},
                            status=HTTP_400_BAD_REQUEST)
        if slot.start_datetime < dj_tz.now():
            return Response({'detail': 'This slot has already passed.'}, status=HTTP_400_BAD_REQUEST)

        skill = invite.skill or slot.skill or Skill.objects.filter(profile=slot.coach).first()
        if skill is None:
            return Response({'detail': 'Add an offering first, then resend this invite.'},
                            status=HTTP_400_BAD_REQUEST)

        resources = list(invite.attached_resources.all())
        if not send_slot_invite_email(slot, skill, invite.email, invite.note, resources=resources):
            return Response({'detail': 'Could not resend the invite. Please try again.'},
                            status=status.HTTP_502_BAD_GATEWAY)

        # Backfill the resolved skill so the history row no longer shows "—".
        if invite.skill_id is None:
            invite.skill = skill
        invite.sent_count = (invite.sent_count or 0) + 1
        invite.last_sent_at = dj_tz.now()
        invite.save(update_fields=['skill', 'sent_count', 'last_sent_at'])

        data = self.get_serializer(invite).data
        return Response({'detail': f'Invite resent to {invite.email}.', 'invite': data}, status=HTTP_200_OK)


class GroupSessionViewSet(viewsets.ModelViewSet):
    """
    Coach-managed group sessions (one event, many paying clients, capped capacity).

    Coaches CRUD their own sessions and view rosters. Clients browse bookable
    sessions via `available` and reserve a seat via `hold` (then pay through
    the group payment endpoints). Capacity is a hard stop.
    """
    serializer_class = GroupSessionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated or not hasattr(user, 'profile'):
            return GroupSession.objects.none()
        if user.profile.role in ('coach', 'admin'):
            return GroupSession.objects.filter(coach=user.profile)
        return GroupSession.objects.none()

    def _ensure_coach(self):
        user = self.request.user
        if not hasattr(user, 'profile') or user.profile.role not in ('coach', 'admin'):
            raise DRFValidationError("Only coaches can manage group sessions.")
        return user.profile

    def perform_create(self, serializer):
        profile = self._ensure_coach()
        serializer.save(coach=profile)

    def perform_update(self, serializer):
        self._ensure_coach()
        session = serializer.instance
        if session.coach.user != self.request.user:
            raise DRFValidationError("You can only manage your own sessions.")
        if session.enrollments.filter(status='booked').exists():
            raise DRFValidationError("This session has paid participants and cannot be edited. Cancel it instead.")
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_coach()
        if instance.coach.user != self.request.user:
            raise DRFValidationError("You can only delete your own sessions.")
        if instance.enrollments.filter(status='booked').exists():
            raise DRFValidationError("This session has paid participants and cannot be deleted. Cancel it instead.")
        instance.delete()

    @action(detail=True, methods=['get'])
    def roster(self, request, pk=None):
        """Coach-only list of (non-cancelled) participants for one session."""
        session = self.get_object()
        enrollments = session.enrollments.exclude(status='cancelled').select_related('learner')
        return Response(GroupEnrollmentSerializer(enrollments, many=True).data)

    @action(detail=True, methods=['patch'])
    def cancel(self, request, pk=None):
        """Coach cancels the whole session and refunds every paid seat."""
        session = self.get_object()
        if session.coach.user != request.user:
            return Response({'detail': 'You can only cancel your own sessions.'}, status=HTTP_403_FORBIDDEN)
        if session.status in ('completed', 'cancelled'):
            return Response({'detail': 'This session cannot be cancelled.'}, status=HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            for enr in session.enrollments.filter(status__in=('held', 'booked')):
                if enr.payment_status == 'paid' and enr.payment_intent_id:
                    try:
                        stripe.api_key = settings.STRIPE_SECRET_KEY
                        stripe.Refund.create(payment_intent=enr.payment_intent_id)
                        enr.payment_status = 'refunded'
                    except Exception as e:
                        print(f"Refund failed for enrollment {enr.id}: {e}")
                enr.status = 'cancelled'
                enr.held_until = None
                enr.save(update_fields=['status', 'held_until', 'payment_status', 'updated_at'])
            session.status = 'cancelled'
            session.save(update_fields=['status', 'updated_at'])
        # Stop any pending reminders for the cancelled session.
        try:
            from .notifications import cancel_group_notifications
            cancel_group_notifications(session)
        except Exception as e:  # noqa: BLE001
            print(f"Failed to cancel group notifications for session {session.id}: {e}")
        return Response(self.get_serializer(session).data)

    @action(detail=False, methods=['get'])
    def available(self, request):
        """Authenticated listing of upcoming, bookable group sessions for clients."""
        release_expired_holds()
        qs = GroupSession.objects.filter(status='scheduled', end_datetime__gt=dj_tz.now())
        coach_id = request.query_params.get('coach')
        skill_id = request.query_params.get('skill')
        if coach_id:
            qs = qs.filter(coach_id=coach_id)
        if skill_id:
            qs = qs.filter(skill_id=skill_id)
        return Response(self.get_serializer(qs, many=True).data)

    @action(detail=True, methods=['get', 'post'], url_path='messages')
    def messages(self, request, pk=None):
        """Group chat history (GET) and file uploads (POST) — coach or booked
        client only. Text messages travel over the WebSocket; file attachments
        come through this POST endpoint and are then broadcast to the group."""
        from messages.models import GroupMessage
        from messages.serializers import GroupMessageSerializer
        from messages.views import broadcast_group_message
        session = get_object_or_404(GroupSession, pk=pk)
        user = request.user
        is_coach = session.coach.user_id == user.id
        is_booked = session.enrollments.filter(learner=user, status='booked').exists()
        if not (is_coach or is_booked):
            return Response({'detail': 'Not allowed.'}, status=HTTP_403_FORBIDDEN)

        if request.method == 'POST':
            serializer = GroupMessageSerializer(data=request.data, context={'request': request})
            serializer.is_valid(raise_exception=True)
            attachment = serializer.validated_data.get('attachment')
            extra = {}
            if attachment:
                extra = {
                    'attachment_name': (getattr(attachment, 'name', '') or '')[:255],
                    'attachment_size': getattr(attachment, 'size', None),
                    'content_type': getattr(attachment, 'content_type', '') or '',
                }
            message = serializer.save(group_session=session, sender=user, **extra)
            if attachment:
                broadcast_group_message(message)
            return Response(GroupMessageSerializer(message, context={'request': request}).data, status=201)

        qs = GroupMessage.objects.filter(group_session=session).select_related('sender')
        return Response(GroupMessageSerializer(qs, many=True, context={'request': request}).data)

    @action(detail=False, methods=['get'])
    def mine(self, request):
        """The current client's booked group sessions (for My Learning)."""
        enrollments = (
            GroupEnrollment.objects
            .filter(learner=request.user, status='booked')
            .select_related('group_session', 'group_session__coach__user')
            .order_by('group_session__start_datetime')
        )
        return Response(MyGroupEnrollmentSerializer(enrollments, many=True).data)

    @action(detail=True, methods=['post'])
    def hold(self, request, pk=None):
        """Reserve a seat for the client while they complete checkout."""
        release_expired_holds()
        try:
            enrollment = reserve_seat(pk, request.user)
        except GroupSession.DoesNotExist:
            return Response({'detail': 'Session not found.'}, status=status.HTTP_404_NOT_FOUND)
        except SeatUnavailable as e:
            return Response({'detail': str(e)}, status=HTTP_400_BAD_REQUEST)
        return Response(GroupEnrollmentSerializer(enrollment).data, status=HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def release(self, request, pk=None):
        """Release the client's own held seat back to the pool."""
        with transaction.atomic():
            session = get_object_or_404(GroupSession, pk=pk)
            enr = session.enrollments.select_for_update().filter(learner=request.user, status='held').first()
            if enr:
                enr.status = 'cancelled'
                enr.held_until = None
                enr.save(update_fields=['status', 'held_until', 'updated_at'])
                if session.status == 'full' and session.seats_taken < session.capacity:
                    session.status = 'scheduled'
                    session.save(update_fields=['status', 'updated_at'])
        return Response({'detail': 'Released.'}, status=HTTP_200_OK)

    @action(detail=True, methods=['patch'], url_path='leave')
    def leave(self, request, pk=None):
        """Client cancels their booked seat: refund and free the seat."""
        with transaction.atomic():
            session = get_object_or_404(GroupSession.objects.select_for_update(), pk=pk)
            enr = session.enrollments.select_for_update().filter(learner=request.user, status='booked').first()
            if not enr:
                return Response({'detail': 'You are not enrolled in this session.'}, status=HTTP_400_BAD_REQUEST)
            if session.start_datetime <= dj_tz.now():
                return Response({'detail': 'This session has already started and cannot be cancelled.'}, status=HTTP_400_BAD_REQUEST)

            if enr.payment_status == 'paid' and enr.payment_intent_id:
                try:
                    stripe.api_key = settings.STRIPE_SECRET_KEY
                    stripe.Refund.create(payment_intent=enr.payment_intent_id)
                    enr.payment_status = 'refunded'
                except Exception as e:
                    print(f"Refund failed for enrollment {enr.id}: {e}")

            enr.status = 'cancelled'
            enr.held_until = None
            enr.save(update_fields=['status', 'held_until', 'payment_status', 'updated_at'])
            if session.status == 'full' and session.seats_taken < session.capacity:
                session.status = 'scheduled'
                session.save(update_fields=['status', 'updated_at'])
        # Cancel just this attendee's pending reminders (others keep theirs).
        try:
            from .notifications import cancel_group_enrollment_notifications
            cancel_group_enrollment_notifications(enr)
        except Exception as e:  # noqa: BLE001
            print(f"Failed to cancel notifications for enrollment {enr.id}: {e}")
        return Response(self.get_serializer(session).data, status=HTTP_200_OK)


class ReviewViewSet(viewsets.ModelViewSet):
    serializer_class = ReviewSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'delete'] # Limit allowed methods

    def get_queryset(self):
        if not hasattr(self.request.user, 'profile'):
            return Review.objects.none()

        if self.request.user.profile.role == 'coach':
            return Review.objects.filter(mentor_profile__user=self.request.user)
        elif self.request.user.profile.role == 'client':
            return Review.objects.filter(student=self.request.user)
        return Review.objects.none() # Default for other roles or no profile

    def perform_create(self, serializer):
        # The context is already available in the serializer, just save it
        serializer.save()

    def perform_destroy(self, instance):
        if instance.student != self.request.user and instance.mentor_profile.user != self.request.user:
            raise DRFValidationError("You do not have permission to delete this review.")
        
        instance.delete()

import stripe
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

stripe.api_key = settings.STRIPE_SECRET_KEY

class CreatePaymentIntentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        # (No request-body logging here — this is the payment path; dumping the
        # raw body into the server log is how card/PII data ends up in plain text.)
        skill_id = request.data.get('skill_id')
        try:
            duration = int(request.data.get('duration', 60))
        except (TypeError, ValueError):
            return Response({'error': 'Invalid duration.'}, status=status.HTTP_400_BAD_REQUEST)
        # Bound the duration: it scales the amount, and a negative/huge value
        # would mint a nonsense PaymentIntent.
        if duration < 1 or duration > 480:
            return Response({'error': 'Invalid duration.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            from skills.models import Skill
            skill = Skill.objects.get(id=skill_id)
        except Skill.DoesNotExist:
            return Response({'error': 'Skill not found'}, status=status.HTTP_404_NOT_FOUND)

        # Calculate amount: hourly rate * (duration/60)
        hourly_rate = float(skill.price)
        amount = hourly_rate * (duration / 60)
        amount_cents = int(amount * 100)  # Stripe uses cents

        try:
            intent = stripe.PaymentIntent.create(
                amount=amount_cents,
                currency='usd',
                metadata={
                    'skill_id': skill_id,
                    'user_id': request.user.id,
                    'duration': duration,
                }
            )
            return Response({
                'client_secret': intent.client_secret,
                'amount': amount,
                'publishable_key': settings.STRIPE_PUBLISHABLE_KEY,
            })
        except stripe.error.StripeError as e:
            print("STRIPE ERROR:", str(e))  # add this
            print("STRIPE ERROR BODY:", e.user_message)  # add this
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            print("GENERAL ERROR:", str(e))  # add this
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class ConfirmBookingPaymentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        payment_intent_id = request.data.get('payment_intent_id')
        booking_data = request.data.get('booking_data')

        try:
            intent = stripe.PaymentIntent.retrieve(payment_intent_id)
        except stripe.error.StripeError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        if intent.status != 'succeeded':
            return Response({'error': 'Payment not completed'}, status=status.HTTP_400_BAD_REQUEST)

        # Create the booking now that payment is confirmed
        from skills.models import Skill

        slot_id = booking_data.get('slot_id')
        if not slot_id:
            return Response({'error': 'A time slot is required to book a session.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # ── Bind the payment to THIS user and THIS session ────────────────────
        # A succeeded PaymentIntent alone proves only that *someone* paid *some*
        # amount for *something*. CreatePaymentIntentView stamps the buyer, the
        # offering and the duration into the intent's metadata; without checking
        # them here, a caller could pay for the cheapest offering and confirm a
        # booking for an expensive one, or replay one payment into many bookings.
        meta = intent.metadata or {}
        if str(meta.get('user_id') or '') != str(request.user.id):
            return Response({'error': 'This payment does not belong to your account.'},
                            status=status.HTTP_403_FORBIDDEN)
        if str(meta.get('skill_id') or '') != str(booking_data.get('skill') or ''):
            return Response({'error': 'This payment was made for a different session.'},
                            status=status.HTTP_400_BAD_REQUEST)
        # One payment, one booking.
        if SessionBooking.objects.filter(payment_intent_id=payment_intent_id).exists():
            return Response({'error': 'This payment has already been used for a booking.'},
                            status=status.HTTP_409_CONFLICT)

        try:
            with transaction.atomic():
                skill = Skill.objects.get(id=booking_data['skill'])
                mentor_profile = skill.profile

                # And that the amount actually covers the current price — the
                # offering's price could have changed after the intent was made.
                slot_for_price = TimeSlot.objects.filter(id=slot_id).first()
                billed_minutes = slot_for_price.duration_minutes if slot_for_price else 60
                expected_cents = int(round(float(skill.price) * (billed_minutes / 60) * 100))
                paid_cents = int(getattr(intent, 'amount_received', None) or intent.amount or 0)
                if paid_cents < expected_cents:
                    return Response(
                        {'error': 'The amount paid does not cover this session.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                # E2: a programme-locked client may only book their offering.
                from .services import program_lock_error
                lock_err = program_lock_error(request.user, skill)
                if lock_err:
                    return Response({'error': lock_err}, status=status.HTTP_403_FORBIDDEN)

                # Lock the slot and verify it is still ours to book.
                slot = TimeSlot.objects.select_for_update().get(id=slot_id)
                if slot.status == 'booked':
                    return Response(
                        {'error': 'This time slot was just booked by someone else. Please pick another.'},
                        status=status.HTTP_409_CONFLICT,
                    )
                # A slot held by another client cannot be booked out from under them.
                if slot.status == 'held' and slot.held_by_id and slot.held_by_id != request.user.id:
                    return Response(
                        {'error': 'This time slot is reserved by someone else. Please pick another.'},
                        status=status.HTTP_409_CONFLICT,
                    )
                if slot.coach_id != mentor_profile.id:
                    return Response({'error': 'Slot does not belong to this coach.'},
                                    status=status.HTTP_400_BAD_REQUEST)
                from .services import min_notice_cutoff
                if slot.start_datetime < min_notice_cutoff(mentor_profile):
                    hrs = mentor_profile.min_notice_hours or 24
                    return Response({'error': f'This time is too soon — sessions must be booked at least {hrs} hours in advance.'},
                                    status=status.HTTP_400_BAD_REQUEST)
                session_date = slot.start_datetime.date()
                session_time = slot.start_datetime.time()
                duration = skill.duration_minutes or slot.duration_minutes

                # Reserve the full session length across the shared grid.
                try:
                    _consume_covering_slots(mentor_profile, slot, duration, request.user)
                except ValueError as ve:
                    return Response({'error': str(ve)}, status=status.HTTP_409_CONFLICT)

                booking = SessionBooking.objects.create(
                    learner=request.user,
                    mentor=mentor_profile,
                    skill=skill,
                    session_date=session_date,
                    session_time=session_time,
                    duration=duration,
                    skill_level=booking_data.get('skill_level', 'Beginner'),
                    message=booking_data.get('message', ''),
                    status='accepted',  # slot booking is auto-confirmed
                    payment_intent_id=payment_intent_id,
                    payment_status='paid',
                    amount_paid=intent.amount / 100,
                    slot=slot,
                )

            # Notify both parties (confirmation now + reminders later). Best-effort:
            # email scheduling must never fail a paid booking.
            try:
                from .notifications import schedule_booking_notifications
                schedule_booking_notifications(booking)
            except Exception as notify_err:  # noqa: BLE001
                print(f"Booking {booking.id} created but notification scheduling failed: {notify_err}")

            # Mirror onto any connected Google Calendars (best-effort).
            try:
                from integrations.sync import sync_booking_created
                sync_booking_created(booking)
            except Exception:  # noqa: BLE001
                pass

            return Response({'booking_id': booking.id, 'status': 'paid'})
        except TimeSlot.DoesNotExist:
            return Response({'error': 'Selected slot no longer exists.'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


def _consume_covering_slots(coach, start_slot, duration_minutes, user):
    """Lock and mark as booked the contiguous slots that cover `duration_minutes`
    from `start_slot`. Returns the list. Raises ValueError (with a friendly
    message) if the window isn't fully open. Blocks the exact length across all
    skills on the shared grid."""
    from .services import booking_slots
    covering = booking_slots(coach, start_slot, duration_minutes)
    if not covering:
        raise ValueError('This time is no longer fully available — please pick another.')
    ids = [s.id for s in covering]
    locked = list(TimeSlot.objects.select_for_update().filter(id__in=ids).order_by('start_datetime'))
    uid = user.id if user else None
    for s in locked:
        if s.status == 'booked':
            raise ValueError('This time was just booked by someone else — please pick another.')
        if s.status == 'held' and s.held_by_id and s.held_by_id != uid:
            raise ValueError('This time is reserved by someone else — please pick another.')

    duration = duration_minutes or start_slot.duration_minutes
    end_needed = start_slot.start_datetime + timedelta(minutes=duration)
    booked = []
    for s in locked:
        # If a slot runs past what this session needs, split the tail off as a
        # fresh open slot so the leftover time stays bookable (e.g. a 30-min call
        # on a 60-min slot books 2:00–2:30 and leaves 2:30–3:00 open).
        if s.end_datetime > end_needed:
            TimeSlot.objects.create(
                coach=s.coach, skill=s.skill,
                start_datetime=end_needed, end_datetime=s.end_datetime,
                status='open', source=s.source,
            )
            s.end_datetime = end_needed
        s.status = 'booked'
        s.held_until = None
        s.held_by = None
        s.save(update_fields=['status', 'held_until', 'held_by', 'end_datetime', 'updated_at'])
        booked.append(s)
    return booked


class ChemistryInfoView(APIView):
    """Public: the free Chemistry Session offering + its intake questions (F5/F6).

    Returns the skill marked is_chemistry plus the coach's intake form for it, so a
    web visitor can complete the intake before the calendar unlocks. AllowAny."""
    permission_classes = [AllowAny]

    def get(self, request):
        from skills.models import Skill
        from formbuilder.models import FormTemplate
        skill = (
            Skill.objects.filter(is_chemistry=True, active=True)
            .select_related('profile__user').first()
        )
        if not skill:
            return Response({'detail': 'No chemistry session is available right now.'},
                            status=status.HTTP_404_NOT_FOUND)
        coach = skill.profile.user
        tmpl = (
            FormTemplate.objects.filter(skill=skill, kind='intake', active=True)
            .order_by('-updated_at').first()
        )
        return Response({
            'skill_id': skill.id,
            'name': skill.name,
            'description': skill.description or '',
            'coach_name': f"{coach.first_name} {coach.last_name}".strip() or coach.username,
            'intake': {
                'title': tmpl.title if tmpl else 'Tell us a little about you',
                'description': tmpl.description if tmpl else '',
                'questions': tmpl.questions if tmpl else [],
            },
        })


class ConfirmFreeBookingView(APIView):
    """
    Book a free ($0) session — no Stripe involved.

    Mirrors ConfirmBookingPaymentView's slot handling but skips payment. The
    skill price is re-checked server-side so a paid offering can never be booked
    for free by a crafted request.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        booking_data = request.data.get('booking_data') or {}
        slot_id = booking_data.get('slot_id')
        if not slot_id:
            return Response({'error': 'A time slot is required to book a session.'},
                            status=status.HTTP_400_BAD_REQUEST)

        from skills.models import Skill
        try:
            with transaction.atomic():
                skill = Skill.objects.get(id=booking_data['skill'])
                # Authoritative check: only genuinely free offerings skip payment.
                if float(skill.price) != 0:
                    return Response({'error': 'This session requires payment.'},
                                    status=status.HTTP_400_BAD_REQUEST)
                mentor_profile = skill.profile

                # E2: a programme-locked client may only book their offering.
                from .services import program_lock_error
                lock_err = program_lock_error(request.user, skill)
                if lock_err:
                    return Response({'error': lock_err}, status=status.HTTP_403_FORBIDDEN)

                slot = TimeSlot.objects.select_for_update().get(id=slot_id)
                if slot.status == 'booked':
                    return Response(
                        {'error': 'This time slot was just booked by someone else. Please pick another.'},
                        status=status.HTTP_409_CONFLICT,
                    )
                if slot.status == 'held' and slot.held_by_id and slot.held_by_id != request.user.id:
                    return Response(
                        {'error': 'This time slot is reserved by someone else. Please pick another.'},
                        status=status.HTTP_409_CONFLICT,
                    )
                if slot.coach_id != mentor_profile.id:
                    return Response({'error': 'Slot does not belong to this coach.'},
                                    status=status.HTTP_400_BAD_REQUEST)
                from .services import min_notice_cutoff
                if slot.start_datetime < min_notice_cutoff(mentor_profile):
                    hrs = mentor_profile.min_notice_hours or 24
                    return Response({'error': f'This time is too soon — sessions must be booked at least {hrs} hours in advance.'},
                                    status=status.HTTP_400_BAD_REQUEST)

                duration = skill.duration_minutes or slot.duration_minutes
                try:
                    _consume_covering_slots(mentor_profile, slot, duration, request.user)
                except ValueError as ve:
                    return Response({'error': str(ve)}, status=status.HTTP_409_CONFLICT)
                booking = SessionBooking.objects.create(
                    learner=request.user,
                    mentor=mentor_profile,
                    skill=skill,
                    session_date=slot.start_datetime.date(),
                    session_time=slot.start_datetime.time(),
                    duration=duration,
                    skill_level=booking_data.get('skill_level', 'Beginner'),
                    message=booking_data.get('message', ''),
                    status='accepted',
                    payment_status='paid',  # nothing owed
                    amount_paid=0,
                    slot=slot,
                )

            try:
                from .notifications import schedule_booking_notifications
                schedule_booking_notifications(booking)
            except Exception as notify_err:  # noqa: BLE001
                print(f"Free booking {booking.id} created but notification scheduling failed: {notify_err}")

            # Mirror onto any connected Google Calendars (best-effort).
            try:
                from integrations.sync import sync_booking_created
                sync_booking_created(booking)
            except Exception:  # noqa: BLE001
                pass

            return Response({'booking_id': booking.id, 'status': 'free'})
        except TimeSlot.DoesNotExist:
            return Response({'error': 'Selected slot no longer exists.'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class ChemistryBookView(APIView):
    """Public: book the free Chemistry Session after the intake (F5/F6).

    Body: { name, email, answers: {qid: value}, slot_id }. Finds or creates a
    client account from the email (new accounts get an activation link), books
    the free session, and stores the intake answers as a completed form the coach
    can read. AllowAny."""
    permission_classes = [AllowAny]

    def post(self, request):
        from django.conf import settings
        from django.core.validators import validate_email
        from django.core.exceptions import ValidationError as DjValidationError
        from django.utils.http import urlsafe_base64_encode
        from django.utils.encoding import force_bytes
        from django.contrib.auth.tokens import default_token_generator
        from skills.models import Skill
        from formbuilder.models import FormTemplate, FormAssignment
        from notifications.services import send_email

        name = (request.data.get('name') or '').strip()
        email = (request.data.get('email') or '').strip().lower()
        answers = request.data.get('answers') or {}
        slot_id = request.data.get('slot_id')

        if not email:
            return Response({'detail': 'Your email is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_email(email)
        except DjValidationError:
            return Response({'detail': 'Please enter a valid email address.'}, status=status.HTTP_400_BAD_REQUEST)
        if not slot_id:
            return Response({'detail': 'Please choose a time.'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(answers, dict):
            answers = {}

        skill = (
            Skill.objects.filter(is_chemistry=True, active=True)
            .select_related('profile__user').first()
        )
        if not skill:
            return Response({'detail': 'No chemistry session is available right now.'},
                            status=status.HTTP_404_NOT_FOUND)
        if float(skill.price) != 0:
            return Response({'detail': 'This session is not free.'}, status=status.HTTP_400_BAD_REQUEST)
        coach = skill.profile

        # Required intake questions must be answered.
        tmpl = (
            FormTemplate.objects.filter(skill=skill, kind='intake', active=True)
            .order_by('-updated_at').first()
        )
        questions = tmpl.questions if tmpl else []
        for q in questions:
            if q.get('required') and answers.get(q.get('id')) in (None, '', []):
                return Response({'detail': f"Please answer: {q.get('label')}"},
                                status=status.HTTP_400_BAD_REQUEST)

        # Find or provision the client account.
        account_created = False
        parts = name.split()
        first = parts[0] if parts else ''
        last = ' '.join(parts[1:]) if len(parts) > 1 else ''
        user = CustomUser.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).first()
        if not user:
            try:
                with transaction.atomic():
                    user = CustomUser.objects.create(
                        username=email, email=email, first_name=first, last_name=last, is_active=True,
                    )
                    user.set_unusable_password()
                    user.save(update_fields=['password'])
                    prof = user.profile
                    prof.role = 'client'
                    prof.save(update_fields=['role'])
                account_created = True
            except Exception as exc:  # noqa: BLE001
                return Response({'detail': f'Could not create your account: {exc}'},
                                status=status.HTTP_400_BAD_REQUEST)

        # Book the slot.
        try:
            with transaction.atomic():
                slot = TimeSlot.objects.select_for_update().get(id=slot_id)
                if slot.coach_id != coach.id or (slot.skill_id and slot.skill_id != skill.id):
                    return Response({'detail': 'That time is not available.'}, status=status.HTTP_400_BAD_REQUEST)
                if slot.status == 'booked':
                    return Response({'detail': 'That time was just booked. Please pick another.'}, status=status.HTTP_409_CONFLICT)
                if slot.status == 'held' and slot.held_by_id and slot.held_by_id != user.id:
                    return Response({'detail': 'That time is reserved. Please pick another.'}, status=status.HTTP_409_CONFLICT)
                duration = skill.duration_minutes or slot.duration_minutes
                try:
                    _consume_covering_slots(coach, slot, duration, user)
                except ValueError as ve:
                    return Response({'detail': str(ve)}, status=status.HTTP_409_CONFLICT)
                booking = SessionBooking.objects.create(
                    learner=user, mentor=coach, skill=skill,
                    session_date=slot.start_datetime.date(),
                    session_time=slot.start_datetime.time(),
                    duration=duration,
                    status='accepted', payment_status='paid', amount_paid=0, slot=slot,
                    message='Chemistry session (booked via public intake).',
                )
                if questions or answers:
                    FormAssignment.objects.create(
                        template=tmpl, coach=coach, client=user, booking=booking,
                        title=(tmpl.title if tmpl else 'Chemistry Session Intake'),
                        description=(tmpl.description if tmpl else ''),
                        kind='intake', questions_snapshot=questions, answers=answers,
                        status='completed', completed_at=dj_tz.now(),
                    )
        except TimeSlot.DoesNotExist:
            return Response({'detail': 'That time no longer exists.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            from .notifications import schedule_booking_notifications
            schedule_booking_notifications(booking)
        except Exception:  # noqa: BLE001
            pass
        try:
            from integrations.sync import sync_booking_created
            sync_booking_created(booking)
        except Exception:  # noqa: BLE001
            pass

        if account_created:
            try:
                uid = urlsafe_base64_encode(force_bytes(user.pk))
                token = default_token_generator.make_token(user)
                link = f"{settings.SITE_URL}/reset-password/{uid}/{token}"
                send_email(
                    to=email, subject="Activate your Dr. Nath account",
                    template='client_activation',
                    context={'recipient_name': (name or email), 'program_name': skill.name,
                             'email': email, 'link': link},
                )
            except Exception:  # noqa: BLE001
                pass

        return Response({'booking_id': booking.id, 'account_created': account_created},
                        status=status.HTTP_201_CREATED)


class CreateGroupPaymentIntentView(APIView):
    """Create a Stripe intent for one seat in a group session."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        session_id = request.data.get('group_session_id')
        try:
            session = GroupSession.objects.get(id=session_id)
        except GroupSession.DoesNotExist:
            return Response({'error': 'Session not found'}, status=status.HTTP_404_NOT_FOUND)

        amount = float(session.price_per_seat)
        amount_cents = int(amount * 100)
        try:
            intent = stripe.PaymentIntent.create(
                amount=amount_cents,
                currency='usd',
                metadata={'group_session_id': session_id, 'user_id': request.user.id},
            )
            return Response({
                'client_secret': intent.client_secret,
                'amount': amount,
                'publishable_key': settings.STRIPE_PUBLISHABLE_KEY,
            })
        except stripe.error.StripeError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class ConfirmGroupPaymentView(APIView):
    """Confirm payment and turn the client's held seat into a booked one."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        payment_intent_id = request.data.get('payment_intent_id')
        session_id = request.data.get('group_session_id')

        try:
            intent = stripe.PaymentIntent.retrieve(payment_intent_id)
        except stripe.error.StripeError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        if intent.status != 'succeeded':
            return Response({'error': 'Payment not completed'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                session = GroupSession.objects.select_for_update().get(id=session_id)
                enrollment = GroupEnrollment.objects.select_for_update().filter(
                    group_session=session, learner=request.user
                ).first()

                # The hold may have expired (and been cancelled) before payment landed.
                if not enrollment or enrollment.status == 'cancelled':
                    return Response(
                        {'error': 'Your seat reservation expired. Please try enrolling again.'},
                        status=status.HTTP_409_CONFLICT,
                    )
                # Idempotent: a retried confirm shouldn't double-charge state.
                if enrollment.status == 'booked':
                    return Response({'enrollment_id': enrollment.id, 'status': 'paid'})

                enrollment.status = 'booked'
                enrollment.payment_intent_id = payment_intent_id
                enrollment.payment_status = 'paid'
                enrollment.amount_paid = intent.amount / 100
                enrollment.held_until = None
                enrollment.save(update_fields=[
                    'status', 'payment_intent_id', 'payment_status',
                    'amount_paid', 'held_until', 'updated_at',
                ])

                if session.seats_taken >= session.capacity and session.status == 'scheduled':
                    session.status = 'full'
                    session.save(update_fields=['status', 'updated_at'])

            # Confirmation + reminder ladder for this attendee (and the coach).
            try:
                from .notifications import schedule_group_notifications
                schedule_group_notifications(session)
            except Exception as notify_err:  # noqa: BLE001 — never fail a paid booking
                print(f"Group session {session.id} booked but notifications failed: {notify_err}")

            return Response({'enrollment_id': enrollment.id, 'status': 'paid'})
        except GroupSession.DoesNotExist:
            return Response({'error': 'Session no longer exists.'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


from rest_framework.parsers import MultiPartParser, FormParser

class UploadNotesView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def patch(self, request, booking_id):
        booking = get_object_or_404(SessionBooking, id=booking_id)

        if booking.mentor.user != request.user:
            return Response({'error': 'Only the coach can upload notes.'}, status=status.HTTP_403_FORBIDDEN)

        file = request.FILES.get('notes_file')
        if not file:
            return Response({'error': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)

        booking.notes_file = file
        booking.save()
        return Response({'notes_file': request.build_absolute_uri(booking.notes_file.url)})


from django.utils import timezone as dj_timezone

class MilestoneView(APIView):
    permission_classes = [IsAuthenticated]

    def _serialize(self, m):
        return {
            'id': m.id,
            'booking_id': m.booking_id,
            'coach': m.coach.user.username,
            'coach_id': m.coach.user.id,
            'client': m.client.username,
            'client_id': m.client.id,
            'title': m.title,
            'description': m.description,
            'due_date': str(m.due_date) if m.due_date else None,
            'completed': m.completed,
            'completed_at': m.completed_at.isoformat() if m.completed_at else None,
            'created_at': m.created_at.isoformat(),
        }

    def get(self, request):
        user = request.user
        profile = user.profile
        if profile.role == 'coach':
            # Optionally filter by client_id
            client_id = request.query_params.get('client_id')
            qs = Milestone.objects.filter(coach=profile)
            if client_id:
                qs = qs.filter(client_id=client_id)
        else:
            qs = Milestone.objects.filter(client=user)
        return Response([self._serialize(m) for m in qs])

    def post(self, request):
        profile = request.user.profile
        if profile.role != 'coach':
            return Response({'error': 'Only coaches can create milestones.'}, status=status.HTTP_403_FORBIDDEN)
        client_id = request.data.get('client_id')
        if not client_id:
            return Response({'error': 'client_id required.'}, status=status.HTTP_400_BAD_REQUEST)
        from profiles.models import CustomUser
        client = get_object_or_404(CustomUser, id=client_id)
        booking_id = request.data.get('booking_id')
        booking = get_object_or_404(SessionBooking, id=booking_id) if booking_id else None
        m = Milestone.objects.create(
            coach=profile,
            client=client,
            booking=booking,
            title=request.data.get('title', '').strip(),
            description=request.data.get('description', '').strip(),
            due_date=request.data.get('due_date') or None,
        )
        return Response(self._serialize(m), status=status.HTTP_201_CREATED)


class MilestoneDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _serialize(self, m):
        return {
            'id': m.id,
            'booking_id': m.booking_id,
            'coach': m.coach.user.username,
            'coach_id': m.coach.user.id,
            'client': m.client.username,
            'client_id': m.client.id,
            'title': m.title,
            'description': m.description,
            'due_date': str(m.due_date) if m.due_date else None,
            'completed': m.completed,
            'completed_at': m.completed_at.isoformat() if m.completed_at else None,
            'created_at': m.created_at.isoformat(),
        }

    def patch(self, request, pk):
        m = get_object_or_404(Milestone, pk=pk)
        user = request.user
        profile = user.profile

        # Coach can edit title/description/due_date
        if profile.role == 'coach' and m.coach == profile:
            for field in ('title', 'description', 'due_date'):
                if field in request.data:
                    setattr(m, field, request.data[field] or None if field == 'due_date' else request.data[field])
            m.save()
            return Response(self._serialize(m))

        # Client can toggle completed
        if profile.role == 'client' and m.client == user:
            completed = request.data.get('completed')
            if completed is not None:
                m.completed = bool(completed)
                m.completed_at = dj_timezone.now() if m.completed else None
                m.save()
            return Response(self._serialize(m))

        return Response({'error': 'Permission denied.'}, status=status.HTTP_403_FORBIDDEN)

    def delete(self, request, pk):
        m = get_object_or_404(Milestone, pk=pk)
        if m.coach.user != request.user:
            return Response({'error': 'Only the coach can delete milestones.'}, status=status.HTTP_403_FORBIDDEN)
        m.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ─── Habit tracker ──────────────────────────────────────────────────────────────
HABIT_WINDOW_DAYS = 30  # window used for the consistency % and returned check-in dates


def _serialize_habit(habit, today=None):
    """Habit + recent check-in history, current streak, and consistency %.

    `check_in_dates` are the last HABIT_WINDOW_DAYS days the client logged it.
    `streak` counts consecutive logged days ending today (or yesterday if today
    isn't logged yet, so the day-in-progress doesn't break the streak).
    `consistency` is logged-days / elapsed-days over the window (0–100).
    """
    today = today or dj_tz.localdate()
    window_start = today - timedelta(days=HABIT_WINDOW_DAYS - 1)
    dates = set(
        habit.check_ins.filter(date__gte=window_start, date__lte=today)
        .values_list('date', flat=True)
    )

    # Current streak (with a one-day grace for today).
    streak = 0
    cursor = today if today in dates else today - timedelta(days=1)
    while cursor in dates:
        streak += 1
        cursor -= timedelta(days=1)

    elapsed = (today - max(window_start, habit.created_at.date() if habit.created_at else window_start)).days + 1
    elapsed = max(1, min(elapsed, HABIT_WINDOW_DAYS))
    logged = len([d for d in dates if d >= window_start])
    consistency = round(min(logged, elapsed) / elapsed * 100)

    return {
        'id': habit.id,
        'coach': habit.coach.user.username,
        'coach_id': habit.coach.user_id,
        'client': habit.client.username,
        'client_id': habit.client_id,
        'title': habit.title,
        'description': habit.description,
        'category': habit.category,
        'active': habit.active,
        'created_at': habit.created_at.isoformat(),
        'check_in_dates': sorted(d.isoformat() for d in dates),
        'checked_today': today in dates,
        'streak': streak,
        'consistency': consistency,
    }


class HabitView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = getattr(request.user, 'profile', None)
        if profile and profile.role == 'coach':
            qs = Habit.objects.filter(coach=profile).select_related('client', 'coach__user')
            client_id = request.query_params.get('client_id')
            if client_id:
                qs = qs.filter(client_id=client_id)
            if request.query_params.get('include_archived') not in ('1', 'true', 'True'):
                qs = qs.filter(active=True)
        else:
            # Clients only ever see their own active habits.
            qs = Habit.objects.filter(client=request.user, active=True).select_related('client', 'coach__user')
        return Response([_serialize_habit(h) for h in qs])

    def post(self, request):
        profile = getattr(request.user, 'profile', None)
        if not profile or profile.role != 'coach':
            return Response({'error': 'Only coaches can create habits.'}, status=status.HTTP_403_FORBIDDEN)
        client_id = request.data.get('client_id')
        title = (request.data.get('title') or '').strip()
        if not client_id or not title:
            return Response({'error': 'client_id and title are required.'}, status=status.HTTP_400_BAD_REQUEST)
        client = get_object_or_404(CustomUser, id=client_id)
        category = (request.data.get('category') or '').strip()
        valid_cats = {c[0] for c in Habit.CATEGORY_CHOICES}
        habit = Habit.objects.create(
            coach=profile,
            client=client,
            title=title,
            description=(request.data.get('description') or '').strip(),
            category=category if category in valid_cats else '',
        )
        return Response(_serialize_habit(habit), status=status.HTTP_201_CREATED)


class HabitDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        habit = get_object_or_404(Habit, pk=pk)
        profile = getattr(request.user, 'profile', None)
        if not profile or profile.role != 'coach' or habit.coach != profile:
            return Response({'error': 'Only the assigning coach can edit habits.'}, status=status.HTTP_403_FORBIDDEN)
        for field in ('title', 'description'):
            if field in request.data:
                setattr(habit, field, (request.data[field] or '').strip())
        if 'category' in request.data:
            cat = (request.data['category'] or '').strip()
            valid_cats = {c[0] for c in Habit.CATEGORY_CHOICES}
            habit.category = cat if cat in valid_cats else ''
        if 'active' in request.data:
            habit.active = bool(request.data['active'])
        habit.save()
        return Response(_serialize_habit(habit))

    def delete(self, request, pk):
        habit = get_object_or_404(Habit, pk=pk)
        if habit.coach.user != request.user:
            return Response({'error': 'Only the assigning coach can delete habits.'}, status=status.HTTP_403_FORBIDDEN)
        habit.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class HabitCheckInView(APIView):
    """Client toggles a habit's check-in for a given day (default today)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        habit = get_object_or_404(Habit, pk=pk)
        if habit.client_id != request.user.id:
            return Response({'error': 'You can only check in your own habits.'}, status=status.HTTP_403_FORBIDDEN)
        if not habit.active:
            return Response({'error': 'This habit is archived.'}, status=status.HTTP_400_BAD_REQUEST)

        # Parse target date (default today); never allow logging the future.
        raw = request.data.get('date')
        target = dj_tz.localdate()
        if raw:
            parsed = parse_date(raw)
            if not parsed:
                return Response({'error': 'Invalid date.'}, status=status.HTTP_400_BAD_REQUEST)
            target = parsed
        if target > dj_tz.localdate():
            return Response({'error': 'Cannot check in for a future date.'}, status=status.HTTP_400_BAD_REQUEST)

        done = request.data.get('done')
        if done is None:
            # No explicit state → toggle.
            existing = habit.check_ins.filter(date=target).first()
            done = existing is None
        if done:
            HabitCheckIn.objects.get_or_create(habit=habit, date=target)
        else:
            habit.check_ins.filter(date=target).delete()
        return Response(_serialize_habit(habit))


class HabitSuggestView(APIView):
    """Coach-only: AI habit suggestions for a client (F3 — 'build' habits).

    POST { client_id, domain? } → { suggestions: [{title, description, category}] }.
    The coach reviews and creates the ones they like via the normal create endpoint.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        profile = getattr(request.user, 'profile', None)
        if not profile or profile.role != 'coach':
            return Response({'error': 'Only coaches can request habit suggestions.'},
                            status=status.HTTP_403_FORBIDDEN)
        client_id = request.data.get('client_id')
        if not client_id:
            return Response({'error': 'client_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        client = get_object_or_404(CustomUser, id=client_id)

        from .habit_ai import suggest_habits
        suggestions = suggest_habits(client=client, domain=(request.data.get('domain') or ''))
        if not suggestions:
            return Response(
                {'suggestions': [], 'detail': 'No suggestions available right now — please try again.'},
                status=status.HTTP_200_OK,
            )
        return Response({'suggestions': suggestions})


# ─── PDF receipts / invoices ────────────────────────────────────────────────────
class BookingInvoiceView(APIView):
    """Stream a PDF receipt for a paid 1:1 session. Accessible to the learner who
    paid, the assigned coach, or an admin."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        booking = get_object_or_404(SessionBooking, pk=pk)
        user = request.user
        is_owner = booking.learner_id == user.id
        is_coach = booking.mentor and booking.mentor.user_id == user.id
        if not (is_owner or is_coach or user.is_staff):
            return Response({'error': 'You do not have access to this receipt.'}, status=status.HTTP_403_FORBIDDEN)
        if booking.payment_status != 'paid' or not (booking.amount_paid and booking.amount_paid > 0):
            return Response({'error': 'No receipt available — this session was not a paid transaction.'},
                            status=status.HTTP_400_BAD_REQUEST)
        from django.http import HttpResponse
        from .invoices import build_booking_invoice_pdf
        pdf, filename = build_booking_invoice_pdf(booking)
        resp = HttpResponse(pdf, content_type='application/pdf')
        resp['Content-Disposition'] = f'attachment; filename="{filename}"'
        return resp


class GroupEnrollmentInvoiceView(APIView):
    """Stream a PDF receipt for a paid group-session enrollment. Accessible to the
    enrolled learner, the session's coach, or an admin."""
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        enrollment = get_object_or_404(
            GroupEnrollment.objects.select_related('learner', 'group_session__coach__user'), pk=pk
        )
        user = request.user
        is_owner = enrollment.learner_id == user.id
        is_coach = enrollment.group_session and enrollment.group_session.coach.user_id == user.id
        if not (is_owner or is_coach or user.is_staff):
            return Response({'error': 'You do not have access to this receipt.'}, status=status.HTTP_403_FORBIDDEN)
        if enrollment.payment_status != 'paid' or not (enrollment.amount_paid and enrollment.amount_paid > 0):
            return Response({'error': 'No receipt available — this enrollment was not a paid transaction.'},
                            status=status.HTTP_400_BAD_REQUEST)
        from django.http import HttpResponse
        from .invoices import build_group_invoice_pdf
        pdf, filename = build_group_invoice_pdf(enrollment)
        resp = HttpResponse(pdf, content_type='application/pdf')
        resp['Content-Disposition'] = f'attachment; filename="{filename}"'
        return resp


class MagicJoinView(APIView):
    """Resolve an old email join link to its session, then require the client to
    sign in (passwordless auto-login has been retired so every client logs in
    with their own credentials). Returns the booking id so the frontend can send
    them to /login?next=/session/<id> — no tokens are ever issued here."""
    permission_classes = [AllowAny]

    def get(self, request, token):
        from django.core.signing import BadSignature, SignatureExpired
        from .magic import read_join_token

        try:
            booking_id, _user_id = read_join_token(token)
        except (SignatureExpired, BadSignature):
            return Response({'detail': 'This link is no longer valid. Please sign in to join your session.'},
                            status=status.HTTP_400_BAD_REQUEST)

        if not SessionBooking.objects.filter(id=booking_id).exists():
            return Response({'detail': 'This session could not be found.'}, status=status.HTTP_404_NOT_FOUND)

        # Route the user through the normal login → session flow.
        return Response({'login_required': True, 'booking_id': booking_id})


class SessionReflectionView(APIView):
    """A client's post-session reflection (takeaways + action items). The client
    reads/writes their own; the coach may read it (to follow up)."""
    permission_classes = [IsAuthenticated]

    def _booking(self, booking_id):
        return get_object_or_404(
            SessionBooking.objects.select_related('mentor__user', 'learner', 'reflection'),
            id=booking_id,
        )

    def get(self, request, booking_id):
        from .serializers import SessionReflectionSerializer
        booking = self._booking(booking_id)
        if request.user != booking.learner and booking.mentor.user_id != request.user.id:
            return Response({'detail': 'Permission denied.'}, status=HTTP_403_FORBIDDEN)
        refl = getattr(booking, 'reflection', None)
        if not refl:
            return Response({'exists': False, 'takeaways': '', 'action_items': []})
        data = SessionReflectionSerializer(refl).data
        data['exists'] = True
        return Response(data)

    def put(self, request, booking_id):
        from .serializers import SessionReflectionSerializer
        from .models import SessionReflection
        booking = self._booking(booking_id)
        if request.user != booking.learner:
            return Response({'detail': 'Only the client can add their session notes.'},
                            status=HTTP_403_FORBIDDEN)

        takeaways = (request.data.get('takeaways') or '').strip()[:5000]
        raw = request.data.get('action_items') or []
        items = []
        for it in (raw if isinstance(raw, list) else []):
            text = (it.get('text') if isinstance(it, dict) else str(it)) or ''
            text = text.strip()
            if text:
                items.append({'text': text[:500], 'done': bool(it.get('done')) if isinstance(it, dict) else False})

        refl, _ = SessionReflection.objects.update_or_create(
            booking=booking,
            defaults={'client': booking.learner, 'takeaways': takeaways, 'action_items': items},
        )
        data = SessionReflectionSerializer(refl).data
        data['exists'] = True
        return Response(data)


class SessionAISummaryView(APIView):
    """AI-generated summary of a session (E7). Either participant (client or
    coach) can read it, or generate it from an in-call transcript.

    GET  → the stored summary (or {exists: False}).
    POST → {transcript} → generate + store + return the summary.
    """
    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        # Bound the cost of AI generation; reuse the assistant scope.
        from rest_framework.throttling import ScopedRateThrottle
        if self.request.method == 'POST':
            self.throttle_scope = 'assistant'
            return [ScopedRateThrottle()]
        return []

    def _booking(self, booking_id):
        return get_object_or_404(
            SessionBooking.objects.select_related('mentor__user', 'learner', 'ai_summary'),
            id=booking_id,
        )

    def _is_participant(self, request, booking):
        return request.user == booking.learner or booking.mentor.user_id == request.user.id

    def get(self, request, booking_id):
        from .serializers import SessionSummarySerializer
        booking = self._booking(booking_id)
        if not self._is_participant(request, booking):
            return Response({'detail': 'Permission denied.'}, status=HTTP_403_FORBIDDEN)
        summ = getattr(booking, 'ai_summary', None)
        if not summ:
            return Response({'exists': False, 'summary': '', 'key_points': [], 'action_items': []})
        data = SessionSummarySerializer(summ).data
        data['exists'] = True
        return Response(data)

    def post(self, request, booking_id):
        from .serializers import SessionSummarySerializer
        from .ai_summary import generate_and_store_summary

        booking = self._booking(booking_id)
        if not self._is_participant(request, booking):
            return Response({'detail': 'Permission denied.'}, status=HTTP_403_FORBIDDEN)

        # Both participants may POST at session end; generate_and_store_summary
        # is idempotent + cost-safe (skips the AI if an equal/longer transcript
        # was already summarised — e.g. by the server-side worker).
        transcript = (request.data.get('transcript') or '').strip()
        # generate_and_store_summary emails the summary to both parties itself
        # (so the server-side worker path is covered too).
        summ = generate_and_store_summary(booking, transcript)
        if not summ:
            return Response(
                {'detail': "There wasn't enough of the conversation to summarise."},
                status=HTTP_400_BAD_REQUEST,
            )

        data = SessionSummarySerializer(summ).data
        data['exists'] = True
        return Response(data)


def _optin_result_page(heading, message, ok=True):
    """Minimal branded confirmation page shown after clicking a link in an email."""
    accent = '#2E7D32' if ok else '#B91C1C'
    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dr. Nath — Coaching for Impact</title></head>
<body style="margin:0; background:#FAF6EC; font-family:Arial, sans-serif;">
  <div style="max-width:440px; margin:12vh auto; background:#fff; border:1px solid rgba(200,169,81,0.25); border-radius:16px; padding:36px 32px; text-align:center;">
    <p style="margin:0 0 4px; font-size:12px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:#C8A951;">Dr. Nath · Coaching for Impact</p>
    <h1 style="margin:14px 0 8px; font-size:22px; color:{accent};">{heading}</h1>
    <p style="margin:0 0 22px; font-size:15px; line-height:1.6; color:#4A5568;">{message}</p>
    <a href="https://dr-nath.com/" style="display:inline-block; background:linear-gradient(135deg,#C8A951,#F0D98C); color:#14213D; text-decoration:none; font-weight:bold; font-size:14px; padding:11px 26px; border-radius:999px;">Go to the platform</a>
  </div>
</body></html>"""


class SessionTranscriptView(APIView):
    """Download a session's transcript as a text file (F1). Coach or client only."""
    permission_classes = [IsAuthenticated]

    def get(self, request, booking_id):
        booking = get_object_or_404(
            SessionBooking.objects.select_related('mentor__user', 'learner', 'ai_summary', 'skill'),
            id=booking_id,
        )
        if request.user != booking.learner and booking.mentor.user_id != request.user.id:
            return Response({'detail': 'You do not have access to this transcript.'},
                            status=HTTP_403_FORBIDDEN)
        summ = getattr(booking, 'ai_summary', None)
        if not summ or not summ.transcript_text:
            return Response({'detail': 'No transcript available for this session.'},
                            status=HTTP_404_NOT_FOUND)
        from django.http import HttpResponse
        programme = booking.skill.name if booking.skill else ''
        header = f"Session transcript\nProgramme: {programme}\nDate: {booking.session_date}\n\n"
        resp = HttpResponse(header + summ.transcript_text, content_type='text/plain; charset=utf-8')
        resp['Content-Disposition'] = f'attachment; filename="transcript-session-{booking.id}.txt"'
        return resp


class RebookReminderOptInView(APIView):
    """A client clicks 'remind me to book my next session' in their summary email.
    Public (they aren't signed in when reading email) — gated by the signed link
    token. Schedules 3/5/7-day nudges and shows a friendly confirmation page."""
    permission_classes = [AllowAny]

    def get(self, request, booking_id):
        from django.http import HttpResponse
        from .notifications import read_rebook_optin_token, schedule_rebook_reminders
        token = request.query_params.get('t') or ''
        if read_rebook_optin_token(token) != booking_id:
            return HttpResponse(
                _optin_result_page("Link expired", "This reminder link is no longer valid. You can still book anytime from the platform.", ok=False),
                content_type='text/html', status=400)
        booking = (SessionBooking.objects
                   .select_related('learner', 'skill', 'mentor__user')
                   .filter(id=booking_id).first())
        if not booking:
            return HttpResponse(
                _optin_result_page("Not found", "We couldn't find that session.", ok=False),
                content_type='text/html', status=404)
        schedule_rebook_reminders(booking)
        return HttpResponse(_optin_result_page(
            "You're all set 🎉",
            "We'll remind you to book your next session over the coming days. You can book anytime — no need to wait for the reminder.",
        ), content_type='text/html')
from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.decorators import action # Required for @action decorator
from rest_framework.status import HTTP_200_OK, HTTP_403_FORBIDDEN, HTTP_400_BAD_REQUEST # Explicitly import status codes
from rest_framework.exceptions import ValidationError as DRFValidationError # Use DRF's ValidationError for API responses

# Import all models used in this file
from .models import SessionBooking, Review, Milestone, TimeSlot, GroupSession, GroupEnrollment
# Import models from other apps
from profiles.models import UserProfile, CustomUser
# Import all serializers used in this file
from .serializers import (
    ReviewSerializer, SessionBookingSerializer, TimeSlotSerializer,
    GroupSessionSerializer, GroupEnrollmentSerializer, MyGroupEnrollmentSerializer,
)
from .services import generate_slots_for_coach, release_expired_holds, HOLD_MINUTES, reserve_seat, SeatUnavailable
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils import timezone as dj_tz
from datetime import timedelta, date as date_cls
# Note: DjangoValidationError is not directly used in this file's logic, but can be kept if needed elsewhere.
# from django.core.exceptions import ValidationError as DjangoValidationError


def cancel_booking(booking, new_status='declined', refund=True):
    """
    Cancel a booking: free its slot back to 'open' and refund payment if any.
    Shared by client and coach cancellation paths. Returns the booking.
    """
    with transaction.atomic():
        # Release the linked slot so it becomes bookable again.
        slot = booking.slot
        if slot:
            if slot.status in ('booked', 'held'):
                slot.status = 'open'
                slot.held_until = None
                slot.held_by = None
                slot.save(update_fields=['status', 'held_until', 'held_by', 'updated_at'])
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
    return booking


class SessionBookingViewSet(viewsets.ModelViewSet):
    serializer_class = SessionBookingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # Ensure the user has a profile before attempting to filter by role
        if not hasattr(self.request.user, 'profile') or not self.request.user.is_authenticated:
            return SessionBooking.objects.none()

        user_profile = self.request.user.profile
        # If the user is a coach, they see sessions where they are the mentor
        if user_profile.role == 'coach':
            # Assuming SessionBooking has a 'mentor' ForeignKey to UserProfile
            return SessionBooking.objects.filter(mentor=user_profile).order_by('-created_at')
        # If the user is a client, they see sessions where they are the learner
        elif user_profile.role == 'client':
            # Assuming SessionBooking has a 'learner' ForeignKey to CustomUser
            return SessionBooking.objects.filter(learner=self.request.user).order_by('-created_at')
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
                cancel_booking(booking, new_status='declined')
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
        booking.status = 'completed'
        booking.save()
        return Response(self.get_serializer(booking).data)

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

        # Release the slot and refund, then mark declined.
        cancel_booking(booking, new_status='declined')

        serializer = self.get_serializer(booking)
        return Response(serializer.data, status=HTTP_200_OK)

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

        cancel_booking(booking, new_status='declined')

        serializer = self.get_serializer(booking)
        return Response(serializer.data, status=HTTP_200_OK)


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
            return TimeSlot.objects.filter(coach=user.profile)
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

        qs = TimeSlot.objects.filter(status='open', start_datetime__gt=dj_tz.now())
        if skill_id:
            from skills.models import Skill
            try:
                skill = Skill.objects.select_related('profile').get(id=skill_id)
            except Skill.DoesNotExist:
                return Response({'detail': 'Skill not found.'}, status=status.HTTP_404_NOT_FOUND)
            # Slots tied to this coach, restricted to this skill or skill-agnostic.
            from django.db.models import Q
            qs = qs.filter(coach=skill.profile).filter(Q(skill=skill) | Q(skill__isnull=True))
        elif coach_id:
            qs = qs.filter(coach_id=coach_id)
        else:
            return Response({'detail': 'A coach or skill query param is required.'}, status=HTTP_400_BAD_REQUEST)

        serializer = self.get_serializer(qs, many=True)
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

    @action(detail=True, methods=['get'], url_path='messages')
    def messages(self, request, pk=None):
        """Group chat history — coach or booked client only."""
        from messages.models import GroupMessage
        from messages.serializers import GroupMessageSerializer
        session = get_object_or_404(GroupSession, pk=pk)
        user = request.user
        is_coach = session.coach.user_id == user.id
        is_booked = session.enrollments.filter(learner=user, status='booked').exists()
        if not (is_coach or is_booked):
            return Response({'detail': 'Not allowed.'}, status=HTTP_403_FORBIDDEN)
        qs = GroupMessage.objects.filter(group_session=session).select_related('sender')
        return Response(GroupMessageSerializer(qs, many=True).data)

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
        print("REQUEST DATA:", request.data)  # add this
        skill_id = request.data.get('skill_id')
        duration = int(request.data.get('duration', 60))
        print("skill_id:", skill_id, "duration:", duration)  # add this
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
        try:
            with transaction.atomic():
                skill = Skill.objects.get(id=booking_data['skill'])
                mentor_profile = skill.profile

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
                session_date = slot.start_datetime.date()
                session_time = slot.start_datetime.time()
                duration = slot.duration_minutes

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

                if slot:
                    slot.status = 'booked'
                    slot.held_until = None
                    slot.held_by = None
                    slot.save(update_fields=['status', 'held_until', 'held_by', 'updated_at'])

            # Notify both parties (confirmation now + reminders later). Best-effort:
            # email scheduling must never fail a paid booking.
            try:
                from .notifications import schedule_booking_notifications
                schedule_booking_notifications(booking)
            except Exception as notify_err:  # noqa: BLE001
                print(f"Booking {booking.id} created but notification scheduling failed: {notify_err}")

            return Response({'booking_id': booking.id, 'status': 'paid'})
        except TimeSlot.DoesNotExist:
            return Response({'error': 'Selected slot no longer exists.'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


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
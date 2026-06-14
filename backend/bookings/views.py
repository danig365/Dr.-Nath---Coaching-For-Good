from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.decorators import action # Required for @action decorator
from rest_framework.status import HTTP_200_OK, HTTP_403_FORBIDDEN, HTTP_400_BAD_REQUEST # Explicitly import status codes
from rest_framework.exceptions import ValidationError as DRFValidationError # Use DRF's ValidationError for API responses

# Import all models used in this file
from .models import SessionBooking, Review, Milestone, TimeSlot
# Import models from other apps
from profiles.models import UserProfile, CustomUser
# Import all serializers used in this file
from .serializers import ReviewSerializer, SessionBookingSerializer, TimeSlotSerializer
from .services import generate_slots_for_coach, release_expired_holds, HOLD_MINUTES
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.utils import timezone as dj_tz
from datetime import timedelta
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
                slot.save(update_fields=['status', 'held_until', 'updated_at'])
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

    def perform_create(self, serializer):
        user = self.request.user
        # Ensure user has a profile before checking role
        if not hasattr(user, 'profile'):
            raise DRFValidationError("User profile not found.")

        # ⭐ CRITICAL FIX: This view is for CLIENTS to book sessions.
        # So, the user's role must be 'client'.
        if user.profile.role != 'client':
            raise DRFValidationError("Only clients can book sessions.")

        try:
            # Let the serializer handle learner, mentor inference from skill, and validation
            serializer.save()
        except DRFValidationError as e:
            # Re-raise DRF ValidationErrors so they are handled as 400 Bad Request
            raise e
        except Exception as e:
            # Catch any other unexpected errors during creation and return a 400 Bad Request
            raise DRFValidationError({'detail': f"An unexpected error occurred during booking creation: {str(e)}"})

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
        """Generate open slots from the coach's recurring availability windows."""
        profile = self._ensure_coach()
        horizon = request.data.get('horizon_days')
        result = generate_slots_for_coach(
            profile,
            horizon_days=int(horizon) if horizon else None,
        )
        return Response(result, status=HTTP_200_OK)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def available(self, request):
        """
        Public (authenticated) listing of bookable slots for a coach or skill.
        Clients use this to pick a slot. Only future, open slots are returned.
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
            slot.save(update_fields=['status', 'held_until', 'updated_at'])
        return Response(self.get_serializer(slot).data, status=HTTP_200_OK)

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def release(self, request, pk=None):
        """Release a held slot back to open (e.g. client abandoned checkout)."""
        with transaction.atomic():
            try:
                slot = TimeSlot.objects.select_for_update().get(pk=pk)
            except TimeSlot.DoesNotExist:
                return Response({'detail': 'Slot not found.'}, status=status.HTTP_404_NOT_FOUND)
            if slot.status == 'held':
                slot.status = 'open'
                slot.held_until = None
                slot.save(update_fields=['status', 'held_until', 'updated_at'])
        return Response(self.get_serializer(slot).data, status=HTTP_200_OK)


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
        try:
            with transaction.atomic():
                skill = Skill.objects.get(id=booking_data['skill'])
                mentor_profile = skill.profile

                slot = None
                if slot_id:
                    # Lock the slot and verify it is still ours to book.
                    slot = TimeSlot.objects.select_for_update().get(id=slot_id)
                    if slot.status == 'booked':
                        return Response(
                            {'error': 'This time slot was just booked by someone else. Please pick another.'},
                            status=status.HTTP_409_CONFLICT,
                        )
                    if slot.coach_id != mentor_profile.id:
                        return Response({'error': 'Slot does not belong to this coach.'},
                                        status=status.HTTP_400_BAD_REQUEST)
                    session_date = slot.start_datetime.date()
                    session_time = slot.start_datetime.time()
                    duration = slot.duration_minutes
                else:
                    # Legacy free-datetime fallback (kept for backward compatibility).
                    session_date = booking_data['session_date']
                    session_time = booking_data['session_time']
                    duration = booking_data['duration']

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
                    slot.save(update_fields=['status', 'held_until', 'updated_at'])

            return Response({'booking_id': booking.id, 'status': 'paid'})
        except TimeSlot.DoesNotExist:
            return Response({'error': 'Selected slot no longer exists.'}, status=status.HTTP_400_BAD_REQUEST)
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
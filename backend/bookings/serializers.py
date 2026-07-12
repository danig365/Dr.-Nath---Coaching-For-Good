from datetime import datetime, timedelta, timezone as dt_timezone

from rest_framework import serializers
from django.utils import timezone as dj_timezone
from .models import SessionBooking, Review, TimeSlot, GroupSession, GroupEnrollment, SlotInvite, SessionReflection, SessionSummary
from profiles.models import CustomUser, UserProfile
from skills.models import Skill


class TimeSlotSerializer(serializers.ModelSerializer):
    coach_username = serializers.CharField(source='coach.user.username', read_only=True)
    skill_title = serializers.CharField(source='skill.name', read_only=True)
    duration_minutes = serializers.IntegerField(read_only=True)
    # Who this slot was invited to — only ever exposed to the slot's own coach,
    # never on the public available-slots listing.
    invited_emails = serializers.SerializerMethodField()

    class Meta:
        model = TimeSlot
        fields = [
            'id', 'coach', 'coach_username', 'skill', 'skill_title',
            'start_datetime', 'end_datetime', 'duration_minutes',
            'status', 'source', 'held_until', 'created_at', 'invited_emails',
        ]
        read_only_fields = ['id', 'coach', 'source', 'held_until', 'created_at']

    def get_invited_emails(self, obj):
        request = self.context.get('request')
        viewer = getattr(request, 'user', None)
        # Guard the recipient list: only the slot's coach can see it.
        if not viewer or not viewer.is_authenticated or obj.coach.user_id != viewer.id:
            return []
        return [i.email for i in obj.invites.all()]

    def validate(self, attrs):
        start = attrs.get('start_datetime', getattr(self.instance, 'start_datetime', None))
        end = attrs.get('end_datetime', getattr(self.instance, 'end_datetime', None))
        if start and end:
            if end <= start:
                raise serializers.ValidationError("Slot end time must be after its start time.")
            if (end - start).total_seconds() > 60 * 60:
                raise serializers.ValidationError("A slot can be at most 60 minutes long.")
        return attrs


class SlotInviteSerializer(serializers.ModelSerializer):
    """Read model for the coach's "Sent Invites" history."""
    skill_title = serializers.CharField(source='skill.name', read_only=True, default=None)
    slot_start = serializers.DateTimeField(source='slot.start_datetime', read_only=True)
    slot_end = serializers.DateTimeField(source='slot.end_datetime', read_only=True)
    duration_minutes = serializers.IntegerField(source='slot.duration_minutes', read_only=True)
    status = serializers.SerializerMethodField()
    can_resend = serializers.SerializerMethodField()
    attached_documents = serializers.SerializerMethodField()

    class Meta:
        model = SlotInvite
        fields = [
            'id', 'email', 'skill', 'skill_title', 'note',
            'slot', 'slot_start', 'slot_end', 'duration_minutes',
            'invited_at', 'last_sent_at', 'sent_count',
            'status', 'can_resend', 'attached_documents',
        ]

    def get_attached_documents(self, obj):
        """Titles of the documents that were attached to the invite email."""
        return [r.title for r in obj.attached_resources.all()]

    def get_status(self, obj):
        """Pending (open, future) · Booked (this invitee took it) ·
        Filled (someone else booked the slot) · Expired (slot passed)."""
        booking = getattr(obj.slot, 'booking', None)
        if booking is not None:
            booker_email = (booking.learner.email or '').lower()
            if booker_email and booker_email == obj.email.lower():
                return 'booked'
            return 'filled'
        if obj.slot.start_datetime < dj_timezone.now():
            return 'expired'
        return 'pending'

    def get_can_resend(self, obj):
        # Re-send pending invites as long as a skill can be resolved to rebuild the
        # booking link: the one stored on the invite, the slot's, or — for legacy
        # invites that predate skill capture — any offering the coach has.
        if self.get_status(obj) != 'pending':
            return False
        if obj.skill_id or obj.slot.skill_id:
            return True
        # Computed once per request in the viewset context to avoid an N+1 query.
        return bool(self.context.get('coach_has_skills'))


class SessionReflectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SessionReflection
        fields = ['id', 'booking', 'takeaways', 'action_items', 'created_at', 'updated_at']
        read_only_fields = fields


class SessionSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = SessionSummary
        fields = ['id', 'booking', 'summary', 'key_points', 'action_items',
                  'transcript_chars', 'created_at', 'updated_at']
        read_only_fields = fields


class SessionBookingSerializer(serializers.ModelSerializer):
    learner_username = serializers.CharField(source='learner.username', read_only=True)
    mentor_username = serializers.CharField(source='mentor.user.username', read_only=True)
    # Display names: "First Last" when set, else the username.
    learner_name = serializers.SerializerMethodField()
    mentor_name = serializers.SerializerMethodField()
    skill_title = serializers.CharField(source='skill.name', read_only=True)
    price = serializers.DecimalField(source='skill.price', max_digits=10, decimal_places=2, read_only=True)
    feedback = serializers.SerializerMethodField()
    unread_messages = serializers.SerializerMethodField()
    has_reflection = serializers.SerializerMethodField()
    has_summary = serializers.SerializerMethodField()
    no_show_by = serializers.SerializerMethodField()  # 'coach' | 'client' | 'both' | None
    # Absolute UTC start/end (ISO) — the source of truth for the frontend to
    # convert to each viewer's local timezone. session_date/session_time are kept
    # for backward compatibility but must NOT be parsed as local on the client.
    slot_start = serializers.SerializerMethodField()
    slot_end = serializers.SerializerMethodField()

    class Meta:
        model = SessionBooking
        fields = [
        'id', 'learner', 'mentor', 'skill', 'session_date',
        'session_time', 'slot_start', 'slot_end', 'created_at', 'status',
        'duration', 'skill_level', 'message', 'notes_file', 'meeting_link',
        'learner_username', 'mentor_username', 'learner_name', 'mentor_name',
        'skill_title', 'price', 'feedback', 'unread_messages', 'has_reflection', 'has_summary',
        'payment_status', 'amount_paid',
        'coach_joined_at', 'client_joined_at', 'no_show_by',
        ]
        # ⭐ Corrected read_only_fields list for the new create logic ⭐
        # 'learner' is not sent by frontend. 'mentor' is inferred from 'skill'.
        # So we remove 'learner' and 'mentor' from fields and add 'skill' here to allow it to be written.
        read_only_fields = [
        'id', 'created_at',
        'learner_username', 'mentor_username', 'skill_title', 'learner', 'mentor', 'price', 'feedback',
        'payment_status', 'amount_paid',
        'coach_joined_at', 'client_joined_at', 'no_show_by',
       ]

    @staticmethod
    def _display_name(user):
        if not user:
            return ''
        full = f"{user.first_name} {user.last_name}".strip()
        return full or user.username

    def get_learner_name(self, obj):
        return self._display_name(obj.learner)

    def get_mentor_name(self, obj):
        return self._display_name(obj.mentor.user if obj.mentor else None)

    def _start_utc(self, obj):
        """Authoritative UTC start: the slot if present, else session_date/time
        treated as UTC (they're derived from the slot's UTC start)."""
        if obj.slot and obj.slot.start_datetime:
            return obj.slot.start_datetime
        if obj.session_date and obj.session_time:
            return datetime.combine(obj.session_date, obj.session_time, tzinfo=dt_timezone.utc)
        return None

    def get_slot_start(self, obj):
        start = self._start_utc(obj)
        return start.isoformat() if start else None

    def get_slot_end(self, obj):
        if obj.slot and obj.slot.end_datetime:
            return obj.slot.end_datetime.isoformat()
        start = self._start_utc(obj)
        if not start:
            return None
        return (start + timedelta(minutes=obj.duration or 60)).isoformat()

    def get_feedback(self, obj):
        review = Review.objects.filter(
            mentor_profile=obj.mentor,
            student=obj.learner,
        ).first()
        if not review:
            return None
        return SessionReviewSerializer(review).data

    def get_has_reflection(self, obj):
        refl = getattr(obj, 'reflection', None)
        return bool(refl and (refl.takeaways or refl.action_items))

    def get_has_summary(self, obj):
        summ = getattr(obj, 'ai_summary', None)
        return bool(summ and (summ.summary or summ.key_points))

    def get_no_show_by(self, obj):
        # Who failed to attend — only meaningful for a no-show booking.
        if obj.status != 'no_show':
            return None
        coach = obj.coach_joined_at is not None
        client = obj.client_joined_at is not None
        if not coach and not client:
            return 'both'
        if not client:
            return 'client'
        if not coach:
            return 'coach'
        return None

    def get_unread_messages(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return 0

        from messages.models import Message

        return Message.objects.filter(
            booking=obj,
            receiver=request.user,
            is_read=False,
        ).count()

    def create(self, validated_data):
        request = self.context.get('request', None)
        if not request or not request.user.is_authenticated:
            raise serializers.ValidationError("Authentication required to create a booking.")
        learner_user = request.user
        
        # Expect only 'skill' in payload; infer mentor from the skill's owner profile
        skill_instance = validated_data.pop('skill')
        mentor_profile_instance = getattr(skill_instance, 'profile', None)
        if mentor_profile_instance is None:
            raise serializers.ValidationError({"skill": "Selected skill is not linked to a coach profile."})
        if mentor_profile_instance.role != 'coach':
            raise serializers.ValidationError({"mentor": "The selected user is not a coach."})
        if skill_instance.profile != mentor_profile_instance:
            raise serializers.ValidationError({"skill": "This skill is not offered by the selected mentor."})

        # Ensure we don't get duplicate 'status' kwarg if client accidentally sends it
        status_value = validated_data.pop('status', 'pending')

        session_booking = SessionBooking.objects.create(
            learner=learner_user,
            mentor=mentor_profile_instance,
            skill=skill_instance,
            status=status_value,
            **validated_data
        )
        return session_booking

    def update(self, instance, validated_data):
        # Update fields that are allowed to be changed
        instance.status = validated_data.get('status', instance.status)
        instance.notes_available = validated_data.get('notes_available', instance.notes_available)
        instance.session_date = validated_data.get('session_date', instance.session_date)
        instance.session_time = validated_data.get('session_time', instance.session_time)
        # Allow meeting_link to be updated when provided (mentors can set this)
        if 'meeting_link' in validated_data:
            instance.meeting_link = validated_data.get('meeting_link')
        instance.save()
        return instance

class ReviewSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.username', read_only=True)
    mentor_username = serializers.CharField(source='mentor_profile.user.username', read_only=True)
    class Meta:
        model = Review
        fields = ['id', 'mentor_profile', 'student_name', 'mentor_username', 'rating', 'comment', 'created_at']
        read_only_fields = ['student_name', 'mentor_username', 'created_at']
    def create(self, validated_data):
        request = self.context.get('request', None)
        if not request or not request.user.is_authenticated:
            raise serializers.ValidationError("Authentication required to create a review.")
        student = request.user
        mentor_profile = validated_data.get('mentor_profile')
        if student == mentor_profile.user:
            raise serializers.ValidationError("You cannot review your own profile.")
        if Review.objects.filter(mentor_profile=mentor_profile, student=student).exists():
            raise serializers.ValidationError("You have already reviewed this mentor.")
        return Review.objects.create(student=student, **validated_data)


class SessionReviewSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.username', read_only=True)

    class Meta:
        model = Review
        fields = ['id', 'student_name', 'rating', 'comment', 'created_at']


class GroupEnrollmentSerializer(serializers.ModelSerializer):
    learner_username = serializers.CharField(source='learner.username', read_only=True)
    session_title = serializers.CharField(source='group_session.title', read_only=True)

    class Meta:
        model = GroupEnrollment
        fields = [
            'id', 'group_session', 'session_title', 'learner', 'learner_username',
            'status', 'payment_status', 'amount_paid', 'created_at',
        ]
        read_only_fields = fields


class MyGroupEnrollmentSerializer(serializers.ModelSerializer):
    """A client's enrolment with the session details flattened in for display."""
    title = serializers.CharField(source='group_session.title', read_only=True)
    coach_username = serializers.CharField(source='group_session.coach.user.username', read_only=True)
    start_datetime = serializers.DateTimeField(source='group_session.start_datetime', read_only=True)
    end_datetime = serializers.DateTimeField(source='group_session.end_datetime', read_only=True)
    meeting_link = serializers.URLField(source='group_session.meeting_link', read_only=True)
    session_status = serializers.CharField(source='group_session.status', read_only=True)
    price_per_seat = serializers.DecimalField(source='group_session.price_per_seat', max_digits=8, decimal_places=2, read_only=True)

    class Meta:
        model = GroupEnrollment
        fields = [
            'id', 'group_session', 'title', 'coach_username',
            'start_datetime', 'end_datetime', 'meeting_link', 'session_status',
            'price_per_seat', 'status', 'payment_status', 'amount_paid', 'created_at',
        ]
        read_only_fields = fields


class GroupSessionSerializer(serializers.ModelSerializer):
    coach_username = serializers.CharField(source='coach.user.username', read_only=True)
    skill_title = serializers.CharField(source='skill.name', read_only=True)
    seats_taken = serializers.IntegerField(read_only=True)
    seats_remaining = serializers.IntegerField(read_only=True)
    is_full = serializers.BooleanField(read_only=True)

    class Meta:
        model = GroupSession
        fields = [
            'id', 'coach', 'coach_username', 'skill', 'skill_title',
            'title', 'description', 'start_datetime', 'end_datetime',
            'capacity', 'price_per_seat', 'meeting_link', 'status',
            'seats_taken', 'seats_remaining', 'is_full', 'created_at',
        ]
        # coach is inferred from the request; status is system-managed.
        read_only_fields = [
            'id', 'coach', 'coach_username', 'skill_title', 'status',
            'seats_taken', 'seats_remaining', 'is_full', 'created_at',
        ]

    def validate(self, attrs):
        start = attrs.get('start_datetime', getattr(self.instance, 'start_datetime', None))
        end = attrs.get('end_datetime', getattr(self.instance, 'end_datetime', None))
        if start and end and end <= start:
            raise serializers.ValidationError("Session end time must be after its start time.")
        return attrs
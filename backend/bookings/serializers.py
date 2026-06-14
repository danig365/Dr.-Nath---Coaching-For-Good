from rest_framework import serializers
from .models import SessionBooking, Review
from profiles.models import CustomUser, UserProfile
from skills.models import Skill

class SessionBookingSerializer(serializers.ModelSerializer):
    learner_username = serializers.CharField(source='learner.username', read_only=True)
    mentor_username = serializers.CharField(source='mentor.user.username', read_only=True)
    skill_title = serializers.CharField(source='skill.name', read_only=True)
    price = serializers.DecimalField(source='skill.price', max_digits=10, decimal_places=2, read_only=True)
    feedback = serializers.SerializerMethodField()
    unread_messages = serializers.SerializerMethodField()

    class Meta:
        model = SessionBooking
        fields = [
        'id', 'learner', 'mentor', 'skill', 'session_date',
        'session_time', 'created_at', 'status',
        'duration', 'skill_level', 'message', 'notes_file', 'meeting_link',
        'learner_username', 'mentor_username', 'skill_title', 'price', 'feedback', 'unread_messages'
        ]
        # ⭐ Corrected read_only_fields list for the new create logic ⭐
        # 'learner' is not sent by frontend. 'mentor' is inferred from 'skill'.
        # So we remove 'learner' and 'mentor' from fields and add 'skill' here to allow it to be written.
        read_only_fields = [
        'id', 'created_at',
        'learner_username', 'mentor_username', 'skill_title', 'learner', 'mentor', 'price', 'feedback'
       ]

    def get_feedback(self, obj):
        review = Review.objects.filter(
            mentor_profile=obj.mentor,
            student=obj.learner,
        ).first()
        if not review:
            return None
        return SessionReviewSerializer(review).data

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
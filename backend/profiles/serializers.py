from rest_framework import serializers
from .models import CustomUser, UserProfile

class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = [
            'role', 'bio', 'photo', 'specialties', 'certifications',
            'hourly_rate', 'years_experience', 'languages', 'industries',
            'approval_status', 'is_verified', 'organisation', 'job_title',
            'coaching_goals', 'timezone', 'booking_horizon_days', 'min_notice_hours'
        ]
        read_only_fields = ['approval_status', 'is_verified']

class CurrentUserAndProfileSerializer(serializers.ModelSerializer):
    profile = UserProfileSerializer()
    full_name = serializers.SerializerMethodField()
    first_name = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = CustomUser
        fields = ['id', 'full_name', 'first_name', 'last_name', 'email', 'profile']

    def get_full_name(self, obj):
        full = f"{obj.first_name} {obj.last_name}".strip()
        return full or obj.username

    def update(self, instance, validated_data):
        profile_data = validated_data.pop('profile', {})
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        profile = instance.profile
        for attr, value in profile_data.items():
            setattr(profile, attr, value)
        profile.save()
        return instance

class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=True)
    password2 = serializers.CharField(write_only=True, required=True)
    role = serializers.ChoiceField(choices=[('coach', 'Coach'), ('client', 'Client')], default='client')
    # Coach fields
    specialties = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    certifications = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    hourly_rate = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True)
    years_experience = serializers.IntegerField(required=False, allow_null=True)
    languages = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    industries = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    bio = serializers.CharField(required=False, allow_blank=True, default='')
    # Client fields
    organisation = serializers.CharField(required=False, allow_blank=True, default='')
    job_title = serializers.CharField(required=False, allow_blank=True, default='')

    class Meta:
        model = CustomUser
        fields = (
            'username', 'email', 'password', 'password2', 'role',
            'bio', 'specialties', 'certifications', 'hourly_rate',
            'years_experience', 'languages', 'industries',
            'organisation', 'job_title'
        )

    def validate(self, attrs):
        if attrs['password'] != attrs['password2']:
            raise serializers.ValidationError({"password": "Passwords didn't match."})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password')
        validated_data.pop('password2')
        role = validated_data.pop('role', 'client')
        profile_fields = {
            'bio': validated_data.pop('bio', ''),
            'specialties': validated_data.pop('specialties', []),
            'certifications': validated_data.pop('certifications', []),
            'hourly_rate': validated_data.pop('hourly_rate', None),
            'years_experience': validated_data.pop('years_experience', None),
            'languages': validated_data.pop('languages', []),
            'industries': validated_data.pop('industries', []),
            'organisation': validated_data.pop('organisation', ''),
            'job_title': validated_data.pop('job_title', ''),
        }
        user = CustomUser.objects.create_user(**validated_data)
        user.set_password(password)
        user.save()
        profile = user.profile
        profile.role = role
        # Coaches start as pending approval, clients are auto-approved
        profile.approval_status = 'pending' if role == 'coach' else 'approved'
        for attr, value in profile_fields.items():
            setattr(profile, attr, value)
        profile.save()
        return user

# Coach directory listing
class CoachDirectorySerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username')
    display_name = serializers.SerializerMethodField()
    email = serializers.CharField(source='user.email')
    user_id = serializers.IntegerField(source='user.id')

    class Meta:
        model = UserProfile
        fields = [
            'user_id', 'username', 'display_name', 'email', 'bio', 'photo',
            'specialties', 'certifications', 'hourly_rate',
            'years_experience', 'languages', 'industries', 'is_verified'
        ]

    def get_display_name(self, obj):
        full = f"{obj.user.first_name} {obj.user.last_name}".strip()
        return full or obj.user.username

# Admin approval
class CoachApprovalSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = ['approval_status', 'is_verified', 'rejection_reason']
from rest_framework import serializers
from .models import CustomUser, UserProfile

class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = [
            'role', 'bio', 'photo', 'specialties', 'certifications',
            'hourly_rate', 'years_experience', 'languages', 'industries', 'linkedin_url',
            'approval_status', 'is_verified', 'organisation', 'job_title',
            'coaching_goals', 'timezone', 'booking_horizon_days', 'min_notice_hours',
            'restricted_to_skill',
        ]
        # `role` MUST stay read-only here: this serializer backs "update my own
        # profile", so a writable role let any client PATCH themselves to
        # role='admin' (or to an already-approved 'coach', skipping approval).
        # Roles are set at registration (RegisterSerializer, coach/client only)
        # and changed afterwards only by an admin.
        read_only_fields = ['role', 'approval_status', 'is_verified', 'restricted_to_skill']

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
        old_tz = profile.timezone
        for attr, value in profile_data.items():
            setattr(profile, attr, value)
        profile.save()

        # A client's timezone is auto-detected from the browser and saved here,
        # which can happen after reminders were already queued (in UTC). Re-render
        # any pending reminders so the emailed time matches what they now see.
        if 'timezone' in profile_data and profile.timezone != old_tz:
            try:
                from bookings.notifications import refresh_user_reminder_timezone
                refresh_user_reminder_timezone(instance)
            except Exception:  # noqa: BLE001 — never block a profile save on this
                pass
        return instance

class RegisterSerializer(serializers.ModelSerializer):
    # Declared explicitly so we own the (case-insensitive) uniqueness checks and
    # their messages, instead of the generic ModelSerializer defaults.
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=True)
    password = serializers.CharField(write_only=True, required=True)
    password2 = serializers.CharField(write_only=True, required=True)
    # Required, with no default: registration must state a role explicitly.
    # A silent default ('client') meant a request that omitted the field still
    # created an account — the choice should always be deliberate, on the API too.
    role = serializers.ChoiceField(
        choices=[('coach', 'Coach'), ('client', 'Client')],
        required=True, allow_blank=False,
        error_messages={
            'required': 'Please choose whether you are registering as a client or a coach.',
            'invalid_choice': 'Please choose either client or coach.',
            'blank': 'Please choose whether you are registering as a client or a coach.',
        },
    )
    first_name = serializers.CharField(required=False, allow_blank=True, default='')
    last_name = serializers.CharField(required=False, allow_blank=True, default='')
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
            'first_name', 'last_name',
            'bio', 'specialties', 'certifications', 'hourly_rate',
            'years_experience', 'languages', 'industries',
            'organisation', 'job_title'
        )

    def validate_username(self, value):
        value = (value or '').strip()
        if len(value) < 3:
            raise serializers.ValidationError("Username must be at least 3 characters.")
        if CustomUser.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("This username is already taken. Please choose another.")
        return value

    def validate_email(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError("An email address is required.")
        if CustomUser.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists — try signing in instead.")
        return value

    def validate_password(self, value):
        from django.contrib.auth.password_validation import validate_password as dj_validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError
        try:
            dj_validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value

    def validate(self, attrs):
        if attrs['password'] != attrs['password2']:
            raise serializers.ValidationError({"password2": "The two passwords don't match."})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password')
        validated_data.pop('password2')
        role = validated_data.pop('role', 'client')
        # first_name/last_name stay in validated_data — passed to create_user
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
    # Admins only. This serializer also backs the PUBLIC coach directory, so a
    # plain `source='user.email'` published every coach's address to anonymous
    # visitors — free scraping for spam/phishing. Admin screens still need it.
    email = serializers.SerializerMethodField()
    user_id = serializers.IntegerField(source='user.id')

    def get_email(self, obj):
        request = self.context.get('request')
        viewer = getattr(request, 'user', None)
        if viewer and viewer.is_authenticated and viewer.is_staff:
            return obj.user.email
        return None

    class Meta:
        model = UserProfile
        fields = [
            'user_id', 'username', 'display_name', 'email', 'bio', 'photo',
            'specialties', 'certifications', 'hourly_rate',
            'years_experience', 'languages', 'industries', 'linkedin_url', 'is_verified'
        ]

    def get_display_name(self, obj):
        full = f"{obj.user.first_name} {obj.user.last_name}".strip()
        return full or obj.user.username

# Admin approval
class CoachApprovalSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = ['approval_status', 'is_verified', 'rejection_reason']
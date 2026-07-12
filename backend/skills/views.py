# skills/views.py
from rest_framework import viewsets, status, generics
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from .models import Skill, Availability
from .serializers import SkillSerializer, AvailabilitySerializer, PublicSkillSerializer
from profiles.models import UserProfile
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework_simplejwt.authentication import JWTAuthentication


# --- ViewSet for Mentor's Private Skill Management (/api/skills/) ---
class SkillViewSet(viewsets.ModelViewSet):
    serializer_class = SkillSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if not self.request.user.is_authenticated or not hasattr(self.request.user, 'profile'):
            return Skill.objects.none()

        if self.request.user.profile.role in ('coach', 'admin'):
            return Skill.objects.filter(profile__user=self.request.user)
        
        return Skill.objects.none()

    def perform_create(self, serializer):
        request_user = self.request.user
        if not hasattr(request_user, 'profile') or request_user.profile.role not in ('coach', 'admin'):
            raise DRFValidationError("Only coaches/admin can add skills.")
        
        try:
            serializer.save()
        except Exception as e:
            raise DRFValidationError({'detail': str(e)})

    def perform_update(self, serializer):
        request_user = self.request.user
        if not hasattr(request_user, 'profile') or request_user.profile.role not in ('coach', 'admin'):
            raise DRFValidationError("Only coaches/admin can update their skills.")

        if serializer.instance.profile.user != request_user:
            raise DRFValidationError("You do not have permission to update this skill.")

        try:
            serializer.save()
        except Exception as e:
            raise DRFValidationError({'detail': str(e)})

    def perform_destroy(self, instance):
        request_user = self.request.user
        if not hasattr(request_user, 'profile') or request_user.profile.role not in ('coach', 'admin'):
            raise DRFValidationError("Only coaches/admin can delete their skills.")

        if instance.profile.user != request_user:
            raise DRFValidationError("You do not have permission to delete this skill.")

        instance.delete()


# --- ViewSet for Mentor's Availability Management ---
class AvailabilityViewSet(viewsets.ModelViewSet):
    serializer_class = AvailabilitySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if not self.request.user.is_authenticated or not hasattr(self.request.user, 'profile'):
            return Availability.objects.none()

        if self.request.user.profile.role in ('coach', 'admin'):
            return Availability.objects.filter(mentor=self.request.user.profile)

        return Availability.objects.none()

    def perform_create(self, serializer):
        request_user = self.request.user
        if not hasattr(request_user, 'profile') or request_user.profile.role not in ('coach', 'admin'):
            raise DRFValidationError("Only coaches/admin can add availability.")
        
        try:
            serializer.save(mentor=request_user.profile)
        except Exception as e:
            raise DRFValidationError({'detail': str(e)})

    def perform_update(self, serializer):
        request_user = self.request.user
        if not hasattr(request_user, 'profile') or request_user.profile.role not in ('coach', 'admin'):
            raise DRFValidationError("Only coaches/admin can update their availability.")
        
        if serializer.instance.mentor.user != request_user:
            raise DRFValidationError("You do not have permission to update this availability.")

        try:
            serializer.save()
        except Exception as e:
            raise DRFValidationError({'detail': str(e)})

    def perform_destroy(self, instance):
        request_user = self.request.user
        if not hasattr(request_user, 'profile') or request_user.profile.role not in ('coach', 'admin'):
            raise DRFValidationError("Only coaches/admin can delete their availability.")
            
        if instance.mentor.user != request_user:
            raise DRFValidationError("You do not have permission to delete this availability.")
        
        instance.delete()


# --- View for Public Skill List (/api/skills/public/) ---
class PublicSkillListView(generics.ListAPIView):
    # This view is for learners and public users to browse skills.
    serializer_class = PublicSkillSerializer
    permission_classes = [AllowAny]
    # Optional auth: guests browse everything; a signed-in client is recognised
    # so a programme-locked one (E2) sees only their offering.
    authentication_classes = [JWTAuthentication]

    def get_queryset(self):
        qs = Skill.objects.filter(active=True).select_related('profile__user')
        user = self.request.user
        if user.is_authenticated:
            from bookings.services import locked_skill_id
            locked = locked_skill_id(user)
            if locked:
                qs = qs.filter(id=locked)
        return qs
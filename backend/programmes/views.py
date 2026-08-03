"""Programme space (F4) — a Canvas-style per-programme hub.

Aggregates, for one programme (Skill): overview, announcements, programme-scoped
resources, and the viewer's sessions. Reuses existing sessions/calendar, chat and
resources — only announcements + programme scoping are new.
"""
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404

from skills.models import Skill
from bookings.models import SessionBooking
from resources.models import Resource
from resources.serializers import ResourceSerializer
from resources.services import resources_for_client
from .models import Announcement
from .serializers import AnnouncementSerializer


def _full_name(user):
    return f"{user.first_name} {user.last_name}".strip() or user.username


def programme_role(user, skill):
    """'coach' if the user owns this programme, 'client' if enrolled, else None.

    A client is enrolled if they have any booking for the programme or are locked
    to it (restricted_to_skill)."""
    profile = getattr(user, 'profile', None)
    if profile and skill.profile_id == profile.id:
        return 'coach'
    if SessionBooking.objects.filter(learner=user, skill=skill).exists():
        return 'client'
    if profile and getattr(profile, 'restricted_to_skill_id', None) == skill.id:
        return 'client'
    return None


class ProgrammeSpaceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, skill_id):
        skill = get_object_or_404(Skill.objects.select_related('profile__user'), pk=skill_id)
        role = programme_role(request.user, skill)
        if not role:
            return Response({'detail': 'You are not part of this programme.'},
                            status=status.HTTP_403_FORBIDDEN)

        coach_user = skill.profile.user
        overview = {
            'id': skill.id,
            'name': skill.name,
            'description': skill.description or '',
            'category': skill.category or '',
            'coach_name': _full_name(coach_user),
        }

        # Programme-scoped resources — coach sees all their own; client sees only
        # those shared with them (reuses the existing visibility rules).
        if role == 'coach':
            res_qs = Resource.objects.filter(coach=skill.profile, skill=skill)
        else:
            res_qs = resources_for_client(request.user).filter(skill=skill)
        res_qs = res_qs.select_related('coach__user', 'folder')

        # Sessions for this viewer in this programme.
        if role == 'coach':
            bk = SessionBooking.objects.filter(mentor=skill.profile, skill=skill)
        else:
            bk = SessionBooking.objects.filter(learner=request.user, skill=skill)
        sessions = [{
            'id': b.id,
            'date': b.session_date.isoformat() if b.session_date else None,
            'time': b.session_time.strftime('%H:%M') if b.session_time else None,
            'status': b.status,
            'with': _full_name(b.learner) if role == 'coach' else overview['coach_name'],
        } for b in bk.select_related('learner').order_by('-session_date')[:50]]

        return Response({
            'role': role,
            'overview': overview,
            'announcements': AnnouncementSerializer(
                Announcement.objects.filter(skill=skill), many=True
            ).data,
            'resources': ResourceSerializer(
                res_qs, many=True, context={'request': request}
            ).data,
            'sessions': sessions,
        })


class AnnouncementCreateView(APIView):
    """Coach posts an announcement to one of their programmes."""
    permission_classes = [IsAuthenticated]

    def post(self, request, skill_id):
        skill = get_object_or_404(Skill, pk=skill_id)
        profile = getattr(request.user, 'profile', None)
        if not profile or profile.role != 'coach' or skill.profile_id != profile.id:
            return Response({'detail': 'Only the programme coach can post announcements.'},
                            status=status.HTTP_403_FORBIDDEN)
        title = (request.data.get('title') or '').strip()
        if not title:
            return Response({'detail': 'Title is required.'}, status=status.HTTP_400_BAD_REQUEST)
        ann = Announcement.objects.create(
            coach=profile, skill=skill,
            title=title[:200], body=(request.data.get('body') or '').strip(),
        )
        return Response(AnnouncementSerializer(ann).data, status=status.HTTP_201_CREATED)


class AnnouncementDetailView(APIView):
    """Coach deletes their own announcement."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        ann = get_object_or_404(Announcement, pk=pk)
        profile = getattr(request.user, 'profile', None)
        if not profile or ann.coach_id != profile.id:
            return Response({'detail': 'Only the author can delete this announcement.'},
                            status=status.HTTP_403_FORBIDDEN)
        ann.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

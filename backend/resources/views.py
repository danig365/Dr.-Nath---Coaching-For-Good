from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.status import HTTP_403_FORBIDDEN, HTTP_400_BAD_REQUEST
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404

from profiles.models import UserProfile
from .models import ResourceFolder, Resource, ClientSubmission
from .serializers import ResourceFolderSerializer, ResourceSerializer, ClientSubmissionSerializer
from .services import resources_for_client, can_access


class ResourceFolderViewSet(viewsets.ModelViewSet):
    """Coach-managed folders for grouping resources."""
    serializer_class = ResourceFolderSerializer
    permission_classes = [IsAuthenticated]

    def _ensure_coach(self):
        user = self.request.user
        if not hasattr(user, 'profile') or user.profile.role not in ('coach', 'admin'):
            raise DRFValidationError("Only coaches can manage resource folders.")
        return user.profile

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated or not hasattr(user, 'profile'):
            return ResourceFolder.objects.none()
        if user.profile.role in ('coach', 'admin'):
            return ResourceFolder.objects.filter(coach=user.profile)
        return ResourceFolder.objects.none()

    def perform_create(self, serializer):
        serializer.save(coach=self._ensure_coach())

    def perform_update(self, serializer):
        self._ensure_coach()
        if serializer.instance.coach.user != self.request.user:
            raise DRFValidationError("You can only manage your own folders.")
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_coach()
        if instance.coach.user != self.request.user:
            raise DRFValidationError("You can only delete your own folders.")
        instance.delete()


class ResourceViewSet(viewsets.ModelViewSet):
    """
    Coach-managed resources. Coaches CRUD their own; clients use `shared` to list
    what's shared with them and `download` to fetch a file (permission-checked).
    """
    serializer_class = ResourceSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _ensure_coach(self):
        user = self.request.user
        if not hasattr(user, 'profile') or user.profile.role not in ('coach', 'admin'):
            raise DRFValidationError("Only coaches can manage resources.")
        return user.profile

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated or not hasattr(user, 'profile'):
            return Resource.objects.none()
        if user.profile.role in ('coach', 'admin'):
            return Resource.objects.filter(coach=user.profile)
        return Resource.objects.none()

    def _validate_relations(self, profile, serializer):
        """Folder and group session (if any) must belong to this coach."""
        folder = serializer.validated_data.get('folder')
        if folder and folder.coach_id != profile.id:
            raise DRFValidationError({'folder': "That folder isn't yours."})
        group = serializer.validated_data.get('group_session')
        if group and group.coach_id != profile.id:
            raise DRFValidationError({'group_session': "That group session isn't yours."})

    def perform_create(self, serializer):
        profile = self._ensure_coach()
        self._validate_relations(profile, serializer)
        f = serializer.validated_data.get('file')
        if f is not None:
            # File resource: record metadata, ensure no stray link.
            serializer.save(coach=profile, link_url='',
                            file_size=getattr(f, 'size', None),
                            content_type=getattr(f, 'content_type', '') or '')
        else:
            # Link resource: no file metadata.
            serializer.save(coach=profile, file_size=None, content_type='')

    def perform_update(self, serializer):
        profile = self._ensure_coach()
        if serializer.instance.coach.user != self.request.user:
            raise DRFValidationError("You can only manage your own resources.")
        self._validate_relations(profile, serializer)
        f = serializer.validated_data.get('file')
        link_url = serializer.validated_data.get('link_url', None)
        if f is not None:
            # Replacing with a file clears any link.
            serializer.save(link_url='', file_size=getattr(f, 'size', None),
                            content_type=getattr(f, 'content_type', '') or '')
        elif link_url:
            # Switching to a link clears the stored file.
            old = serializer.instance.file
            serializer.save(file=None, file_size=None, content_type='')
            if old:
                old.delete(save=False)
        else:
            serializer.save()

    def perform_destroy(self, instance):
        self._ensure_coach()
        if instance.coach.user != self.request.user:
            raise DRFValidationError("You can only delete your own resources.")
        instance.file.delete(save=False)
        instance.delete()

    @action(detail=False, methods=['get'])
    def shared(self, request):
        """Resources shared with the current client."""
        qs = resources_for_client(request.user).select_related('coach__user', 'folder')
        return Response(self.get_serializer(qs, many=True).data)

    @action(detail=False, methods=['get'])
    def clients(self, request):
        """
        Registered clients for the 'specific clients' sharing picker. Returns all
        clients (not only coachees) so a coach can share with anyone, including
        clients who haven't booked yet.
        """
        self._ensure_coach()
        from profiles.models import CustomUser
        users = (
            CustomUser.objects.filter(profile__role='client', is_active=True)
            .order_by('username')
            .values('id', 'username')
        )
        return Response(list(users))

    @action(detail=True, methods=['get'], url_path='download')
    def download(self, request, pk=None):
        """Permission-checked file download (owner coach or shared coachee)."""
        resource = get_object_or_404(Resource, pk=pk)
        if not can_access(resource, request.user):
            return Response({'detail': 'You do not have access to this file.'}, status=HTTP_403_FORBIDDEN)
        if not resource.file:
            return Response({'detail': 'This resource is a link, not a file.'}, status=HTTP_400_BAD_REQUEST)
        try:
            fh = resource.file.open('rb')
        except (FileNotFoundError, ValueError):
            raise Http404("File is missing.")
        filename = resource.file.name.split('/')[-1]
        return FileResponse(
            fh,
            as_attachment=True,
            filename=filename,
            content_type=resource.content_type or 'application/octet-stream',
        )


class ClientSubmissionViewSet(viewsets.ModelViewSet):
    """
    The client → coach upload inbox.

    Clients upload files to a coach (signed contracts, assessment reports,
    assignment responses) and list their own. Coaches see submissions addressed
    to them, download them (permission-checked), and mark them reviewed.
    """
    serializer_class = ClientSubmissionSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _is_coach(self, user):
        return hasattr(user, 'profile') and user.profile.role in ('coach', 'admin')

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated or not hasattr(user, 'profile'):
            return ClientSubmission.objects.none()
        base = ClientSubmission.objects.select_related('client', 'coach__user', 'in_response_to')
        if self._is_coach(user):
            return base.filter(coach=user.profile)        # the coach's inbox
        return base.filter(client=user)                   # the client's own uploads

    def perform_create(self, serializer):
        user = self.request.user
        if not hasattr(user, 'profile') or user.profile.role != 'client':
            raise DRFValidationError("Only clients can submit files.")
        coach = serializer.validated_data.get('coach')
        if not coach or coach.role != 'coach':
            raise DRFValidationError({'coach': "Select a valid coach."})
        in_resp = serializer.validated_data.get('in_response_to')
        if in_resp and in_resp.coach_id != coach.id:
            raise DRFValidationError({'in_response_to': "That assignment isn't from this coach."})
        f = serializer.validated_data.get('file')
        serializer.save(
            client=user,
            file_size=getattr(f, 'size', None),
            content_type=getattr(f, 'content_type', '') or '',
        )

    def perform_update(self, serializer):
        instance = serializer.instance
        if instance.client_id != self.request.user.id:
            raise DRFValidationError("You can only edit your own submissions.")
        f = serializer.validated_data.get('file')
        extra = {}
        if f is not None:
            extra = {'file_size': getattr(f, 'size', None), 'content_type': getattr(f, 'content_type', '') or ''}
        serializer.save(**extra)

    def perform_destroy(self, instance):
        user = self.request.user
        owns = instance.client_id == user.id
        addressed = self._is_coach(user) and instance.coach_id == user.profile.id
        if not (owns or addressed):
            raise DRFValidationError("You cannot delete this submission.")
        instance.file.delete(save=False)
        instance.delete()

    @action(detail=True, methods=['patch'], url_path='mark-reviewed')
    def mark_reviewed(self, request, pk=None):
        """Coach marks an incoming submission as reviewed."""
        submission = get_object_or_404(ClientSubmission, pk=pk)
        if not (self._is_coach(request.user) and submission.coach_id == request.user.profile.id):
            return Response({'detail': 'Only the addressed coach can review this.'}, status=HTTP_403_FORBIDDEN)
        submission.status = 'reviewed'
        submission.save(update_fields=['status', 'updated_at'])
        return Response(self.get_serializer(submission).data)

    @action(detail=True, methods=['get'], url_path='download')
    def download(self, request, pk=None):
        """Permission-checked download: the submitting client or the addressed coach."""
        submission = get_object_or_404(ClientSubmission, pk=pk)
        user = request.user
        allowed = submission.client_id == user.id or (self._is_coach(user) and submission.coach_id == user.profile.id)
        if not allowed:
            return Response({'detail': 'You do not have access to this file.'}, status=HTTP_403_FORBIDDEN)
        try:
            fh = submission.file.open('rb')
        except (FileNotFoundError, ValueError):
            raise Http404("File is missing.")
        filename = submission.file.name.split('/')[-1]
        return FileResponse(
            fh,
            as_attachment=True,
            filename=filename,
            content_type=submission.content_type or 'application/octet-stream',
        )

    @action(detail=False, methods=['get'])
    def coaches(self, request):
        """Coaches a client can submit to — flexible: any approved coach."""
        coaches = (
            UserProfile.objects.filter(role='coach', approval_status='approved')
            .select_related('user').order_by('user__username')
        )
        return Response([{'id': c.id, 'username': c.user.username} for c in coaches])

from rest_framework import serializers
from django.urls import reverse

from profiles.models import CustomUser
from .models import ResourceFolder, Resource, ClientSubmission

# Upload guard rails (see plan): cap size and restrict to safe document/media types.
MAX_FILE_BYTES = 50 * 1024 * 1024  # 50 MB
ALLOWED_CONTENT_TYPES = {
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/mp4',
    'application/zip',
}


def validate_upload_file(f):
    """Shared upload guard: size cap + content-type allowlist."""
    if f.size > MAX_FILE_BYTES:
        raise serializers.ValidationError(f"File exceeds the {MAX_FILE_BYTES // (1024*1024)} MB limit.")
    ctype = getattr(f, 'content_type', '') or ''
    if ctype and ctype not in ALLOWED_CONTENT_TYPES:
        raise serializers.ValidationError(f"File type '{ctype}' is not allowed.")
    return f


class ResourceFolderSerializer(serializers.ModelSerializer):
    resource_count = serializers.IntegerField(source='resources.count', read_only=True)

    class Meta:
        model = ResourceFolder
        fields = ['id', 'name', 'resource_count', 'created_at']
        read_only_fields = ['id', 'resource_count', 'created_at']


class ResourceSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True, required=False, allow_null=True)
    download_url = serializers.SerializerMethodField()
    is_link = serializers.BooleanField(read_only=True)
    coach_username = serializers.CharField(source='coach.user.username', read_only=True)
    folder_name = serializers.CharField(source='folder.name', read_only=True)
    shared_clients = serializers.PrimaryKeyRelatedField(
        many=True, queryset=CustomUser.objects.all(), required=False
    )
    shared_client_usernames = serializers.SerializerMethodField()

    class Meta:
        model = Resource
        fields = [
            'id', 'coach', 'coach_username', 'folder', 'folder_name',
            'title', 'description', 'file', 'download_url', 'file_size', 'content_type',
            'link_url', 'is_link',
            'visibility', 'shared_clients', 'shared_client_usernames', 'group_session',
            'created_at',
        ]
        read_only_fields = [
            'id', 'coach', 'coach_username', 'folder_name', 'download_url', 'is_link',
            'file_size', 'content_type', 'shared_client_usernames', 'created_at',
        ]

    def get_download_url(self, obj):
        # Link resources have no streamed file; clients open `link_url` directly.
        if not obj.file:
            return None
        request = self.context.get('request')
        url = reverse('resource-download', args=[obj.id])
        return request.build_absolute_uri(url) if request else url

    def get_shared_client_usernames(self, obj):
        return [u.username for u in obj.shared_clients.all()]

    def validate_file(self, f):
        return validate_upload_file(f)

    def validate(self, attrs):
        visibility = attrs.get('visibility', getattr(self.instance, 'visibility', 'all_clients'))
        group_session = attrs.get('group_session', getattr(self.instance, 'group_session', None))
        if visibility == 'group' and not group_session:
            raise serializers.ValidationError({'group_session': "Required when visibility is 'group'."})
        if visibility != 'group' and group_session:
            raise serializers.ValidationError({'group_session': "Only valid when visibility is 'group'."})

        # A resource is a file OR a link. On create, exactly one must be present.
        # (On update the view keeps them mutually exclusive when one is replaced.)
        if self.instance is None:
            has_file = attrs.get('file', None) is not None
            has_link = bool(attrs.get('link_url'))
            if not has_file and not has_link:
                raise serializers.ValidationError("Provide either a file or a link.")
            if has_file and has_link:
                raise serializers.ValidationError("Provide a file or a link, not both.")
        return attrs


class ClientSubmissionSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True)
    download_url = serializers.SerializerMethodField()
    client_username = serializers.CharField(source='client.username', read_only=True)
    coach_username = serializers.CharField(source='coach.user.username', read_only=True)
    in_response_to_title = serializers.CharField(source='in_response_to.title', read_only=True)

    class Meta:
        model = ClientSubmission
        fields = [
            'id', 'client', 'client_username', 'coach', 'coach_username',
            'title', 'note', 'file', 'download_url', 'file_size', 'content_type',
            'in_response_to', 'in_response_to_title', 'status', 'created_at',
        ]
        read_only_fields = [
            'id', 'client', 'client_username', 'coach_username', 'download_url',
            'file_size', 'content_type', 'in_response_to_title', 'status', 'created_at',
        ]

    def get_download_url(self, obj):
        request = self.context.get('request')
        url = reverse('submission-download', args=[obj.id])
        return request.build_absolute_uri(url) if request else url

    def validate_file(self, f):
        return validate_upload_file(f)

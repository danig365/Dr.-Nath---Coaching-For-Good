from django.contrib import admin
from .models import ResourceFolder, Resource, ClientSubmission


@admin.register(ResourceFolder)
class ResourceFolderAdmin(admin.ModelAdmin):
    list_display = ('name', 'coach', 'created_at')
    search_fields = ('name', 'coach__user__username')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(Resource)
class ResourceAdmin(admin.ModelAdmin):
    list_display = ('title', 'coach', 'folder', 'visibility', 'file_size', 'created_at')
    list_filter = ('visibility', 'created_at')
    search_fields = ('title', 'coach__user__username', 'folder__name')
    readonly_fields = ('created_at', 'updated_at', 'file_size', 'content_type')
    filter_horizontal = ('shared_clients',)


@admin.register(ClientSubmission)
class ClientSubmissionAdmin(admin.ModelAdmin):
    list_display = ('title', 'client', 'coach', 'status', 'file_size', 'created_at')
    list_filter = ('status', 'created_at')
    search_fields = ('title', 'client__username', 'coach__user__username')
    readonly_fields = ('created_at', 'updated_at', 'file_size', 'content_type')

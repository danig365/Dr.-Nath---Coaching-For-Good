from django.urls import path

from .views import (
    BackupListView, BackupDownloadView, BackupDeleteView,
    BackupRestoreView, BackupRestoreStatusView,
)
from .media_views import (
    SessionNotesDownloadView, ChatAttachmentDownloadView,
    GroupChatAttachmentDownloadView, SubmissionDownloadView,
)

urlpatterns = [
    # Private uploads — authorised delivery only (see media_views).
    path('media/session-notes/<int:booking_id>/', SessionNotesDownloadView.as_view(), name='dl-session-notes'),
    path('media/chat-attachment/<int:message_id>/', ChatAttachmentDownloadView.as_view(), name='dl-chat-attachment'),
    path('media/group-chat-attachment/<int:message_id>/', GroupChatAttachmentDownloadView.as_view(), name='dl-group-chat-attachment'),
    path('media/submission/<int:submission_id>/', SubmissionDownloadView.as_view(), name='dl-submission'),
    path('backups/', BackupListView.as_view(), name='backup-list'),
    path('backups/restore-status/', BackupRestoreStatusView.as_view(), name='backup-restore-status'),
    path('backups/<str:name>/download/', BackupDownloadView.as_view(), name='backup-download'),
    path('backups/<str:name>/delete/', BackupDeleteView.as_view(), name='backup-delete'),
    path('backups/<str:name>/restore/', BackupRestoreView.as_view(), name='backup-restore'),
]

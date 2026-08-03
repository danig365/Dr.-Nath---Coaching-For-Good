from django.urls import path

from .views import ProgrammeSpaceView, AnnouncementCreateView, AnnouncementDetailView

urlpatterns = [
    path('<int:skill_id>/space/', ProgrammeSpaceView.as_view(), name='programme-space'),
    path('<int:skill_id>/announcements/', AnnouncementCreateView.as_view(), name='announcement-create'),
    path('announcements/<int:pk>/', AnnouncementDetailView.as_view(), name='announcement-detail'),
]

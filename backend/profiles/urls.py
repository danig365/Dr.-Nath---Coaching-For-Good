from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    RegisterView, CustomTokenObtainPairView,
    CurrentUserProfileView, CoachDirectoryView,
    SmartMatchView, PendingCoachesView, CoachApprovalView,
    AdminStatsView, AdminAnalyticsView, AdminCoachStatsView, AdminClientStatsView,
    AdminSessionsView, CoachDetailView,
)
urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('login/', CustomTokenObtainPairView.as_view(), name='login'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('profile/', CurrentUserProfileView.as_view(), name='profile'),
    path('coaches/', CoachDirectoryView.as_view(), name='coach-directory'),
    path('coaches/match/', SmartMatchView.as_view(), name='smart-match'),
    path('admin/coaches/pending/', PendingCoachesView.as_view(), name='pending-coaches'),
    path('admin/coaches/<int:user_id>/approve/', CoachApprovalView.as_view(), name='coach-approval'),
    path('admin/stats/', AdminStatsView.as_view(), name='admin-stats'),
    path('admin/analytics/', AdminAnalyticsView.as_view(), name='admin-analytics'),
    path('admin/coach-stats/', AdminCoachStatsView.as_view(), name='admin-coach-stats'),
    path('admin/client-stats/', AdminClientStatsView.as_view(), name='admin-client-stats'),
    path('admin/sessions/', AdminSessionsView.as_view(), name='admin-sessions'),
    path('admin/sessions/<int:pk>/', AdminSessionsView.as_view(), name='admin-session-detail'),
    path('coaches/<int:user_id>/', CoachDetailView.as_view(), name='coach-detail'),
]
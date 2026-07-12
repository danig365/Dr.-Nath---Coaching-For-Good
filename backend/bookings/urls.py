from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    SessionBookingViewSet, ReviewViewSet, CreatePaymentIntentView, ConfirmBookingPaymentView,
    ConfirmFreeBookingView, UploadNotesView, MilestoneView, MilestoneDetailView, TimeSlotViewSet,
    GroupSessionViewSet, CreateGroupPaymentIntentView, ConfirmGroupPaymentView, SlotInviteViewSet,
    HabitView, HabitDetailView, HabitCheckInView,
    BookingInvoiceView, GroupEnrollmentInvoiceView, MagicJoinView, SessionReflectionView,
    SessionAISummaryView,
)
from .livekit_views import BookingCallTokenView, GroupCallTokenView

router = DefaultRouter()
router.register(r'reviews', ReviewViewSet, basename='review')
router.register(r'slots', TimeSlotViewSet, basename='slot')
router.register(r'invites', SlotInviteViewSet, basename='slot-invite')
router.register(r'group-sessions', GroupSessionViewSet, basename='group-session')
router.register(r'', SessionBookingViewSet, basename='booking')

urlpatterns = [
    path('create-payment-intent/', CreatePaymentIntentView.as_view(), name='create-payment-intent'),
    path('confirm-payment/', ConfirmBookingPaymentView.as_view(), name='confirm-payment'),
    path('confirm-free-booking/', ConfirmFreeBookingView.as_view(), name='confirm-free-booking'),
    path('create-group-payment-intent/', CreateGroupPaymentIntentView.as_view(), name='create-group-payment-intent'),
    path('confirm-group-payment/', ConfirmGroupPaymentView.as_view(), name='confirm-group-payment'),
    path('upload-notes/<int:booking_id>/', UploadNotesView.as_view(), name='upload-notes'),
    path('milestones/', MilestoneView.as_view(), name='milestones'),
    path('milestones/<int:pk>/', MilestoneDetailView.as_view(), name='milestone-detail'),
    path('habits/', HabitView.as_view(), name='habits'),
    path('habits/<int:pk>/', HabitDetailView.as_view(), name='habit-detail'),
    path('habits/<int:pk>/check-in/', HabitCheckInView.as_view(), name='habit-check-in'),
    path('group-enrollments/<int:pk>/invoice/', GroupEnrollmentInvoiceView.as_view(), name='group-enrollment-invoice'),
    path('<int:pk>/invoice/', BookingInvoiceView.as_view(), name='booking-invoice'),
    path('livekit/token/booking/<int:booking_id>/', BookingCallTokenView.as_view(), name='livekit-booking-token'),
    path('livekit/token/group/<int:session_id>/', GroupCallTokenView.as_view(), name='livekit-group-token'),
    path('magic-join/<str:token>/', MagicJoinView.as_view(), name='magic-join'),
    path('<int:booking_id>/reflection/', SessionReflectionView.as_view(), name='session-reflection'),
    path('<int:booking_id>/ai-summary/', SessionAISummaryView.as_view(), name='session-ai-summary'),
    path('', include(router.urls)),
]
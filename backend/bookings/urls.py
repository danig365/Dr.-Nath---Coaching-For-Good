from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SessionBookingViewSet, ReviewViewSet, CreatePaymentIntentView, ConfirmBookingPaymentView, UploadNotesView, MilestoneView, MilestoneDetailView

router = DefaultRouter()
router.register(r'reviews', ReviewViewSet, basename='review')
router.register(r'', SessionBookingViewSet, basename='booking')

urlpatterns = [
    path('create-payment-intent/', CreatePaymentIntentView.as_view(), name='create-payment-intent'),
    path('confirm-payment/', ConfirmBookingPaymentView.as_view(), name='confirm-payment'),
    path('upload-notes/<int:booking_id>/', UploadNotesView.as_view(), name='upload-notes'),
    path('milestones/', MilestoneView.as_view(), name='milestones'),
    path('milestones/<int:pk>/', MilestoneDetailView.as_view(), name='milestone-detail'),
    path('', include(router.urls)),
]
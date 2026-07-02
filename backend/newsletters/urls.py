from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    NewsletterViewSet, SubscribeView, SubscriberListView, UnsubscribeView,
)

router = DefaultRouter()
router.register(r'admin/newsletters', NewsletterViewSet, basename='newsletter')

urlpatterns = [
    path('subscribe/', SubscribeView.as_view(), name='newsletter-subscribe'),
    path('unsubscribe/<uuid:token>/', UnsubscribeView.as_view(), name='newsletter-unsubscribe'),
    path('admin/subscribers/', SubscriberListView.as_view(), name='newsletter-subscribers'),
    path('', include(router.urls)),
]

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import FormTemplateViewSet, FormAssignmentViewSet

router = DefaultRouter()
router.register(r'templates', FormTemplateViewSet, basename='form-template')
router.register(r'assignments', FormAssignmentViewSet, basename='form-assignment')

urlpatterns = [
    path('', include(router.urls)),
]

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ResourceFolderViewSet, ResourceViewSet, ClientSubmissionViewSet

router = DefaultRouter()
# Specific prefixes MUST be registered before the empty-prefix ResourceViewSet,
# whose detail pattern would otherwise swallow 'folders/' and 'submissions/'.
router.register(r'folders', ResourceFolderViewSet, basename='resource-folder')
router.register(r'submissions', ClientSubmissionViewSet, basename='submission')
router.register(r'', ResourceViewSet, basename='resource')

urlpatterns = [
    path('', include(router.urls)),
]

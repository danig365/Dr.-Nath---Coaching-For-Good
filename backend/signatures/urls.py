from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import SignatureDocumentViewSet

router = DefaultRouter()
router.register(r'', SignatureDocumentViewSet, basename='signature-document')

urlpatterns = [
    path('', include(router.urls)),
]

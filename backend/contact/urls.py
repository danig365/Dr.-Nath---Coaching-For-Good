from django.urls import path

from .views import ContactMessageListCreateView, ContactMessageDetailView

urlpatterns = [
    path('', ContactMessageListCreateView.as_view(), name='contact-messages'),
    path('<int:pk>/', ContactMessageDetailView.as_view(), name='contact-message-detail'),
]

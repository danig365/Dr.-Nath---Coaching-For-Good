"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static



urlpatterns = [
    path('django-admin/', admin.site.urls),
    path('api/', include('profiles.urls')),
    path('api/skills/', include('skills.urls')),
    path('api/bookings/', include('bookings.urls')),
    path('api/messages/', include('messages.urls')),
    path('api/resources/', include('resources.urls')),
    path('api/programmes/', include('programmes.urls')),
    path('api/contact/', include('contact.urls')),
    path('api/newsletter/', include('newsletters.urls')),
    path('api/assistant/', include('assistant.urls')),
    path('api/signatures/', include('signatures.urls')),
    path('api/forms/', include('formbuilder.urls')),
    path('api/integrations/', include('integrations.urls')),
    path('api/ops/', include('ops.urls')),
    # NOTE: login/refresh live in profiles.urls (CustomTokenObtainPairView /
    # CustomTokenRefreshView), which are rate-limited. The stock SimpleJWT views
    # used to be mounted here too — /api/token/ was an unthrottled second door to
    # login that bypassed that rate limit entirely. Don't re-add them.
    # path('api/notifications/', include('notifications.urls')),
]

urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
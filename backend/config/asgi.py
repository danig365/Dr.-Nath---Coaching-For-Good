import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.middleware import BaseMiddleware
from channels.db import database_sync_to_async
from django.urls import re_path

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

django_asgi_app = get_asgi_application()

@database_sync_to_async
def get_user_from_token(token):
    from django.contrib.auth.models import AnonymousUser
    from rest_framework_simplejwt.tokens import AccessToken
    from profiles.models import CustomUser
    try:
        validated = AccessToken(token)
        return CustomUser.objects.get(id=validated['user_id'])
    except Exception:
        return AnonymousUser()

class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        from urllib.parse import parse_qs
        from django.contrib.auth.models import AnonymousUser
        query_string = scope.get('query_string', b'').decode()
        params = parse_qs(query_string)
        token = params.get('token', [None])[0]
        scope['user'] = await get_user_from_token(token) if token else AnonymousUser()
        return await super().__call__(scope, receive, send)

from messages.consumers import ChatConsumer

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': JWTAuthMiddleware(
        URLRouter([
            re_path(r'ws/chat/(?P<booking_id>\d+)/$', ChatConsumer.as_asgi()),
        ])
    ),
})
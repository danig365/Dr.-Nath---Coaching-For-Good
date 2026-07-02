from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from .services import get_assistant_reply, MAX_HISTORY_MESSAGES


class AssistantThrottle(AnonRateThrottle):
    scope = 'assistant'


class AssistantChatView(APIView):
    """Public website chatbot. Takes a short conversation history and returns the
    assistant's next reply. Rate-limited per IP; degrades gracefully with no key."""
    permission_classes = [AllowAny]
    throttle_classes = [AssistantThrottle]

    def post(self, request):
        history = request.data.get('messages', [])
        if not isinstance(history, list):
            return Response({'error': 'messages must be a list.'}, status=400)
        if len(history) > MAX_HISTORY_MESSAGES * 2:
            history = history[-MAX_HISTORY_MESSAGES * 2:]
        reply = get_assistant_reply(history)
        return Response({'reply': reply})

import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.booking_id = self.scope['url_route']['kwargs']['booking_id']
        self.room_group_name = f'chat_{self.booking_id}'
        user = self.scope['user']

        if isinstance(user, AnonymousUser):
            await self.close()
            return

        # Verify user has access to this booking
        has_access = await self.check_access(user, self.booking_id)
        if not has_access:
            await self.close()
            return

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get('type', 'chat')

        if msg_type == 'signal':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'webrtc_signal',
                    'signal': data.get('signal'),
                    'sender_channel': self.channel_name,
                }
            )
            return

        content = data.get('content', '').strip()
        if not content:
            return

        user = self.scope['user']
        message = await self.save_message(user, self.booking_id, content)
        if not message:
            return

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'id': message['id'],
                'content': message['content'],
                'sender': message['sender_id'],
                'sender_username': message['sender_username'],
                'timestamp': message['timestamp'],
            }
        )

    async def webrtc_signal(self, event):
        if event.get('sender_channel') == self.channel_name:
            return
        await self.send(text_data=json.dumps({
            'type': 'signal',
            'signal': event['signal'],
        }))

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'id': event['id'],
            'content': event['content'],
            'sender': event['sender'],
            'sender_username': event['sender_username'],
            'timestamp': event['timestamp'],
        }))

    @database_sync_to_async
    def check_access(self, user, booking_id):
        from bookings.models import SessionBooking
        try:
            booking = SessionBooking.objects.select_related(
                'mentor__user', 'learner'
            ).get(id=booking_id)
            is_mentor = booking.mentor.user == user
            is_learner = booking.learner == user
            return (is_mentor or is_learner) and booking.status in ['accepted', 'completed']
        except SessionBooking.DoesNotExist:
            return False

    @database_sync_to_async
    def save_message(self, user, booking_id, content):
        from bookings.models import SessionBooking
        from messages.models import Message
        try:
            booking = SessionBooking.objects.select_related(
                'mentor__user', 'learner'
            ).get(id=booking_id)
            is_mentor = booking.mentor.user == user
            receiver = booking.learner if is_mentor else booking.mentor.user
            msg = Message.objects.create(
                booking=booking,
                sender=user,
                receiver=receiver,
                content=content,
            )
            return {
                'id': msg.id,
                'content': msg.content,
                'sender_id': user.id,
                'sender_username': user.username,
                'timestamp': msg.timestamp.isoformat(),
            }
        except Exception:
            return None
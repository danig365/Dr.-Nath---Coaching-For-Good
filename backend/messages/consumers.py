import json
from collections import defaultdict
from datetime import timedelta
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


# Live video call participants per group session, tracked in-process.
# Safe because the deployment runs a single daphne process with the
# InMemoryChannelLayer; revisit if scaling to multiple workers.
GROUP_CALL_ROOMS = defaultdict(set)
# Maximum simultaneous participants in a group video call (mesh quality cap).
GROUP_CALL_MAX = 5


class GroupCallConsumer(AsyncWebsocketConsumer):
    """
    Mesh WebRTC signaling for a group session's built-in video call.

    Relays targeted offer/answer/ICE between peers, announces joins/leaves, and
    carries ephemeral (non-persisted) in-call chat. Access is limited to the
    coach and clients with a booked seat, within a window around the start time,
    and capped at GROUP_CALL_MAX live participants.
    """

    async def connect(self):
        self.session_id = self.scope['url_route']['kwargs']['session_id']
        self.room_group_name = f'groupcall_{self.session_id}'
        user = self.scope['user']

        if isinstance(user, AnonymousUser):
            await self.close()
            return

        access = await self.check_access(user, self.session_id)
        if not access:
            await self.close(code=4403)
            return

        # Enforce the live-call participant cap.
        room = GROUP_CALL_ROOMS[self.room_group_name]
        if self.channel_name not in room and len(room) >= GROUP_CALL_MAX:
            await self.close(code=4429)
            return

        self.username = user.username
        self.user_id = user.id
        self.ready = False
        room.add(self.channel_name)

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        GROUP_CALL_ROOMS.get(self.room_group_name, set()).discard(self.channel_name)
        if getattr(self, 'username', None) is not None:
            await self.channel_layer.group_send(
                self.room_group_name,
                {'type': 'peer_left', 'sender_channel': self.channel_name},
            )
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get('type')

        if msg_type == 'ready':
            # Announce presence; existing ready peers will reply with 'peer_here'
            # so this newcomer can initiate offers to each of them.
            self.ready = True
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'peer_joined',
                    'sender_channel': self.channel_name,
                    'username': self.username,
                },
            )

        elif msg_type == 'signal':
            # Targeted relay to a single peer (offer / answer / ice-candidate).
            target = data.get('target')
            if target:
                await self.channel_layer.send(
                    target,
                    {
                        'type': 'webrtc_signal',
                        'signal': data.get('signal'),
                        'sender_channel': self.channel_name,
                        'username': self.username,
                    },
                )

    # ── Group event handlers ────────────────────────────────────────────────
    async def peer_joined(self, event):
        if event['sender_channel'] == self.channel_name:
            return
        # Tell the newcomer we're here (only if our media is ready). The newcomer
        # is the offer initiator, so existing peers just advertise themselves.
        if self.ready:
            await self.channel_layer.send(
                event['sender_channel'],
                {
                    'type': 'peer_here',
                    'sender_channel': self.channel_name,
                    'username': self.username,
                },
            )

    async def peer_here(self, event):
        await self.send(text_data=json.dumps({
            'type': 'peer-here',
            'peer_id': event['sender_channel'],
            'username': event['username'],
        }))

    async def peer_left(self, event):
        if event['sender_channel'] == self.channel_name:
            return
        await self.send(text_data=json.dumps({
            'type': 'peer-left',
            'peer_id': event['sender_channel'],
        }))

    async def webrtc_signal(self, event):
        await self.send(text_data=json.dumps({
            'type': 'signal',
            'signal': event['signal'],
            'peer_id': event['sender_channel'],
            'username': event.get('username'),
        }))

    @database_sync_to_async
    def check_access(self, user, session_id):
        from django.utils import timezone as dj_tz
        from bookings.models import GroupSession, GroupEnrollment
        try:
            session = GroupSession.objects.select_related('coach__user').get(id=session_id)
        except GroupSession.DoesNotExist:
            return False
        if session.status == 'cancelled':
            return False
        now = dj_tz.now()
        # Joinable from 15 minutes before start until the scheduled end.
        if now < session.start_datetime - timedelta(minutes=15) or now > session.end_datetime:
            return False
        is_coach = session.coach.user_id == user.id
        is_booked = GroupEnrollment.objects.filter(
            group_session=session, learner=user, status='booked'
        ).exists()
        return is_coach or is_booked


def _group_chat_access(user, session_id):
    """Coach or booked client may use the group chat (no time window)."""
    from bookings.models import GroupSession, GroupEnrollment
    try:
        session = GroupSession.objects.select_related('coach__user').get(id=session_id)
    except GroupSession.DoesNotExist:
        return False
    if session.coach.user_id == user.id:
        return True
    return GroupEnrollment.objects.filter(
        group_session=session, learner=user, status='booked'
    ).exists()


class GroupChatConsumer(AsyncWebsocketConsumer):
    """
    Persisted group chat for a session, shared by the in-call panel and the
    standalone group-chat page. Available to the coach and booked clients at any
    time (no call window or participant cap).
    """

    async def connect(self):
        self.session_id = self.scope['url_route']['kwargs']['session_id']
        self.room_group_name = f'groupchat_{self.session_id}'
        user = self.scope['user']
        if isinstance(user, AnonymousUser):
            await self.close()
            return
        if not await database_sync_to_async(_group_chat_access)(user, self.session_id):
            await self.close(code=4403)
            return
        self.user = user
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        content = (data.get('content') or '').strip()
        if not content:
            return
        msg = await self.save_message(self.user, self.session_id, content)
        if not msg:
            return
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'group_message', **msg},
        )

    async def group_message(self, event):
        await self.send(text_data=json.dumps({
            'id': event['id'],
            'content': event['content'],
            'sender': event['sender'],
            'sender_username': event['sender_username'],
            'timestamp': event['timestamp'],
        }))

    @database_sync_to_async
    def save_message(self, user, session_id, content):
        from bookings.models import GroupSession
        from messages.models import GroupMessage
        try:
            session = GroupSession.objects.get(id=session_id)
        except GroupSession.DoesNotExist:
            return None
        m = GroupMessage.objects.create(group_session=session, sender=user, content=content)
        return {
            'id': m.id,
            'content': m.content,
            'sender': user.id,
            'sender_username': user.username,
            'timestamp': m.timestamp.isoformat(),
        }
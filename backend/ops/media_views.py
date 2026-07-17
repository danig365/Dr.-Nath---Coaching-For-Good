"""
Authenticated delivery of private uploads.

Session notes, chat attachments and client submissions used to sit under
/media/, which nginx served to anyone who knew (or guessed) the URL — filenames
come from the original upload, so "contract.pdf" was trivially reachable. These
views put an ownership check in front of every private file; nginx now marks
those directories `internal`, so the ONLY way to them is through here.

Delivery uses X-Accel-Redirect: Django decides *who may read*, nginx does the
actual sending, so we never stream large files through the app server.
"""
import os
import posixpath

from django.core import signing
from django.http import Http404, HttpResponse
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView

# Short-lived signed links for attachments that the browser loads itself (an
# inline <img> can't send an Authorization header). Same idea as an S3 presigned
# URL: the link itself is the capability, so keep its life short. Only ever
# handed to a user who already passed the ownership check in the serializer.
ATTACHMENT_SALT = 'chat-attachment-access'
ATTACHMENT_TTL = 6 * 3600


def sign_attachment(message_id, kind='direct'):
    # `kind` keeps 1:1 and group ids in separate namespaces — without it a token
    # for Message #5 would also unlock GroupMessage #5.
    return signing.dumps({'m': int(message_id), 'k': kind}, salt=ATTACHMENT_SALT)


def read_attachment_token(token, kind='direct'):
    """The message id this token unlocks for `kind`, or None."""
    try:
        data = signing.loads(token, salt=ATTACHMENT_SALT, max_age=ATTACHMENT_TTL)
    except (signing.BadSignature, signing.SignatureExpired):
        return None
    if not isinstance(data, dict) or data.get('k') != kind:
        return None
    return data.get('m')


def _serve(file_field, download_name=None):
    """Hand a file off to nginx via X-Accel-Redirect, after auth has passed."""
    if not file_field or not file_field.name:
        raise Http404('File not found.')
    # file_field.name is a storage-relative path such as "session_notes/x.pdf".
    # Normalise and refuse anything that tries to climb out of MEDIA_ROOT.
    rel = posixpath.normpath(file_field.name.replace('\\', '/')).lstrip('/')
    if rel.startswith('../') or '/../' in rel:
        raise Http404('File not found.')

    response = HttpResponse(status=200)
    response['X-Accel-Redirect'] = f'/protected-media/{rel}'
    # Let nginx set the length/type; we only control disposition.
    del response['Content-Type']
    name = download_name or os.path.basename(rel)
    # Quote the filename so a crafted name can't inject extra headers.
    safe = name.replace('"', '').replace('\r', '').replace('\n', '')
    response['Content-Disposition'] = f'attachment; filename="{safe}"'
    return response


class SessionNotesDownloadView(APIView):
    """Notes a coach uploaded for a session — the two participants only."""
    permission_classes = [IsAuthenticated]

    def get(self, request, booking_id):
        from bookings.models import SessionBooking
        try:
            booking = SessionBooking.objects.select_related('mentor', 'learner').get(id=booking_id)
        except SessionBooking.DoesNotExist:
            raise Http404('Session not found.')
        user = request.user
        if not (booking.learner_id == user.id or booking.mentor.user_id == user.id or user.is_staff):
            raise Http404('Session not found.')  # 404, not 403: don't confirm it exists
        return _serve(booking.notes_file)


class ChatAttachmentDownloadView(APIView):
    """A file shared inside a session's chat — that session's participants only.

    Accepts either a signed-in participant OR a valid short-lived `?t=` token
    (needed because the chat renders images inline, and an <img> tag cannot send
    an Authorization header).
    """
    permission_classes = [AllowAny]

    def get(self, request, message_id):
        from messages.models import Message
        try:
            msg = Message.objects.select_related('booking__mentor', 'booking__learner').get(id=message_id)
        except Message.DoesNotExist:
            raise Http404('Message not found.')

        token = request.query_params.get('t') or ''
        token_ok = token and read_attachment_token(token, 'direct') == msg.id

        user = request.user
        booking = msg.booking
        member = user.is_authenticated and (
            booking.learner_id == user.id or booking.mentor.user_id == user.id or user.is_staff
        )
        if not (token_ok or member):
            raise Http404('Message not found.')
        return _serve(msg.attachment, msg.attachment_name or None)


class GroupChatAttachmentDownloadView(APIView):
    """A file shared in a group session's chat — its coach and booked clients."""
    permission_classes = [AllowAny]

    def get(self, request, message_id):
        from messages.models import GroupMessage
        from bookings.models import GroupEnrollment
        try:
            msg = GroupMessage.objects.select_related('group_session__coach').get(id=message_id)
        except GroupMessage.DoesNotExist:
            raise Http404('Message not found.')

        token = request.query_params.get('t') or ''
        token_ok = token and read_attachment_token(token, 'group') == msg.id

        user = request.user
        member = False
        if user.is_authenticated:
            session = msg.group_session
            member = (
                user.is_staff
                or getattr(session.coach, 'user_id', None) == user.id
                or GroupEnrollment.objects.filter(
                    group_session=session, learner=user, status='booked'
                ).exists()
            )
        if not (token_ok or member):
            raise Http404('Message not found.')
        return _serve(msg.attachment, getattr(msg, 'attachment_name', '') or None)


class SubmissionDownloadView(APIView):
    """A document a client sent their coach — those two only."""
    permission_classes = [IsAuthenticated]

    def get(self, request, submission_id):
        from resources.models import ClientSubmission
        try:
            sub = ClientSubmission.objects.select_related('client', 'coach').get(id=submission_id)
        except ClientSubmission.DoesNotExist:
            raise Http404('Submission not found.')
        user = request.user
        # client is a CustomUser; coach is a UserProfile (hence .user_id).
        if not (sub.client_id == user.id or sub.coach.user_id == user.id or user.is_staff):
            raise Http404('Submission not found.')
        return _serve(sub.file)

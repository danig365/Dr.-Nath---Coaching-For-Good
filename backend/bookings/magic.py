"""
One-click ("magic") session-join links for emails.

A signed token encodes only (booking_id, user_id) — it is tamper-proof (signed
with SECRET_KEY) but carries no secret itself. Clicking the link logs the user
straight into that session's call, so non-technical clients don't have to
remember a password or navigate the app.

Security: the token grants a normal login for its user, so links are only ever
emailed to that user's own address. Actual join is additionally gated at
redemption time (booking must be the user's, accepted, and still within its
scheduled window) — an old or leaked token cannot join a past session.
"""
from django.core import signing

SALT = 'session-join-v1'
# Generous age cap so a link emailed well in advance still works; the real gate
# is the session-window check at redemption.
MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days


def make_join_token(booking_id, user_id):
    return signing.dumps({'b': int(booking_id), 'u': int(user_id)}, salt=SALT)


def read_join_token(token):
    """Return (booking_id, user_id) or raise signing.BadSignature / SignatureExpired."""
    data = signing.loads(token, salt=SALT, max_age=MAX_AGE_SECONDS)
    return data['b'], data['u']

"""
Calendar integration for a booking: an .ics attachment (Apple / Outlook desktop /
import-anywhere) plus one-click "Add to Google Calendar" / "Add to Outlook" links.

All times are emitted in UTC. The event points the client at the in-app session
page (sign-in required), matching the platform's login-first policy.
"""
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.utils import timezone as dj_tz


def _display_name(user):
    if not user:
        return "Dr. Nath"
    return f"{user.first_name} {user.last_name}".strip() or user.username


def _event_fields(booking, start_utc):
    """Common event data shared by the .ics file and the web links."""
    coach_user = booking.mentor.user
    coach_name = _display_name(coach_user)
    skill_name = booking.skill.name if booking.skill else 'Coaching session'
    duration = booking.duration or 60
    end_utc = start_utc + timedelta(minutes=duration)
    # The program name often already mentions the coach ("… with Dr Nath"); only
    # append the coach when it doesn't, to avoid an awkward double "with".
    title = skill_name if 'nath' in skill_name.lower() else f"{skill_name} with {coach_name}"
    join_url = f"{settings.SITE_URL}/session/{booking.id}"
    description = (
        f"Your online coaching session with {coach_name} on the Dr. Nath platform.\n\n"
        f"To join: sign in at {settings.SITE_URL}/login, open My Learning, then click "
        f"Join at the session time.\nSession page: {join_url}"
    )
    location = "Online — Dr. Nath platform (dr-nath.com)"
    return {
        'title': title,
        'description': description,
        'location': location,
        'start_utc': start_utc,
        'end_utc': end_utc,
        'coach_email': coach_user.email or 'dr.nath@dr-nath.com',
        'coach_name': coach_name,
    }


def _ics_escape(text):
    return (text.replace('\\', '\\\\').replace(';', '\\;')
                .replace(',', '\\,').replace('\n', '\\n'))


def build_ics(booking, start_utc):
    """Return (filename, ics_bytes) for the booking, or None if start is unknown."""
    if not start_utc:
        return None
    f = _event_fields(booking, start_utc)
    fmt = '%Y%m%dT%H%M%SZ'
    lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Dr. Nath//Coaching for Impact//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        f'UID:booking-{booking.id}@dr-nath.com',
        f'DTSTAMP:{dj_tz.now().strftime(fmt)}',
        f'DTSTART:{f["start_utc"].strftime(fmt)}',
        f'DTEND:{f["end_utc"].strftime(fmt)}',
        f'SUMMARY:{_ics_escape(f["title"])}',
        f'DESCRIPTION:{_ics_escape(f["description"])}',
        f'LOCATION:{_ics_escape(f["location"])}',
        f'ORGANIZER;CN={_ics_escape(f["coach_name"])}:mailto:{f["coach_email"]}',
        'STATUS:CONFIRMED',
        'BEGIN:VALARM',
        'TRIGGER:-PT1H',
        'ACTION:DISPLAY',
        'DESCRIPTION:Your coaching session is in 1 hour',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
    ]
    ics = '\r\n'.join(lines) + '\r\n'
    return ('session.ics', ics.encode('utf-8'), 'text/calendar')


def google_calendar_link(booking, start_utc):
    if not start_utc:
        return ''
    f = _event_fields(booking, start_utc)
    fmt = '%Y%m%dT%H%M%SZ'
    dates = f'{f["start_utc"].strftime(fmt)}/{f["end_utc"].strftime(fmt)}'
    return (
        'https://calendar.google.com/calendar/render?action=TEMPLATE'
        f'&text={quote(f["title"])}&dates={dates}'
        f'&details={quote(f["description"])}&location={quote(f["location"])}'
    )


def outlook_calendar_link(booking, start_utc):
    if not start_utc:
        return ''
    f = _event_fields(booking, start_utc)
    fmt = '%Y-%m-%dT%H:%M:%SZ'
    return (
        'https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose'
        '&rru=addevent'
        f'&subject={quote(f["title"])}'
        f'&startdt={f["start_utc"].strftime(fmt)}&enddt={f["end_utc"].strftime(fmt)}'
        f'&body={quote(f["description"])}&location={quote(f["location"])}'
    )

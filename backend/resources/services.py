"""Access resolution for Resources.

Who may see a resource is relationship-based (v1): the coach owner always, plus
coachees according to the resource's visibility. A coachee of a coach is anyone
with an accepted/completed 1:1 booking or a booked group-session seat with them.
"""
from django.db.models import Q

from bookings.models import SessionBooking, GroupEnrollment
from .models import Resource


def _coach_ids_for_client(user):
    """UserProfile ids of coaches this user is a coachee of."""
    ids = set(
        SessionBooking.objects.filter(
            learner=user, status__in=['accepted', 'completed']
        ).values_list('mentor_id', flat=True)
    )
    ids |= set(
        GroupEnrollment.objects.filter(
            learner=user, status='booked'
        ).values_list('group_session__coach_id', flat=True)
    )
    return ids


def _group_ids_for_client(user):
    """GroupSession ids the user has a booked seat in."""
    return set(
        GroupEnrollment.objects.filter(
            learner=user, status='booked'
        ).values_list('group_session_id', flat=True)
    )


def resources_for_client(user):
    """Resources shared with `user` across all their coaches."""
    coach_ids = _coach_ids_for_client(user)
    group_ids = _group_ids_for_client(user)
    return Resource.objects.filter(
        Q(visibility='all_platform')
        | Q(visibility='all_clients', coach_id__in=coach_ids)
        | Q(visibility='specific', shared_clients=user)
        | Q(visibility='group', group_session_id__in=group_ids)
    ).distinct()


def can_access(resource, user):
    """True if `user` is the owning coach or a coachee the resource is shared with."""
    if not user or not user.is_authenticated:
        return False
    if resource.coach.user_id == user.id:
        return True
    if resource.visibility == 'all_platform':
        return True  # shared with every client on the platform
    if resource.visibility == 'all_clients':
        return resource.coach_id in _coach_ids_for_client(user)
    if resource.visibility == 'specific':
        return resource.shared_clients.filter(id=user.id).exists()
    if resource.visibility == 'group':
        return resource.group_session_id in _group_ids_for_client(user)
    return False

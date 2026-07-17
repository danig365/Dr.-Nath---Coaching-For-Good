from rest_framework import generics, status, permissions, filters
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.db.models import Sum, Count, Q
from .models import CustomUser, UserProfile
from .serializers import (
    CurrentUserAndProfileSerializer, RegisterSerializer,
    CoachDirectorySerializer, CoachApprovalSerializer
)
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken, AccessToken


def inject_user_claims(token, user):
    """Stamp a token with the user's current identity/profile state.

    Reads live from the DB so a freshly issued token (login OR refresh) always
    reflects the latest profile — e.g. is_profile_complete flips to True the
    moment the user finishes the completion form and we mint a new token.
    """
    profile = user.profile
    token['username'] = user.username
    token['email'] = user.email
    token['user_id'] = user.id
    token['first_name'] = user.first_name
    token['last_name'] = user.last_name
    token['role'] = profile.role
    token['is_verified'] = profile.is_verified
    token['approval_status'] = profile.approval_status
    token['is_profile_complete'] = profile.is_profile_complete
    # E2: the offering a client is locked to (or None). Lets the app show only
    # that programme without an extra fetch.
    token['restricted_to_skill'] = profile.restricted_to_skill_id
    return token


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        return inject_user_claims(token, user)

class CustomTokenObtainPairView(TokenObtainPairView):
    """Login. Gives the user a clear, specific reason when it fails (unknown
    username vs wrong password) instead of one generic message, and is rate-
    limited to blunt brute-force / username-enumeration attempts."""
    serializer_class = CustomTokenObtainPairSerializer
    throttle_scope = 'login'

    def get_throttles(self):
        from rest_framework.throttling import ScopedRateThrottle
        return [ScopedRateThrottle()]

    def post(self, request, *args, **kwargs):
        from django.contrib.auth import get_user_model
        identifier = (request.data.get('username') or '').strip()
        password = request.data.get('password') or ''

        if not identifier or not password:
            return Response({'detail': 'Please enter your username or email, and your password.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Accept either the username OR the email address — clients who forget
        # their username can still sign in with the email they registered with.
        User = get_user_model()
        user = (User.objects.filter(username__iexact=identifier).first()
                or User.objects.filter(email__iexact=identifier).order_by('id').first())
        if user is None:
            return Response({'detail': 'No account found with that username or email. Please check it, or create an account.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not user.is_active:
            return Response({'detail': 'This account is inactive. Please contact us for help.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not user.check_password(password):
            return Response({'detail': 'Incorrect password. Please try again, or reset your password.'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Credentials are valid — issue tokens directly (also handles a case-
        # insensitive username match cleanly, without a second auth pass).
        refresh = CustomTokenObtainPairSerializer.get_token(user)
        return Response({'access': str(refresh.access_token), 'refresh': str(refresh)})


class CustomTokenRefreshSerializer(TokenRefreshSerializer):
    """Re-mint the access token with FRESH claims read from the DB.

    The default refresh copies stale claims off the refresh token. We instead
    rebuild them from the user's current state so the gate (is_profile_complete)
    and role/approval changes take effect on the next refresh without re-login.
    """
    def validate(self, attrs):
        data = super().validate(attrs)
        # Read the user from the freshly-minted ACCESS token, not by re-parsing
        # the incoming refresh token: with BLACKLIST_AFTER_ROTATION the call
        # above has already blacklisted that raw token, so parsing it again
        # raises "Token is blacklisted" and every refresh 401s.
        access = AccessToken(data['access'])
        user_id = access.payload.get('user_id')
        try:
            user = CustomUser.objects.select_related('profile').get(id=user_id)
        except CustomUser.DoesNotExist:
            return data
        inject_user_claims(access, user)
        data['access'] = str(access)
        return data

class CustomTokenRefreshView(TokenRefreshView):
    serializer_class = CustomTokenRefreshSerializer

class RegisterView(generics.CreateAPIView):
    queryset = CustomUser.objects.all()
    permission_classes = [permissions.AllowAny]
    serializer_class = RegisterSerializer

class CurrentUserProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = CurrentUserAndProfileSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return CustomUser.objects.select_related('profile').get(id=self.request.user.id)

# Public coach directory — only approved coaches
class CoachDirectoryView(generics.ListAPIView):
    serializer_class = CoachDirectorySerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        qs = UserProfile.objects.filter(
            role='coach', approval_status='approved'
        ).select_related('user')

        # Filtering
        specialty = self.request.query_params.get('specialty')
        industry = self.request.query_params.get('industry')
        language = self.request.query_params.get('language')
        verified = self.request.query_params.get('verified')

        if specialty:
            qs = qs.filter(specialties__icontains=specialty)
        if industry:
            qs = qs.filter(industries__icontains=industry)
        if language:
            qs = qs.filter(languages__contains=[language])
        if verified:
            qs = qs.filter(is_verified=True)

        return qs

# Smart matching — quiz-based
class SmartMatchView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        goals = request.data.get('goals', [])        # e.g. ["Leadership", "Career"]
        industries = request.data.get('industries', [])
        languages = request.data.get('languages', [])

        # Save goals to client profile
        profile = request.user.profile
        profile.coaching_goals = goals
        profile.save()

        # Match coaches
        qs = UserProfile.objects.filter(role='coach', approval_status='approved')
        matched = []
        for coach in qs.select_related('user'):
            score = 0
            for goal in goals:
                if goal in coach.specialties:
                    score += 2
            for ind in industries:
                if ind in coach.industries:
                    score += 1
            for lang in languages:
                if lang in coach.languages:
                    score += 1
            if score > 0:
                matched.append((score, coach))

        matched.sort(key=lambda x: x[0], reverse=True)
        top_coaches = [c for _, c in matched[:10]]
        serializer = CoachDirectorySerializer(top_coaches, many=True)
        return Response(serializer.data)

# Admin: list pending coaches
class PendingCoachesView(generics.ListAPIView):
    serializer_class = CoachDirectorySerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        return UserProfile.objects.filter(
            role='coach', approval_status='pending'
        ).select_related('user')

# Admin: approve or reject a coach
class CoachApprovalView(APIView):
    permission_classes = [IsAdminUser]

    def patch(self, request, user_id):
        profile = get_object_or_404(UserProfile, user__id=user_id, role='coach')
        serializer = CoachApprovalSerializer(profile, data=request.data, partial=True)
        if serializer.is_valid():
            instance = serializer.save()
            # Auto-set verified badge when approved
            if instance.approval_status == 'approved':
                instance.is_verified = True
                instance.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class AdminStatsView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        from bookings.models import SessionBooking
        from decimal import Decimal

        now = timezone.now()
        week_start = now - timezone.timedelta(days=7)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        bookings = SessionBooking.objects.all()

        # Status counts
        status_counts = {
            s: bookings.filter(status=s).count()
            for s in ['pending', 'accepted', 'completed', 'declined', 'no_show']
        }

        # Revenue from completed sessions
        total_revenue = bookings.filter(status='completed').aggregate(
            total=Sum('skill__price')
        )['total'] or Decimal('0')

        # Sessions this week / month
        sessions_this_week = bookings.filter(
            created_at__gte=week_start, status__in=['accepted', 'completed']
        ).count()
        sessions_this_month = bookings.filter(
            created_at__gte=month_start, status__in=['accepted', 'completed']
        ).count()

        # Total coaching hours (completed sessions)
        completed = bookings.filter(status='completed')
        total_minutes = sum(b.duration for b in completed if b.duration)
        total_hours = round(total_minutes / 60, 1)

        # User counts
        total_coaches = UserProfile.objects.filter(role='coach', approval_status='approved').count()
        pending_coaches = UserProfile.objects.filter(role='coach', approval_status='pending').count()
        total_clients = UserProfile.objects.filter(role='client').count()

        from bookings.models import Milestone
        total_milestones = Milestone.objects.count()
        completed_milestones = Milestone.objects.filter(completed=True).count()

        return Response({
            'total_coaches': total_coaches,
            'pending_coaches': pending_coaches,
            'total_clients': total_clients,
            'total_sessions': bookings.count(),
            'status_counts': status_counts,
            'total_revenue': float(total_revenue),
            'sessions_this_week': sessions_this_week,
            'sessions_this_month': sessions_this_month,
            'total_hours': total_hours,
            'total_milestones': total_milestones,
            'completed_milestones': completed_milestones,
        })


class AdminAnalyticsView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        from bookings.models import SessionBooking
        from collections import defaultdict
        from datetime import datetime, timezone as dt_timezone

        now = timezone.now()

        # Build list of (year, month) for last 12 months
        months = []
        for i in range(11, -1, -1):
            total = now.year * 12 + now.month - 1 - i
            months.append((total // 12, total % 12 + 1))

        cutoff = datetime(months[0][0], months[0][1], 1, tzinfo=dt_timezone.utc)

        bookings = SessionBooking.objects.filter(
            created_at__gte=cutoff
        ).values('created_at', 'status', 'skill__price', 'duration')

        monthly_sessions = defaultdict(int)
        monthly_revenue = defaultdict(float)
        monthly_completed = defaultdict(int)

        for b in bookings:
            dt = b['created_at']
            key = f"{dt.year}-{dt.month:02d}"
            monthly_sessions[key] += 1
            if b['status'] == 'completed':
                monthly_completed[key] += 1
                monthly_revenue[key] += float(b['skill__price'] or 0)

        data = []
        for (y, m) in months:
            key = f"{y}-{m:02d}"
            label = datetime(y, m, 1).strftime("%b %Y")
            data.append({
                'month': label,
                'sessions': monthly_sessions.get(key, 0),
                'completed': monthly_completed.get(key, 0),
                'revenue': round(monthly_revenue.get(key, 0), 2),
            })

        return Response({
            'monthly': data,
            'retention': self._retention(),
            'by_company': self._by_company(),
            'top_coaches': self._top_coaches(),
            'habit_consistency': self._habit_consistency(now),
        })

    # ── Extended analytics (brief #8) ─────────────────────────────────────────
    def _retention(self):
        """Client retention = share of engaged clients who booked more than once.

        'Engaged' = has at least one booking that was accepted or completed (a
        real session, not just a pending request). Returning = 2+ such bookings.
        """
        from bookings.models import SessionBooking
        engaged = (
            SessionBooking.objects
            .filter(status__in=['accepted', 'completed'])
            .values('learner')
            .annotate(n=Count('id'))
        )
        active = len(engaged)
        returning = sum(1 for e in engaged if e['n'] > 1)
        rate = round(returning / active * 100, 1) if active else 0.0
        return {
            'active_clients': active,
            'returning_clients': returning,
            'one_time_clients': active - returning,
            'retention_rate': rate,
        }

    def _by_company(self, limit=8):
        """Coachees grouped by their organisation/company."""
        rows = (
            UserProfile.objects
            .filter(role='client')
            .exclude(user__is_staff=True)  # skip admin/staff accounts, not real coachees
            .values('organisation')
            .annotate(clients=Count('id'))
            .order_by('-clients')
        )
        out = []
        for r in rows:
            name = (r['organisation'] or '').strip() or 'Not specified'
            out.append({'company': name, 'clients': r['clients']})
        # Merge any duplicate 'Not specified' buckets from blanks/nulls.
        merged = {}
        for r in out:
            merged[r['company']] = merged.get(r['company'], 0) + r['clients']
        result = sorted(
            ({'company': k, 'clients': v} for k, v in merged.items()),
            key=lambda x: x['clients'], reverse=True,
        )
        return result[:limit]

    def _top_coaches(self, limit=5):
        """Coaches ranked by engagement (accepted+completed), then rating."""
        from bookings.models import SessionBooking, Review
        from django.db.models import Avg
        rows = []
        for coach in UserProfile.objects.filter(role='coach').select_related('user'):
            bk = SessionBooking.objects.filter(mentor=coach)
            completed = bk.filter(status='completed')
            engaged = bk.filter(status__in=['accepted', 'completed']).count()
            revenue = completed.aggregate(t=Sum('skill__price'))['t'] or 0
            mins = sum(b.duration for b in completed if b.duration)
            avg_rating = Review.objects.filter(mentor_profile=coach).aggregate(a=Avg('rating'))['a']
            name = (f"{coach.user.first_name} {coach.user.last_name}".strip()
                    or coach.user.username)
            rows.append({
                'username': coach.user.username,
                'name': name,
                'engaged_sessions': engaged,
                'completed': completed.count(),
                'revenue': float(revenue),
                'hours': round(mins / 60, 1),
                'avg_rating': round(avg_rating, 1) if avg_rating else None,
            })
        rows.sort(key=lambda r: (r['engaged_sessions'], r['avg_rating'] or 0, r['revenue']), reverse=True)
        return rows[:limit]

    def _habit_consistency(self, now, window=30, daily_days=14):
        """Overall habit adherence across all active habits.

        Per-habit consistency = check-ins in the last `window` days / window
        (capped at 100%). Overall = average across active habits. Also returns
        per-day check-in counts for the last `daily_days` days for a mini chart.
        """
        from bookings.models import Habit, HabitCheckIn
        from datetime import timedelta
        today = timezone.localtime(now).date()
        window_start = today - timedelta(days=window - 1)

        active_habits = list(Habit.objects.filter(active=True))
        per_habit = []
        for h in active_habits:
            c = HabitCheckIn.objects.filter(
                habit=h, date__gte=window_start, date__lte=today
            ).count()
            per_habit.append(min(c / window * 100, 100))
        avg_consistency = round(sum(per_habit) / len(per_habit), 1) if per_habit else 0.0

        checkins_window = HabitCheckIn.objects.filter(
            date__gte=window_start, date__lte=today
        ).count()

        # Per-day counts for a short trend chart.
        daily_start = today - timedelta(days=daily_days - 1)
        rows = (
            HabitCheckIn.objects
            .filter(date__gte=daily_start, date__lte=today)
            .values('date')
            .annotate(n=Count('id'))
        )
        by_date = {r['date']: r['n'] for r in rows}
        daily = []
        for i in range(daily_days):
            d = daily_start + timedelta(days=i)
            daily.append({'date': d.strftime('%d %b'), 'checkins': by_date.get(d, 0)})

        return {
            'active_habits': len(active_habits),
            'avg_consistency': avg_consistency,
            'checkins_30d': checkins_window,
            'daily': daily,
        }


class AdminCoachStatsView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        from bookings.models import SessionBooking, Review
        from django.db.models import Avg

        coaches = UserProfile.objects.filter(role='coach').select_related('user').order_by('-user__date_joined')
        result = []
        for coach in coaches:
            bookings = SessionBooking.objects.filter(mentor=coach)
            total = bookings.count()
            completed = bookings.filter(status='completed').count()
            pending = bookings.filter(status='pending').count()
            accepted = bookings.filter(status='accepted').count()
            revenue = bookings.filter(status='completed').aggregate(
                total=Sum('skill__price')
            )['total'] or 0
            mins = sum(b.duration for b in bookings.filter(status='completed') if b.duration)
            avg_rating = Review.objects.filter(mentor_profile=coach).aggregate(avg=Avg('rating'))['avg']
            review_count = Review.objects.filter(mentor_profile=coach).count()
            result.append({
                'user_id': coach.user.id,
                'username': coach.user.username,
                'email': coach.user.email,
                'is_active': coach.user.is_active,
                'approval_status': coach.approval_status,
                'is_verified': coach.is_verified,
                'specialties': coach.specialties or [],
                'hourly_rate': float(coach.hourly_rate) if coach.hourly_rate else None,
                'years_experience': coach.years_experience,
                'joined': coach.user.date_joined.strftime('%Y-%m-%d'),
                'stats': {
                    'total': total,
                    'completed': completed,
                    'pending': pending,
                    'accepted': accepted,
                    'revenue': float(revenue),
                    'hours': round(mins / 60, 1),
                    'avg_rating': round(avg_rating, 1) if avg_rating else None,
                    'review_count': review_count,
                },
            })
        return Response(result)


class AdminClientStatsView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        from bookings.models import SessionBooking, Review

        clients = UserProfile.objects.filter(role='client').select_related('user').order_by('-user__date_joined')
        result = []
        for client in clients:
            bookings = SessionBooking.objects.filter(learner=client.user)
            total = bookings.count()
            completed = bookings.filter(status='completed').count()
            pending = bookings.filter(status='pending').count()
            accepted = bookings.filter(status='accepted').count()
            declined = bookings.filter(status='declined').count()
            spent = bookings.filter(status='completed').aggregate(
                total=Sum('skill__price')
            )['total'] or 0
            reviews_given = Review.objects.filter(student=client.user).count()
            coaches_set = bookings.values_list('mentor__user__username', flat=True).distinct()
            result.append({
                'user_id': client.user.id,
                'username': client.user.username,
                'email': client.user.email,
                'is_active': client.user.is_active,
                'joined': client.user.date_joined.strftime('%Y-%m-%d'),
                'coaching_goals': client.coaching_goals or [],
                'stats': {
                    'total': total,
                    'completed': completed,
                    'pending': pending,
                    'accepted': accepted,
                    'declined': declined,
                    'spent': float(spent),
                    'reviews_given': reviews_given,
                    'unique_coaches': coaches_set.count(),
                },
            })
        return Response(result)


class CoachClientsView(APIView):
    """
    All registered clients, visible to coaches (and staff). Lets the coach see
    everyone who has signed up — including people who haven't booked yet — with
    how many sessions each has booked with them.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = getattr(request.user, 'profile', None)
        is_coach = bool(profile and profile.role == 'coach')
        if not (is_coach or request.user.is_staff):
            return Response({'detail': 'Coaches only.'}, status=403)

        from bookings.models import SessionBooking

        clients = (
            UserProfile.objects.filter(role='client')
            .select_related('user')
            .order_by('-user__date_joined')
        )
        result = []
        for c in clients:
            u = c.user
            all_bookings = SessionBooking.objects.filter(learner=u)
            mine = all_bookings.filter(mentor=profile).count() if is_coach else all_bookings.count()
            last = all_bookings.order_by('-session_date', '-session_time').first()
            full = f"{u.first_name} {u.last_name}".strip()
            result.append({
                'user_id': u.id,
                'name': full or u.username,
                'username': u.username,
                'email': u.email,
                'joined': u.date_joined.strftime('%Y-%m-%d'),
                'organisation': c.organisation or '',
                'job_title': c.job_title or '',
                'bookings_with_me': mine,
                'total_bookings': all_bookings.count(),
                'last_session': last.session_date.strftime('%Y-%m-%d') if last and last.session_date else None,
            })
        return Response(result)


class AdminSessionsView(APIView):
    permission_classes = [IsAdminUser]

    def get(self, request):
        from bookings.models import SessionBooking

        qs = SessionBooking.objects.select_related(
            'mentor__user', 'learner', 'skill'
        ).order_by('-created_at')

        result = []
        for b in qs:
            result.append({
                'id': b.id,
                'coach': b.mentor.user.username if b.mentor and b.mentor.user else '—',
                'coach_id': b.mentor.user.id if b.mentor and b.mentor.user else None,
                'client': b.learner.username if b.learner else '—',
                'client_id': b.learner.id if b.learner else None,
                'skill': b.skill.name if b.skill else '—',
                'price': float(b.skill.price) if b.skill and b.skill.price else 0,
                'session_date': str(b.session_date),
                'session_time': str(b.session_time)[:5],
                'duration': b.duration,
                'status': b.status,
                'payment_status': b.payment_status,
                'created_at': b.created_at.strftime('%Y-%m-%d'),
                'message': b.message or '',
            })
        return Response(result)

    def patch(self, request, pk):
        from bookings.models import SessionBooking
        booking = get_object_or_404(SessionBooking, pk=pk)
        new_status = request.data.get('status')
        if new_status and new_status in ['pending', 'accepted', 'completed', 'declined', 'no_show']:
            booking.status = new_status
            booking.save()
            return Response({'status': booking.status})
        return Response({'error': 'Invalid status'}, status=status.HTTP_400_BAD_REQUEST)


class AdminUserManageView(APIView):
    """Admin: suspend/reactivate (PATCH is_active) or delete (DELETE) a coach or
    client. Admin/staff accounts and your own account are protected."""
    permission_classes = [IsAdminUser]

    def _target(self, user_id):
        from django.contrib.auth import get_user_model
        return get_object_or_404(get_user_model(), id=user_id)

    def _guard(self, request, user):
        if user.id == request.user.id:
            return "You can't change your own account here."
        if user.is_staff or user.is_superuser:
            return "Admin accounts can't be modified here."
        return None

    def patch(self, request, user_id):
        user = self._target(user_id)
        err = self._guard(request, user)
        if err:
            return Response({'detail': err}, status=status.HTTP_400_BAD_REQUEST)
        if 'is_active' in request.data:
            user.is_active = bool(request.data['is_active'])
            user.save(update_fields=['is_active'])
        return Response({'id': user.id, 'is_active': user.is_active})

    def delete(self, request, user_id):
        user = self._target(user_id)
        err = self._guard(request, user)
        if err:
            return Response({'detail': err}, status=status.HTTP_400_BAD_REQUEST)
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CoachDetailView(generics.RetrieveAPIView):
    serializer_class = CoachDirectorySerializer
    permission_classes = [permissions.AllowAny]

    def get_object(self):
        return get_object_or_404(
            UserProfile,
            user__id=self.kwargs['user_id'],
            role='coach',
            approval_status='approved'
        )


class PasswordResetRequestView(APIView):
    """Step 1 of forgot-password: email the user a reset link. Always responds
    the same way whether or not the email exists (no account enumeration)."""
    permission_classes = [AllowAny]
    throttle_scope = 'login'

    def get_throttles(self):
        from rest_framework.throttling import ScopedRateThrottle
        return [ScopedRateThrottle()]

    def post(self, request):
        from django.conf import settings
        from django.contrib.auth import get_user_model
        email = (request.data.get('email') or '').strip()
        generic = Response({'detail': "If an account exists for that email, we've sent a reset link. Please check your inbox."})
        if not email:
            return generic

        user = get_user_model().objects.filter(email__iexact=email, is_active=True).first()
        if user and user.email:
            from django.utils.http import urlsafe_base64_encode
            from django.utils.encoding import force_bytes
            from django.contrib.auth.tokens import default_token_generator
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            link = f"{settings.SITE_URL}/reset-password/{uid}/{token}"
            try:
                from notifications.services import send_email
                send_email(
                    to=user.email,
                    subject="Reset your Dr. Nath password",
                    template='password_reset',
                    context={
                        'recipient_name': (f"{user.first_name} {user.last_name}".strip() or user.username),
                        'link': link,
                    },
                )
            except Exception:  # noqa: BLE001 — never reveal send failures here
                pass
        return generic


class PasswordResetConfirmView(APIView):
    """Step 2 of forgot-password: set a new password given a valid uid + token."""
    permission_classes = [AllowAny]

    def post(self, request):
        from django.contrib.auth import get_user_model
        from django.utils.http import urlsafe_base64_decode
        from django.utils.encoding import force_str
        from django.contrib.auth.tokens import default_token_generator

        uid = request.data.get('uid')
        token = request.data.get('token')
        new_password = request.data.get('new_password') or ''

        if not (uid and token and new_password):
            return Response({'detail': 'Something is missing — please use the link from your email.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if len(new_password) < 8:
            return Response({'detail': 'Your new password must be at least 8 characters.'},
                            status=status.HTTP_400_BAD_REQUEST)

        User = get_user_model()
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(uid)))
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            user = None
        if user is None or not default_token_generator.check_token(user, token):
            return Response({'detail': 'This reset link is invalid or has expired. Please request a new one.'},
                            status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save(update_fields=['password'])
        return Response({'detail': 'Your password has been reset. You can now sign in with your new password.'})


class RegisterCheckView(APIView):
    """Lightweight availability check so the sign-up form can flag a taken
    username/email early (before the user fills the whole form), instead of only
    failing at final submit. Rate-limited."""
    permission_classes = [AllowAny]
    throttle_scope = 'login'

    def get_throttles(self):
        from rest_framework.throttling import ScopedRateThrottle
        return [ScopedRateThrottle()]

    def post(self, request):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        out = {}
        username = (request.data.get('username') or '').strip()
        email = (request.data.get('email') or '').strip()
        if username:
            out['username_taken'] = User.objects.filter(username__iexact=username).exists()
        if email:
            out['email_taken'] = User.objects.filter(email__iexact=email).exists()
        return Response(out)


class PreRegisterClientsView(APIView):
    """Admin (E2): bulk pre-register clients locked to a single programme and
    email each a branded welcome + set-password (activation) link.

    Idempotent per email — an address that already has an account is skipped,
    never overwritten. Returns a per-row result so the admin sees exactly what
    happened. New accounts are created active but with no usable password, so
    the only way in is the activation link (or 'forgot password' later)."""
    permission_classes = [IsAdminUser]

    def post(self, request):
        from django.conf import settings
        from django.db import transaction
        from django.contrib.auth import get_user_model
        from django.core.validators import validate_email
        from django.core.exceptions import ValidationError as DjValidationError
        from django.utils.http import urlsafe_base64_encode
        from django.utils.encoding import force_bytes
        from django.contrib.auth.tokens import default_token_generator
        from skills.models import Skill
        from notifications.services import send_email

        skill_id = request.data.get('skill_id')
        rows = request.data.get('clients')
        if not skill_id:
            return Response({'detail': 'A programme (skill_id) is required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(rows, list) or not rows:
            return Response({'detail': 'Provide at least one client.'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            skill = Skill.objects.select_related('profile').get(id=skill_id)
        except Skill.DoesNotExist:
            return Response({'detail': 'Programme not found.'}, status=status.HTTP_404_NOT_FOUND)

        User = get_user_model()
        results = []
        seen = set()
        for row in (rows if isinstance(rows, list) else []):
            row = row if isinstance(row, dict) else {}
            email = (row.get('email') or '').strip().lower()
            first = (row.get('first_name') or '').strip()
            last = (row.get('last_name') or '').strip()

            if not email:
                results.append({'email': '', 'status': 'invalid', 'detail': 'Missing email.'})
                continue
            if email in seen:
                results.append({'email': email, 'status': 'invalid', 'detail': 'Duplicate in this list.'})
                continue
            seen.add(email)
            try:
                validate_email(email)
            except DjValidationError:
                results.append({'email': email, 'status': 'invalid', 'detail': 'Not a valid email address.'})
                continue
            if len(email) > 150:
                results.append({'email': email, 'status': 'invalid', 'detail': 'Email is too long.'})
                continue
            if User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).exists():
                results.append({'email': email, 'status': 'exists', 'detail': 'Account already exists — skipped.'})
                continue

            try:
                with transaction.atomic():
                    user = User.objects.create(
                        username=email, email=email,
                        first_name=first, last_name=last, is_active=True,
                    )
                    user.set_unusable_password()
                    user.save(update_fields=['password'])
                    profile = user.profile  # auto-created by post_save signal
                    profile.role = 'client'
                    profile.restricted_to_skill = skill
                    profile.save(update_fields=['role', 'restricted_to_skill'])
            except Exception as exc:  # noqa: BLE001
                results.append({'email': email, 'status': 'error', 'detail': str(exc)})
                continue

            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            link = f"{settings.SITE_URL}/reset-password/{uid}/{token}"
            sent = send_email(
                to=email,
                subject="Activate your Dr. Nath account",
                template='client_activation',
                context={
                    'recipient_name': (f"{first} {last}".strip() or email),
                    'program_name': skill.name,
                    'email': email,
                    'link': link,
                },
            )
            results.append({
                'email': email,
                'status': 'created' if sent else 'created_no_email',
                'detail': ('Account created and activation email sent.' if sent
                           else 'Account created, but the activation email could not be sent.'),
            })

        summary = {
            'created': sum(1 for r in results if r['status'].startswith('created')),
            'exists': sum(1 for r in results if r['status'] == 'exists'),
            'invalid': sum(1 for r in results if r['status'] == 'invalid'),
            'error': sum(1 for r in results if r['status'] == 'error'),
        }
        return Response({'programme': skill.name, 'summary': summary, 'results': results})
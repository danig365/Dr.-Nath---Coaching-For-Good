from rest_framework import generics, status, permissions, filters
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.db.models import Sum, Count, Q
from .models import CustomUser, UserProfile
from .serializers import (
    CurrentUserAndProfileSerializer, RegisterSerializer,
    CoachDirectorySerializer, CoachApprovalSerializer
)
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['username'] = user.username
        token['email'] = user.email
        token['user_id'] = user.id
        token['role'] = user.profile.role
        token['is_verified'] = user.profile.is_verified
        token['approval_status'] = user.profile.approval_status
        return token

class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer

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
            for s in ['pending', 'accepted', 'completed', 'declined']
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

        return Response({'monthly': data})


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
        if new_status and new_status in ['pending', 'accepted', 'completed', 'declined']:
            booking.status = new_status
            booking.save()
            return Response({'status': booking.status})
        return Response({'error': 'Invalid status'}, status=status.HTTP_400_BAD_REQUEST)


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
# Register your models here.
from django.contrib import admin
from .models import SessionBooking
from .models import Review
from .models import TimeSlot
from .models import GroupSession, GroupEnrollment


@admin.register(TimeSlot)
class TimeSlotAdmin(admin.ModelAdmin):
    list_display = ('coach', 'skill', 'start_datetime', 'end_datetime', 'status', 'source')
    list_filter = ('status', 'source', 'start_datetime')
    search_fields = ('coach__user__username', 'skill__name')
    readonly_fields = ('created_at', 'updated_at')
    date_hierarchy = 'start_datetime'

@admin.register(SessionBooking)
class SessionBookingAdmin(admin.ModelAdmin):
    list_display = ('learner', 'skill', 'session_date', 'session_time', 'status', 'created_at')
    list_filter = ('status', 'session_date')
    search_fields = ('learner__username', 'skill__name', 'skill__profile__user__username')
    readonly_fields = ('created_at',)
    fields = ('mentor', 'learner', 'skill', 'session_date', 'session_time', 'status', 'duration', 'skill_level', 'message', 'meeting_link', 'created_at')

@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ('get_mentor_username', 'get_student_username', 'rating', 'created_at')
    list_filter = ('rating', 'created_at')
    search_fields = ('comment', 'mentor_profile__user__username', 'student__username')
    readonly_fields = ('created_at',) # Ensure creation date isn't editable
    # Add fields to manage in the admin form
    fields = ('mentor_profile', 'student', 'rating', 'comment', 'created_at')

    def get_mentor_username(self, obj):
        return obj.mentor_profile.user.username if obj.mentor_profile and obj.mentor_profile.user else 'N/A'
    get_mentor_username.short_description = 'Mentor'

    def get_student_username(self, obj):
        return obj.student.username if obj.student else 'N/A'
    get_student_username.short_description = 'Student'


class GroupEnrollmentInline(admin.TabularInline):
    model = GroupEnrollment
    extra = 0
    readonly_fields = ('created_at', 'updated_at')
    fields = ('learner', 'status', 'payment_status', 'amount_paid', 'held_until', 'created_at')


@admin.register(GroupSession)
class GroupSessionAdmin(admin.ModelAdmin):
    list_display = ('title', 'coach', 'start_datetime', 'capacity', 'seats_taken', 'status')
    list_filter = ('status', 'start_datetime')
    search_fields = ('title', 'coach__user__username', 'skill__name')
    readonly_fields = ('created_at', 'updated_at')
    date_hierarchy = 'start_datetime'
    inlines = [GroupEnrollmentInline]


@admin.register(GroupEnrollment)
class GroupEnrollmentAdmin(admin.ModelAdmin):
    list_display = ('learner', 'group_session', 'status', 'payment_status', 'amount_paid', 'created_at')
    list_filter = ('status', 'payment_status', 'created_at')
    search_fields = ('learner__username', 'group_session__title')
    readonly_fields = ('created_at', 'updated_at')

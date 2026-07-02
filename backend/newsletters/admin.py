from django.contrib import admin

from .models import Newsletter, NewsletterSubscriber


@admin.register(NewsletterSubscriber)
class NewsletterSubscriberAdmin(admin.ModelAdmin):
    list_display = ('email', 'first_name', 'is_active', 'source', 'created_at')
    list_filter = ('is_active', 'source')
    search_fields = ('email', 'first_name')


@admin.register(Newsletter)
class NewsletterAdmin(admin.ModelAdmin):
    list_display = ('subject', 'status', 'sent_count', 'sent_at', 'created_at')
    list_filter = ('status',)
    search_fields = ('subject',)

from rest_framework import serializers

from .models import Newsletter, NewsletterSubscriber


class SubscribeSerializer(serializers.Serializer):
    """Public sign-up payload. Email is normalised; first_name/source optional."""
    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=120, required=False, allow_blank=True, default='')
    source = serializers.ChoiceField(
        choices=NewsletterSubscriber.SOURCE_CHOICES, required=False, default='other'
    )

    def validate_email(self, value):
        return value.strip().lower()


class SubscriberSerializer(serializers.ModelSerializer):
    """Admin-facing subscriber row."""
    class Meta:
        model = NewsletterSubscriber
        fields = ['id', 'email', 'first_name', 'is_active', 'source', 'created_at']
        read_only_fields = fields


class NewsletterSerializer(serializers.ModelSerializer):
    """Admin CRUD for newsletter issues. Status/send metadata are server-managed."""
    class Meta:
        model = Newsletter
        fields = [
            'id', 'subject', 'body_html', 'status',
            'sent_at', 'sent_count', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'status', 'sent_at', 'sent_count', 'created_at', 'updated_at']

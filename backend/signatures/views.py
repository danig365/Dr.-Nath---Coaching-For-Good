from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import SignatureDocument
from .serializers import SignatureDocumentSerializer


def _client_ip(request):
    xff = request.META.get('HTTP_X_FORWARDED_FOR', '')
    return (xff.split(',')[0].strip() if xff else request.META.get('REMOTE_ADDR')) or None


class SignatureDocumentViewSet(viewsets.ModelViewSet):
    """Coach-created e-signature documents. The coach sends; the client signs;
    the coach counter-signs. Both parties can view/download their own docs."""
    serializer_class = SignatureDocumentSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _profile(self):
        return getattr(self.request.user, 'profile', None)

    def _is_coach(self):
        p = self._profile()
        return bool(p and p.role in ('coach', 'admin'))

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated or not hasattr(user, 'profile'):
            return SignatureDocument.objects.none()
        qs = SignatureDocument.objects.select_related('coach__user', 'client')
        if self._is_coach():
            return qs.filter(coach=user.profile)
        return qs.filter(client=user)

    def perform_create(self, serializer):
        profile = self._profile()
        if not self._is_coach():
            raise ValidationError("Only coaches can send documents for signature.")
        client = serializer.validated_data.get('client')
        if not client or getattr(getattr(client, 'profile', None), 'role', None) != 'client':
            raise ValidationError({'client': 'Select a valid client.'})
        doc = serializer.save(coach=profile, status=SignatureDocument.STATUS_SENT)
        from .notifications import notify_signature_request
        notify_signature_request(doc)

    def perform_update(self, serializer):
        raise ValidationError("Signature documents can't be edited once sent.")

    def perform_destroy(self, instance):
        if not self._is_coach() or instance.coach.user_id != self.request.user.id:
            raise ValidationError("You can only delete your own documents.")
        if instance.status == SignatureDocument.STATUS_COMPLETED:
            raise ValidationError("A completed (fully signed) document can't be deleted.")
        instance.file.delete(save=False)
        if instance.signed_file:
            instance.signed_file.delete(save=False)
        instance.delete()

    # ── Signing actions ──────────────────────────────────────────────────────
    @action(detail=True, methods=['post'])
    def sign(self, request, pk=None):
        """Client signs (typed full name = e-signature)."""
        doc = self.get_object()
        if doc.client_id != request.user.id:
            return Response({'detail': 'Only the assigned client can sign this document.'}, status=status.HTTP_403_FORBIDDEN)
        if doc.status != SignatureDocument.STATUS_SENT:
            return Response({'detail': 'This document is not awaiting your signature.'}, status=status.HTTP_400_BAD_REQUEST)
        name = (request.data.get('signature') or '').strip()
        if not name:
            return Response({'detail': 'Type your full name to sign.'}, status=status.HTTP_400_BAD_REQUEST)
        doc.client_signature = name[:200]
        doc.client_signed_at = timezone.now()
        doc.client_signed_ip = _client_ip(request)
        doc.status = SignatureDocument.STATUS_CLIENT_SIGNED
        doc.save(update_fields=['client_signature', 'client_signed_at', 'client_signed_ip', 'status', 'updated_at'])
        from .notifications import notify_client_signed
        notify_client_signed(doc)
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=['post'], url_path='counter-sign')
    def counter_sign(self, request, pk=None):
        """Coach counter-signs, completing the document."""
        doc = self.get_object()
        if not self._is_coach() or doc.coach.user_id != request.user.id:
            return Response({'detail': 'Only the sending coach can counter-sign.'}, status=status.HTTP_403_FORBIDDEN)
        if doc.status != SignatureDocument.STATUS_CLIENT_SIGNED:
            return Response({'detail': 'This document is not awaiting your counter-signature.'}, status=status.HTTP_400_BAD_REQUEST)
        name = (request.data.get('signature') or '').strip()
        if not name:
            return Response({'detail': 'Type your full name to sign.'}, status=status.HTTP_400_BAD_REQUEST)
        doc.coach_signature = name[:200]
        doc.coach_signed_at = timezone.now()
        doc.coach_signed_ip = _client_ip(request)
        doc.status = SignatureDocument.STATUS_COMPLETED
        doc.save(update_fields=['coach_signature', 'coach_signed_at', 'coach_signed_ip', 'status', 'updated_at'])
        # Generate the signed PDF (Phase 2). Best-effort — completion isn't blocked.
        try:
            from .pdf import build_and_store_signed_pdf
            build_and_store_signed_pdf(doc)
        except Exception:  # noqa: BLE001 — never block completion on PDF gen
            pass
        # Email both parties the completed doc (with signed PDF attached).
        from .notifications import notify_completed
        notify_completed(doc)
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=['post'])
    def decline(self, request, pk=None):
        """Client declines to sign."""
        doc = self.get_object()
        if doc.client_id != request.user.id:
            return Response({'detail': 'Only the assigned client can decline.'}, status=status.HTTP_403_FORBIDDEN)
        if doc.status != SignatureDocument.STATUS_SENT:
            return Response({'detail': 'This document can no longer be declined.'}, status=status.HTTP_400_BAD_REQUEST)
        doc.status = SignatureDocument.STATUS_DECLINED
        doc.decline_reason = (request.data.get('reason') or '').strip()
        doc.save(update_fields=['status', 'decline_reason', 'updated_at'])
        from .notifications import notify_declined
        notify_declined(doc)
        return Response(self.get_serializer(doc).data)

    # ── Downloads ────────────────────────────────────────────────────────────
    def _serve(self, filefield, fallback_name):
        if not filefield:
            raise Http404("No file.")
        try:
            fh = filefield.open('rb')
        except (FileNotFoundError, ValueError):
            raise Http404("File is missing.")
        name = filefield.name.split('/')[-1] or fallback_name
        return FileResponse(fh, as_attachment=True, filename=name)

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        """Download the original document (coach or client)."""
        doc = self.get_object()  # queryset already restricts to the two parties
        return self._serve(doc.file, f"{doc.title}.pdf")

    @action(detail=True, methods=['get'], url_path='download-signed')
    def download_signed(self, request, pk=None):
        """Download the fully-signed PDF once completed."""
        doc = self.get_object()
        if doc.status != SignatureDocument.STATUS_COMPLETED or not doc.signed_file:
            return Response({'detail': 'The signed document is not ready yet.'}, status=status.HTTP_400_BAD_REQUEST)
        return self._serve(doc.signed_file, f"{doc.title} (signed).pdf")

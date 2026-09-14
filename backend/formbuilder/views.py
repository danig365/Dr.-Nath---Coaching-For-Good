"""API for the Template Builder: coach template CRUD + assign/submit flow."""
import logging

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import FormTemplate, FormAssignment

logger = logging.getLogger(__name__)
from .serializers import FormTemplateSerializer, FormAssignmentSerializer, clean_answers


def _coach_profile(user):
    profile = getattr(user, 'profile', None)
    if not profile or profile.role not in ('coach', 'admin'):
        return None
    return profile


class FormTemplateViewSet(viewsets.ModelViewSet):
    """A coach's reusable form/survey templates. Coaches only; each sees and
    manages their own templates."""
    serializer_class = FormTemplateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        profile = _coach_profile(self.request.user)
        if not profile:
            return FormTemplate.objects.none()
        qs = FormTemplate.objects.filter(coach=profile)
        # Hide archived templates unless explicitly asked for (?include_archived=1).
        if self.request.query_params.get('include_archived') not in ('1', 'true'):
            qs = qs.filter(active=True)
        return qs

    def _check_skill(self, profile, serializer):
        skill = serializer.validated_data.get('skill')
        if skill and skill.profile_id != profile.id:
            from rest_framework.exceptions import ValidationError as DRFValidationError
            raise DRFValidationError({'skill': "That programme isn't yours."})

    def perform_create(self, serializer):
        profile = _coach_profile(self.request.user)
        if not profile:
            raise PermissionDenied("Only coaches can create templates.")
        self._check_skill(profile, serializer)
        serializer.save(coach=profile)

    def perform_update(self, serializer):
        # get_queryset already restricts to the coach's own templates.
        self._check_skill(_coach_profile(self.request.user), serializer)
        serializer.save()

    def perform_destroy(self, instance):
        """Archive rather than hard-delete, so existing assignments/responses
        (which snapshot their own questions) are never orphaned."""
        instance.active = False
        instance.save(update_fields=['active', 'updated_at'])

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        """Un-archive a template. Fetches from the coach's full set (including
        archived), since the default queryset hides archived templates."""
        from django.shortcuts import get_object_or_404
        profile = _coach_profile(request.user)
        if not profile:
            raise PermissionDenied("Only coaches can restore templates.")
        template = get_object_or_404(FormTemplate, pk=pk, coach=profile)
        template.active = True
        template.save(update_fields=['active', 'updated_at'])
        return Response(self.get_serializer(template).data)

    @action(detail=True, methods=['post'])
    def duplicate(self, request, pk=None):
        """Clone a template into a new draft the coach can tweak."""
        src = self.get_object()
        copy = FormTemplate.objects.create(
            coach=src.coach,
            title=f"{src.title} (copy)"[:200],
            description=src.description,
            kind=src.kind,
            questions=src.questions,
        )
        return Response(self.get_serializer(copy).data, status=201)

    @action(detail=True, methods=['post'], url_path='send-to-all')
    def send_to_all(self, request, pk=None):
        """
        Send this form to every registered client at once.

        Dr Nath asked to be able to poll "currently registered clients" — the
        same set the Clients page shows, which is everyone signed up, not only
        people who have booked with her.

        Skips anyone who already has this form, so it can be re-run to catch
        clients who registered since, without sending a second copy to anyone.
        """
        template = self.get_object()
        if not template.questions:
            raise ValidationError("This template has no questions yet.")

        from profiles.models import UserProfile
        from .notifications import notify_form_assigned

        already = set(
            FormAssignment.objects.filter(template=template)
            .values_list('client_id', flat=True)
        )
        clients = (
            UserProfile.objects.filter(role='client')
            .select_related('user')
            .exclude(user_id__in=already)
        )

        created = []
        for profile in clients:
            created.append(FormAssignment(
                template=template, coach=template.coach, client=profile.user,
                title=template.title, description=template.description,
                kind=template.kind, questions_snapshot=template.questions,
            ))
        FormAssignment.objects.bulk_create(created)

        # bulk_create doesn't return usable pks on every backend, so re-read the
        # rows we just made in order to email them.
        sent = 0
        for a in FormAssignment.objects.filter(
            template=template, client_id__in=[c.client_id for c in created]
        ):
            try:
                notify_form_assigned(a)
                sent += 1
            except Exception:  # noqa: BLE001 — the form is assigned either way
                logger.warning("Could not email form %s to %s", template.id, a.client_id,
                               exc_info=True)

        return Response({
            'assigned': len(created),
            'emailed': sent,
            'skipped_already_sent': len(already),
        }, status=201)

    @action(detail=True, methods=['get'])
    def results(self, request, pk=None):
        """
        Aggregate the answers to this form — what a poll is actually for.

        Reading twenty individual responses one at a time answers nothing; a
        coach wants the totals. Choice and yes/no questions come back as counts,
        ratings as an average plus their spread, and free text as the answers
        themselves, since there is nothing to count there.
        """
        template = self.get_object()
        assignments = FormAssignment.objects.filter(template=template)
        completed = [a for a in assignments if a.status == FormAssignment.STATUS_COMPLETED]

        questions = []
        for q in (template.questions or []):
            qid = q.get('id')
            answers = [a.answers.get(qid) for a in completed if a.answers.get(qid) not in (None, '', [])]
            entry = {'id': qid, 'label': q.get('label'), 'type': q.get('type'),
                     'answered': len(answers)}

            if q.get('type') in ('single_choice', 'multi_choice', 'yes_no'):
                counts = {}
                for ans in answers:
                    for value in (ans if isinstance(ans, list) else [ans]):
                        key = 'Yes' if value is True else 'No' if value is False else str(value)
                        counts[key] = counts.get(key, 0) + 1
                entry['counts'] = counts
            elif q.get('type') in ('rating', 'number'):
                nums = []
                for ans in answers:
                    try:
                        nums.append(float(ans))
                    except (TypeError, ValueError):
                        continue
                entry['average'] = round(sum(nums) / len(nums), 1) if nums else None
                spread = {}
                for n in nums:
                    key = str(int(n))
                    spread[key] = spread.get(key, 0) + 1
                entry['counts'] = spread
            else:
                entry['answers'] = [str(a) for a in answers]

            questions.append(entry)

        return Response({
            'template': template.id,
            'title': template.title,
            'sent': assignments.count(),
            'completed': len(completed),
            'questions': questions,
        })


class FormAssignmentViewSet(viewsets.ModelViewSet):
    """A form/survey sent to a client. Coaches assign templates and read the
    responses; clients see forms assigned to them and submit answers."""
    serializer_class = FormAssignmentSerializer
    permission_classes = [IsAuthenticated]
    # Assignments are created via POST and completed via the `submit` action;
    # editing a snapshot/answers directly is not allowed. Coaches may delete.
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated or not hasattr(user, 'profile'):
            return FormAssignment.objects.none()
        qs = FormAssignment.objects.select_related('coach__user', 'client', 'template')
        if user.profile.role in ('coach', 'admin'):
            return qs.filter(coach=user.profile)
        return qs.filter(client=user)

    def create(self, request, *args, **kwargs):
        """Coach assigns a template to a client, snapshotting its questions."""
        profile = _coach_profile(request.user)
        if not profile:
            raise PermissionDenied("Only coaches can assign forms.")

        template = get_object_or_404(
            FormTemplate, pk=request.data.get('template'), coach=profile,
        )
        if not template.questions:
            raise ValidationError("This template has no questions yet.")

        from profiles.models import CustomUser
        client = get_object_or_404(CustomUser, pk=request.data.get('client'))
        if getattr(getattr(client, 'profile', None), 'role', None) != 'client':
            raise ValidationError({'client': 'Select a valid client.'})

        # Optional link to a session; must belong to this coach + client.
        booking = None
        booking_id = request.data.get('booking')
        if booking_id:
            from bookings.models import SessionBooking
            booking = get_object_or_404(
                SessionBooking, pk=booking_id, mentor=profile, learner=client,
            )

        assignment = FormAssignment.objects.create(
            template=template, coach=profile, client=client, booking=booking,
            title=template.title, description=template.description,
            kind=template.kind, questions_snapshot=template.questions,
        )
        from .notifications import notify_form_assigned
        notify_form_assigned(assignment)
        return Response(self.get_serializer(assignment).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        # get_queryset already scopes to the coach's own; clients can't reach here.
        if not _coach_profile(self.request.user):
            raise PermissionDenied("Only coaches can delete a sent form.")
        instance.delete()

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """Client submits their answers, completing the form."""
        assignment = self.get_object()
        if assignment.client_id != request.user.id:
            return Response({'detail': 'Only the assigned client can submit this form.'},
                            status=status.HTTP_403_FORBIDDEN)
        if assignment.status == FormAssignment.STATUS_COMPLETED:
            return Response({'detail': "You've already submitted this form."},
                            status=status.HTTP_400_BAD_REQUEST)

        answers = clean_answers(assignment.questions_snapshot, request.data.get('answers'))
        assignment.answers = answers
        assignment.status = FormAssignment.STATUS_COMPLETED
        assignment.completed_at = timezone.now()
        assignment.save(update_fields=['answers', 'status', 'completed_at'])
        from .notifications import notify_form_submitted
        notify_form_submitted(assignment)
        return Response(self.get_serializer(assignment).data)

"""Serializers for the Template Builder (intake forms / feedback surveys)."""
import uuid

from rest_framework import serializers

from .models import FormTemplate, FormAssignment, QUESTION_TYPES

CHOICE_TYPES = {'single_choice', 'multi_choice'}


def clean_questions(raw):
    """Validate + normalise a list of question dicts.

    Ensures each question has a stable id, a non-empty label, a supported type,
    and (for choice types) at least two options. Returns the cleaned list or
    raises ValidationError. Shared by templates and (Phase 2) assignments.
    """
    if not isinstance(raw, list):
        raise serializers.ValidationError("Questions must be a list.")
    if not raw:
        raise serializers.ValidationError("Add at least one question.")

    cleaned, seen_ids = [], set()
    for i, q in enumerate(raw, 1):
        if not isinstance(q, dict):
            raise serializers.ValidationError(f"Question {i} is malformed.")
        label = (q.get('label') or '').strip()
        if not label:
            raise serializers.ValidationError(f"Question {i} needs a label.")
        qtype = q.get('type')
        if qtype not in QUESTION_TYPES:
            raise serializers.ValidationError(f"Question {i} has an unsupported type '{qtype}'.")

        qid = str(q.get('id') or '').strip() or f"q{uuid.uuid4().hex[:8]}"
        while qid in seen_ids:  # guarantee uniqueness
            qid = f"q{uuid.uuid4().hex[:8]}"
        seen_ids.add(qid)

        item = {
            'id': qid,
            'label': label[:500],
            'type': qtype,
            'required': bool(q.get('required', False)),
        }
        if qtype in CHOICE_TYPES:
            options = [str(o).strip() for o in (q.get('options') or []) if str(o).strip()]
            if len(options) < 2:
                raise serializers.ValidationError(f"Question {i} ('{label}') needs at least two options.")
            item['options'] = options[:20]
        cleaned.append(item)
    return cleaned


class FormTemplateSerializer(serializers.ModelSerializer):
    assignment_count = serializers.SerializerMethodField(read_only=True)
    skill_name = serializers.CharField(source='skill.name', read_only=True)

    class Meta:
        model = FormTemplate
        fields = [
            'id', 'title', 'description', 'kind', 'questions', 'skill', 'skill_name',
            'active', 'assignment_count', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'active', 'skill_name', 'created_at', 'updated_at']

    def get_assignment_count(self, obj):
        return obj.assignments.count()

    def validate_title(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError("A title is required.")
        return value

    def validate_questions(self, value):
        return clean_questions(value)


def clean_answers(questions, raw):
    """Validate a client's answers against a form's (snapshotted) questions.

    Enforces required questions and per-type shape (choice values must be within
    the offered options, rating 1-5, etc.). Returns the cleaned {id: value} map.
    """
    if not isinstance(raw, dict):
        raise serializers.ValidationError("Answers must be an object.")

    cleaned = {}
    for q in questions:
        qid, qtype, label = q['id'], q['type'], q.get('label', 'This question')
        val = raw.get(qid, None)
        if val in (None, '', [], {}):
            if q.get('required'):
                raise serializers.ValidationError(f"'{label}' is required.")
            continue

        if qtype in ('short_text', 'long_text', 'date'):
            cleaned[qid] = str(val)[:5000]
        elif qtype == 'number':
            try:
                cleaned[qid] = float(val)
            except (TypeError, ValueError):
                raise serializers.ValidationError(f"'{label}' must be a number.")
        elif qtype == 'rating':
            try:
                iv = int(val)
            except (TypeError, ValueError):
                raise serializers.ValidationError(f"'{label}' must be a rating.")
            if not 1 <= iv <= 5:
                raise serializers.ValidationError(f"'{label}' rating must be between 1 and 5.")
            cleaned[qid] = iv
        elif qtype == 'yes_no':
            if isinstance(val, bool):
                cleaned[qid] = val
            elif str(val).lower() in ('yes', 'true', '1'):
                cleaned[qid] = True
            elif str(val).lower() in ('no', 'false', '0'):
                cleaned[qid] = False
            else:
                raise serializers.ValidationError(f"'{label}' must be yes or no.")
        elif qtype == 'single_choice':
            if str(val) not in (q.get('options') or []):
                raise serializers.ValidationError(f"'{label}': please pick one of the given options.")
            cleaned[qid] = str(val)
        elif qtype == 'multi_choice':
            if not isinstance(val, list):
                raise serializers.ValidationError(f"'{label}' must be a list of selections.")
            options = q.get('options') or []
            for v in val:
                if str(v) not in options:
                    raise serializers.ValidationError(f"'{label}': '{v}' is not a valid option.")
            cleaned[qid] = [str(v) for v in val]
    return cleaned


class FormAssignmentSerializer(serializers.ModelSerializer):
    """Read model for a form assigned to a client (coach + client views)."""
    client_name = serializers.SerializerMethodField()
    client_email = serializers.CharField(source='client.email', read_only=True)
    coach_name = serializers.SerializerMethodField()
    template_title = serializers.CharField(source='template.title', read_only=True, default=None)

    class Meta:
        model = FormAssignment
        fields = [
            'id', 'template', 'template_title', 'coach', 'client',
            'client_name', 'client_email', 'coach_name', 'booking',
            'title', 'description', 'kind', 'questions_snapshot', 'answers',
            'status', 'created_at', 'completed_at',
        ]
        read_only_fields = fields

    def _name(self, user):
        full = f"{user.first_name} {user.last_name}".strip()
        return full or user.username

    def get_client_name(self, obj):
        return self._name(obj.client)

    def get_coach_name(self, obj):
        return self._name(obj.coach.user)

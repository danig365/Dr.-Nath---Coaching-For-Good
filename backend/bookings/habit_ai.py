"""AI habit coaching (F3).

Two capabilities on top of the manual Habit tracker:
  - suggest_habits()      → help the coach *build* habits for a client (AI ideas).
  - habit_nudge_message() → help the client *sustain* habits (AI encouragement).

Everything degrades gracefully: no AI provider or any error → empty/fallback,
never raises. AI output is supportive coaching, not medical advice.
"""
import json
import re

from assistant.services import complete_text

# domain key → human phrase used in prompts. Mirrors Habit.CATEGORY_CHOICES.
DOMAIN_LABELS = {
    'nutrition': 'nutrition and eating habits',
    'activity': 'physical activity and movement',
    'sleep': 'sleep',
    'stress': 'stress management',
    'mindfulness': 'mindfulness',
    'relationships': 'relationships and social connection',
    'burnout': 'preventing burnout',
    'balance': 'work-life balance',
}
VALID_CATEGORIES = set(DOMAIN_LABELS)

_SUGGEST_SYSTEM = (
    "You are an experienced health-and-wellness coach helping another coach design "
    "daily habits for their client. Suggest small, specific, measurable habits the "
    "client can realistically do every day and sustain. Return ONLY a JSON object: "
    '{"habits": [{"title": "...", "description": "...", "category": "<one of: '
    'nutrition, activity, sleep, stress, mindfulness, relationships, burnout, '
    'balance>"}]}. Titles are short (max ~60 chars); each description is one warm, '
    "encouraging sentence. This is supportive coaching, not medical advice — avoid "
    "clinical or diagnostic claims."
)

_NUDGE_SYSTEM = (
    "You are a warm, encouraging wellness coach writing a SHORT personal nudge to a "
    "client about their daily habits. 2-4 sentences. Celebrate what is going well, "
    "gently re-encourage anything they have slipped on, and end with one small, "
    "specific suggestion. Warm and human, written in the first person as the coach. "
    "Supportive guidance, not medical advice. Return plain text only — no JSON, no "
    "greeting, no sign-off."
)


def _extract_json(text):
    raw = (text or '').strip()
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    if match:
        raw = match.group(0)
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return {}


def _client_context(client, limit_chars=4000):
    """Brief material from the client's recent session summaries, to tailor
    suggestions. Empty string if there's nothing useful."""
    from .models import SessionSummary
    parts = []
    for s in SessionSummary.objects.filter(
        booking__learner=client
    ).order_by('-updated_at')[:5]:
        if s.summary:
            parts.append(s.summary)
        if s.key_points:
            parts.append(' • '.join(s.key_points))
    return ('\n'.join(parts))[:limit_chars]


def suggest_habits(*, client, domain='', count=5):
    """Return a list of {title, description, category} habit suggestions for a
    client — focused on one wellness `domain` if given, tailored with the
    client's recent session context when available. Returns [] on failure.
    """
    domain = (domain or '').strip().lower()
    context = _client_context(client)

    parts = []
    focus = DOMAIN_LABELS.get(domain)
    if focus:
        parts.append(f"Focus area: {focus}.")
    else:
        parts.append(
            "Cover a helpful mix across nutrition, activity, sleep, stress, "
            "mindfulness, relationships, burnout and work-life balance as relevant."
        )
    if context:
        parts.append(
            "Recent coaching context for this client (use it to tailor the "
            "habits):\n" + context
        )
    parts.append(f"Suggest {count} daily habits as instructed. Return only the JSON.")

    data = _extract_json(complete_text(_SUGGEST_SYSTEM, "\n\n".join(parts), max_tokens=700))

    out = []
    for h in (data.get('habits') or []):
        title = str(h.get('title', '')).strip()[:200]
        if not title:
            continue
        cat = str(h.get('category', '')).strip().lower()
        out.append({
            'title': title,
            'description': str(h.get('description', '')).strip()[:500],
            'category': cat if cat in VALID_CATEGORIES else (domain if domain in VALID_CATEGORIES else ''),
        })
        if len(out) >= count:
            break
    return out


def habit_nudge_message(*, client_name, habit_stats):
    """`habit_stats`: list of {title, category, streak, consistency}. Returns a
    short encouraging paragraph, or '' if there's nothing to say / AI is off."""
    if not habit_stats:
        return ''
    lines = []
    for h in habit_stats:
        lines.append(
            f"- {h.get('title')} ({h.get('category') or 'general'}): "
            f"current streak {h.get('streak', 0)} day(s), "
            f"{h.get('consistency', 0)}% consistency recently"
        )
    user_msg = (
        f"Client: {client_name}\nTheir habits and recent adherence:\n"
        + "\n".join(lines)
        + "\n\nWrite the nudge as instructed."
    )
    return complete_text(_NUDGE_SYSTEM, user_msg, max_tokens=300).strip()

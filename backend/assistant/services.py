"""
Provider-agnostic AI assistant for the public website chatbot.

The active provider is chosen from settings.AI_PROVIDER:
  - 'auto'      → Anthropic if ANTHROPIC_API_KEY is set, else OpenAI if
                  OPENAI_API_KEY is set, else "not configured".
  - 'anthropic' → Anthropic (Claude)
  - 'openai'    → OpenAI (GPT)

Switching providers is a .env change only — no code edits. If no key is set,
`get_assistant_reply` returns a friendly fallback so the widget still works.
"""
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

# Per the Anthropic model guidance, default to Opus 4.8. Override with
# ASSISTANT_MODEL in .env (e.g. claude-haiku-4-5 for a cheaper website bot).
DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8'
DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

MAX_TOKENS = 500  # assistant replies are short, on-topic guidance

SYSTEM_PROMPT = (
    "You are the friendly virtual assistant for Dr. Nath Coaching (dr-nath.com), "
    "a professional coaching platform. Your job is to help visitors as they browse: "
    "answer questions about the platform and guide them toward getting started.\n\n"
    "About the platform:\n"
    "- Dr. Nathalie is a certified executive and life coach. Areas of coaching include "
    "Executive & Leadership Coaching and Health & Wellness Coaching.\n"
    "- Visitors can create a free account, browse coaches, use Smart Match (a short quiz "
    "that pairs them with a suitable coach), and book 1:1 or group coaching sessions.\n"
    "- Sessions are held securely on the platform with built-in video and chat. Clients "
    "get milestones, habit tracking, shared resources, and session reminders.\n"
    "- To book: sign up, browse coaches or use Smart Match, pick a time slot, and confirm. "
    "Paid sessions get an emailed receipt.\n\n"
    "Guidelines:\n"
    "- Be warm, concise, and encouraging. Keep replies short (2-4 sentences).\n"
    "- Nudge interested visitors toward creating an account or booking a discovery session.\n"
    "- You do not have access to their account, bookings, or payment details, and you cannot "
    "book, cancel, or change anything — direct them to the relevant page instead.\n"
    "- If asked something unrelated to coaching or this platform, politely steer back.\n"
    "- Never invent prices, credentials, or policies you weren't given; if unsure, suggest "
    "they contact the team via the Contact page."
)

# Keep the payload bounded regardless of what the client sends.
MAX_HISTORY_MESSAGES = 20
MAX_MESSAGE_CHARS = 2000

NOT_CONFIGURED_REPLY = (
    "Hi! I'm the Dr. Nath assistant. I'm not fully set up yet, but you can explore "
    "coaches, try Smart Match, or reach out via the Contact page to get started."
)


def _active_provider():
    """Return ('anthropic'|'openai'|None, api_key). None means not configured."""
    provider = (settings.AI_PROVIDER or 'auto').lower()
    anthropic_key = settings.ANTHROPIC_API_KEY
    openai_key = settings.OPENAI_API_KEY

    if provider == 'anthropic':
        return ('anthropic', anthropic_key) if anthropic_key else (None, '')
    if provider == 'openai':
        return ('openai', openai_key) if openai_key else (None, '')
    # auto
    if anthropic_key:
        return 'anthropic', anthropic_key
    if openai_key:
        return 'openai', openai_key
    return None, ''


def _sanitize(history):
    """Clamp history length and coerce to {role, content} with valid roles."""
    cleaned = []
    for m in (history or [])[-MAX_HISTORY_MESSAGES:]:
        role = m.get('role')
        content = (m.get('content') or '').strip()[:MAX_MESSAGE_CHARS]
        if role in ('user', 'assistant') and content:
            cleaned.append({'role': role, 'content': content})
    return cleaned


def _reply_anthropic(messages, api_key):
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)
    model = settings.ASSISTANT_MODEL or DEFAULT_ANTHROPIC_MODEL
    resp = client.messages.create(
        model=model,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    parts = [block.text for block in resp.content if getattr(block, 'type', None) == 'text']
    return ''.join(parts).strip()


def _reply_openai(messages, api_key):
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    model = settings.ASSISTANT_MODEL or DEFAULT_OPENAI_MODEL
    resp = client.chat.completions.create(
        model=model,
        max_tokens=MAX_TOKENS,
        messages=[{'role': 'system', 'content': SYSTEM_PROMPT}, *messages],
    )
    return (resp.choices[0].message.content or '').strip()


def get_assistant_reply(history):
    """Return the assistant's reply text for a conversation history.

    Never raises — on any provider error it logs and returns a friendly message,
    so the public widget degrades gracefully.
    """
    messages = _sanitize(history)
    if not messages or messages[-1]['role'] != 'user':
        return "Ask me anything about Dr. Nath Coaching and how to get started!"

    provider, api_key = _active_provider()
    if not provider:
        return NOT_CONFIGURED_REPLY

    try:
        if provider == 'anthropic':
            return _reply_anthropic(messages, api_key) or NOT_CONFIGURED_REPLY
        return _reply_openai(messages, api_key) or NOT_CONFIGURED_REPLY
    except Exception as exc:  # noqa: BLE001 — never break the public endpoint
        logger.error("AI assistant (%s) failed: %s", provider, exc)
        return (
            "Sorry, I'm having trouble responding right now. Please try again in a "
            "moment, or reach us via the Contact page."
        )

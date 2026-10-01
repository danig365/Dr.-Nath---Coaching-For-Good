"""Make pasted newsletter HTML safe to drop into an email.

A newsletter body is written elsewhere — Word, a web editor, an AI draft — and
pasted in. The 2nd edition arrived carrying a stray `</div>` with no opening
tag, which closed the EMAIL's own wrapper: subscribers got a letter whose
footer had fallen outside the card. One unbalanced tag is all it takes.

So the body is balanced and narrowed to the tags an email can render before it
is stored: unmatched closing tags are dropped, anything left open is closed,
and tags that would fight the email's own layout (or run code) are removed.
"""
from html.parser import HTMLParser

# Tags a newsletter body legitimately uses.
ALLOWED = {
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'div', 'blockquote',
    'ul', 'ol', 'li', 'a', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'small', 'sub', 'sup', 'figure', 'figcaption', 'pre', 'code',
}
# Never: they either break the email's table layout or execute.
FORBIDDEN = {
    'html', 'head', 'body', 'meta', 'link', 'title', 'base',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col',
    'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
}
VOID = {'br', 'img', 'hr'}
ALLOWED_ATTRS = {'style', 'href', 'src', 'alt', 'title', 'width', 'height', 'target', 'rel', 'class'}


class _Balancer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.out = []
        self.open_tags = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in FORBIDDEN or tag not in ALLOWED:
            return
        kept = []
        for name, value in attrs:
            name = (name or '').lower()
            if name not in ALLOWED_ATTRS or value is None:
                continue
            if 'javascript:' in value.lower().replace(' ', ''):
                continue
            kept.append(f'{name}="{value}"')
        attr_text = (' ' + ' '.join(kept)) if kept else ''
        if tag in VOID:
            self.out.append(f'<{tag}{attr_text}>')
            return
        self.out.append(f'<{tag}{attr_text}>')
        self.open_tags.append(tag)

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if tag in ALLOWED and tag not in FORBIDDEN:
            self.out.append(f'<{tag}>' if tag in VOID else f'<{tag}></{tag}>')

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in VOID or tag not in ALLOWED or tag in FORBIDDEN:
            return
        if tag not in self.open_tags:
            # The stray closer that broke the 2nd edition. Drop it.
            return
        # Close anything opened inside it, so nesting stays valid.
        while self.open_tags:
            current = self.open_tags.pop()
            self.out.append(f'</{current}>')
            if current == tag:
                break

    def handle_data(self, data):
        self.out.append(data)

    def handle_entityref(self, name):
        self.out.append(f'&{name};')

    def handle_charref(self, name):
        self.out.append(f'&#{name};')

    def result(self):
        while self.open_tags:
            self.out.append(f'</{self.open_tags.pop()}>')
        return ''.join(self.out)


def clean_newsletter_html(html):
    """Balanced, email-safe HTML. Never raises: a body is content, not code."""
    if not html:
        return ''
    try:
        parser = _Balancer()
        parser.feed(html)
        parser.close()
        return parser.result()
    except Exception:  # noqa: BLE001 — a bad paste must never block a send
        return html

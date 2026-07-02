"""
Branded PDF receipt/invoice generation for paid sessions and group enrollments.

On-demand: nothing is stored. A view calls build_booking_invoice_pdf() /
build_group_invoice_pdf() and streams the bytes back. Invoice numbers are
deterministic (derived from the object id + year), so the same booking always
produces the same receipt number.
"""
import io
from datetime import datetime

from django.utils import timezone
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

NAVY = HexColor('#1B2B4A')
GOLD = HexColor('#C8A951')
CREAM = HexColor('#FAF6EC')
SLATE = HexColor('#4A5568')
GREEN = HexColor('#2E7D32')
WHITE = HexColor('#FFFFFF')
LINE = HexColor('#E5DCC3')

COMPANY_NAME = 'Dr. Nath Coaching'
COMPANY_TAGLINE = 'Coaching for Impact'
COMPANY_EMAIL = 'dr.nath@dr-nath.com'


def _money(amount):
    try:
        return f"${float(amount):,.2f}"
    except (TypeError, ValueError):
        return "$0.00"


def _render_invoice(*, invoice_no, issued, bill_to_name, bill_to_email,
                    description, sub_line, service_date, amount, payment_ref):
    """Draw a single-page receipt and return PDF bytes."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4

    # ── Header band ──────────────────────────────────────────────────────────
    c.setFillColor(NAVY)
    c.rect(0, H - 96, W, 96, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 22)
    c.drawString(48, H - 52, COMPANY_NAME)
    c.setFillColor(GOLD)
    c.setFont('Helvetica', 9)
    c.drawString(48, H - 70, COMPANY_TAGLINE.upper())
    c.setFillColor(WHITE)
    c.setFont('Helvetica', 9)
    c.drawRightString(W - 48, H - 52, COMPANY_EMAIL)
    c.drawRightString(W - 48, H - 66, 'dr-nath.com')
    # Gold rule under the band
    c.setFillColor(GOLD)
    c.rect(0, H - 100, W, 4, fill=1, stroke=0)

    # ── Title + meta ─────────────────────────────────────────────────────────
    top = H - 150
    c.setFillColor(NAVY)
    c.setFont('Helvetica-Bold', 24)
    c.drawString(48, top, 'RECEIPT')

    c.setFont('Helvetica', 10)
    c.setFillColor(SLATE)
    c.drawRightString(W - 130, top + 6, 'Invoice No.')
    c.drawRightString(W - 130, top - 10, 'Date Paid')
    c.drawRightString(W - 130, top - 26, 'Status')
    c.setFillColor(NAVY)
    c.setFont('Helvetica-Bold', 10)
    c.drawRightString(W - 48, top + 6, invoice_no)
    c.drawRightString(W - 48, top - 10, issued.strftime('%d %b %Y'))
    # PAID badge
    c.setFillColor(GREEN)
    c.setFont('Helvetica-Bold', 10)
    c.drawRightString(W - 48, top - 26, 'PAID')

    # ── Bill to / From ───────────────────────────────────────────────────────
    y = top - 64
    c.setFont('Helvetica-Bold', 9)
    c.setFillColor(GOLD)
    c.drawString(48, y, 'BILLED TO')
    c.drawString(W / 2 + 20, y, 'FROM')
    c.setFont('Helvetica-Bold', 11)
    c.setFillColor(NAVY)
    c.drawString(48, y - 18, bill_to_name or '—')
    c.drawString(W / 2 + 20, y - 18, COMPANY_NAME)
    c.setFont('Helvetica', 10)
    c.setFillColor(SLATE)
    if bill_to_email:
        c.drawString(48, y - 34, bill_to_email)
    c.drawString(W / 2 + 20, y - 34, COMPANY_EMAIL)

    # ── Line item table ──────────────────────────────────────────────────────
    table_top = y - 78
    c.setFillColor(CREAM)
    c.rect(48, table_top - 6, W - 96, 24, fill=1, stroke=0)
    c.setFillColor(SLATE)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(60, table_top + 2, 'DESCRIPTION')
    c.drawString(W - 250, table_top + 2, 'DATE')
    c.drawRightString(W - 60, table_top + 2, 'AMOUNT')

    row_y = table_top - 30
    c.setFillColor(NAVY)
    c.setFont('Helvetica-Bold', 11)
    c.drawString(60, row_y, description[:48])
    c.setFillColor(SLATE)
    c.setFont('Helvetica', 9)
    if sub_line:
        c.drawString(60, row_y - 14, sub_line[:60])
    c.setFont('Helvetica', 10)
    c.drawString(W - 250, row_y, service_date.strftime('%d %b %Y') if service_date else '—')
    c.setFillColor(NAVY)
    c.setFont('Helvetica-Bold', 11)
    c.drawRightString(W - 60, row_y, _money(amount))

    # divider
    c.setStrokeColor(LINE)
    c.setLineWidth(1)
    c.line(48, row_y - 30, W - 48, row_y - 30)

    # ── Total ────────────────────────────────────────────────────────────────
    total_y = row_y - 56
    c.setFillColor(SLATE)
    c.setFont('Helvetica', 11)
    c.drawRightString(W - 150, total_y, 'Total Paid')
    c.setFillColor(NAVY)
    c.setFont('Helvetica-Bold', 16)
    c.drawRightString(W - 60, total_y - 2, _money(amount))

    # ── Payment details ──────────────────────────────────────────────────────
    pay_y = total_y - 56
    c.setFillColor(GOLD)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(48, pay_y, 'PAYMENT DETAILS')
    c.setFillColor(SLATE)
    c.setFont('Helvetica', 10)
    c.drawString(48, pay_y - 18, 'Method: Card (Stripe)')
    if payment_ref:
        c.drawString(48, pay_y - 34, f'Reference: {payment_ref}')

    # ── Footer ───────────────────────────────────────────────────────────────
    c.setStrokeColor(LINE)
    c.line(48, 90, W - 48, 90)
    c.setFillColor(SLATE)
    c.setFont('Helvetica', 9)
    c.drawString(48, 72, 'Thank you for your business. Keep this receipt for your tax records.')
    c.setFillColor(HexColor('#9AA3B0'))
    c.drawString(48, 58, f'{COMPANY_NAME} · {COMPANY_TAGLINE} · dr-nath.com')

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.getvalue()


def build_booking_invoice_pdf(booking):
    """(pdf_bytes, filename) for a paid 1:1 session booking."""
    issued = booking.created_at or timezone.now()
    invoice_no = f"INV-{issued.year}-{booking.id:05d}"
    learner = booking.learner
    coach = booking.mentor.user if booking.mentor else None
    bill_name = (f"{learner.first_name} {learner.last_name}".strip() or learner.username) if learner else '—'
    skill_title = booking.skill.name if booking.skill else 'Coaching session'
    sub = f"Coaching session with {coach.get_full_name() or coach.username}" if coach else 'Coaching session'
    pdf = _render_invoice(
        invoice_no=invoice_no,
        issued=issued,
        bill_to_name=bill_name,
        bill_to_email=learner.email if learner else '',
        description=skill_title,
        sub_line=sub,
        service_date=booking.session_date,
        amount=booking.amount_paid,
        payment_ref=booking.payment_intent_id,
    )
    return pdf, f"{invoice_no}.pdf"


def build_group_invoice_pdf(enrollment):
    """(pdf_bytes, filename) for a paid group session enrollment."""
    issued = enrollment.created_at or timezone.now()
    invoice_no = f"INV-G-{issued.year}-{enrollment.id:05d}"
    learner = enrollment.learner
    session = enrollment.group_session
    coach = session.coach.user if session and session.coach else None
    bill_name = (f"{learner.first_name} {learner.last_name}".strip() or learner.username) if learner else '—'
    title = session.title if session else 'Group session'
    sub = f"Group session with {coach.get_full_name() or coach.username}" if coach else 'Group session'
    pdf = _render_invoice(
        invoice_no=invoice_no,
        issued=issued,
        bill_to_name=bill_name,
        bill_to_email=learner.email if learner else '',
        description=title,
        sub_line=sub,
        service_date=session.start_datetime.date() if session else None,
        amount=enrollment.amount_paid,
        payment_ref=enrollment.payment_intent_id,
    )
    return pdf, f"{invoice_no}.pdf"

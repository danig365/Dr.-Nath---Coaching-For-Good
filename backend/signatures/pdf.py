"""
Signed-PDF generation for completed signature documents.

Renders a branded "signature certificate" page (both e-signatures + audit trail)
with reportlab. If the original upload is a PDF, the certificate is appended to
it so the signed file is the document + certificate; otherwise the certificate
stands alone (referencing the original by title).
"""
import io

from django.core.files.base import ContentFile
from django.utils import timezone
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

NAVY = HexColor('#1B2B4A')
GOLD = HexColor('#C8A951')
SLATE = HexColor('#4A5568')
GREEN = HexColor('#2E7D32')
WHITE = HexColor('#FFFFFF')
LINE = HexColor('#E5DCC3')


def _fmt(dt, tzname='UTC'):
    if not dt:
        return '—'
    from zoneinfo import ZoneInfo
    try:
        local = dt.astimezone(ZoneInfo(tzname or 'UTC'))
    except Exception:  # noqa: BLE001
        local = dt
    return local.strftime('%d %b %Y, %H:%M %Z')


def _signer_block(c, x, y, W, *, role, name, signature, when, ip):
    c.setFillColor(GOLD)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(x, y, role.upper())
    c.setStrokeColor(LINE)
    c.setLineWidth(1)
    # Signature line with the typed name rendered in an italic "script" style.
    c.setFillColor(NAVY)
    c.setFont('Helvetica-Oblique', 20)
    c.drawString(x, y - 34, signature or '—')
    c.line(x, y - 40, x + (W - 96) / 2 - 20, y - 40)
    c.setFillColor(SLATE)
    c.setFont('Helvetica', 9)
    c.drawString(x, y - 54, f"Name: {name}")
    c.drawString(x, y - 68, f"Signed: {when}")
    c.drawString(x, y - 82, f"IP: {ip or '—'}")


def build_certificate_pdf(doc):
    """Return the signature-certificate page as PDF bytes."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    coach_tz = getattr(doc.coach, 'timezone', 'UTC')

    # Header band
    c.setFillColor(NAVY)
    c.rect(0, H - 96, W, 96, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 22)
    c.drawString(48, H - 52, 'Dr. Nath Coaching')
    c.setFillColor(GOLD)
    c.setFont('Helvetica', 9)
    c.drawString(48, H - 70, 'CERTIFICATE OF ELECTRONIC SIGNATURE')
    c.setFillColor(GOLD)
    c.rect(0, H - 100, W, 4, fill=1, stroke=0)

    top = H - 150
    c.setFillColor(NAVY)
    c.setFont('Helvetica-Bold', 22)
    c.drawString(48, top, 'Signed & Completed')
    c.setFillColor(GREEN)
    c.setFont('Helvetica-Bold', 11)
    c.drawRightString(W - 48, top + 4, 'COMPLETED')

    c.setFillColor(SLATE)
    c.setFont('Helvetica', 11)
    c.drawString(48, top - 26, 'Document:')
    c.setFillColor(NAVY)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(120, top - 26, doc.title[:70])

    c.setStrokeColor(LINE)
    c.line(48, top - 46, W - 48, top - 46)

    c.setFillColor(SLATE)
    c.setFont('Helvetica', 10)
    c.drawString(48, top - 66,
                 "This document was electronically signed by both parties on the Dr. Nath Coaching platform.")

    # Signer blocks (side by side)
    y = top - 110
    _signer_block(c, 48, y, W, role='Client', name=doc.client.get_full_name() or doc.client.username,
                  signature=doc.client_signature, when=_fmt(doc.client_signed_at, coach_tz),
                  ip=doc.client_signed_ip)
    coach_user = doc.coach.user
    _signer_block(c, W / 2 + 20, y, W, role='Coach', name=coach_user.get_full_name() or coach_user.username,
                  signature=doc.coach_signature, when=_fmt(doc.coach_signed_at, coach_tz),
                  ip=doc.coach_signed_ip)

    # Footer
    c.setStrokeColor(LINE)
    c.line(48, 96, W - 48, 96)
    c.setFillColor(SLATE)
    c.setFont('Helvetica', 9)
    c.drawString(48, 78, f"Document ID: {doc.id}  ·  Certificate generated: {_fmt(timezone.now(), coach_tz)}")
    c.setFillColor(HexColor('#9AA3B0'))
    c.drawString(48, 62, 'Dr. Nath Coaching · Coaching for Impact · dr-nath.com')

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.getvalue()


def build_and_store_signed_pdf(doc):
    """Generate the signed PDF (original + certificate when the original is a
    PDF, else certificate alone) and save it to doc.signed_file."""
    certificate = build_certificate_pdf(doc)

    output = certificate
    try:
        from pypdf import PdfReader, PdfWriter
        doc.file.open('rb')
        reader = PdfReader(doc.file)  # raises if not a valid PDF
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        cert_reader = PdfReader(io.BytesIO(certificate))
        for page in cert_reader.pages:
            writer.add_page(page)
        merged = io.BytesIO()
        writer.write(merged)
        output = merged.getvalue()
    except Exception:  # noqa: BLE001 — non-PDF original or merge issue → certificate only
        output = certificate
    finally:
        try:
            doc.file.close()
        except Exception:  # noqa: BLE001
            pass

    filename = f"{doc.title}-signed.pdf".replace('/', '-')
    doc.signed_file.save(filename, ContentFile(output), save=True)
    return doc.signed_file

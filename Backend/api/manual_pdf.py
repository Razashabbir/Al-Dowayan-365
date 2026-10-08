"""System Manual as a real PDF file (System Manual page › Download › PDF).

The page sends the sections the user may see; this builds a styled A4 PDF with reportlab (already used by
Report Pack): cover page, contents with page numbers, one chapter per group, tables, lists, note boxes,
header and "Page X of Y" footer. Calibri is used when Windows has it, otherwise DejaVu Sans / Helvetica.
"""
import io
import os
import re
from datetime import date

from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field


class Section(BaseModel):
    id: str = Field(..., max_length=80)
    group: str = Field(..., max_length=120)
    title: str = Field(..., max_length=200)
    md: str = Field("", max_length=60000)


class ManualIn(BaseModel):
    company: str = Field("Financial Reporting", max_length=120)
    accent: str = Field("#0f766e", pattern=r"^#[0-9a-fA-F]{6}$")
    groups: list[str] = Field(default_factory=list, max_length=40)
    sections: list[Section] = Field(..., max_length=200)


def _fonts():
    """Register Calibri (Windows) or DejaVu Sans; returns (regular, bold, italic, light, mono)."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    win = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    sets = [
        ("Calibri", [os.path.join(win, f) for f in ("calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibril.ttf")]),
        ("DejaVu", [f"/usr/share/fonts/truetype/dejavu/{f}" for f in
                    ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-ExtraLight.ttf")]),
    ]
    for name, files in sets:
        if all(os.path.exists(f) for f in files):
            try:
                for suffix, f in zip(("", "-Bold", "-Italic", "-Light"), files):
                    if f"{name}{suffix}" not in pdfmetrics.getRegisteredFontNames():
                        pdfmetrics.registerFont(TTFont(f"{name}{suffix}", f))
                pdfmetrics.registerFontFamily(name, normal=name, bold=f"{name}-Bold", italic=f"{name}-Italic", boldItalic=f"{name}-Bold")
                return name, f"{name}-Bold", f"{name}-Italic", f"{name}-Light", "Courier"
            except Exception:  # noqa: BLE001 - try the next font set
                continue
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica", "Courier"


_SYM = {"font": None, "main": None}       # fallback font for symbols the text font lacks (e.g. Calibri has no ✔)


def _symbol_font():
    """Segoe UI Symbol (Windows) or DejaVu Sans: used for ✔ ✎ ☰ → and similar characters."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    win = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    for name, f in (("SegoeSymbol", os.path.join(win, "seguisym.ttf")), ("SegoeUI", os.path.join(win, "segoeui.ttf")),
                    ("DejaVuSym", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")):
        if os.path.exists(f):
            try:
                if name not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont(name, f))
                return name
            except Exception:  # noqa: BLE001
                continue
    return None


def _has(font: str, ch: str) -> bool:
    from reportlab.pdfbase import pdfmetrics
    try:
        face = getattr(pdfmetrics.getFont(font), "face", None)
        cmap = getattr(face, "charToGlyph", None)
        return True if cmap is None else ord(ch) in cmap
    except Exception:  # noqa: BLE001
        return True


def _symbols(s: str) -> str:
    """Wrap characters the text font cannot draw in the symbol font, so they do not come out blank."""
    main, sym = _SYM["main"], _SYM["font"]
    if not (main and sym):
        return s
    return "".join(f'<font name="{sym}">{ch}</font>' if ord(ch) > 127 and not _has(main, ch) and _has(sym, ch) else ch for ch in s)


def _inline(s: str, mono: str) -> str:
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    s = _symbols(s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"`([^`]+)`", rf'<font face="{mono}" backColor="#eef1f3">\1</font>', s)
    s = re.sub(r"\*([^*\s][^*]*)\*", r"<i>\1</i>", s)
    return s


def build_pdf(data: ManualIn) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_JUSTIFY, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (BaseDocTemplate, Frame, ListFlowable, ListItem, NextPageTemplate,
                                    PageBreak, PageTemplate, Paragraph, Preformatted, Spacer, Table, TableStyle)
    from reportlab.platypus.tableofcontents import TableOfContents

    reg, bold, ital, light, mono = _fonts()
    _SYM["main"], _SYM["font"] = reg, _symbol_font()
    accent = colors.HexColor(data.accent)
    soft = colors.Color(1 - (1 - accent.red) * 0.12, 1 - (1 - accent.green) * 0.12, 1 - (1 - accent.blue) * 0.12)  # 12% tint
    ink, grey, line = colors.HexColor("#1f2933"), colors.HexColor("#5d6b78"), colors.HexColor("#cfd8dc")
    company = data.company.strip() or "Financial Reporting"

    S = {
        "body": ParagraphStyle("body", fontName=reg, fontSize=10.2, leading=14.6, textColor=ink, spaceAfter=6, alignment=TA_JUSTIFY),
        "h1": ParagraphStyle("h1", fontName=light, fontSize=24, leading=29, textColor=accent, spaceAfter=14),
        "h2": ParagraphStyle("h2", fontName=bold, fontSize=15, leading=19, textColor=ink, spaceBefore=14, spaceAfter=6, keepWithNext=1),
        "h3": ParagraphStyle("h3", fontName=bold, fontSize=11, leading=15, textColor=accent, spaceBefore=8, spaceAfter=4, keepWithNext=1),
        "cell": ParagraphStyle("cell", fontName=reg, fontSize=9, leading=12, textColor=ink),
        "head": ParagraphStyle("head", fontName=bold, fontSize=9, leading=12, textColor=colors.white),
        "note": ParagraphStyle("note", fontName=reg, fontSize=9.8, leading=14, textColor=ink),
        "code": ParagraphStyle("code", fontName=mono, fontSize=8.4, leading=11, textColor=ink),
        "toc1": ParagraphStyle("toc1", fontName=bold, fontSize=11, leading=15, textColor=accent, spaceBefore=8),
        "toc2": ParagraphStyle("toc2", fontName=reg, fontSize=9.8, leading=13.5, leftIndent=14, textColor=ink),
    }

    class Doc(BaseDocTemplate):
        def afterFlowable(self, f):            # chapter / section headings feed the contents page
            if isinstance(f, Paragraph) and f.style.name in ("h1", "h2"):
                key = getattr(f, "_bm", None)
                if key:
                    self.canv.bookmarkPage(key)
                    self.canv.addOutlineEntry(f.getPlainText(), key, level=0 if f.style.name == "h1" else 1, closed=True)
                self.notify("TOCEntry", (0 if f.style.name == "h1" else 1, f.getPlainText(), self.page, key))

    buf = io.BytesIO()
    W, H = A4
    M = 20 * mm
    doc = Doc(buf, pagesize=A4, leftMargin=M, rightMargin=M, topMargin=24 * mm, bottomMargin=20 * mm,
              title=f"{company} - System Manual", author=f"{company} Financial Reporting System")
    frame = Frame(M, 20 * mm, W - 2 * M, H - 44 * mm, id="f")

    def cover(c, d):
        c.saveState()
        c.setFillColor(accent); c.rect(0, H - 95 * mm, W, 95 * mm, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont(bold, 10); c.drawString(M, H - 40 * mm, "FINANCIAL REPORTING SYSTEM")
        c.setFont(bold, 34); c.drawString(M, H - 58 * mm, company[:40])
        c.setFont(light, 20); c.drawString(M, H - 72 * mm, "System Manual")
        c.setFillColor(ink); c.setFont(reg, 11)
        y = H - 120 * mm
        for txt in ("Dashboards, financial statements, adjustments, close and consolidation,",
                    "and the Dynamics 365 data pipeline - how to use the system, how it works,",
                    "and what to do when something goes wrong."):
            c.drawString(M, y, txt); y -= 15
        c.setFillColor(grey); c.setFont(reg, 10)
        y = 45 * mm
        for k, v in (("Date", date.today().strftime("%d %B %Y")),
                     ("Contents", f"{len(data.sections)} sections in {len(groups)} chapters"),
                     ("Source", "Microsoft Dynamics 365 Finance & Operations")):
            c.setFont(bold, 10); c.drawString(M, y, f"{k}:"); c.setFont(reg, 10); c.drawString(M + 22 * mm, y, v); y -= 15
        c.setStrokeColor(accent); c.setLineWidth(2); c.line(M, 58 * mm, W - M, 58 * mm)
        c.restoreState()

    def page(c, d):
        c.saveState()
        c.setStrokeColor(accent); c.setLineWidth(0.8); c.line(M, H - 15 * mm, W - M, H - 15 * mm)
        c.setFont(reg, 8.5); c.setFillColor(grey)
        c.drawString(M, H - 13 * mm, company); c.drawRightString(W - M, H - 13 * mm, "System Manual")
        c.drawString(M, 11 * mm, f"{company} · Financial Reporting System")
        c.drawRightString(W - M, 11 * mm, f"Page {d.page}")
        c.restoreState()

    doc.addPageTemplates([PageTemplate("cover", [frame], onPage=cover), PageTemplate("page", [frame], onPage=page)])

    groups = [g for g in (data.groups or []) if any(s.group == g for s in data.sections)]
    groups += [g for g in dict.fromkeys(s.group for s in data.sections) if g not in groups]
    story = [NextPageTemplate("page"), PageBreak()]

    toc = TableOfContents()
    toc.levelStyles = [S["toc1"], S["toc2"]]
    toc.dotsMinLevel = 0
    story += [Paragraph("Contents", ParagraphStyle("ctitle", parent=S["h1"])), toc]   # not listed in itself

    def heading(text, style, key):
        p = Paragraph(_inline(text, mono), S[style])
        p._bm = key
        return p

    def md_flow(md: str):
        out, lines, i = [], (md or "").replace("\r", "").split("\n"), 0
        cells = lambda l: [c.strip() for c in l.strip().strip("|").split("|")]  # noqa: E731
        while i < len(lines):
            l = lines[i]
            if not l.strip():
                i += 1; continue
            if re.match(r"^\s*```", l):
                code = []; i += 1
                while i < len(lines) and not re.match(r"^\s*```", lines[i]):
                    code.append(lines[i]); i += 1
                i += 1
                t = Table([[Preformatted("\n".join(code), S["code"])]], colWidths=[W - 2 * M])
                t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f1f3f4")),
                                       ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 6),
                                       ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
                out += [t, Spacer(1, 6)]; continue
            if re.match(r"^>\s?", l):
                q = []
                while i < len(lines) and re.match(r"^>\s?", lines[i]):
                    q.append(re.sub(r"^>\s?", "", lines[i])); i += 1
                t = Table([[Paragraph(_inline(" ".join(q), mono), S["note"])]], colWidths=[W - 2 * M])
                t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), soft), ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
                                       ("LEFTPADDING", (0, 0), (-1, -1), 10), ("TOPPADDING", (0, 0), (-1, -1), 6),
                                       ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
                out += [Spacer(1, 2), t, Spacer(1, 8)]; continue
            if re.match(r"^\s*\|.*\|\s*$", l) and i + 1 < len(lines) and re.match(r"^\s*\|?[\s:|-]+\|?\s*$", lines[i + 1]):
                head, body = cells(l), []
                i += 2
                while i < len(lines) and re.match(r"^\s*\|.*\|\s*$", lines[i]):
                    body.append(cells(lines[i])); i += 1
                n, tw = len(head), W - 2 * M
                if n == 2:
                    widths = [tw * 0.3, tw * 0.7]
                elif n >= 4 and all(not r[k] or r[k] in ("✔", "✓") for r in body for k in range(1, min(n, len(r)))):
                    widths = [tw * 0.36] + [tw * 0.64 / (n - 1)] * (n - 1)      # check-mark matrix: wide first column
                else:
                    widths = [tw / n] * n
                rows = [[Paragraph(_inline(h, mono), S["head"]) for h in head]]
                tick = ParagraphStyle("tick", parent=S["cell"], alignment=1, textColor=accent, fontName=bold, fontSize=11)
                rows += [[Paragraph(_inline(r[k] if k < len(r) else "", mono), tick if (r[k] if k < len(r) else "") in ("✔", "✓") else S["cell"])
                          for k in range(n)] for r in body]
                t = Table(rows, colWidths=widths, repeatRows=1)
                st = [("BACKGROUND", (0, 0), (-1, 0), accent), ("GRID", (0, 0), (-1, -1), 0.5, line),
                      ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 5),
                      ("RIGHTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
                st += [("BACKGROUND", (0, r), (-1, r), colors.HexColor("#f6f9f9")) for r in range(2, len(rows), 2)]
                t.setStyle(TableStyle(st))
                out += [t, Spacer(1, 8)]; continue
            m = re.match(r"^(#{1,4})\s+(.*)$", l)
            if m:
                out.append(Paragraph(_inline(m.group(2), mono), S["h3"])); i += 1; continue
            if re.match(r"^\s*([-*•]|\d+[.)])\s+", l):
                ordered, items = bool(re.match(r"^\s*\d", l)), []
                while i < len(lines) and re.match(r"^\s*([-*•]|\d+[.)])\s+", lines[i]):
                    item = re.sub(r"^\s*([-*•]|\d+[.)])\s+", "", lines[i]); i += 1
                    while i < len(lines) and re.match(r"^\s{2,}\S", lines[i]) and not re.match(r"^\s*([-*•]|\d+[.)])\s+", lines[i]):
                        item += " " + lines[i].strip(); i += 1
                    items.append(ListItem(Paragraph(_inline(item, mono), S["body"]), leftIndent=14))
                out.append(ListFlowable(items, bulletType="1" if ordered else "bullet", start=None if ordered else "•",
                                        bulletColor=accent, bulletFontName=bold, bulletFontSize=9, leftIndent=14))
                continue
            para = [l.strip()]; i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r"^(\s*([-*•]|\d+[.)])\s+|#{1,4}\s|>|\s*\||\s*```)", lines[i]):
                para.append(lines[i].strip()); i += 1
            out.append(Paragraph(_inline(" ".join(para), mono), S["body"]))
        return out

    n = 0
    for g in groups:
        n += 1
        story += [PageBreak(), heading(g, "h1", f"g{n}")]
        for s in (x for x in data.sections if x.group == g):
            n += 1
            story.append(heading(s.title, "h2", f"s{n}"))
            story += md_flow(s.md)

    doc.multiBuild(story)
    return buf.getvalue()


def register(app):
    @app.post("/api/auth/manual/pdf")
    def manual_pdf(data: ManualIn):
        try:
            pdf = build_pdf(data)
        except ImportError as ex:
            raise HTTPException(500, "The PDF needs the reportlab package: in the api folder run  pip install reportlab  and restart uvicorn.") from ex
        name = re.sub(r"[^\w-]+", "_", data.company or "System") + "_System_Manual.pdf"
        return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}"'})

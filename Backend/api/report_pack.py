"""Scheduled report pack (Administration › Report Pack).

Each schedule e-mails a PDF with the monthly statements (Income Statement, Financial Position, Cash Flow) of the
chosen companies for the previous month, on a day of the month and hour. "Send now" / "Preview PDF" work any time.
SMTP server, port, sender and user are set on the page; the password stays in api\\.env as SMTP_PASSWORD.
The PDF is built with reportlab (pip install reportlab).
"""
import io
import os
import smtplib
from datetime import date, datetime
from email.message import EmailMessage

from fastapi import HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text

import security
from modlib import MONTHS, call, num

REPORTS = {"IS": "Income Statement", "BS": "Financial Position", "CF": "Cash Flow"}


class SmtpIn(BaseModel):
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_from: str = ""
    smtp_user: str = ""
    smtp_tls: bool = True


class ScheduleIn(BaseModel):
    schedule_id: int | None = None
    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    tenant_key: int
    companies: list[str] = Field(min_length=1)
    reports: list[str] = Field(min_length=1)
    basis: str = Field("final", pattern="^(ledger|adjusted|final)$")
    day_of_month: int = Field(5, ge=1, le=28)
    send_hour: int = Field(8, ge=0, le=23)
    recipients: str = Field(min_length=3, max_length=1000)


class SendIn(BaseModel):
    period: str | None = None          # YYYY-MM, default = previous month
    to: str | None = None              # override recipients (e.g. a test to yourself)


def prev_period(today: date | None = None) -> tuple[int, int]:
    t = today or date.today()
    return (t.year, t.month - 1) if t.month > 1 else (t.year - 1, 12)


def _period(s):
    if not s:
        return prev_period()
    try:
        y, m = s.split("-")
        y, m = int(y), int(m)
        assert 1 <= m <= 12 and 2000 < y < 2100
        return y, m
    except Exception:                                    # noqa: BLE001
        raise HTTPException(400, "Period must be YYYY-MM.")


def _fmt(v, neg_brackets=True):
    v = num(v)
    if abs(v) < 0.5:
        return "–"
    s = f"{abs(v):,.0f}"
    return f"({s})" if v < 0 else s


def build_pdf(app, cfg, sch: dict, y: int, m: int) -> bytes:
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except ImportError:
        raise HTTPException(400, "The PDF needs reportlab: in the api folder run  pip install reportlab  and restart uvicorn.")
    st = getSampleStyleSheet()
    buf = io.BytesIO()
    name = cfg.get("company_name") or "Financial Reporting"
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"{name} - {MONTHS[m - 1]} {y}")
    story = [Paragraph(f"<b>{name}</b>", st["Title"]),
             Paragraph(f"Monthly report pack - {MONTHS[m - 1]} {y}", st["Heading2"]),
             Paragraph(f"Generated {datetime.now():%d %b %Y %H:%M} · basis: {sch['basis']} · amounts in {cfg.get('currency') or 'SAR'}", st["Normal"]),
             Spacer(1, 8 * mm)]
    comps = [c.strip() for c in sch["companies"].split(",") if c.strip()]
    first = True
    for co in comps:
        for rep in [r for r in sch["reports"].split(",") if r in REPORTS]:
            if not first:
                story.append(PageBreak())
            first = False
            who = "All companies (combined)" if co == "*" else co.upper()
            try:
                if rep == "CF":
                    d = call(app, "/api/report/fs/cashflow", tenant=sch["tenant_key"], company=co, year=y, month=m, basis=sch["basis"])
                else:
                    d = call(app, "/api/report/fs/statement", tenant=sch["tenant_key"], company=co, year=y, kind=rep, month=m, basis=sch["basis"])
            except HTTPException as ex:
                story += [Paragraph(f"{REPORTS[rep]} - {who}", st["Heading2"]), Paragraph(f"Not available: {ex.detail}", st["Normal"])]
                continue
            story += [Paragraph(f"{REPORTS[rep]} - {who}", st["Heading2"]), Spacer(1, 2 * mm)]
            data = [["", d["headings"][0], d["headings"][1]]]
            style = [("FONT", (0, 0), (-1, -1), "Helvetica", 8.5), ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                     ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.grey), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
                     ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]
            for r in d["rows"]:
                i = len(data)
                if r["kind"] == "H":
                    data.append([r["label"], "", ""])
                    style += [("FONT", (0, i), (-1, i), "Helvetica-Bold", 8.5), ("TEXTCOLOR", (0, i), (-1, i), colors.HexColor("#0f766e"))]
                    continue
                if r["kind"] == "L" and abs(num(r.get("cur"))) < 0.5 and abs(num(r.get("prev"))) < 0.5:
                    continue
                data.append([("" if r["kind"] == "T" else "   ") + r["label"], _fmt(r.get("cur")), _fmt(r.get("prev"))])
                if r["kind"] == "T":
                    style += [("FONT", (0, i), (-1, i), "Helvetica-Bold", 8.5), ("LINEABOVE", (1, i), (-1, i), 0.4, colors.grey)]
            t = Table(data, colWidths=[100 * mm, 38 * mm, 38 * mm], repeatRows=1)
            t.setStyle(TableStyle(style))
            story.append(t)
            if rep == "BS" and abs(num(d.get("check", {}).get("cur"))) > 1:
                story.append(Paragraph(f"<font color='#b42318'>Out of balance by {_fmt(d['check']['cur'])}</font>", st["Normal"]))
    doc.build(story)
    return buf.getvalue()


def register(app, engine, settings, ops, store, log):
    def load(cn, sid):
        r = cn.execute(text("SELECT * FROM ops.pack_schedule WHERE schedule_id=:s"), {"s": sid}).mappings().first()
        if not r:
            raise HTTPException(404, "Schedule not found.")
        return dict(r)

    def smtp_info():
        o = ops.all()
        return {"smtp_host": o["smtp_host"], "smtp_port": int(o["smtp_port"] or 587), "smtp_from": o["smtp_from"],
                "smtp_user": o["smtp_user"], "smtp_tls": o["smtp_tls"] == "1", "password_set": bool(os.getenv("SMTP_PASSWORD", "").strip())}

    def send(sch: dict, y: int, m: int, to: str | None = None, by: str = "scheduler") -> str:
        s = smtp_info()
        if not s["smtp_host"] or not s["smtp_from"]:
            raise HTTPException(400, "Set the SMTP server and sender first (Report Pack › E-mail settings).")
        pdf = build_pdf(app, settings.all(), sch, y, m)
        rcpt = [x.strip() for x in (to or sch["recipients"]).replace(";", ",").split(",") if x.strip()]
        msg = EmailMessage()
        cname = settings.all().get("company_name") or "Financial Reporting"
        msg["Subject"] = f"{cname} - {sch['name']} - {MONTHS[m - 1]} {y}"
        msg["From"], msg["To"] = s["smtp_from"], ", ".join(rcpt)
        msg.set_content(f"Attached: {sch['name']} for {MONTHS[m - 1]} {y} "
                        f"({', '.join(REPORTS[r] for r in sch['reports'].split(',') if r in REPORTS)}).\n\n"
                        f"Sent automatically by the {cname} reporting system.")
        msg.add_attachment(pdf, maintype="application", subtype="pdf", filename=f"report_pack_{y}-{m:02d}.pdf")
        status, text_ = "OK", f"sent to {len(rcpt)} recipient(s)"
        try:
            with smtplib.SMTP(s["smtp_host"], s["smtp_port"], timeout=60) as srv:
                if s["smtp_tls"]:
                    srv.starttls()
                if s["smtp_user"]:
                    srv.login(s["smtp_user"], os.getenv("SMTP_PASSWORD", ""))
                srv.send_message(msg)
        except Exception as ex:                                  # noqa: BLE001
            status, text_ = "Failed", str(ex).splitlines()[0][:300]
        with engine().begin() as cn:
            cn.execute(text("INSERT INTO ops.pack_log (schedule_id, period, recipients, status, message, sent_by) VALUES (:s, :p, :r, :st, :m, :b)"),
                       {"s": sch["schedule_id"], "p": f"{y}-{m:02d}", "r": ", ".join(rcpt)[:1000], "st": status, "m": text_, "b": by})
            cn.execute(text("UPDATE ops.pack_schedule SET last_run_at=SYSUTCDATETIME(), last_status=:st WHERE schedule_id=:s"),
                       {"s": sch["schedule_id"], "st": f"{status}: {text_}"[:400]})
        if status != "OK":
            raise HTTPException(502, f"E-mail not sent: {text_}")
        return text_

    def run_due(now: datetime | None = None):
        """Called by the scheduler every minute: send schedules whose day and hour have come, once per period."""
        now = now or datetime.now()
        y, m = prev_period(now.date())
        per = f"{y}-{m:02d}"
        try:
            with engine().connect() as cn:
                due = [dict(r) for r in cn.execute(text("""SELECT * FROM ops.pack_schedule WHERE enabled=1 AND day_of_month <= :d
                                                           AND send_hour <= :h AND (last_period IS NULL OR last_period < :p)"""),
                                                   {"d": now.day, "h": now.hour, "p": per}).mappings()]
        except Exception:                                        # noqa: BLE001 - tables not ready
            return
        for sch in due:
            try:
                send(sch, y, m)
                log.info("report pack %s sent for %s", sch["name"], per)
            except Exception as ex:                              # noqa: BLE001
                log.warning("report pack %s for %s failed: %s", sch["name"], per, getattr(ex, "detail", ex))
            with engine().begin() as cn:                         # one try per period; failures are in the log and alerts
                cn.execute(text("UPDATE ops.pack_schedule SET last_period=:p WHERE schedule_id=:s"), {"p": per, "s": sch["schedule_id"]})

    @app.get("/api/admin/pack")
    def overview():
        with engine().connect() as cn:
            sch = [dict(r) for r in cn.execute(text("SELECT * FROM ops.pack_schedule ORDER BY name")).mappings()]
            logs = [dict(r) for r in cn.execute(text("SELECT TOP 50 l.*, s.name FROM ops.pack_log l LEFT JOIN ops.pack_schedule s ON s.schedule_id = l.schedule_id ORDER BY l.id DESC")).mappings()]
        try:
            import reportlab  # noqa: F401
            pdf_ok = True
        except ImportError:
            pdf_ok = False
        return {"schedules": sch, "log": logs, "smtp": smtp_info(), "pdf_ready": pdf_ok, "next_period": "%d-%02d" % prev_period()}

    @app.put("/api/admin/pack/smtp")
    def save_smtp(body: SmtpIn):
        ops.save({"smtp_host": body.smtp_host.strip(), "smtp_port": body.smtp_port, "smtp_from": body.smtp_from.strip(),
                  "smtp_user": body.smtp_user.strip(), "smtp_tls": "1" if body.smtp_tls else "0"})
        store.write(security.current_user(), "pack.smtp", f"{body.smtp_host}:{body.smtp_port}")
        return smtp_info()

    @app.post("/api/admin/pack/schedules")
    def save_schedule(body: ScheduleIn):
        reps = [r for r in body.reports if r in REPORTS]
        if not reps:
            raise HTTPException(400, "Choose at least one report.")
        p = {"n": body.name.strip(), "e": body.enabled, "t": body.tenant_key, "c": ",".join(c.strip().lower() for c in body.companies),
             "r": ",".join(reps), "b": body.basis, "d": body.day_of_month, "h": body.send_hour, "rc": body.recipients.strip(),
             "u": (security.current_user() or {}).get("username")}
        with engine().begin() as cn:
            if body.schedule_id:
                load(cn, body.schedule_id)
                cn.execute(text("""UPDATE ops.pack_schedule SET name=:n, enabled=:e, tenant_key=:t, companies=:c, reports=:r, basis=:b,
                                   day_of_month=:d, send_hour=:h, recipients=:rc WHERE schedule_id=:s"""), {**p, "s": body.schedule_id})
                sid = body.schedule_id
            else:
                sid = cn.execute(text("""INSERT INTO ops.pack_schedule (name, enabled, tenant_key, companies, reports, basis, day_of_month, send_hour, recipients, created_by)
                                         OUTPUT inserted.schedule_id VALUES (:n, :e, :t, :c, :r, :b, :d, :h, :rc, :u)"""), p).scalar()
        store.write(security.current_user(), "pack.schedule", f"{body.name} · {p['c']} · day {body.day_of_month} {body.send_hour}:00")
        return {"ok": True, "schedule_id": sid}

    @app.delete("/api/admin/pack/schedules/{sid}")
    def delete_schedule(sid: int):
        with engine().begin() as cn:
            load(cn, sid)
            cn.execute(text("DELETE FROM ops.pack_schedule WHERE schedule_id=:s"), {"s": sid})
        return {"ok": True}

    @app.post("/api/admin/pack/schedules/{sid}/send")
    def send_now(sid: int, body: SendIn):
        y, m = _period(body.period)
        with engine().connect() as cn:
            sch = load(cn, sid)
        res = send(sch, y, m, body.to, (security.current_user() or {}).get("username", "api"))
        return {"ok": True, "message": res}

    @app.get("/api/admin/pack/schedules/{sid}/preview")
    def preview(sid: int, period: str | None = Query(None)):
        y, m = _period(period)
        with engine().connect() as cn:
            sch = load(cn, sid)
        pdf = build_pdf(app, settings.all(), sch, y, m)
        return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="report_pack_{y}-{m:02d}.pdf"'})

    return run_due

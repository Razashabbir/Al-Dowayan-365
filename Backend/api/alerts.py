"""Alerts (Administration › Alerts and the bell in the top bar).

Checked every hour by the scheduler (and on "Check now"):
  * ETL job failed or partly failed (latest job of a tenant)       * no successful ETL for N days
  * trial balance of a company does not net to zero               * financial position does not balance
  * expense spike: an expense account's latest month is X % above its 3-month average (and above a minimum)
  * reconciliation found differences                               * scheduled report pack failed
Alerts are kept in ops.alert by a fingerprint: still detected = Open (updated), no longer detected = Resolved.
Users only see alerts of companies they may see.
"""
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

import security
from modlib import MONTHS, as_date, as_datetime, call, month_end, num


class SettingsIn(BaseModel):
    alerts_spike_pct: float = Field(50, ge=5, le=1000)
    alerts_spike_min: float = Field(10000, ge=0)
    alerts_stale_days: int = Field(2, ge=1, le=60)
    recon_hour: int = Field(2, ge=0, le=23)
    ic_tolerance: float = Field(1, ge=0)


def register(app, engine, ops, store, log):
    def detect():
        found = []
        o = ops.all()
        spike_pct, spike_min, stale = num(o["alerts_spike_pct"]), num(o["alerts_spike_min"]), int(num(o["alerts_stale_days"]) or 2)
        with engine().connect() as cn:
            tenants = [dict(r) for r in cn.execute(text("SELECT tenant_key, name FROM etl.tenant WHERE is_active = 1")).mappings()]
            for t in tenants:
                k = t["tenant_key"]
                last = cn.execute(text("""SELECT TOP 1 job_id, status, finished_at, message FROM etl.sync_job
                                          WHERE tenant_key=:k AND status <> 'Running' ORDER BY job_id DESC"""), {"k": k}).mappings().first()
                if last and last["status"] in ("Failed", "Partial"):
                    found.append({"fp": f"etl:{k}:{last['job_id']}", "tenant_key": k, "kind": "etl_failed",
                                  "severity": "bad" if last["status"] == "Failed" else "warn",
                                  "title": f"ETL job #{last['job_id']} {last['status'].lower()} - {t['name']}",
                                  "detail": (last["message"] or "")[:1500], "link": "/etl/jobs"})
                ok = as_datetime(cn.execute(text("SELECT MAX(finished_at) FROM etl.sync_job WHERE tenant_key=:k AND status='OK'"), {"k": k}).scalar())
                if not ok or ok < datetime.utcnow() - timedelta(days=stale):
                    # say what actually happened, so a failed or still-running job is not mistaken for "ETL was never run"
                    if last:
                        msg = " ".join((last["message"] or "").split())[:300]
                        lastrun = (f"Latest run: job #{last['job_id']} {last['status']}"
                                   + (f" on {as_datetime(last['finished_at']):%d %b %Y %H:%M} UTC" if last["finished_at"] else "")
                                   + (f" - {msg}" if msg and last["status"] != "OK" else ""))
                    else:
                        lastrun = "No ETL job has been run yet."
                    running = cn.execute(text("SELECT TOP 1 job_id FROM etl.sync_job WHERE tenant_key=:k AND status='Running' ORDER BY job_id DESC"),
                                         {"k": k}).scalar()
                    if running:
                        lastrun += f" Job #{running} is running now."
                    found.append({"fp": f"stale:{k}", "tenant_key": k, "kind": "etl_stale", "severity": "warn",
                                  "title": (f"No successful ETL for {stale}+ days - {t['name']}" if ok
                                            else f"No successful ETL yet - {t['name']}"),
                                  "detail": (f"Last successful run: {ok:%d %b %Y %H:%M} UTC. " if ok else "") + lastrun, "link": "/etl/jobs"})
                # trial balance per company must net to zero (double entry)
                for r in cn.execute(text("""SELECT company, SUM(amount) AS s, COUNT_BIG(*) AS n FROM dw.fact_gl WHERE tenant_key=:k
                                            GROUP BY company HAVING ABS(SUM(amount)) > 1"""), {"k": k}).mappings():
                    found.append({"fp": f"tb:{k}:{r['company']}", "tenant_key": k, "company": r["company"], "kind": "tb_unbalanced", "severity": "bad",
                                  "title": f"Trial balance of {r['company'].upper()} does not net to zero",
                                  "detail": f"Debits minus credits = {num(r['s']):,.2f} over {r['n']:,} ledger lines. Run the reconciliation.", "link": "/close/reconciliation"})
                # expense spike: latest month with data vs average of the 3 months before it
                lm = as_date(cn.execute(text("SELECT MAX(accounting_date) FROM dw.fact_gl WHERE tenant_key=:k AND is_close=0"), {"k": k}).scalar())
                if lm:
                    y, m = lm.year, lm.month
                    sy, sm = (y, m - 3) if m > 3 else (y - 1, m + 9)      # first day of the month 3 months before
                    start = date(sy, sm, 1)
                    data = cn.execute(text("""SELECT f.company, f.main_account, MAX(a.account_name) AS name,
                                                     SUM(CASE WHEN YEAR(f.accounting_date)=:y AND MONTH(f.accounting_date)=:m THEN f.amount ELSE 0 END) AS cur,
                                                     SUM(CASE WHEN f.accounting_date < :ms AND f.accounting_date >= :st THEN f.amount ELSE 0 END) / 3.0 AS avg3
                                              FROM dw.fact_gl f JOIN dw.dim_account a ON a.tenant_key=f.tenant_key AND a.main_account=f.main_account
                                              WHERE f.tenant_key=:k AND f.is_close=0 AND a.pl_group='Expense' AND f.accounting_date >= :st
                                              GROUP BY f.company, f.main_account"""),
                                      {"k": k, "y": y, "m": m, "ms": date(y, m, 1), "st": date(start.year, start.month, 1)}).mappings()
                    for r in data:
                        cur, avg = num(r["cur"]), num(r["avg3"])
                        if cur >= spike_min and avg > 0 and cur > avg * (1 + spike_pct / 100):
                            found.append({"fp": f"spike:{k}:{r['company']}:{r['main_account']}:{y}-{m:02d}", "tenant_key": k, "company": r["company"],
                                          "kind": "expense_spike", "severity": "warn",
                                          "title": f"Expense spike {r['company'].upper()} · {r['main_account']} {r['name'] or ''} - {MONTHS[m - 1]} {y}",
                                          "detail": f"{cur:,.0f} this month vs {avg:,.0f} 3-month average (+{(cur / avg - 1) * 100:.0f}%).",
                                          "link": "/dashboards/expenses"})
                rr = cn.execute(text("SELECT TOP 1 run_id, status, summary, finished_at FROM ops.recon_run WHERE tenant_key=:k ORDER BY run_id DESC"), {"k": k}).mappings().first()
                if rr and rr["status"] in ("Differences", "Failed"):
                    found.append({"fp": f"recon:{k}:{rr['run_id']}", "tenant_key": k, "kind": "recon", "severity": "warn" if rr["status"] == "Differences" else "bad",
                                  "title": f"Reconciliation {rr['status'].lower()} - {t['name']}", "detail": (rr["summary"] or "")[:1500],
                                  "link": "/close/reconciliation"})
            for r in cn.execute(text("""SELECT s.schedule_id, s.name, s.last_status, s.last_run_at, s.tenant_key FROM ops.pack_schedule s
                                         WHERE s.enabled = 1 AND s.last_status LIKE 'Failed%'""")).mappings():
                found.append({"fp": f"pack:{r['schedule_id']}:{str(r['last_run_at'])[:16]}",
                              "tenant_key": r["tenant_key"], "kind": "pack_failed", "severity": "warn",
                              "title": f"Report pack '{r['name']}' was not sent", "detail": r["last_status"], "link": "/admin/report-pack"})
        # financial position balance per company (latest month with data) - uses the statements engine
        for t in tenants:
            try:
                cos = call(app, "/api/report/companies-all")
            except Exception:                                    # noqa: BLE001
                cos = []
            with engine().connect() as cn:
                last = {r[0].lower(): as_date(r[1]) for r in cn.execute(text("SELECT company, MAX(accounting_date) FROM dw.fact_gl WHERE tenant_key=:k AND is_close=0 GROUP BY company"),
                                                                {"k": t["tenant_key"]})}
            for c in [c for c in cos if c["tenant_key"] == t["tenant_key"] and c["company"] in last]:
                d = last[c["company"]]
                try:
                    bs = call(app, "/api/report/fs/statement", tenant=t["tenant_key"], company=c["company"], year=d.year, kind="BS", month=d.month, basis="final")
                except Exception:                                # noqa: BLE001
                    continue
                diff = num(bs.get("check", {}).get("cur"))
                if abs(diff) > 1:
                    found.append({"fp": f"bs:{t['tenant_key']}:{c['company']}", "tenant_key": t["tenant_key"], "company": c["company"], "kind": "bs_unbalanced",
                                  "severity": "bad", "title": f"Financial position of {c['company'].upper()} does not balance ({MONTHS[d.month - 1]} {d.year})",
                                  "detail": f"Total assets minus equity and liabilities = {diff:,.0f}. Usually accounts not mapped (Reports › FS Mapping).",
                                  "link": "/reports/balance-sheet"})
        return found

    def evaluate():
        """Detect and store: new -> Open, still there -> last_at updated, gone -> Resolved."""
        try:
            found = detect()
        except Exception as ex:                                  # noqa: BLE001
            log.warning("alerts not evaluated: %s", str(ex).splitlines()[0][:300])
            return {"error": str(ex).splitlines()[0][:300]}
        fps = {f["fp"] for f in found}
        with engine().begin() as cn:
            for f in found:
                p = {"fp": f["fp"][:200], "t": f.get("tenant_key"), "c": f.get("company"), "k": f["kind"], "s": f["severity"],
                     "ti": f["title"][:300], "d": (f.get("detail") or "")[:2000], "l": f.get("link")}
                if not cn.execute(text("""UPDATE ops.alert SET last_at=SYSUTCDATETIME(), title=:ti, detail=:d, severity=:s,
                                          status = CASE WHEN status='Resolved' THEN 'Open' ELSE status END, resolved_at=NULL WHERE fingerprint=:fp"""), p).rowcount:
                    cn.execute(text("""INSERT INTO ops.alert (fingerprint, tenant_key, company, kind, severity, title, detail, link)
                                       VALUES (:fp, :t, :c, :k, :s, :ti, :d, :l)"""), p)
            for r in cn.execute(text("SELECT alert_id, fingerprint FROM ops.alert WHERE status <> 'Resolved'")).mappings().all():
                if r["fingerprint"] not in fps:
                    cn.execute(text("UPDATE ops.alert SET status='Resolved', resolved_at=SYSUTCDATETIME() WHERE alert_id=:i"), {"i": r["alert_id"]})
        return {"found": len(found)}

    def visible(rows_):
        u = security.current_user()

        def ok(r):
            if r["company"]:
                return security.can_see(u, r["tenant_key"], r["company"])
            return r["tenant_key"] is None or security.can_see(u, r["tenant_key"], None)
        return [r for r in rows_ if ok(r)]

    @app.get("/api/admin/alerts")
    def list_alerts(status: str = "active"):
        with engine().connect() as cn:
            where = "status <> 'Resolved'" if status == "active" else "1=1"
            data = [dict(r) for r in cn.execute(text(f"SELECT TOP 500 * FROM ops.alert WHERE {where} ORDER BY CASE severity WHEN 'bad' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, last_at DESC")).mappings()]
        data = visible(data)
        return {"alerts": data, "open": sum(1 for a in data if a["status"] == "Open"),
                "bad": sum(1 for a in data if a["status"] == "Open" and a["severity"] == "bad"), "settings": ops.all()}

    @app.get("/api/admin/alerts/count")
    def count():
        try:
            with engine().connect() as cn:
                data = [dict(r) for r in cn.execute(text("SELECT alert_id, tenant_key, company, severity FROM ops.alert WHERE status = 'Open'")).mappings()]
        except Exception:                                        # noqa: BLE001
            return {"open": 0, "bad": 0}
        data = visible(data)
        return {"open": len(data), "bad": sum(1 for a in data if a["severity"] == "bad")}

    @app.post("/api/admin/alerts/run")
    def run_now():
        r = evaluate()
        store.write(security.current_user(), "alerts.run", str(r))
        return {**r, **count()}

    @app.post("/api/admin/alerts/{alert_id}/ack")
    def ack(alert_id: int):
        with engine().begin() as cn:
            r = cn.execute(text("SELECT tenant_key, company FROM ops.alert WHERE alert_id=:i"), {"i": alert_id}).mappings().first()
            if not r:
                raise HTTPException(404, "Alert not found.")
            if r["company"] and not security.can_see(security.current_user(), r["tenant_key"], r["company"]):
                raise HTTPException(403, "No access to this alert.")
            cn.execute(text("UPDATE ops.alert SET status='Acknowledged', ack_by=:u, ack_at=SYSUTCDATETIME() WHERE alert_id=:i AND status='Open'"),
                       {"i": alert_id, "u": (security.current_user() or {}).get("username")})
        return {"ok": True}

    @app.put("/api/admin/alerts/settings")
    def save_settings(body: SettingsIn):
        ops.save(body.model_dump())
        store.write(security.current_user(), "alerts.settings", str(body.model_dump()))
        return ops.all()

    return evaluate

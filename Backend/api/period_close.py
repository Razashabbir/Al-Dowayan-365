"""Period close and lock (Close › Period Close).

Each company-month has a checklist (cls.task, editable) plus automatic checks, and can be Closed (locked).
A closed month refuses new, changed, posted, unposted or reversed adjustment entries dated in it
(adjustments.py calls `locked()`), until someone with close.manage reopens it. Everything is in the Audit Logs.
"""
from datetime import date

from fastapi import HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

import security
from modlib import MONTHS, as_datetime, call, month_end, need_company, num


class PeriodIn(BaseModel):
    tenant_key: int
    companies: list[str] = Field(min_length=1)
    year: int
    month: int = Field(ge=1, le=12)
    note: str = ""


class TaskTick(BaseModel):
    tenant_key: int
    company: str
    year: int
    month: int = Field(ge=1, le=12)
    task_id: int
    done: bool
    note: str = ""


class TaskIn(BaseModel):
    task_id: int | None = None
    area: str = Field(min_length=1, max_length=60)
    title: str = Field(min_length=1, max_length=200)
    sort: int = 0
    is_active: bool = True


def locked(cn, tenant: int, companies, d: date) -> list[str]:
    """Companies whose month of date d is closed (empty list = all open)."""
    if not cn.execute(text("SELECT OBJECT_ID('cls.period')")).scalar():
        return []
    out = []
    for c in {str(x).lower() for x in companies}:
        if cn.execute(text("""SELECT 1 FROM cls.period WHERE tenant_key=:t AND company=:c AND [year]=:y AND [month]=:m AND status='Closed'"""),
                      {"t": tenant, "c": c, "y": d.year, "m": d.month}).first():
            out.append(c)
    return out


def lock_message(companies, d: date) -> str:
    return (f"{MONTHS[d.month - 1]} {d.year} is closed for {', '.join(c.upper() for c in companies)}. "
            f"Reopen the month under Close › Period Close first (permission: lock and reopen periods).")


def register(app, engine, store, rows):
    def me():
        return (security.current_user() or {}).get("username")

    def auto_checks(tenant, company, y, m):
        """Automatic checks for the checklist (read-only, never block closing)."""
        checks = []
        d, ys = month_end(y, m), date(y, 1, 1)
        with engine().connect() as cn:
            last = as_datetime(cn.execute(text("SELECT MAX(finished_at) FROM etl.sync_job WHERE tenant_key=:t AND status='OK'"), {"t": tenant}).scalar())
            checks.append({"name": "ETL loaded after month end", "ok": bool(last and last.date() > d),
                           "detail": f"last successful ETL {last:%d %b %Y %H:%M} UTC" if last else "no successful ETL yet"})
            drafts = cn.execute(text("""SELECT COUNT(DISTINCT e.entry_id) FROM adj.entry e JOIN adj.line l ON l.entry_id = e.entry_id
                                        WHERE e.tenant_key=:t AND l.company=:c AND e.status='Draft' AND YEAR(e.entry_date)=:y AND MONTH(e.entry_date)=:m"""),
                                {"t": tenant, "c": company, "y": y, "m": m}).scalar() if cn.execute(text("SELECT OBJECT_ID('adj.entry')")).scalar() else 0
            checks.append({"name": "No draft adjustments left in the month", "ok": not drafts,
                           "detail": f"{drafts} draft entr{'y' if drafts == 1 else 'ies'}" if drafts else "none"})
        try:
            bs = call(app, "/api/report/fs/statement", tenant=tenant, company=company, year=y, kind="BS", month=m, basis="final")
            diff = num(bs.get("check", {}).get("cur"))
            checks.append({"name": "Financial position balances", "ok": abs(diff) < 1,
                           "detail": "assets = equity + liabilities" if abs(diff) < 1 else f"difference {diff:,.0f}"})
            checks.append({"name": "All accounts mapped to the statements", "ok": not bs.get("unmapped"),
                           "detail": f"{bs.get('unmapped')} account(s) not mapped" if bs.get("unmapped") else "all mapped"})
        except Exception as ex:                                # noqa: BLE001
            checks.append({"name": "Financial position balances", "ok": False, "detail": str(getattr(ex, 'detail', ex))[:160]})
        try:
            r = rows("""SELECT COUNT(*) AS n, ISNULL(SUM(amount), 0) AS s FROM dw.fact_gl
                        WHERE tenant_key=:t AND company=:c AND accounting_date <= :d""", t=tenant, c=company, d=d)[0]
            checks.append({"name": "Ledger lines exist up to month end", "ok": r["n"] > 0, "detail": f"{r['n']:,} lines"})
        except Exception:                                      # noqa: BLE001
            pass
        return checks

    @app.get("/api/admin/close")
    def overview(tenant: int, company: str, year: int):
        need_company(tenant, company)
        c = company.lower()
        with engine().connect() as cn:
            per = {r["month"]: dict(r) for r in cn.execute(text("""SELECT [month], status, closed_by, closed_at, reopened_by, reopened_at, note
                                                                    FROM cls.period WHERE tenant_key=:t AND company=:c AND [year]=:y"""),
                                                           {"t": tenant, "c": c, "y": year}).mappings()}
            total = cn.execute(text("SELECT COUNT(*) FROM cls.task WHERE is_active=1")).scalar()
            done = {r["month"]: r["n"] for r in cn.execute(text("""SELECT d.[month], COUNT(*) AS n FROM cls.task_done d JOIN cls.task k ON k.task_id=d.task_id
                                                                    WHERE k.is_active=1 AND d.tenant_key=:t AND d.company=:c AND d.[year]=:y GROUP BY d.[month]"""),
                                                           {"t": tenant, "c": c, "y": year}).mappings()}
        months = [{"month": m, "label": MONTHS[m - 1], "status": (per.get(m) or {}).get("status", "Open"), **{k: v for k, v in (per.get(m) or {}).items() if k != "month"},
                   "tasks_done": done.get(m, 0), "tasks_total": total} for m in range(1, 13)]
        return {"year": year, "company": c, "months": months}

    @app.get("/api/admin/close/checklist")
    def checklist(tenant: int, company: str, year: int, month: int = Query(ge=1, le=12)):
        need_company(tenant, company)
        c = company.lower()
        with engine().connect() as cn:
            tasks = [dict(r) for r in cn.execute(text("""SELECT k.task_id, k.area, k.title, d.done_by, d.done_at, d.note
                        FROM cls.task k LEFT JOIN cls.task_done d ON d.task_id = k.task_id AND d.tenant_key=:t AND d.company=:c AND d.[year]=:y AND d.[month]=:m
                        WHERE k.is_active = 1 ORDER BY k.sort, k.task_id"""), {"t": tenant, "c": c, "y": year, "m": month}).mappings()]
            p = cn.execute(text("SELECT * FROM cls.period WHERE tenant_key=:t AND company=:c AND [year]=:y AND [month]=:m"),
                           {"t": tenant, "c": c, "y": year, "m": month}).mappings().first()
        return {"tasks": tasks, "period": dict(p) if p else {"status": "Open"}, "checks": auto_checks(tenant, c, year, month)}

    @app.post("/api/admin/close/task")
    def tick(body: TaskTick):
        need_company(body.tenant_key, body.company)
        p = {"t": body.tenant_key, "c": body.company.lower(), "y": body.year, "m": body.month, "k": body.task_id, "u": me(), "n": body.note[:400]}
        with engine().begin() as cn:
            if locked(cn, body.tenant_key, [body.company], month_end(body.year, body.month)):
                raise HTTPException(400, "The month is closed - reopen it to change the checklist.")
            cn.execute(text("DELETE FROM cls.task_done WHERE tenant_key=:t AND company=:c AND [year]=:y AND [month]=:m AND task_id=:k"), p)
            if body.done:
                cn.execute(text("INSERT INTO cls.task_done (tenant_key, company, [year], [month], task_id, done_by, note) VALUES (:t, :c, :y, :m, :k, :u, :n)"), p)
        return {"ok": True}

    def _set(body: PeriodIn, status):
        for c in body.companies:
            need_company(body.tenant_key, c)
        with engine().begin() as cn:
            for c in {x.lower() for x in body.companies}:
                p = {"t": body.tenant_key, "c": c, "y": body.year, "m": body.month, "u": me(), "n": body.note[:400] or None, "s": status}
                if status == "Closed":
                    sql_u = "UPDATE cls.period SET status='Closed', closed_by=:u, closed_at=SYSUTCDATETIME(), note=:n WHERE tenant_key=:t AND company=:c AND [year]=:y AND [month]=:m"
                    sql_i = "INSERT INTO cls.period (tenant_key, company, [year], [month], status, closed_by, closed_at, note) VALUES (:t, :c, :y, :m, 'Closed', :u, SYSUTCDATETIME(), :n)"
                else:
                    sql_u = "UPDATE cls.period SET status='Open', reopened_by=:u, reopened_at=SYSUTCDATETIME(), note=:n WHERE tenant_key=:t AND company=:c AND [year]=:y AND [month]=:m"
                    sql_i = "INSERT INTO cls.period (tenant_key, company, [year], [month], status, reopened_by, reopened_at, note) VALUES (:t, :c, :y, :m, 'Open', :u, SYSUTCDATETIME(), :n)"
                if not cn.execute(text(sql_u), p).rowcount:
                    cn.execute(text(sql_i), p)
        store.write(security.current_user(), "close.lock" if status == "Closed" else "close.reopen",
                    f"{MONTHS[body.month - 1]} {body.year} · {', '.join(c.upper() for c in body.companies)}{' · ' + body.note if body.note else ''}")
        return {"ok": True}

    @app.post("/api/admin/close/lock")
    def lock(body: PeriodIn):
        return _set(body, "Closed")

    @app.post("/api/admin/close/reopen")
    def reopen(body: PeriodIn):
        return _set(body, "Open")

    @app.get("/api/admin/close/tasks")
    def tasks():
        with engine().connect() as cn:
            return [dict(r) for r in cn.execute(text("SELECT task_id, area, title, sort, is_active FROM cls.task ORDER BY sort, task_id")).mappings()]

    @app.put("/api/admin/close/tasks")
    def save_tasks(items: list[TaskIn]):
        with engine().begin() as cn:
            keep = []
            for i, t in enumerate(items):
                p = {"a": t.area.strip(), "ti": t.title.strip(), "s": t.sort or (i + 1) * 10, "on": t.is_active}
                if t.task_id:
                    cn.execute(text("UPDATE cls.task SET area=:a, title=:ti, sort=:s, is_active=:on WHERE task_id=:k"), {**p, "k": t.task_id})
                    keep.append(t.task_id)
                else:
                    keep.append(cn.execute(text("INSERT INTO cls.task (area, title, sort, is_active) OUTPUT inserted.task_id VALUES (:a, :ti, :s, :on)"), p).scalar())
            if keep:
                cn.execute(text(f"UPDATE cls.task SET is_active = 0 WHERE task_id NOT IN ({','.join(str(int(k)) for k in keep)})"))
        store.write(security.current_user(), "close.tasks", f"{len(items)} checklist items")
        return tasks()

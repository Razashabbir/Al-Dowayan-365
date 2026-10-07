"""Adjustments & eliminations journal.

Entry types
  Adjustment        audit / year-end adjustments of one company (e.g. PwC AJE)
  Reclassification  moves an amount between statement lines of one company
  Elimination       consolidation eliminations (intercompany revenue / cost, due to / due from, investment)
                    - only applied when the statements show all companies combined

Each line is a debit or credit on a ledger account (it then follows the account's FS mapping) or directly
on a statement line (line_code).  Only Posted entries change the statements; drafts are work in progress.
"""
from datetime import date

from fastapi import HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

import fs_model as M
import security

TYPES = ["Adjustment", "Reclassification", "Elimination"]


class LineIn(BaseModel):
    company: str
    main_account: str | None = None
    line_code: str | None = None
    debit: float = 0
    credit: float = 0
    memo: str = ""


class EntryIn(BaseModel):
    tenant_key: int
    entry_type: str
    entry_date: date
    description: str = Field(min_length=1, max_length=400)
    reference: str = ""
    lines: list[LineIn]


class ReverseIn(BaseModel):
    entry_date: date | None = None


def adj_rows(engine, tenant, company, d, pd, ys, pys, include_elim: bool):
    """Posted adjustment amounts (debit +) per account / statement line, in the same shape as the ledger balances."""
    where = "e.tenant_key = :t AND e.status = 'Posted' AND e.entry_date <= :d"
    p = {"t": tenant, "d": d, "pd": pd, "ys": ys, "pys": pys}
    if company not in (None, "", "*"):
        where += " AND l.company = :c AND e.entry_type <> 'Elimination'"
        p["c"] = company
    elif not include_elim:
        where += " AND e.entry_type <> 'Elimination'"
    try:
        with engine().connect() as cn:
            data = [dict(r) for r in cn.execute(text(f"""
                SELECT l.company, l.main_account, l.line_code, e.entry_type, e.entry_id, e.reference, e.description,
                       SUM(l.debit - l.credit) AS bal,
                       SUM(CASE WHEN e.entry_date <= :pd THEN l.debit - l.credit ELSE 0 END) AS pbal,
                       SUM(CASE WHEN e.entry_date < :ys THEN l.debit - l.credit ELSE 0 END) AS opening,
                       SUM(CASE WHEN e.entry_date >= :ys THEN l.debit ELSE 0 END) AS dr,
                       SUM(CASE WHEN e.entry_date >= :ys THEN l.credit ELSE 0 END) AS cr,
                       SUM(CASE WHEN e.entry_date >= :ys THEN l.debit - l.credit ELSE 0 END) AS ytd,
                       SUM(CASE WHEN e.entry_date BETWEEN :pys AND :pd THEN l.debit - l.credit ELSE 0 END) AS pytd
                FROM adj.line l JOIN adj.entry e ON e.entry_id = l.entry_id
                WHERE {where}
                GROUP BY l.company, l.main_account, l.line_code, e.entry_type, e.entry_id, e.reference, e.description"""), p).mappings()]
    except Exception as ex:    # e.g. adjustment tables not created yet (API not restarted) - ledger only
        import logging
        logging.getLogger("api").error("adjustments not applied to the report: %s", str(ex).splitlines()[0][:300])
        return []
    u = security.current_user()
    out = []
    for r in data:
        if not security.can_see(u, tenant, r["company"]):
            continue                                       # row-level security also applies to adjustments
        r["comp"] = "elim" if r["entry_type"] == "Elimination" else "adj"
        for k in ("bal", "pbal", "opening", "dr", "cr", "ytd", "pytd"):
            r[k] = float(r[k] or 0)
        out.append(r)
    return out


def summary(engine, tenant, company, d, ys):
    """What the statement for period ys..d includes and what it leaves out (shown above the report)."""
    p = {"t": tenant, "d": d, "ys": ys}
    co = ""
    if company not in (None, "", "*"):
        co = " AND EXISTS (SELECT 1 FROM adj.line l WHERE l.entry_id = e.entry_id AND l.company = :c)"
        p["c"] = company
    try:
        with engine().connect() as cn:
            r = cn.execute(text(f"""
                SELECT SUM(CASE WHEN status = 'Posted' AND entry_date <= :d THEN 1 ELSE 0 END) AS posted,
                       SUM(CASE WHEN status = 'Posted' AND entry_date BETWEEN :ys AND :d THEN 1 ELSE 0 END) AS posted_period,
                       SUM(CASE WHEN status = 'Draft' THEN 1 ELSE 0 END) AS drafts,
                       SUM(CASE WHEN status = 'Posted' AND entry_date > :d THEN 1 ELSE 0 END) AS later,
                       SUM(CASE WHEN status = 'Posted' AND entry_type = 'Elimination' THEN 1 ELSE 0 END) AS elims
                FROM adj.entry e WHERE tenant_key = :t{co}"""), p).mappings().first()
            out = {k: int(v or 0) for k, v in dict(r).items()}
            if co:                              # posted entries of OTHER companies in this period (not in this report)
                others = cn.execute(text("""
                    SELECT DISTINCT l.company FROM adj.entry e JOIN adj.line l ON l.entry_id = e.entry_id
                    WHERE e.tenant_key = :t AND e.status = 'Posted' AND e.entry_type <> 'Elimination'
                      AND e.entry_date BETWEEN :ys AND :d AND l.company <> :c"""), p).scalars().all()
                out["other_companies"] = sorted(c.upper() for c in others)
        return out
    except Exception:
        return None


def register(app, engine):
    def me():
        u = security.current_user() or {}
        return u.get("username")

    def _visible(lines, tenant):
        u = security.current_user()
        return all(security.can_see(u, tenant, l["company"]) for l in lines)

    def _load(cn, entry_id):
        e = cn.execute(text("SELECT * FROM adj.entry WHERE entry_id = :i"), {"i": entry_id}).mappings().first()
        if not e:
            raise HTTPException(404, f"Entry #{entry_id} not found.")
        e = dict(e)
        e["lines"] = [dict(r) for r in cn.execute(text("""
            SELECT l.line_id, l.line_no, l.company, l.main_account, l.line_code, l.debit, l.credit, l.memo,
                   a.account_name
            FROM adj.line l LEFT JOIN dw.dim_account a ON a.tenant_key = :t AND a.main_account = l.main_account
            WHERE l.entry_id = :i ORDER BY l.line_no"""), {"i": entry_id, "t": e["tenant_key"]}).mappings()]
        for l in e["lines"]:
            l["debit"], l["credit"] = float(l["debit"]), float(l["credit"])
            l["line_label"] = M.LABEL.get(l["line_code"] or "", "")
        if not _visible(e["lines"], e["tenant_key"]):
            raise HTTPException(403, "This entry includes companies you have no access to.")
        return e

    def _guard(cn, tenant, companies, d):
        """Period close: no changes in a closed month (cls.period)."""
        from period_close import lock_message, locked
        hit = locked(cn, tenant, companies, d)
        if hit:
            raise HTTPException(400, lock_message(hit, d))

    def _validate(body: EntryIn):
        if body.entry_type not in TYPES:
            raise HTTPException(400, f"Type must be one of {', '.join(TYPES)}.")
        lines = [l for l in body.lines if (l.debit or l.credit)]
        if len(lines) < 2:
            raise HTTPException(400, "An entry needs at least two lines with an amount.")
        for i, l in enumerate(lines, 1):
            if l.debit < 0 or l.credit < 0:
                raise HTTPException(400, f"Line {i}: amounts must be positive - use the other column instead.")
            if l.debit and l.credit:
                raise HTTPException(400, f"Line {i}: put the amount in Debit or Credit, not both.")
            if not (l.main_account or l.line_code):
                raise HTTPException(400, f"Line {i}: choose an account or a statement line.")
            if l.line_code and l.line_code not in M.LABEL:
                raise HTTPException(400, f"Line {i}: unknown statement line {l.line_code}.")
            if not l.company:
                raise HTTPException(400, f"Line {i}: choose the company.")
            if not security.can_see(security.current_user(), body.tenant_key, l.company):
                raise HTTPException(403, f"Line {i}: you have no access to company {l.company}.")
        dr, cr = round(sum(l.debit for l in lines), 2), round(sum(l.credit for l in lines), 2)
        if abs(dr - cr) > 0.005:
            raise HTTPException(400, f"The entry is not balanced: debits {dr:,.2f}, credits {cr:,.2f} (difference {dr - cr:,.2f}).")
        if body.entry_type == "Elimination" and len({l.company.lower() for l in lines}) < 2:
            raise HTTPException(400, "An elimination is between companies - its lines need at least two companies. "
                                     "For an entry of one company (e.g. an audit adjustment) choose type Adjustment or Reclassification.")
        if body.entry_type != "Elimination" and len({l.company.lower() for l in lines}) > 1:
            raise HTTPException(400, "Adjustments and reclassifications belong to one company. Use an Elimination for entries across companies.")
        return lines

    def _write_lines(cn, entry_id, lines):
        cn.execute(text("DELETE FROM adj.line WHERE entry_id = :i"), {"i": entry_id})
        for n, l in enumerate(lines, 1):
            cn.execute(text("""INSERT adj.line (entry_id, line_no, company, main_account, line_code, debit, credit, memo)
                               VALUES (:e, :n, :c, NULLIF(:a, ''), NULLIF(:lc, ''), :d, :cr, NULLIF(:m, ''))"""),
                       {"e": entry_id, "n": n, "c": l.company.lower(), "a": (l.main_account or "").strip(),
                        "lc": l.line_code or "", "d": round(l.debit, 2), "cr": round(l.credit, 2), "m": l.memo[:200]})

    @app.get("/api/admin/adj/entries")
    def entries(tenant: int, year: int | None = None, entry_type: str = "", status: str = "", company: str = "", q: str = ""):
        where, p = ["e.tenant_key = :t"], {"t": tenant}
        if year:
            where.append("YEAR(e.entry_date) = :y"); p["y"] = year
        if entry_type:
            where.append("e.entry_type = :ty"); p["ty"] = entry_type
        if status:
            where.append("e.status = :s"); p["s"] = status
        with engine().connect() as cn:
            rows = [dict(r) for r in cn.execute(text(f"""
                SELECT e.entry_id, e.entry_type, e.entry_date, e.description, e.reference, e.status, e.reverses_id,
                       e.created_by, e.created_at, e.posted_by, e.posted_at,
                       (SELECT SUM(debit) FROM adj.line l WHERE l.entry_id = e.entry_id) AS total,
                       (SELECT COUNT(*) FROM adj.line l WHERE l.entry_id = e.entry_id) AS lines,
                       (SELECT STRING_AGG(c, ',') FROM (SELECT DISTINCT company AS c FROM adj.line l WHERE l.entry_id = e.entry_id) x) AS companies,
                       (SELECT TOP 1 r.entry_id FROM adj.entry r WHERE r.reverses_id = e.entry_id) AS reversed_by
                FROM adj.entry e WHERE {' AND '.join(where)} ORDER BY e.entry_date DESC, e.entry_id DESC"""), p).mappings()]
        u = security.current_user()
        out = []
        for r in rows:
            cos = [c for c in (r["companies"] or "").split(",") if c]
            if not all(security.can_see(u, tenant, c) for c in cos):
                continue
            if company and company.lower() not in cos:
                continue
            if q and q.lower() not in f"{r['description']} {r['reference'] or ''} #{r['entry_id']}".lower():
                continue
            r["companies"], r["total"] = cos, float(r["total"] or 0)
            out.append(r)
        return out

    @app.get("/api/admin/adj/entries/{entry_id}")
    def entry(entry_id: int):
        with engine().connect() as cn:
            return _load(cn, entry_id)

    @app.get("/api/admin/adj/accounts")
    def accounts(tenant: int):
        """Accounts for the line picker (posting accounts of the chart)."""
        with engine().connect() as cn:
            return [dict(r) for r in cn.execute(text("""
                SELECT main_account, account_name, account_type FROM dw.dim_account
                WHERE tenant_key = :t AND ISNULL(account_type, '') NOT IN ('Reporting', 'Total', 'Header')
                ORDER BY main_account"""), {"t": tenant}).mappings()]

    @app.post("/api/admin/adj/entries")
    def create(body: EntryIn):
        lines = _validate(body)
        with engine().begin() as cn:
            _guard(cn, body.tenant_key, [l.company for l in body.lines], body.entry_date)
            eid = cn.execute(text("""INSERT adj.entry (tenant_key, entry_type, entry_date, description, reference, created_by)
                                     OUTPUT inserted.entry_id VALUES (:t, :ty, :d, :ds, NULLIF(:r, ''), :u)"""),
                             {"t": body.tenant_key, "ty": body.entry_type, "d": body.entry_date, "ds": body.description,
                              "r": body.reference, "u": me()}).scalar()
            _write_lines(cn, eid, lines)
        return {"ok": True, "entry_id": eid}

    @app.put("/api/admin/adj/entries/{entry_id}")
    def update(entry_id: int, body: EntryIn):
        lines = _validate(body)
        with engine().begin() as cn:
            e = _load(cn, entry_id)
            if e["status"] != "Draft":
                raise HTTPException(400, "Only draft entries can be changed. Unpost it first.")
            _guard(cn, e["tenant_key"], [l["company"] for l in e["lines"]], e["entry_date"])
            _guard(cn, body.tenant_key, [l.company for l in body.lines], body.entry_date)
            cn.execute(text("""UPDATE adj.entry SET entry_type = :ty, entry_date = :d, description = :ds, reference = NULLIF(:r, ''),
                                      updated_by = :u, updated_at = SYSUTCDATETIME() WHERE entry_id = :i"""),
                       {"ty": body.entry_type, "d": body.entry_date, "ds": body.description, "r": body.reference, "u": me(), "i": entry_id})
            _write_lines(cn, entry_id, lines)
        return {"ok": True, "entry_id": entry_id}

    @app.delete("/api/admin/adj/entries/{entry_id}")
    def delete(entry_id: int):
        with engine().begin() as cn:
            e = _load(cn, entry_id)
            if e["status"] != "Draft":
                raise HTTPException(400, "Posted entries cannot be deleted - reverse them, or unpost first.")
            _guard(cn, e["tenant_key"], [l["company"] for l in e["lines"]], e["entry_date"])
            cn.execute(text("DELETE FROM adj.entry WHERE entry_id = :i"), {"i": entry_id})
        return {"ok": True}

    @app.post("/api/admin/adj/entries/{entry_id}/post")
    def post(entry_id: int):
        with engine().begin() as cn:
            e = _load(cn, entry_id)
            if e["status"] == "Posted":
                raise HTTPException(400, "Already posted.")
            _guard(cn, e["tenant_key"], [l["company"] for l in e["lines"]], e["entry_date"])
            dr = sum(l["debit"] for l in e["lines"]); cr = sum(l["credit"] for l in e["lines"])
            if abs(dr - cr) > 0.005 or len(e["lines"]) < 2:
                raise HTTPException(400, "The entry is not balanced.")
            cn.execute(text("UPDATE adj.entry SET status = 'Posted', posted_by = :u, posted_at = SYSUTCDATETIME() WHERE entry_id = :i"),
                       {"u": me(), "i": entry_id})
        return {"ok": True}

    @app.post("/api/admin/adj/entries/{entry_id}/unpost")
    def unpost(entry_id: int):
        with engine().begin() as cn:
            e = _load(cn, entry_id)
            if cn.execute(text("SELECT 1 FROM adj.entry WHERE reverses_id = :i"), {"i": entry_id}).first():
                raise HTTPException(400, "This entry has been reversed - unpost or delete the reversal first.")
            _guard(cn, e["tenant_key"], [l["company"] for l in e["lines"]], e["entry_date"])
            cn.execute(text("UPDATE adj.entry SET status = 'Draft', posted_by = NULL, posted_at = NULL WHERE entry_id = :i"), {"i": entry_id})
        return {"ok": True}

    @app.post("/api/admin/adj/entries/{entry_id}/reverse")
    def reverse(entry_id: int, body: ReverseIn):
        with engine().begin() as cn:
            e = _load(cn, entry_id)
            if e["status"] != "Posted":
                raise HTTPException(400, "Only posted entries can be reversed.")
            if cn.execute(text("SELECT 1 FROM adj.entry WHERE reverses_id = :i"), {"i": entry_id}).first():
                raise HTTPException(400, "This entry is already reversed.")
            _guard(cn, e["tenant_key"], [l["company"] for l in e["lines"]], body.entry_date or e["entry_date"])
            rid = cn.execute(text("""INSERT adj.entry (tenant_key, entry_type, entry_date, description, reference, status,
                                                       reverses_id, created_by, posted_by, posted_at)
                                     OUTPUT inserted.entry_id
                                     VALUES (:t, :ty, :d, :ds, :r, 'Posted', :rv, :u, :u, SYSUTCDATETIME())"""),
                             {"t": e["tenant_key"], "ty": e["entry_type"], "d": body.entry_date or e["entry_date"],
                              "ds": f"Reversal of #{entry_id}: {e['description']}"[:400], "r": e["reference"], "rv": entry_id, "u": me()}).scalar()
            _write_lines(cn, rid, [LineIn(company=l["company"], main_account=l["main_account"], line_code=l["line_code"],
                                          debit=l["credit"], credit=l["debit"], memo=l["memo"] or "") for l in e["lines"]])
        return {"ok": True, "entry_id": rid}

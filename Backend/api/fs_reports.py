"""Reports module: statutory-style Income statement, Balance sheet, mapped trial balance and notes,
built from the same dw.fact_gl data as the dashboards (so both always agree after "Rebuild reports").

Account -> line mapping priority:  Manual change (Reports > Mapping)  >  workbook set assigned to the
company  >  other workbook sets  >  chart-of-accounts ranges (fs_model.RULES).
"""
import calendar
import json
import os
from datetime import date

from fastapi import HTTPException, Query

import adjustments
from pydantic import BaseModel
from sqlalchemy import text

import fs_model as M

SEED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fs_mapping_seed.json")
SET_ORDER = ["ADD SPF", "Tazayud"]
ALL = "*"          # company value meaning "all companies combined"


def ensure_seed(engine) -> str:
    """Load the mapping sets read from the YE2025 workbooks (once; re-import with fs_import.py)."""
    try:
        seed = json.load(open(SEED, encoding="utf-8"))
        added = []
        with engine.begin() as cn:
            for s, rows in seed.items():
                if cn.execute(text("SELECT COUNT(*) FROM rpt.fs_map WHERE map_set=:s AND tenant_key IS NULL"), {"s": s}).scalar():
                    continue
                cn.execute(text("""INSERT INTO rpt.fs_map (map_set, tenant_key, main_account, account_name, fsli, note_line, line_code)
                                   VALUES (:s, NULL, :main_account, :account_name, :fsli, :note_line, :line_code)"""),
                           [{"s": s, **r} for r in rows])
                added.append(f"{s} ({len(rows)})")
        return "reports mapping loaded: " + ", ".join(added) if added else "reports mapping ready"
    except Exception as ex:   # never block the API start
        return f"reports mapping not loaded: {str(ex)[:200]}"


def month_end(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def register(app, rows, admin, engine):
    # ---------------------------------------------------------------- mapping resolution ----
    def resolve(tenant: int, company: str) -> tuple[dict, dict, str | None]:
        """-> ({account: {line, note, fsli, source}}, {account: name}, assigned set)"""
        with engine().connect() as cn:
            assigned = None
            if company and company != ALL:
                assigned = cn.execute(text("SELECT map_set FROM rpt.fs_company WHERE tenant_key=:t AND company=:c"),
                                      {"t": tenant, "c": company}).scalar()
            maps = cn.execute(text("""SELECT map_set, tenant_key, main_account, fsli, note_line, line_code
                                      FROM rpt.fs_map WHERE tenant_key IS NULL OR tenant_key=:t"""), {"t": tenant}).all()
            names = {r[0]: r[1] for r in cn.execute(text(
                "SELECT main_account, account_name FROM dw.dim_account WHERE tenant_key=:t"), {"t": tenant})}
        order = ([assigned] if assigned else []) + [s for s in SET_ORDER if s != assigned]
        rank = lambda s: order.index(s) if s in order else len(order)  # noqa: E731
        best: dict = {}
        for r in sorted(maps, key=lambda r: (0 if r.map_set == "Manual" and r.tenant_key else 1 + rank(r.map_set)), reverse=True):
            best[r.main_account] = {"line": r.line_code, "note": r.note_line or "", "fsli": r.fsli or "",
                                    "source": "Manual" if r.map_set == "Manual" else r.map_set}
        return best, names, assigned

    def line_of(acc, mp, names):
        parent = names.get(acc[:4] + "000") or names.get(acc[:3] + "0000") or ""
        parent = parent.strip().title() if parent.isupper() else parent.strip()
        e = mp.get(acc)
        if e and e["line"] in M.LABEL:
            return e if e["note"] else {**e, "note": parent}
        return {"line": M.rule_line(acc, names.get(acc, "")), "note": parent, "fsli": "", "source": "Account range"}

    def balances(tenant, company, d, pd, ys, pys):
        where = "f.tenant_key = :t AND f.is_close = 0 AND f.accounting_date <= :d"
        p = {"t": tenant, "d": d, "pd": pd, "ys": ys, "pys": pys}
        if company != ALL:
            where += " AND f.company = :c"
            p["c"] = company
        return rows(f"""SELECT f.main_account,
                   SUM(f.amount) AS bal,
                   SUM(CASE WHEN f.accounting_date <= :pd THEN f.amount ELSE 0 END) AS pbal,
                   SUM(CASE WHEN f.accounting_date < :ys THEN f.amount ELSE 0 END) AS opening,
                   SUM(CASE WHEN f.accounting_date >= :ys AND f.amount > 0 THEN f.amount ELSE 0 END) AS dr,
                   SUM(CASE WHEN f.accounting_date >= :ys AND f.amount < 0 THEN -f.amount ELSE 0 END) AS cr,
                   SUM(CASE WHEN f.accounting_date >= :ys THEN f.amount ELSE 0 END) AS ytd,
                   SUM(CASE WHEN f.accounting_date BETWEEN :pys AND :pd THEN f.amount ELSE 0 END) AS pytd
                FROM dw.fact_gl f WHERE {where} GROUP BY f.main_account""", **p)

    COMPS = ("ledger", "adj", "elim")

    def aggregate(tenant, company, d, pd, ys, pys, basis="final"):
        """Ledger + posted adjustments (+ eliminations for all companies) per statement line, split by component.
        BS lines carry balances at d / pd, IS lines the period amounts ys..d / pys..pd."""
        mp, names, assigned = resolve(tenant, company)
        items = [dict(r, comp="ledger", entry_id=None, description=None) for r in balances(tenant, company, d, pd, ys, pys)]
        if basis != "ledger":
            items += adjustments.adj_rows(engine, tenant, company, d, pd, ys, pys, include_elim=(basis == "final"))
        zero = lambda: {c: 0.0 for c in COMPS}  # noqa: E731
        per_line, earn, dep = {}, {"cur": zero(), "prev": zero()}, {"cur": zero(), "prev": zero()}
        unmapped = 0
        for r in items:
            comp, acc = r["comp"], r.get("main_account")
            if acc:
                e = line_of(acc, mp, names)
                line, note, name = e["line"], e["note"] or "Other", names.get(acc, "")
                akey, source = acc, e["source"]
            else:
                line = r["line_code"]
                note = "Eliminations" if comp == "elim" else "Adjustments"
                akey, name, source = f"#{r['entry_id']}", r["description"] or "", r.get("entry_type", "")
            st, sg = M.statement_of(line), M.sign_of(line)
            bal, pbal = float(r["bal"] or 0), float(r["pbal"] or 0)
            if st == "IS":
                earn["cur"][comp] += -bal
                earn["prev"][comp] += -pbal
                if acc and acc.startswith("515"):          # depreciation & amortisation (for the cash flow)
                    dep["cur"][comp] += float(r["ytd"] or 0)
                    dep["prev"][comp] += float(r["pytd"] or 0)
                cur, prev = sg * float(r["ytd"] or 0), sg * float(r["pytd"] or 0)
            else:
                cur, prev = sg * bal, sg * pbal
            if abs(cur) < 0.005 and abs(prev) < 0.005:
                continue
            if comp == "ledger" and source == "Account range" and line.endswith("_OTH"):
                unmapped += 1
            L = per_line.setdefault(line, {"cur": zero(), "prev": zero(), "notes": {}})
            L["cur"][comp] += cur
            L["prev"][comp] += prev
            n = L["notes"].setdefault(note, {"note": note, "cur": 0.0, "prev": 0.0, "accounts": {}})
            n["cur"] += cur
            n["prev"] += prev
            a = n["accounts"].setdefault(akey, {"main_account": akey, "account_name": name, "cur": 0.0, "prev": 0.0,
                                                "source": source, "parts": zero()})
            a["cur"] += cur
            a["prev"] += prev
            a["parts"][comp] += cur
            if comp != "ledger" and acc:
                a["source"] = f"{a['source']} + adjustments" if "adjust" not in a["source"] else a["source"]
        L = per_line.setdefault("RE", {"cur": zero(), "prev": zero(), "notes": {}})
        for c in COMPS:
            L["cur"][c] += earn["cur"][c]
            L["prev"][c] += earn["prev"][c]
        if any(abs(earn["cur"][c]) > 0.005 or abs(earn["prev"][c]) > 0.005 for c in COMPS):
            nm = "Profit and OCI not yet closed to retained earnings"
            L["notes"][nm] = {"note": nm, "cur": sum(earn["cur"].values()), "prev": sum(earn["prev"].values()), "accounts": {}}
        return {"lines": per_line, "assigned": assigned, "unmapped": unmapped, "dep": dep}

    def totals(agg, layout, when="cur"):
        """{comp: computed layout values} plus 'final' = all components added."""
        out = {c: M.compute(layout, {k: v[when][c] for k, v in agg["lines"].items()}) for c in COMPS}
        out["final"] = {k: sum(out[c][k] for c in COMPS) for k in out["ledger"]}
        return out

    def check_basis(basis, company):
        if basis not in ("ledger", "adjusted", "final"):
            raise HTTPException(400, "basis must be ledger, adjusted or final")
        return basis

    def period(year, month):
        return dict(d=month_end(year, month), ys=date(year, 1, 1))

    # ---------------------------------------------------------------- endpoints ----
    @app.get("/api/report/fs/layout")
    def fs_layout():
        conv = lambda L: [{"kind": r[0], "code": r[1], "label": r[2], "sum": r[3] if len(r) > 3 else None} for r in L]  # noqa: E731
        return {"IS": conv(M.IS_LAYOUT), "BS": conv(M.BS_LAYOUT),
                "lines": [{"code": c, "label": M.LABEL[c], "statement": M.statement_of(c)}
                          for c in [r[1] for r in M.IS_LAYOUT + M.BS_LAYOUT if r[0] == "L"]]}

    @app.get("/api/report/fs/statement")
    def fs_statement(tenant: int, company: str, year: int, kind: str = Query("IS", pattern="^(IS|BS)$"),
                     month: int = Query(12, ge=1, le=12), basis: str = "final"):
        """basis: ledger = D365 only, adjusted = + posted adjustments, final = + eliminations when all companies."""
        check_basis(basis, company)
        d, ys = month_end(year, month), date(year, 1, 1)
        if kind == "IS":
            pd, pys = month_end(year - 1, month), date(year - 1, 1, 1)
            heads = [f"{year}" if month == 12 else f"Jan–{d:%b} {year}", f"{year - 1}" if month == 12 else f"Jan–{d:%b} {year - 1}"]
        else:
            pd, pys = date(year - 1, 12, 31), date(year - 1, 1, 1)
            heads = [f"{d:%d %b %Y}", f"{pd:%d %b %Y}"]
        agg = aggregate(tenant, company, d, pd, ys, pys, basis)
        layout = M.IS_LAYOUT if kind == "IS" else M.BS_LAYOUT
        cur_t, prev_t = totals(agg, layout, "cur"), totals(agg, layout, "prev")
        out = []
        for row in layout:
            k, code, label = row[0], row[1], row[2]
            item = {"kind": k, "code": code, "label": label}
            if k != "H":
                item["cur"], item["prev"] = cur_t["final"][code], prev_t["final"][code]
                item["parts"] = {c: cur_t[c][code] for c in COMPS}
            if k == "L":
                notes = sorted(agg["lines"].get(code, {}).get("notes", {}).values(), key=lambda n: -abs(n["cur"]))
                notes = [{**n, "accounts": sorted(n["accounts"].values(), key=lambda a: a["main_account"])} for n in notes]
                item["notes"] = notes
                if not notes and code.endswith("_OTH"):
                    continue                              # hide empty "not mapped" lines
            out.append(item)
        has_adj = any(abs(v) > 0.005 for r in out for c, v in (r.get("parts") or {}).items() if c != "ledger")
        res = {"kind": kind, "headings": heads, "as_of": d.isoformat(), "rows": out, "map_set": agg["assigned"],
               "unmapped": agg["unmapped"], "basis": basis, "has_adjustments": has_adj,
               "adj_summary": adjustments.summary(engine, tenant, company, d, ys)}
        if kind == "BS":
            res["check"] = {"cur": cur_t["final"]["TA"] - cur_t["final"]["TEL"], "prev": prev_t["final"]["TA"] - prev_t["final"]["TEL"]}
        else:
            res["profit"] = {"cur": cur_t["final"]["PFY"], "prev": prev_t["final"]["PFY"]}
        return res

    def _cash_flow(tenant, company, d, start, ys, basis):
        """One cash flow from `start` (exclusive) to `d`, for one basis."""
        agg = aggregate(tenant, company, d, start, ys, date(ys.year - 1, 1, 1), basis)
        bs = totals(agg, M.BS_LAYOUT, "cur")["final"], totals(agg, M.BS_LAYOUT, "prev")["final"]
        is_ = totals(agg, M.IS_LAYOUT, "cur")["final"]
        return M.cash_flow(bs[0], bs[1], is_, sum(agg["dep"]["cur"].values()))

    @app.get("/api/report/fs/cashflow")
    def fs_cashflow(tenant: int, company: str, year: int, month: int = Query(12, ge=1, le=12), basis: str = "final"):
        """Statement of cash flows (indirect method) for Jan 1 .. month end, with the same period last year."""
        check_basis(basis, company)
        d, d0 = month_end(year, month), date(year - 1, 12, 31)
        pd, pd0 = month_end(year - 1, month), date(year - 2, 12, 31)
        bases = ["ledger", "adjusted", "final"][: ["ledger", "adjusted", "final"].index(basis) + 1]
        cur = {b: _cash_flow(tenant, company, d, d0, date(year, 1, 1), b) for b in bases}
        prev = _cash_flow(tenant, company, pd, pd0, date(year - 1, 1, 1), basis)
        fin, chk = cur[basis]
        parts = {"ledger": cur["ledger"][0],
                 "adj": {k: cur["adjusted"][0][k] - cur["ledger"][0][k] for k in fin} if "adjusted" in cur else None,
                 "elim": {k: cur["final"][0][k] - cur["adjusted"][0][k] for k in fin} if "final" in cur else None}
        rows_ = []
        for row in M.CF_LAYOUT:
            k, code, label = row[0], row[1], row[2]
            item = {"kind": k, "code": code, "label": label}
            if k != "H":
                item["cur"], item["prev"] = fin[code], prev[0][code]
                item["parts"] = {c: (parts[c][code] if parts[c] else 0.0) for c in COMPS}
            rows_.append(item)
        heads = [f"{year}" if month == 12 else f"Jan–{d:%b} {year}", f"{year - 1}" if month == 12 else f"Jan–{d:%b} {year - 1}"]
        return {"kind": "CF", "headings": heads, "as_of": d.isoformat(), "rows": rows_, "basis": basis,
                "adj_summary": adjustments.summary(engine, tenant, company, d, date(year, 1, 1)),
                "check": {"cur": chk, "prev": prev[1]},
                "has_adjustments": any(abs(v) > 0.005 for r in rows_ for c, v in (r.get("parts") or {}).items() if c != "ledger")}

    @app.get("/api/report/fs/tb")
    def fs_tb(tenant: int, company: str, year: int, month: int = Query(12, ge=1, le=12)):
        """Trial balance laid out like the 'TB25 Dec' working: opening, debit, credit, closing + FS mapping."""
        d, ys = month_end(year, month), date(year, 1, 1)
        mp, names, _ = resolve(tenant, company)
        out, pl_open = [], 0.0
        for r in balances(tenant, company, d, date(year - 1, 12, 31), ys, date(year - 1, 1, 1)):
            acc = r["main_account"]
            e = line_of(acc, mp, names)
            opening, dr, cr = float(r["opening"] or 0), float(r["dr"] or 0), float(r["cr"] or 0)
            if M.statement_of(e["line"]) == "IS":       # P&L accounts start every year at zero
                pl_open += opening
                opening = 0.0
            closing = opening + dr - cr
            if not (opening or dr or cr):
                continue
            out.append({"main_account": acc, "account_name": names.get(acc, ""), "statement": M.statement_of(e["line"]),
                        "line_code": e["line"], "line": M.LABEL[e["line"]], "note": e["note"], "fsli": e["fsli"],
                        "source": e["source"], "opening": opening, "debit": dr, "credit": cr, "closing": closing})
        if abs(pl_open) >= 0.005:
            out.append({"main_account": "(P&L b/f)", "account_name": "Prior years' profit not closed to retained earnings",
                        "statement": "BS", "line_code": "RE", "line": M.LABEL["RE"], "note": "", "fsli": "",
                        "source": "Calculated", "opening": pl_open, "debit": 0.0, "credit": 0.0, "closing": pl_open})
        out.sort(key=lambda x: x["main_account"])
        return out

    @app.get("/api/report/fs/mapping")
    def fs_mapping(tenant: int, company: str = ALL):
        mp, names, assigned = resolve(tenant, company)
        accts = rows("""SELECT a.main_account, a.account_name, a.account_type, ISNULL(f.lines, 0) AS lines
                        FROM dw.dim_account a
                        LEFT JOIN (SELECT main_account, COUNT_BIG(*) AS lines FROM dw.fact_gl WHERE tenant_key=:t
                                   GROUP BY main_account) f ON f.main_account = a.main_account
                        WHERE a.tenant_key=:t AND ISNULL(a.account_type, '') NOT IN ('Reporting', 'Total', 'Header')
                        ORDER BY a.main_account""", t=tenant)
        out = []
        for a in accts:
            e = line_of(a["main_account"], mp, names)
            out.append({**a, "line_code": e["line"], "line": M.LABEL[e["line"]], "statement": M.statement_of(e["line"]),
                        "note": e["note"], "fsli": e["fsli"], "source": e["source"]})
        with engine().connect() as cn:
            sets = [dict(r._mapping) for r in cn.execute(text(
                "SELECT map_set, COUNT(*) AS accounts FROM rpt.fs_map WHERE tenant_key IS NULL GROUP BY map_set ORDER BY map_set"))]
            comp = [dict(r._mapping) for r in cn.execute(text(
                "SELECT company, map_set FROM rpt.fs_company WHERE tenant_key=:t"), {"t": tenant})]
        return {"accounts": out, "sets": sets, "companies": comp, "assigned": assigned}

    # ---------------------------------------------------------------- admin: change mapping ----
    class MapItem(BaseModel):
        main_account: str
        line_code: str = ""          # "" = remove the manual change (back to workbook / range)
        note_line: str = ""

    class MapIn(BaseModel):
        tenant: int
        items: list[MapItem]

    class SetIn(BaseModel):
        tenant: int
        company: str
        map_set: str = ""            # "" = automatic

    @app.put("/api/admin/fs/mapping", dependencies=admin)
    def fs_save_mapping(body: MapIn):
        bad = [i.line_code for i in body.items if i.line_code and i.line_code not in M.LABEL]
        if bad:
            raise HTTPException(400, f"Unknown statement line: {bad[0]}")
        with engine().begin() as cn:
            for i in body.items:
                cn.execute(text("DELETE FROM rpt.fs_map WHERE map_set='Manual' AND tenant_key=:t AND main_account=:a"),
                           {"t": body.tenant, "a": i.main_account})
                if i.line_code:
                    cn.execute(text("""INSERT INTO rpt.fs_map (map_set, tenant_key, main_account, note_line, line_code)
                                       VALUES ('Manual', :t, :a, NULLIF(:n, ''), :l)"""),
                               {"t": body.tenant, "a": i.main_account, "n": i.note_line.strip()[:160], "l": i.line_code})
        return {"ok": True, "saved": len(body.items)}

    @app.put("/api/admin/fs/company-set", dependencies=admin)
    def fs_company_set(body: SetIn):
        with engine().begin() as cn:
            cn.execute(text("DELETE FROM rpt.fs_company WHERE tenant_key=:t AND company=:c"), {"t": body.tenant, "c": body.company})
            if body.map_set:
                cn.execute(text("INSERT INTO rpt.fs_company (tenant_key, company, map_set) VALUES (:t, :c, :s)"),
                           {"t": body.tenant, "c": body.company, "s": body.map_set})
        return {"ok": True}

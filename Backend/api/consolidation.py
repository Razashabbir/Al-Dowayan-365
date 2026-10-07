"""Consolidation (Close › Consolidation): intercompany matching, currency translation and the group pack.

* Setup: functional currency, ownership % and include flag per company (cons.company); exchange rates per
  currency and month (cons.fx_rate: closing and year-to-date average, 1 unit = x group currency); intercompany
  accounts with their counterparty (cons.ic_account). Group currency = the currency in System Configuration.
* Matching: for every pair of companies, A's intercompany balances with B plus B's with A should net to zero
  (receivable vs payable, revenue vs cost). Matched pairs can be turned into draft Elimination entries.
* Group pack: each company's income statement and financial position (D365 + posted adjustments), translated
  (P&L at average rate, balance sheet at closing rate), posted eliminations, group total, translation difference
  and non-controlling interests.
"""
from datetime import date

from fastapi import HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

import fs_model as M
import security
from modlib import MONTHS, call, month_end, num

IC_WORDS = ["due from", "due to", "related part", "intercompany", "inter-company", "inter company", "group compan",
            "subsidiar", "parent", "affiliate", "sister", "أطراف ذات علاقة", "مستحق من", "مستحق إلى"]


class CompanyCfg(BaseModel):
    company: str
    currency: str = Field(min_length=3, max_length=3)
    ownership: float = Field(100, ge=0, le=100)
    include: bool = True


class CompaniesIn(BaseModel):
    tenant_key: int
    items: list[CompanyCfg]


class RateIn(BaseModel):
    currency: str = Field(min_length=3, max_length=3)
    year: int
    month: int = Field(ge=1, le=12)
    closing: float = Field(gt=0)
    average: float = Field(gt=0)


class IcIn(BaseModel):
    company: str
    main_account: str
    counterparty: str
    kind: str = Field("Balance", pattern="^(Balance|PL)$")


class IcListIn(BaseModel):
    tenant_key: int
    items: list[IcIn]


class ElimIn(BaseModel):
    tenant_key: int
    year: int
    month: int = Field(ge=1, le=12)


def register(app, engine, rows, settings, ops, store):
    def group_ccy():
        return (settings.all().get("currency") or "SAR").upper()

    def visible_companies(tenant):
        u = security.current_user()
        cos = call(app, "/api/report/companies-all")
        return [c for c in cos if c["tenant_key"] == tenant and security.can_see(u, tenant, c["company"])]

    def cfg(tenant):
        with engine().connect() as cn:
            comp = {r["company"]: dict(r) for r in cn.execute(text("SELECT company, currency, ownership, include FROM cons.company WHERE tenant_key=:t"),
                                                               {"t": tenant}).mappings()}
            ic = [dict(r) for r in cn.execute(text("SELECT company, main_account, counterparty, kind FROM cons.ic_account WHERE tenant_key=:t ORDER BY company, main_account"),
                                              {"t": tenant}).mappings()]
        return comp, ic

    def rate(cn, ccy, y, m, which):
        if ccy == group_ccy():
            return 1.0, True
        r = cn.execute(text(f"SELECT TOP 1 {which} FROM cons.fx_rate WHERE currency=:c AND ([year] < :y OR ([year] = :y AND [month] <= :m)) "
                            "ORDER BY [year] DESC, [month] DESC"), {"c": ccy, "y": y, "m": m}).scalar()
        return (num(r), True) if r else (1.0, False)

    @app.get("/api/admin/consol/setup")
    def setup(tenant: int):
        comp, ic = cfg(tenant)
        cos = visible_companies(tenant)
        g = group_ccy()
        items = [{"company": c["company"], "name": c.get("name"), "currency": (comp.get(c["company"]) or {}).get("currency") or g,
                  "ownership": num((comp.get(c["company"]) or {}).get("ownership", 100)), "include": bool((comp.get(c["company"]) or {}).get("include", True))}
                 for c in cos]
        with engine().connect() as cn:
            rates = [dict(r) for r in cn.execute(text("SELECT currency, [year], [month], closing, average FROM cons.fx_rate ORDER BY currency, [year] DESC, [month] DESC")).mappings()]
        return {"group_currency": g, "companies": items, "ic_accounts": ic, "rates": [{**r, "closing": num(r["closing"]), "average": num(r["average"])} for r in rates],
                "tolerance": num(ops.get("ic_tolerance") or 1)}

    @app.put("/api/admin/consol/companies")
    def save_companies(body: CompaniesIn):
        with engine().begin() as cn:
            for i in body.items:
                if not security.can_see(security.current_user(), body.tenant_key, i.company):
                    continue
                p = {"t": body.tenant_key, "c": i.company.lower(), "cu": i.currency.upper(), "o": i.ownership, "in": i.include}
                if not cn.execute(text("UPDATE cons.company SET currency=:cu, ownership=:o, include=:in WHERE tenant_key=:t AND company=:c"), p).rowcount:
                    cn.execute(text("INSERT INTO cons.company (tenant_key, company, currency, ownership, include) VALUES (:t, :c, :cu, :o, :in)"), p)
        store.write(security.current_user(), "consol.companies", ", ".join(f"{i.company}:{i.currency}/{i.ownership:g}%" for i in body.items)[:900])
        return setup(body.tenant_key)

    @app.put("/api/admin/consol/rates")
    def save_rates(items: list[RateIn]):
        with engine().begin() as cn:
            for r in items:
                p = {"c": r.currency.upper(), "y": r.year, "m": r.month, "cl": r.closing, "av": r.average}
                if not cn.execute(text("UPDATE cons.fx_rate SET closing=:cl, average=:av WHERE currency=:c AND [year]=:y AND [month]=:m"), p).rowcount:
                    cn.execute(text("INSERT INTO cons.fx_rate (currency, [year], [month], closing, average) VALUES (:c, :y, :m, :cl, :av)"), p)
        store.write(security.current_user(), "consol.rates", f"{len(items)} rate(s)")
        return {"ok": True}

    @app.delete("/api/admin/consol/rates/{currency}/{year}/{month}")
    def delete_rate(currency: str, year: int, month: int):
        with engine().begin() as cn:
            cn.execute(text("DELETE FROM cons.fx_rate WHERE currency=:c AND [year]=:y AND [month]=:m"), {"c": currency.upper(), "y": year, "m": month})
        return {"ok": True}

    @app.put("/api/admin/consol/ic-accounts")
    def save_ic(body: IcListIn):
        u = security.current_user()
        with engine().begin() as cn:
            mine = [c["company"] for c in visible_companies(body.tenant_key)]
            for c in mine:
                cn.execute(text("DELETE FROM cons.ic_account WHERE tenant_key=:t AND company=:c"), {"t": body.tenant_key, "c": c})
            for i in body.items:
                if i.company.lower() == i.counterparty.lower():
                    raise HTTPException(400, f"{i.main_account}: the counterparty must be another company.")
                if i.company.lower() not in mine:
                    continue
                cn.execute(text("INSERT INTO cons.ic_account (tenant_key, company, main_account, counterparty, kind) VALUES (:t, :c, :a, :cp, :k)"),
                           {"t": body.tenant_key, "c": i.company.lower(), "a": i.main_account, "cp": i.counterparty.lower(), "k": i.kind})
        store.write(u, "consol.ic_accounts", f"{len(body.items)} intercompany account(s)")
        return {"ok": True}

    @app.get("/api/admin/consol/suggest")
    def suggest(tenant: int, year: int, month: int = Query(12, ge=1, le=12)):
        """Accounts whose name looks intercompany (due from / due to / related parties ...), with balances per company."""
        like = " OR ".join(f"LOWER(a.account_name) LIKE N'%{w}%'" for w in IC_WORDS)
        data = rows(f"""SELECT f.company, f.main_account, MAX(a.account_name) AS account_name, MAX(a.pl_group) AS pl_group,
                               SUM(f.amount) AS balance
                        FROM dw.fact_gl f JOIN dw.dim_account a ON a.tenant_key=f.tenant_key AND a.main_account=f.main_account
                        WHERE f.tenant_key=:t AND f.is_close=0 AND f.accounting_date <= :d AND ({like})
                        GROUP BY f.company, f.main_account HAVING ABS(SUM(f.amount)) > 0.5 ORDER BY f.company, f.main_account""",
                    t=tenant, d=month_end(year, month))
        return [{**r, "balance": num(r["balance"]), "kind": "PL" if r["pl_group"] in ("Revenue", "Expense") else "Balance"} for r in data]

    def ic_balances(tenant, y, m, ic):
        if not ic:
            return {}
        accts = sorted({i["main_account"] for i in ic})
        params = {f"a{n}": a for n, a in enumerate(accts)}
        inn = ",".join(f":a{n}" for n in range(len(accts)))
        data = rows(f"""SELECT f.company, f.main_account,
                               SUM(CASE WHEN f.accounting_date <= :d THEN f.amount ELSE 0 END) AS bal,
                               SUM(CASE WHEN f.accounting_date BETWEEN :ys AND :d THEN f.amount ELSE 0 END) AS ytd
                        FROM dw.fact_gl f WHERE f.tenant_key=:t AND f.is_close=0 AND f.main_account IN ({inn})
                        GROUP BY f.company, f.main_account""", t=tenant, d=month_end(y, m), ys=date(y, 1, 1), **params)
        return {(r["company"].lower(), r["main_account"]): (num(r["bal"]), num(r["ytd"])) for r in data}

    @app.get("/api/admin/consol/matching")
    def matching(tenant: int, year: int, month: int = Query(12, ge=1, le=12)):
        comp, ic = cfg(tenant)
        bal = ic_balances(tenant, year, month, ic)
        tol = num(ops.get("ic_tolerance") or 1)
        seen = {c["company"] for c in visible_companies(tenant)}
        pairs = {}
        for i in ic:
            a, b = i["company"].lower(), i["counterparty"].lower()
            key = (min(a, b), max(a, b), i["kind"])
            v = bal.get((a, i["main_account"]), (0.0, 0.0))[0 if i["kind"] == "Balance" else 1]
            p = pairs.setdefault(key, {"a": key[0], "b": key[1], "kind": i["kind"], "a_amount": 0.0, "b_amount": 0.0, "lines": []})
            p["a_amount" if a == key[0] else "b_amount"] += v
            p["lines"].append({"company": a, "main_account": i["main_account"], "counterparty": b, "amount": v})
        out = []
        for p in pairs.values():
            diff = p["a_amount"] + p["b_amount"]
            hidden = [c for c in (p["a"], p["b"]) if c not in seen]
            p.update(difference=diff, status="Hidden" if hidden else ("Matched" if abs(diff) <= tol else "Difference"),
                     note=f"no access to {', '.join(h.upper() for h in hidden)}" if hidden else None)
            out.append(p)
        out.sort(key=lambda p: (p["status"] == "Matched", -abs(p["difference"])))
        return {"pairs": out, "tolerance": tol, "as_of": month_end(year, month).isoformat(),
                "matched": sum(1 for p in out if p["status"] == "Matched"), "differences": sum(1 for p in out if p["status"] == "Difference"),
                "configured": bool(ic)}

    @app.post("/api/admin/consol/eliminate")
    def eliminate(body: ElimIn):
        """Draft Elimination entries for every matched pair (reference IC-AUTO ...); existing ones are not duplicated."""
        from period_close import lock_message, locked
        m = matching(body.tenant_key, body.year, body.month)
        d = month_end(body.year, body.month)
        made, skipped = [], []
        u = security.current_user()
        with engine().begin() as cn:
            for p in m["pairs"]:
                ref = f"IC-AUTO {p['a'].upper()}-{p['b'].upper()} {p['kind']} {body.year}-{body.month:02d}"
                if p["status"] != "Matched":
                    skipped.append(f"{p['a'].upper()}↔{p['b'].upper()} ({p['kind']}): {p['status'].lower()}")
                    continue
                if cn.execute(text("SELECT 1 FROM adj.entry WHERE tenant_key=:t AND reference=:r"), {"t": body.tenant_key, "r": ref}).first():
                    skipped.append(f"{ref}: already exists")
                    continue
                if locked(cn, body.tenant_key, [p["a"], p["b"]], d):
                    skipped.append(lock_message(locked(cn, body.tenant_key, [p["a"], p["b"]], d), d))
                    continue
                lines = [l for l in p["lines"] if abs(l["amount"]) >= 0.005]
                if not lines:
                    continue
                diff = round(sum(l["amount"] for l in lines), 2)
                eid = cn.execute(text("""INSERT adj.entry (tenant_key, entry_type, entry_date, description, reference, created_by)
                                         OUTPUT inserted.entry_id VALUES (:t, 'Elimination', :d, :ds, :r, :u)"""),
                                 {"t": body.tenant_key, "d": d, "r": ref, "u": u and u["username"],
                                  "ds": f"Intercompany {'balances' if p['kind'] == 'Balance' else 'revenue / costs'} {p['a'].upper()} ↔ {p['b'].upper()} {MONTHS[body.month - 1]} {body.year} (proposed)"}).scalar()
                for n, l in enumerate(lines, start=1):
                    amt = l["amount"] - (diff if n == 1 else 0)          # rounding difference (within tolerance) on the first line
                    cn.execute(text("""INSERT adj.line (entry_id, line_no, company, main_account, line_code, debit, credit, memo)
                                       VALUES (:e, :n, :c, :a, NULL, :dr, :cr, :m)"""),
                               {"e": eid, "n": n, "c": l["company"], "a": l["main_account"], "dr": round(-amt, 2) if amt < 0 else 0,
                                "cr": round(amt, 2) if amt > 0 else 0, "m": f"Eliminate {l['company'].upper()} with {l['counterparty'].upper()}"})
                made.append({"entry_id": eid, "reference": ref})
        store.write(u, "consol.eliminate", f"{len(made)} draft elimination(s) for {MONTHS[body.month - 1]} {body.year}")
        return {"created": made, "skipped": skipped}

    @app.get("/api/admin/consol/pack")
    def pack(tenant: int, year: int, month: int = Query(12, ge=1, le=12)):
        comp, _ = cfg(tenant)
        cos = [c for c in visible_companies(tenant) if (comp.get(c["company"]) or {}).get("include", True)]
        if not cos:
            raise HTTPException(400, "No companies to consolidate - check Setup.")
        g = group_ccy()
        cols, warn = [], []
        with engine().connect() as cn:
            for c in cos:
                cc = comp.get(c["company"]) or {}
                ccy = (cc.get("currency") or g).upper()
                cl, ok1 = rate(cn, ccy, year, month, "closing")
                av, ok2 = rate(cn, ccy, year, month, "average")
                if not (ok1 and ok2):
                    warn.append(f"No {ccy} rate for {MONTHS[month - 1]} {year} - {c['company'].upper()} is shown untranslated (rate 1).")
                cols.append({"company": c["company"], "name": c.get("name"), "currency": ccy, "closing": cl, "average": av,
                             "ownership": num(cc.get("ownership", 100))})
        stm = {}
        for col in cols:
            for kind in ("IS", "BS"):
                d = call(app, "/api/report/fs/statement", tenant=tenant, company=col["company"], year=year, kind=kind, month=month, basis="adjusted")
                stm[(col["company"], kind)] = {r["code"]: r for r in d["rows"]}
                heads = d["headings"]
                if kind == "BS" and abs(num(d.get("check", {}).get("cur"))) > 1:
                    warn.append(f"{col['company'].upper()} financial position is out of balance by {num(d['check']['cur']):,.0f} before consolidation.")
        u = security.current_user() or {}
        with engine().connect() as cn:                      # every company of the tenant (no row-level filter here)
            every = {r[0].lower() for r in cn.execute(text("SELECT DISTINCT company FROM dw.fact_gl WHERE tenant_key=:t"), {"t": tenant})}
        all_cos = bool(u.get("all_companies")) or every <= {c["company"] for c in visible_companies(tenant)}
        elim = {}
        if all_cos:
            for kind in ("IS", "BS"):
                d = call(app, "/api/report/fs/statement", tenant=tenant, company="*", year=year, kind=kind, month=month, basis="final")
                elim[kind] = {r["code"]: num((r.get("parts") or {}).get("elim")) for r in d["rows"] if r["kind"] != "H"}
        else:
            warn.append("Eliminations are shown only when you can see every included company.")

        def build(kind, layout):
            out = []
            for k, code, label, *_ in layout:
                if k == "H":
                    out.append({"kind": "H", "code": code, "label": label})
                    continue
                vals = []
                for col in cols:
                    r = stm[(col["company"], kind)].get(code)
                    v = num(r.get("cur")) if r else 0.0
                    vals.append(v * (col["average"] if kind == "IS" else col["closing"]))
                e = (elim.get(kind) or {}).get(code, 0.0)
                tot = sum(vals) + e
                if k == "L" and code.endswith("_OTH") and abs(tot) < 0.5 and not any(abs(v) > 0.5 for v in vals):
                    continue
                out.append({"kind": k, "code": code, "label": label, "values": vals, "elim": e, "group": tot})
            return out
        is_rows, bs_rows = build("IS", M.IS_LAYOUT), build("BS", M.BS_LAYOUT)
        val = lambda rows_, code: next((r["group"] for r in rows_ if r.get("code") == code), 0.0)  # noqa: E731
        # translation difference: profit at average rate in the P&L vs closing rate in the balance sheet
        ctd = sum(num((stm[(c["company"], "IS")].get("PFY") or {}).get("cur")) * (c["closing"] - c["average"]) for c in cols)
        nci_profit = sum(num((stm[(c["company"], "IS")].get("PFY") or {}).get("cur")) * c["average"] * (1 - c["ownership"] / 100) for c in cols)
        nci_equity = sum(num((stm[(c["company"], "BS")].get("TOT_EQ") or {}).get("cur")) * c["closing"] * (1 - c["ownership"] / 100) for c in cols)
        pfy = val(is_rows, "PFY")
        return {"group_currency": g, "headings": heads, "as_of": month_end(year, month).isoformat(), "companies": cols,
                "income_statement": is_rows, "financial_position": bs_rows, "warnings": warn,
                "translation_difference": ctd, "check": val(bs_rows, "TA") - val(bs_rows, "TEL"),
                "profit": {"group": pfy, "owners": pfy - nci_profit, "nci": nci_profit},
                "equity": {"group": val(bs_rows, "TOT_EQ"), "owners": val(bs_rows, "TOT_EQ") - nci_equity, "nci": nci_equity},
                "ic": matching(tenant, year, month)}

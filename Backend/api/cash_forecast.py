"""Cash Flow Forecast (Reports › Cash Flow Forecast): a rolling weekly forecast of the bank balance.

Opening cash   = ledger balance today of the asset accounts named bank / cash (a "Bank loan" liability is not cash).
Collections    = open customer items (stg.cust_open_trans, see ageing.py) on their due date + a delay.
Payments       = open vendor items (stg.vend_open_trans) on their due date + a delay.
Items are netted per customer / vendor first: payments and credit notes not yet settled against invoices in D365
are applied to the oldest invoices (FIFO), so only the newest invoices of the net balance remain to be paid.
Other items    = cash items users add per company (payroll, rent, loans, VAT, capex ...), once / weekly / monthly.
Overdue items are spread over the first weeks; receivables overdue longer than the doubtful limit are left out.
Assumptions are saved per company (cff.setting); the page can try other values without saving them.
"""
import calendar
from datetime import date, timedelta

from fastapi import HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text

import ageing
import security
from modlib import as_date, clean, need_company, num

DEFAULTS = {"ar_delay_days": 0, "ap_delay_days": 0, "ar_collect_pct": 100.0, "ar_doubtful_days": 90,
            "overdue_weeks": 4, "default_terms": 30, "min_cash": 0.0}
CATEGORIES = ["Payroll", "Rent", "Loan", "Tax & Zakat", "Capex", "Customer receipt", "Supplier payment", "Other"]
SUGGEST = {   # ledger expense accounts whose names look like regular cash costs -> proposed monthly item
    "Payroll": {"day": 27, "like": ["%salar%", "%wage%", "%payroll%", "%gosi%", "%رواتب%", "%أجور%"]},
    "Rent": {"day": 1, "like": ["%rent%", "%lease%", "%إيجار%"]},
}


class SettingsIn(BaseModel):
    tenant_key: int
    company: str = Field(min_length=1, max_length=10)
    ar_delay_days: int = Field(0, ge=-60, le=365)
    ap_delay_days: int = Field(0, ge=-60, le=365)
    ar_collect_pct: float = Field(100, ge=0, le=100)
    ar_doubtful_days: int = Field(90, ge=0, le=3650)
    overdue_weeks: int = Field(4, ge=1, le=13)
    default_terms: int = Field(30, ge=0, le=365)
    min_cash: float = 0


class ItemIn(BaseModel):
    tenant_key: int
    company: str = Field(min_length=1, max_length=10)
    name: str = Field(min_length=1, max_length=100)
    category: str = Field("Other", max_length=40)
    direction: str = Field(pattern="^(in|out)$")
    amount: float = Field(gt=0)
    frequency: str = Field(pattern="^(once|weekly|monthly)$")
    start_date: date
    end_date: date | None = None
    note: str | None = Field(None, max_length=300)

    @model_validator(mode="after")
    def _dates(self):
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("The end date is before the start date.")
        return self


def _occurrences(it, first: date, last: date):
    """Dates of a cash item between first and last (inclusive)."""
    start, end = it["start_date"], it["end_date"] or last
    end = min(end, last)
    if it["frequency"] == "once":
        return [start] if first <= start <= last else []
    if it["frequency"] == "weekly":
        d = start
        if d < first:
            d += timedelta(days=-(-(first - d).days // 7) * 7)      # first occurrence on or after `first`
        out = []
        while d <= end:
            out.append(d)
            d += timedelta(days=7)
        return out
    out, y, m = [], max(start, first).year, max(start, first).month
    while True:
        d = date(y, m, min(start.day, calendar.monthrange(y, m)[1]))
        if d > end:
            return out
        if d >= start and d >= first:
            out.append(d)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def _net_fifo(items):
    """Net each account's open items. A positive balance stays on its newest invoices (older ones are taken as paid
    by the unsettled payments / credit notes); a zero or negative balance (advance, overpayment) leaves nothing to forecast."""
    by, out, stats = {}, [], {"netted": 0.0, "advances": 0.0, "accounts": 0}
    for it in items or []:
        by.setdefault(it["account"], []).append(it)
    for lst in by.values():
        bal = sum(x["amount"] for x in lst)
        gross = sum(x["amount"] for x in lst if x["amount"] > 0)
        if bal <= 0.005:
            stats["advances"] += -bal
            stats["netted"] += gross
            continue
        stats["accounts"] += 1
        stats["netted"] += gross - bal
        inv = sorted((x for x in lst if x["amount"] > 0), key=lambda x: x["due"] or x["trans_date"] or date.min, reverse=True)
        left = bal
        for x in inv:
            if left <= 0.005:
                break
            take = min(x["amount"], left)
            out.append({**x, "amount": take})
            left -= take
    return out, stats


def register(app, engine, rows, from_gl, cash_names):
    def _settings(cn, tenant, company):
        r = cn.execute(text("SELECT * FROM cff.setting WHERE tenant_key = :t AND company = :c"),
                       {"t": tenant, "c": company.lower()}).mappings().first()
        out = dict(DEFAULTS)
        if r:
            out.update({k: (num(r[k]) if isinstance(DEFAULTS[k], float) else int(r[k])) for k in DEFAULTS})
            out.update(updated_by=r["updated_by"], updated_at=r["updated_at"])
        return out

    def _items(cn, tenant, company):
        return [dict(r) for r in cn.execute(text("""SELECT item_id, name, category, direction, amount, frequency, start_date, end_date,
                                                           note, created_by, created_at
                                                    FROM cff.item WHERE tenant_key = :t AND company = :c
                                                    ORDER BY direction DESC, start_date, name"""),
                                            {"t": tenant, "c": company.lower()}).mappings()]

    def _item_company(cn, item_id):
        r = cn.execute(text("SELECT tenant_key, company FROM cff.item WHERE item_id = :i"), {"i": item_id}).mappings().first()
        if not r:
            raise HTTPException(404, "Cash item not found.")
        need_company(r["tenant_key"], r["company"])

    @app.get("/api/report/cash-forecast")
    def forecast(tenant: int, company: str, weeks: int = Query(13, ge=4, le=26),
                 ar_delay_days: int | None = Query(None, ge=-60, le=365), ap_delay_days: int | None = Query(None, ge=-60, le=365),
                 ar_collect_pct: float | None = Query(None, ge=0, le=100), ar_doubtful_days: int | None = Query(None, ge=0, le=3650),
                 overdue_weeks: int | None = Query(None, ge=1, le=13), default_terms: int | None = Query(None, ge=0, le=365),
                 min_cash: float | None = None):
        """Weekly forecast from today. Assumption parameters override the saved ones (what-if, nothing is saved)."""
        need_company(tenant, company)
        as_of = date.today()
        horizon = as_of + timedelta(days=7 * weeks - 1)
        with engine().connect() as cn:
            saved = _settings(cn, tenant, company)
            ar_raw = ageing.open_items(cn, "customer", tenant, company, as_of)
            ap_raw = ageing.open_items(cn, "vendor", tenant, company, as_of)
            items = _items(cn, tenant, company)
        given = {"ar_delay_days": ar_delay_days, "ap_delay_days": ap_delay_days, "ar_collect_pct": ar_collect_pct,
                 "ar_doubtful_days": ar_doubtful_days, "overdue_weeks": overdue_weeks, "default_terms": default_terms, "min_cash": min_cash}
        s = {k: (saved[k] if given[k] is None else given[k]) for k in DEFAULTS}
        what_if = any(v is not None and v != saved[k] for k, v in given.items())
        ow = min(s["overdue_weeks"], weeks)
        ar, ar_net = _net_fifo(ar_raw)
        ap, ap_net = _net_fifo(ap_raw)

        cash = rows(f"""SELECT a.main_account, MAX(a.account_name) AS account_name, SUM(f.amount) AS balance
                        {from_gl} AND a.bs_group = 'Asset' AND a.pl_group NOT IN ('Revenue', 'Expense', 'OCI') AND {cash_names} AND f.accounting_date <= :d
                        GROUP BY a.main_account HAVING ABS(SUM(f.amount)) >= 0.005 ORDER BY a.main_account""",
                    t=tenant, c=company, d=as_of)
        gl_last = rows(f"SELECT MAX(f.accounting_date) AS d {from_gl}", t=tenant, c=company)[0]["d"]
        opening = sum(num(r["balance"]) for r in cash)

        W = [{"n": i + 1, "start": as_of + timedelta(days=7 * i), "end": as_of + timedelta(days=7 * i + 6),
              "ar_in": 0.0, "ap_out": 0.0, "other_in": 0.0, "other_out": 0.0} for i in range(weeks)]
        detail = [{} for _ in range(weeks)]                    # week -> (kind, label) -> amount
        off = {"ar_doubtful": 0.0, "ar_uncollected": 0.0, "ar_beyond": 0.0, "ap_beyond": 0.0}

        def put(i, field, kind, label, v):
            W[i][field] += v
            k = (kind, label)
            detail[i][k] = detail[i].get(k, 0.0) + v

        def spread(side, lst, delay, field, kind):
            for it in lst or []:
                base = it["due"] or (it["trans_date"] + timedelta(days=s["default_terms"]) if it["trans_date"] else as_of)
                v = it["amount"]
                if side == "customer":
                    keep = v * s["ar_collect_pct"] / 100
                    off["ar_uncollected"] += v - keep
                    v = keep
                label = f"{it['account']} {it['name']}".strip()
                exp = base + timedelta(days=delay)
                if exp < as_of:                                   # overdue: spread over the first weeks
                    if side == "customer" and (as_of - base).days > s["ar_doubtful_days"]:
                        off["ar_doubtful"] += v
                        continue
                    for i in range(ow):
                        put(i, field, kind, label, v / ow)
                elif exp > horizon:
                    off["ar_beyond" if side == "customer" else "ap_beyond"] += v
                else:
                    put((exp - as_of).days // 7, field, kind, label, v)

        spread("customer", ar, s["ar_delay_days"], "ar_in", "ar")
        spread("vendor", ap, s["ap_delay_days"], "ap_out", "ap")
        for it in items:
            it["start_date"], it["end_date"] = as_date(it["start_date"]), as_date(it["end_date"])
            for d in _occurrences(it, as_of, horizon):
                i = (d - as_of).days // 7
                put(i, "other_in" if it["direction"] == "in" else "other_out", it["direction"], it["name"], num(it["amount"]))

        run, lowest, first_below = opening, None, None
        for i, w in enumerate(W):
            w["opening"] = run
            w["net"] = w["ar_in"] + w["other_in"] - w["ap_out"] - w["other_out"]
            run += w["net"]
            w["closing"] = run
            w["below_min"] = run < s["min_cash"]
            if lowest is None or run < lowest["closing"]:
                lowest = {"week": w["n"], "start": w["start"], "closing": run}
            if w["below_min"] and first_below is None:
                first_below = w["n"]
            top = sorted(detail[i].items(), key=lambda kv: -abs(kv[1]))
            w["lines"] = [{"kind": k, "label": lbl, "amount": v} for (k, lbl), v in top[:15] if abs(v) >= 0.5]
            w["more_lines"] = max(0, len(top) - 15)

        tot = {k: sum(w[k] for w in W) for k in ("ar_in", "ap_out", "other_in", "other_out", "net")}
        src = lambda raw, lst, net, side: {"loaded": raw is not None, "items": len(raw or []), "open_items": len(lst),  # noqa: E731
                                           "table": f"stg.{ageing.SIDES[side]['table']}", "open": sum(x["amount"] for x in lst), **net}
        return clean({"as_of": as_of, "horizon": horizon, "weeks": W, "opening": opening, "closing": run,
                      "cash_accounts": cash, "gl_last_date": gl_last, "totals": tot, "left_out": off,
                      "lowest": lowest, "first_below": first_below, "settings": s, "saved_settings": saved, "what_if": what_if,
                      "sources": {"ar": src(ar_raw, ar, ar_net, "customer"), "ap": src(ap_raw, ap, ap_net, "vendor")}, "items": len(items)})

    @app.get("/api/report/cash-forecast/items")
    def list_items(tenant: int, company: str):
        need_company(tenant, company)
        with engine().connect() as cn:
            return clean({"items": _items(cn, tenant, company), "categories": CATEGORIES})

    @app.get("/api/report/cash-forecast/suggest")
    def suggest(tenant: int, company: str):
        """Monthly items proposed from the last three full months of salary and rent postings in the ledger."""
        need_company(tenant, company)
        today = date.today()
        end = today.replace(day=1) - timedelta(days=1)
        start = (end.replace(day=1) - timedelta(days=62)).replace(day=1)
        months = (end.year - start.year) * 12 + end.month - start.month + 1
        out = []
        for cat, cfg in SUGGEST.items():
            like = " OR ".join(f"a.account_name LIKE N'{p}'" for p in cfg["like"])
            accts = rows(f"""SELECT f.main_account, MAX(a.account_name) AS account_name, SUM(f.amount) AS amount
                             {from_gl} AND a.pl_group = 'Expense' AND ({like}) AND f.accounting_date BETWEEN :s AND :e
                             GROUP BY f.main_account HAVING SUM(f.amount) > 0 ORDER BY SUM(f.amount) DESC""",
                         t=tenant, c=company, s=start, e=end)
            total = sum(num(r["amount"]) for r in accts)
            if total < 1:
                continue
            nxt = today.replace(day=min(cfg["day"], calendar.monthrange(today.year, today.month)[1]))
            if nxt < today:
                y, m = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
                nxt = date(y, m, min(cfg["day"], calendar.monthrange(y, m)[1]))
            out.append({"name": f"{cat} (average {start:%b}–{end:%b %Y})", "category": cat, "direction": "out",
                        "amount": round(total / months, 2), "frequency": "monthly", "start_date": nxt,
                        "accounts": [{"main_account": r["main_account"], "account_name": r["account_name"], "monthly": num(r["amount"]) / months}
                                     for r in accts[:10]]})
        return clean({"from": start, "to": end, "suggestions": out})

    @app.put("/api/admin/cash-forecast/settings")
    def save_settings(body: SettingsIn):
        need_company(body.tenant_key, body.company)
        u = security.current_user()
        p = body.model_dump()
        p.update(company=body.company.lower(), updated_by=u and u["username"])
        sets = ", ".join(f"{k} = :{k}" for k in DEFAULTS)
        with engine().begin() as cn:
            if not cn.execute(text(f"""UPDATE cff.setting SET {sets}, updated_by = :updated_by, updated_at = SYSUTCDATETIME()
                                       WHERE tenant_key = :tenant_key AND company = :company"""), p).rowcount:
                cn.execute(text(f"""INSERT INTO cff.setting (tenant_key, company, {', '.join(DEFAULTS)}, updated_by)
                                    VALUES (:tenant_key, :company, {', '.join(':' + k for k in DEFAULTS)}, :updated_by)"""), p)
        return {"ok": True}

    @app.post("/api/admin/cash-forecast/items")
    def add_item(body: ItemIn):
        need_company(body.tenant_key, body.company)
        u = security.current_user()
        p = body.model_dump()
        p.update(company=body.company.lower(), name=body.name.strip(), created_by=u and u["username"])
        with engine().begin() as cn:
            iid = cn.execute(text("""INSERT INTO cff.item (tenant_key, company, name, category, direction, amount, frequency,
                                                           start_date, end_date, note, created_by)
                                     OUTPUT inserted.item_id
                                     VALUES (:tenant_key, :company, :name, :category, :direction, :amount, :frequency,
                                             :start_date, :end_date, :note, :created_by)"""), p).scalar()
        return {"ok": True, "item_id": iid}

    @app.put("/api/admin/cash-forecast/items/{item_id}")
    def edit_item(item_id: int, body: ItemIn):
        need_company(body.tenant_key, body.company)
        p = body.model_dump()
        p.update(company=body.company.lower(), name=body.name.strip(), i=item_id)
        with engine().begin() as cn:
            _item_company(cn, item_id)
            cn.execute(text("""UPDATE cff.item SET tenant_key = :tenant_key, company = :company, name = :name, category = :category,
                                      direction = :direction, amount = :amount, frequency = :frequency, start_date = :start_date,
                                      end_date = :end_date, note = :note
                               WHERE item_id = :i"""), p)
        return {"ok": True}

    @app.delete("/api/admin/cash-forecast/items/{item_id}")
    def delete_item(item_id: int):
        with engine().begin() as cn:
            _item_company(cn, item_id)
            cn.execute(text("DELETE FROM cff.item WHERE item_id = :i"), {"i": item_id})
        return {"ok": True}

"""Customer and vendor ageing (Reports › Customer & Vendor Ageing).

Needs the D365 open-transaction tables, loaded by ETL into stg.cust_open_trans and stg.vend_open_trans
(the page offers the D365 entities found in the catalogue and loads them). Columns are detected by name, so
different D365 entity versions work. Buckets: not yet due, 0-30, 31-60, 61-90, 90+ days past due
(or days since the invoice date when the entity has no due date / when "by invoice date" is chosen).
"""
from datetime import date, datetime

from fastapi import HTTPException, Query
from sqlalchemy import text

from modlib import columns, month_end, need_company, num, pick

SIDES = {
    "customer": {"table": "cust_open_trans", "master": "customers", "hints": ["CustTransOpen", "CustomerOpenTrans", "CustTrans", "CustomerTrans", "CustomerOpen"]},
    "vendor": {"table": "vend_open_trans", "master": "vendors", "hints": ["VendTransOpen", "VendorOpenTrans", "VendTrans", "VendorTrans", "VendorOpen"]},
}
BUCKETS = ["Not due", "0-30", "31-60", "61-90", "90+"]


def _as_date(v):
    if v is None or isinstance(v, date) and not isinstance(v, datetime):
        return v
    if isinstance(v, datetime):
        return v.date()
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _bucket(days):
    if days is None or days < 0:
        return 0
    return 1 if days <= 30 else 2 if days <= 60 else 3 if days <= 90 else 4


def _layout(cn, side):
    cfg = SIDES[side]
    cols = columns(cn, "stg", cfg["table"])
    if not cols:
        return None
    lay = {
        "account": pick(cols, "AccountNum", "CustomerAccount", "VendorAccount", "CustAccount", "VendAccount", "CustomerAccountNumber",
                        "VendorAccountNumber", "AccountNumber", "OrderAccount", "InvoiceAccount"),
        "company": pick(cols, "dataAreaId", "DataAreaId", "Company", "LegalEntity"),
        "amount": pick(cols, "AmountMST", "AmountInAccountingCurrency", "AccountingCurrencyAmount", "RemainAmountMST",
                       "RemainingAmountMST", "AmountCur", "TransactionAmount", "Amount"),
        "settled": pick(cols, "SettleAmountMST", "SettledAmountMST", "SettleAmount"),
        "due": pick(cols, "DueDate", "DueDateDate", "PaymentDueDate"),
        "date": pick(cols, "TransDate", "TransactionDate", "DocumentDate", "InvoiceDate", "AccountingDate"),
        "invoice": pick(cols, "Invoice", "InvoiceId", "InvoiceNumber", "DocumentNum", "Voucher"),
        "currency": pick(cols, "CurrencyCode", "Currency"),
        "tenant": pick(cols, "_tenant_key"),
    }
    lay["cols"] = cols
    return lay


def _names(cn, side, tenant):
    cfg = SIDES[side]
    cols = columns(cn, "stg", cfg["master"])
    if not cols:
        return {}
    k = pick(cols, "CustomerAccount", "VendorAccountNumber", "AccountNum", "VendorAccount", "CustAccount")
    n = pick(cols, "OrganizationName", "VendorOrganizationName", "Name", "NameAlias", "CustomerName", "VendorName",
             "PersonFirstName")
    co = pick(cols, "dataAreaId", "DataAreaId")
    if not k or not n:
        return {}
    sql = f"SELECT [{k}] AS k, MAX([{n}]) AS n{', LOWER([' + co + ']) AS co' if co else ''} FROM stg.[{cfg['master']}] WHERE _tenant_key = :t GROUP BY [{k}]{', [' + co + ']' if co else ''}"
    out = {}
    for r in cn.execute(text(sql), {"t": tenant}).mappings():
        out[(r.get("co"), str(r["k"]))] = r["n"]
        out.setdefault((None, str(r["k"])), r["n"])
    return out


def open_items(cn, side, tenant, company, as_of):
    """Open items of one company for the cash forecast: account, name, invoice, due date and the open amount
    with the natural sign (positive = the customer owes us / we owe the vendor). None when the table is not loaded."""
    cfg = SIDES[side]
    lay = _layout(cn, side)
    if not lay or not lay["account"] or not lay["amount"]:
        return None
    where = ["1=1"]
    if lay["tenant"]:
        where.append("_tenant_key = :t")
    if lay["company"]:
        where.append(f"LOWER([{lay['company']}]) = :c")
    if lay["date"]:
        where.append(f"([{lay['date']}] IS NULL OR CAST([{lay['date']}] AS date) <= :d)")
    amt = f"CAST([{lay['amount']}] AS decimal(19,2))" + (f" - ISNULL(CAST([{lay['settled']}] AS decimal(19,2)), 0)" if lay["settled"] else "")
    sql = f"""SELECT [{lay['account']}] AS account, {f"[{lay['invoice']}]" if lay['invoice'] else 'NULL'} AS invoice,
                     {f"CAST([{lay['date']}] AS date)" if lay['date'] else 'NULL'} AS trans_date,
                     {f"CAST([{lay['due']}] AS date)" if lay['due'] else 'NULL'} AS due_date, {amt} AS amount
              FROM stg.[{cfg['table']}] WHERE {' AND '.join(where)}"""
    data = cn.execute(text(sql), {"t": tenant, "c": company.lower(), "d": as_of}).mappings().all()
    names = _names(cn, side, tenant)
    sign = 1 if side == "customer" else -1                            # vendor balances are credits
    out = []
    for r in data:
        v = sign * num(r["amount"])
        if abs(v) < 0.005:
            continue
        key = str(r["account"])
        due, td = _as_date(r["due_date"]), _as_date(r["trans_date"])
        out.append({"account": key, "name": names.get((company.lower(), key)) or names.get((None, key)) or "",
                    "invoice": r["invoice"], "due": due if due and due.year > 1901 else None,
                    "trans_date": td if td and td.year > 1901 else None, "amount": v})
    return out


def register(app, engine):
    @app.get("/api/report/ageing/sources")
    def sources(tenant: int):
        """Which ageing tables are loaded, and the D365 entities that could fill them (from the cached catalogue)."""
        out = {}
        with engine().connect() as cn:
            for side, cfg in SIDES.items():
                lay = _layout(cn, side)
                n = cn.execute(text(f"SELECT COUNT(*) FROM stg.[{cfg['table']}] WHERE _tenant_key = :t"), {"t": tenant}).scalar() \
                    if lay and lay["tenant"] else (0 if not lay else None)
                out[side] = {"table": f"stg.{cfg['table']}", "loaded": bool(lay), "rows": n,
                             "missing": [k for k in ("account", "amount", "date") if lay and not lay[k]]}
            cands = {"customer": [], "vendor": []}
            raw = cn.execute(text("SELECT entities_json FROM etl.metadata_cache WHERE tenant_key = :t"), {"t": tenant}).scalar()
        if raw:
            try:
                import catalog                                   # etl/catalog.py (cached $metadata, no download here)
                names = [c["name"] for c in catalog.get_metadata(tenant).catalog()]
            except Exception:                                    # noqa: BLE001
                names = []
            for side, cfg in SIDES.items():
                hits = [n for n in names if any(h.lower() in n.lower() for h in cfg["hints"])]
                hits.sort(key=lambda n: (("open" not in n.lower()), len(n)))   # open-transaction entities first
                cands[side] = hits[:12]
        return {"sides": out, "candidates": cands, "catalog_cached": bool(raw)}

    @app.get("/api/report/ageing")
    def ageing(tenant: int, company: str, side: str = Query("customer", pattern="^(customer|vendor)$"),
               year: int | None = None, month: int | None = None, basis: str = Query("due", pattern="^(due|invoice)$")):
        need_company(tenant, company)
        as_of = month_end(year, month) if year and month else date.today()
        cfg = SIDES[side]
        with engine().connect() as cn:
            lay = _layout(cn, side)
            if not lay:
                return {"loaded": False, "side": side, "table": f"stg.{cfg['table']}"}
            miss = [k for k in ("account", "amount") if not lay[k]]
            if miss:
                raise HTTPException(400, f"stg.{cfg['table']} has no {' / '.join(miss)} column. Columns found: {', '.join(lay['cols'][:40])}")
            where = ["1=1"]
            p = {"t": tenant, "c": company.lower(), "d": as_of}
            if lay["tenant"]:
                where.append("_tenant_key = :t")
            if lay["company"]:
                where.append(f"LOWER([{lay['company']}]) = :c")
            dcol = lay["due"] if basis == "due" and lay["due"] else lay["date"]
            if lay["date"]:
                where.append(f"([{lay['date']}] IS NULL OR CAST([{lay['date']}] AS date) <= :d)")
            amt = f"CAST([{lay['amount']}] AS decimal(19,2))" + (f" - ISNULL(CAST([{lay['settled']}] AS decimal(19,2)), 0)" if lay["settled"] else "")
            sql = f"""SELECT [{lay['account']}] AS account, {f"[{lay['invoice']}]" if lay['invoice'] else 'NULL'} AS invoice,
                             {f"CAST([{lay['date']}] AS date)" if lay['date'] else 'NULL'} AS trans_date,
                             {f"CAST([{dcol}] AS date)" if dcol else 'NULL'} AS age_date,
                             {amt} AS amount
                      FROM stg.[{cfg['table']}] WHERE {' AND '.join(where)}"""
            data = [dict(r) for r in cn.execute(text(sql), p).mappings()]
            names = _names(cn, side, tenant)
        sign = 1 if side == "customer" else -1                        # vendor balances are credits
        accts, totals = {}, [0.0] * 5
        for r in data:
            v = sign * num(r["amount"])
            if abs(v) < 0.005:
                continue
            d = _as_date(r["age_date"])
            days = (as_of - d).days if d and d.year > 1901 else None
            b = _bucket(days)
            key = str(r["account"])
            e = accts.setdefault(key, {"account": key, "name": names.get((company.lower(), key)) or names.get((None, key)) or "",
                                       "buckets": [0.0] * 5, "total": 0.0, "items": 0, "oldest_days": 0})
            e["buckets"][b] += v; e["total"] += v; e["items"] += 1
            if days is not None:
                e["oldest_days"] = max(e["oldest_days"], days)
            totals[b] += v
        rows_ = sorted(accts.values(), key=lambda e: -abs(e["total"]))
        overdue = sum(totals[1:])
        return {"loaded": True, "side": side, "as_of": as_of.isoformat(), "basis": "due date" if dcol == lay["due"] and lay["due"] else "invoice date",
                "buckets": BUCKETS, "rows": rows_, "totals": totals, "total": sum(totals), "overdue": overdue,
                "over_90": totals[4], "accounts": len(rows_), "table": f"stg.{cfg['table']}",
                "note": None if lay["due"] else "No due-date column - ageing by transaction date."}

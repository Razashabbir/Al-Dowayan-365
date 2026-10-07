"""Sales, Purchasing and Fixed Assets analytics (Dashboards › Sales / Purchasing / Fixed Assets).

Built on the tables already loaded: the general ledger (dw.fact_gl with accounts and financial dimensions),
customers and vendors (stg.customers, stg.vendors). Ledger lines carry no customer / vendor, so customer and
vendor figures come from the master tables (counts by group) and from the ageing tables when they are loaded.
"""
from datetime import date

from sqlalchemy import text

from modlib import call, columns, month_end, num, pick

FROM_GL = """FROM dw.fact_gl f JOIN dw.dim_account a ON a.tenant_key = f.tenant_key AND a.main_account = f.main_account
             WHERE f.tenant_key = :t AND f.company = :c AND f.is_close = 0"""
FA_NAMES = """(a.account_name LIKE '%property%' OR a.account_name LIKE '%equipment%' OR a.account_name LIKE '%furniture%'
               OR a.account_name LIKE '%vehicle%' OR a.account_name LIKE '%building%' OR a.account_name LIKE '%land%'
               OR a.account_name LIKE '%machinery%' OR a.account_name LIKE '%computer%' OR a.account_name LIKE '%fixed asset%'
               OR a.account_name LIKE '%leasehold%' OR a.account_name LIKE '%right of use%' OR a.account_name LIKE '%right-of-use%'
               OR a.account_name LIKE '%intangible%' OR a.account_name LIKE '%software%' OR a.account_name LIKE '%capital work%'
               OR a.account_name LIKE '%depreciation%' OR a.account_name LIKE '%amortization%' OR a.account_name LIKE '%amortisation%'
               OR a.account_name LIKE N'%أصول ثابتة%' OR a.account_name LIKE N'%ممتلكات%' OR a.account_name LIKE N'%إهلاك%')"""
DEP_NAMES = """(a.account_name LIKE '%depreciation%' OR a.account_name LIKE '%amortization%' OR a.account_name LIKE '%amortisation%'
                OR a.account_name LIKE N'%إهلاك%' OR a.account_name LIKE N'%استهلاك%')"""
COS_NAMES = """(a.account_name LIKE '%cost of%' OR a.account_name LIKE '%direct cost%' OR a.account_name LIKE '%purchase%'
                OR a.account_name LIKE '%material%' OR a.account_name LIKE '%subcontract%' OR a.account_name LIKE '%COGS%'
                OR a.account_name LIKE N'%تكلفة%' OR a.account_name LIKE N'%مشتريات%')"""


def _months(rows_, y, key="amount", sign=1):
    cur, prev = [0.0] * 12, [0.0] * 12
    for r in rows_:
        (cur if r["y"] == y else prev)[r["m"] - 1] += sign * num(r[key])
    return cur, prev


def register(app, engine, rows):
    def master(table, tenant, company):
        """Counts of customers / vendors by group from the master table, when it is loaded."""
        with engine().connect() as cn:
            cols = columns(cn, "stg", table)
            if not cols:
                return None
            co = pick(cols, "dataAreaId", "DataAreaId")
            grp = pick(cols, "CustomerGroupId", "VendorGroupId", "CustGroup", "VendGroup", "GroupId")
            ctry = pick(cols, "AddressCountryRegionId", "CountryRegionId", "AddressCountryRegionISOCode")
            where = "_tenant_key = :t" + (f" AND LOWER([{co}]) = :c" if co else "")
            p = {"t": tenant, "c": company.lower()}
            total = cn.execute(text(f"SELECT COUNT(*) FROM stg.[{table}] WHERE {where}"), p).scalar()
            groups = [dict(r) for r in cn.execute(text(f"""SELECT TOP 12 ISNULL(CAST([{grp}] AS nvarchar(60)), '(none)') AS name, COUNT(*) AS n
                        FROM stg.[{table}] WHERE {where} GROUP BY [{grp}] ORDER BY COUNT(*) DESC"""), p).mappings()] if grp else []
            countries = [dict(r) for r in cn.execute(text(f"""SELECT TOP 8 ISNULL(CAST([{ctry}] AS nvarchar(20)), '(none)') AS name, COUNT(*) AS n
                        FROM stg.[{table}] WHERE {where} GROUP BY [{ctry}] ORDER BY COUNT(*) DESC"""), p).mappings()] if ctry else []
        return {"total": total, "groups": groups, "countries": countries}

    def by_dim(where, t, c, y, col, sign=1):
        return [{"name": r["name"], "amount": sign * num(r["amount"])} for r in rows(f"""
            SELECT TOP 12 ISNULL({col}, '(none)') AS name, SUM(f.amount) AS amount {FROM_GL} AND {where} AND YEAR(f.accounting_date) = :y
            GROUP BY ISNULL({col}, '(none)') ORDER BY ABS(SUM(f.amount)) DESC""", t=t, c=c, y=y)]

    @app.get("/api/report/analytics/sales")
    def sales(tenant: int, company: str, year: int):
        rev = "a.pl_group = 'Revenue'"
        by_m = rows(f"""SELECT YEAR(f.accounting_date) AS y, MONTH(f.accounting_date) AS m, SUM(f.amount) AS amount
                        {FROM_GL} AND {rev} AND YEAR(f.accounting_date) IN (:y, :py)
                        GROUP BY YEAR(f.accounting_date), MONTH(f.accounting_date)""", t=tenant, c=company, y=year, py=year - 1)
        cur, prev = _months(by_m, year, sign=-1)
        accts = rows(f"""SELECT TOP 15 f.main_account, MAX(a.account_name) AS account_name,
                                SUM(CASE WHEN YEAR(f.accounting_date) = :y THEN -f.amount ELSE 0 END) AS amount,
                                SUM(CASE WHEN YEAR(f.accounting_date) = :py THEN -f.amount ELSE 0 END) AS prev
                         {FROM_GL} AND {rev} AND YEAR(f.accounting_date) IN (:y, :py)
                         GROUP BY f.main_account ORDER BY SUM(CASE WHEN YEAR(f.accounting_date) = :y THEN -f.amount ELSE 0 END) DESC""",
                     t=tenant, c=company, y=year, py=year - 1)
        last = max([i + 1 for i, v in enumerate(cur) if abs(v) > 0.5], default=0)
        ytd_prev = sum(prev[:last]) if last else 0
        cust = master("customers", tenant, company)
        recv = None
        try:
            d = call(app, "/api/report/ar-ap", tenant=tenant, company=company, year=year)   # same AR as the dashboard
            i = max(0, (last or 12) - 1)
            recv = {"balance": d["ar_balance"][i], "dso": d["dso"][i], "month": i + 1}
        except Exception:                                    # noqa: BLE001
            pass
        return {"months": cur, "prev_months": prev, "total": sum(cur), "prev_total": sum(prev), "prev_ytd": ytd_prev, "last_month": last,
                "accounts": [{**r, "amount": num(r["amount"]), "prev": num(r["prev"])} for r in accts],
                "by_dim2": by_dim(rev, tenant, company, year, "f.dim2", -1), "by_dim3": by_dim(rev, tenant, company, year, "f.dim3", -1),
                "by_project": by_dim(rev + " AND f.project IS NOT NULL", tenant, company, year, "f.project", -1),
                "customers": cust, "receivables": recv,
                "note": "Ledger revenue by account, dimension and project; customer counts from the customer master."}

    @app.get("/api/report/analytics/purchasing")
    def purchasing(tenant: int, company: str, year: int):
        cos = f"a.pl_group = 'Expense' AND {COS_NAMES}"
        exp = "a.pl_group = 'Expense'"
        by_m = rows(f"""SELECT YEAR(f.accounting_date) AS y, MONTH(f.accounting_date) AS m,
                               SUM(CASE WHEN {COS_NAMES} THEN f.amount ELSE 0 END) AS direct, SUM(f.amount) AS amount
                        {FROM_GL} AND {exp} AND YEAR(f.accounting_date) IN (:y, :py)
                        GROUP BY YEAR(f.accounting_date), MONTH(f.accounting_date)""", t=tenant, c=company, y=year, py=year - 1)
        cur, prev = _months(by_m, year)
        dcur, dprev = _months(by_m, year, key="direct")
        accts = rows(f"""SELECT TOP 15 f.main_account, MAX(a.account_name) AS account_name,
                                SUM(CASE WHEN YEAR(f.accounting_date) = :y THEN f.amount ELSE 0 END) AS amount,
                                SUM(CASE WHEN YEAR(f.accounting_date) = :py THEN f.amount ELSE 0 END) AS prev,
                                MAX(CASE WHEN {COS_NAMES} THEN 1 ELSE 0 END) AS direct
                         {FROM_GL} AND {exp} AND YEAR(f.accounting_date) IN (:y, :py)
                         GROUP BY f.main_account ORDER BY SUM(CASE WHEN YEAR(f.accounting_date) = :y THEN f.amount ELSE 0 END) DESC""",
                     t=tenant, c=company, y=year, py=year - 1)
        last = max([i + 1 for i, v in enumerate(cur) if abs(v) > 0.5], default=0)
        pay = None
        try:
            d = call(app, "/api/report/ar-ap", tenant=tenant, company=company, year=year)
            i = max(0, (last or 12) - 1)
            pay = {"balance": d["ap_balance"][i], "dpo": d["dpo"][i], "month": i + 1, "trend": d["ap_balance"][: (last or 12)]}
        except Exception:                                    # noqa: BLE001
            pass
        return {"months": cur, "prev_months": prev, "direct": dcur, "prev_direct": dprev, "total": sum(cur), "prev_total": sum(prev),
                "direct_total": sum(dcur), "last_month": last, "prev_ytd": sum(prev[:last]) if last else 0,
                "accounts": [{**r, "amount": num(r["amount"]), "prev": num(r["prev"]), "direct": bool(r["direct"])} for r in accts],
                "by_dim2": by_dim(exp, tenant, company, year, "f.dim2"), "by_dim3": by_dim(exp, tenant, company, year, "f.dim3"),
                "vendors": master("vendors", tenant, company), "payables": pay,
                "note": "Direct costs = expense accounts named cost of / direct cost / purchase / material / subcontract."}

    @app.get("/api/report/analytics/fixed-assets")
    def fixed_assets(tenant: int, company: str, year: int):
        d_end, ys = month_end(year, 12), date(year, 1, 1)
        accts = rows(f"""SELECT f.main_account, MAX(a.account_name) AS account_name,
                                SUM(CASE WHEN f.accounting_date < :ys THEN f.amount ELSE 0 END) AS opening,
                                SUM(CASE WHEN f.accounting_date BETWEEN :ys AND :d AND f.amount > 0 THEN f.amount ELSE 0 END) AS debit,
                                SUM(CASE WHEN f.accounting_date BETWEEN :ys AND :d AND f.amount < 0 THEN -f.amount ELSE 0 END) AS credit,
                                SUM(CASE WHEN f.accounting_date <= :d THEN f.amount ELSE 0 END) AS closing
                         {FROM_GL} AND a.pl_group NOT IN ('Revenue', 'Expense', 'OCI') AND {FA_NAMES} AND f.accounting_date <= :d
                         GROUP BY f.main_account ORDER BY f.main_account""", t=tenant, c=company, ys=ys, d=d_end)
        cost, accum = [], []
        for r in accts:
            e = {k: (num(v) if k not in ("main_account", "account_name") else v) for k, v in r.items()}
            is_acc = any(w in (e["account_name"] or "").lower() for w in ("depreciation", "amortization", "amortisation", "إهلاك", "impairment"))
            (accum if is_acc else cost).append(e)
        dep = rows(f"""SELECT MONTH(f.accounting_date) AS m, SUM(f.amount) AS amount {FROM_GL}
                       AND a.pl_group = 'Expense' AND {DEP_NAMES} AND YEAR(f.accounting_date) = :y GROUP BY MONTH(f.accounting_date)""",
                   t=tenant, c=company, y=year)
        add = rows(f"""SELECT MONTH(f.accounting_date) AS m, SUM(CASE WHEN f.amount > 0 THEN f.amount ELSE 0 END) AS additions,
                              SUM(CASE WHEN f.amount < 0 THEN -f.amount ELSE 0 END) AS disposals
                       {FROM_GL} AND a.pl_group NOT IN ('Revenue', 'Expense', 'OCI') AND {FA_NAMES} AND NOT {DEP_NAMES}
                       AND YEAR(f.accounting_date) = :y GROUP BY MONTH(f.accounting_date)""", t=tenant, c=company, y=year)
        dep_m, add_m, disp_m = [0.0] * 12, [0.0] * 12, [0.0] * 12
        for r in dep:
            dep_m[r["m"] - 1] = num(r["amount"])
        for r in add:
            add_m[r["m"] - 1], disp_m[r["m"] - 1] = num(r["additions"]), num(r["disposals"])
        gross = sum(e["closing"] for e in cost)
        acc_dep = -sum(e["closing"] for e in accum)
        return {"cost": cost, "accumulated": accum, "gross": gross, "accumulated_total": acc_dep, "nbv": gross - acc_dep,
                "opening_nbv": sum(e["opening"] for e in cost) + sum(e["opening"] for e in accum),
                "additions": add_m, "disposals": disp_m, "depreciation": dep_m,
                "additions_total": sum(add_m), "disposals_total": sum(disp_m), "depreciation_total": sum(dep_m),
                "note": "Fixed-asset accounts are found by name (property, equipment, vehicles, buildings, land, right-of-use, intangibles; "
                        "accumulated depreciation / amortisation). Additions = debits and disposals = credits to cost accounts in the year."}

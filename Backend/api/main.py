"""REST API for the React app.

  * /api/report/...  read-only dashboard data (api_reader login)
  * /api/admin/...   D365 connections, sync jobs, users, system health
  Every call needs a signed-in user (Authorization: Bearer <token>, see security.py); what a user may do
  depends on the role, and which companies they see is enforced by row-level security.

    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000      # docs at http://localhost:8000/docs
"""
import hmac
import time
import os
import sys

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

HERE = os.path.dirname(os.path.abspath(__file__))
ETL_DIR = os.path.join(HERE, "..", "etl")
load_dotenv(os.path.join(HERE, ".env"))
load_dotenv(os.path.join(ETL_DIR, ".env"))      # SQL_CONN, SECRET_KEY, ADMIN_API_KEY
sys.path.insert(0, ETL_DIR)

_missing = [v for v in ("API_SQL_CONN", "SQL_CONN", "SECRET_KEY", "ADMIN_API_KEY") if not os.getenv(v)]
if _missing:
    sys.exit(f"\nMissing settings: {', '.join(_missing)}.\n"
             f"Create etl\\.env and api\\.env by running from the project folder:\n"
             f"    python setup_env.py\n")

import catalog                                   # noqa: E402
import db                                        # noqa: E402
import sync as etl_sync                           # noqa: E402
import tenants as tn                              # noqa: E402
from d365_client import D365Client, D365Error, normalize_env_url  # noqa: E402
import adjustments                                # noqa: E402
import ai_assistant                               # noqa: E402
import app_config                                 # noqa: E402
import audit_logs                                 # noqa: E402
import health                                     # noqa: E402
import security                                   # noqa: E402

reader = create_engine(URL.create("mssql+pyodbc", query={"odbc_connect": os.environ["API_SQL_CONN"]}),
                       pool_pre_ping=True, pool_size=5, max_overflow=5, pool_timeout=60,
                       connect_args={"timeout": db.LOGIN_TIMEOUT})

app = FastAPI(title="Al-Dowayan Reporting API")

# ---- error log: api/logs/api.log (every unhandled error with its full traceback) ----
import logging                                    # noqa: E402
import traceback                                  # noqa: E402
from logging.handlers import RotatingFileHandler  # noqa: E402

from fastapi import Request                       # noqa: E402
from fastapi.responses import JSONResponse        # noqa: E402

os.makedirs(os.path.join(HERE, "logs"), exist_ok=True)
log = logging.getLogger("api")
log.setLevel(logging.INFO)
_fh = RotatingFileHandler(os.path.join(HERE, "logs", "api.log"), maxBytes=2_000_000, backupCount=3, encoding="utf-8")
_fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
log.addHandler(_fh)


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):
    """Log the full traceback and return the REAL reason (not just 'HTTP 500') to the browser."""
    log.error("%s %s failed:\n%s", request.method, request.url.path,
              "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
    reason = str(getattr(exc, "orig", None) or exc).splitlines()[0][:500]
    return JSONResponse(status_code=500, content={
        "detail": f"{type(exc).__name__}: {reason} (full details in api\\logs\\api.log)"})
store = security.Store(tn.engine)
app.add_middleware(security.AuthMiddleware, store=store, log=log)   # sign-in, roles, company access (RLS)
security.install_reset(reader)
security.install_reset(db.engine())
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    state = db.ensure_schema()
    print("database:", state)
    log.info("startup - database: %s", state)
    sec_state = security.bootstrap(tn.engine, log)
    print(sec_state)
    log.info("startup - %s", sec_state)
    demo_state = security.ensure_demo_users(tn.engine)
    print(demo_state)
    log.info("startup - %s", demo_state)
    fs_state = fs_reports.ensure_seed(tn.engine())
    print(fs_state)
    log.info("startup - %s", fs_state)
    try:
        etl_sync.mark_interrupted_jobs()
    except Exception as ex:  # DB not ready yet - the endpoints will report it
        print("startup:", ex)


API_VERSION = 18
_co_cache: dict = {}


def _resolve_company(tenant, company):
    """When the ledger had no company column, dw.fact_gl holds company '(all)'. Then every company in the
    top bar shows that data instead of an empty page."""
    key = (tenant, (company or "").lower())
    hit = _co_cache.get(key)
    if hit and hit[1] > time.time():
        return hit[0]
    with reader.connect() as cn:
        found = cn.execute(text("""SELECT TOP 1 company FROM dw.fact_gl WHERE tenant_key=:t AND company IN (:c, '(all)')
                                   ORDER BY IIF(company = '(all)', 1, 0)"""), {"t": tenant, "c": company}).scalar()
    out = found or company
    _co_cache[key] = (out, time.time() + 60)
    return out


def rows(sql: str, **params):
    if "t" in params and "c" in params:
        params["c"] = _resolve_company(params["t"], params["c"])
    with reader.connect() as cn:
        security.set_rls(cn)                      # row-level security: only the user's companies
        return [dict(r._mapping) for r in cn.execute(text(sql), params)]


# ======================================================== dashboard data ====
@app.get("/api/report/tenants")
def report_tenants():
    u = security.current_user()
    return [t for t in rows("SELECT tenant_key, name, default_company FROM dw.vw_tenants ORDER BY name")
            if security.can_see(u, t["tenant_key"], None)]


@app.get("/api/report/companies-all")
def companies_all():
    """Every company of every active tenant, for the company dropdown in the top bar.
    Names come from stg.legal_entities (entity LegalEntities); otherwise companies found in the ledger."""
    def run():
        with tn.engine().connect() as cn:
            tenants = {r.tenant_key: r for r in cn.execute(text(
                "SELECT tenant_key, name, default_company FROM etl.tenant WHERE is_active = 1"))}
            rows = []
            if cn.execute(text("SELECT OBJECT_ID('stg.legal_entities')")).scalar():
                rows = [(r[0], r[1], r[2]) for r in cn.execute(text(
                    "SELECT _tenant_key, LegalEntityId, Name FROM stg.legal_entities"))]
            if not rows:
                rows = [(r[0], r[1], None) for r in cn.execute(text(
                    "SELECT DISTINCT tenant_key, company FROM dw.fact_gl"))]
        out = []
        for k, co, name in rows:
            t = tenants.get(k)
            if t is None or not co:
                continue
            out.append({"tenant_key": k, "tenant": t.name, "company": str(co).lower(), "name": name,
                        "is_default": (t.default_company or "").lower() == str(co).lower()})
        return security.filter_companies(sorted(out, key=lambda r: (r["tenant"], r["company"])))
    return db.retry(run)


@app.get("/api/report/companies")
def companies(tenant: int):
    return rows("SELECT DISTINCT company FROM dw.vw_pnl_monthly WHERE tenant_key=:t ORDER BY company", t=tenant)


@app.get("/api/report/years")
def years(tenant: int, company: str):
    return rows("""SELECT DISTINCT [year] FROM dw.vw_pnl_monthly WHERE tenant_key=:t AND company=:c
                   ORDER BY [year] DESC""", t=tenant, c=company)


@app.get("/api/report/kpis")
def kpis(tenant: int, company: str, year: int):
    q = """SELECT ISNULL(SUM(revenue),0) revenue, ISNULL(SUM(expenses),0) expenses,
                  ISNULL(SUM(net_profit),0) net_profit
           FROM dw.vw_pnl_monthly WHERE tenant_key=:t AND company=:c AND [year]=:y"""
    cur, prev = rows(q, t=tenant, c=company, y=year)[0], rows(q, t=tenant, c=company, y=year - 1)[0]
    rev = float(cur["revenue"])
    return {
        "revenue": rev, "expenses": float(cur["expenses"]), "net_profit": float(cur["net_profit"]),
        "margin_pct": round(float(cur["net_profit"]) / rev * 100, 1) if rev else None,
        "revenue_prev": float(prev["revenue"]), "net_profit_prev": float(prev["net_profit"]),
    }


@app.get("/api/report/pnl-monthly")
def pnl_monthly(tenant: int, company: str, year: int):
    return rows("""SELECT [month], revenue, expenses, net_profit FROM dw.vw_pnl_monthly
                   WHERE tenant_key=:t AND company=:c AND [year]=:y ORDER BY [month]""", t=tenant, c=company, y=year)


@app.get("/api/report/top-expenses")
def top_expenses(tenant: int, company: str, year: int, limit: int = Query(10, le=50)):
    return rows("""SELECT TOP (:n) main_account, account_name, SUM(amount) amount
                   FROM dw.vw_account_monthly
                   WHERE tenant_key=:t AND company=:c AND [year]=:y AND pl_group='Expense'
                   GROUP BY main_account, account_name ORDER BY SUM(amount) DESC""",
                n=limit, t=tenant, c=company, y=year)


@app.get("/api/report/trial-balance")
def trial_balance(tenant: int, company: str, year: int, month: int = Query(12, ge=1, le=12)):
    return rows("""SELECT main_account, account_name, account_type,
                          SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)  debit,
                          SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) credit,
                          SUM(amount) balance
                   FROM dw.vw_account_monthly
                   WHERE tenant_key=:t AND company=:c AND [year]=:y AND [month] <= :m
                   GROUP BY main_account, account_name, account_type
                   ORDER BY main_account""", t=tenant, c=company, y=year, m=month)


# ======================================================== dashboard pages ====
# Sign convention in dw.fact_gl: debit +, credit -. Revenue, liabilities and equity are shown as positive numbers.
import calendar                                   # noqa: E402
from datetime import date                         # noqa: E402

FROM_GL = """FROM dw.fact_gl f JOIN dw.dim_account a ON a.tenant_key = f.tenant_key AND a.main_account = f.main_account
             WHERE f.tenant_key = :t AND f.company = :c AND f.is_close = 0"""
CASH_NAMES = "(a.account_name LIKE '%bank%' OR a.account_name LIKE '%cash%' OR a.account_name LIKE N'%بنك%' OR a.account_name LIKE N'%نقد%')"
AR_NAMES = "(a.account_name LIKE '%receivable%' OR a.account_name LIKE '%debtor%' OR a.account_name LIKE N'%مدين%')"
AP_NAMES = "(a.account_name LIKE '%payable%' OR a.account_name LIKE '%creditor%' OR a.account_name LIKE N'%دائن%')"


def month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def num(v) -> float:
    return float(v or 0)


@app.get("/api/report/pnl")
def pnl_statement(tenant: int, company: str, year: int):
    """Income statement: every revenue / expense account by month, with last year's total."""
    data = rows(f"""SELECT a.pl_group, f.main_account, MAX(a.account_name) AS account_name,
                           YEAR(f.accounting_date) AS y, MONTH(f.accounting_date) AS m, SUM(f.amount) AS amount
                    {FROM_GL} AND a.pl_group IN ('Revenue', 'Expense') AND YEAR(f.accounting_date) IN (:y, :py)
                    GROUP BY a.pl_group, f.main_account, YEAR(f.accounting_date), MONTH(f.accounting_date)""",
                t=tenant, c=company, y=year, py=year - 1)
    acc = {}
    for r in data:
        sign = -1 if r["pl_group"] == "Revenue" else 1
        e = acc.setdefault(r["main_account"], {"main_account": r["main_account"], "account_name": r["account_name"],
                                               "group": r["pl_group"], "months": [0.0] * 12, "total": 0.0, "prev_total": 0.0})
        v = sign * num(r["amount"])
        if r["y"] == year:
            e["months"][r["m"] - 1] += v
            e["total"] += v
        else:
            e["prev_total"] += v
    lines = sorted(acc.values(), key=lambda e: (e["group"] != "Revenue", -abs(e["total"])))
    rev = [sum(e["months"][i] for e in lines if e["group"] == "Revenue") for i in range(12)]
    exp = [sum(e["months"][i] for e in lines if e["group"] == "Expense") for i in range(12)]
    prev_rev = sum(e["prev_total"] for e in lines if e["group"] == "Revenue")
    prev_exp = sum(e["prev_total"] for e in lines if e["group"] == "Expense")
    return {"lines": lines, "revenue": rev, "expenses": exp, "net": [r - x for r, x in zip(rev, exp)],
            "totals": {"revenue": sum(rev), "expenses": sum(exp), "net": sum(rev) - sum(exp),
                       "prev_revenue": prev_rev, "prev_expenses": prev_exp, "prev_net": prev_rev - prev_exp}}


@app.get("/api/report/balance-sheet")
def balance_sheet(tenant: int, company: str, year: int, month: int = Query(12, ge=1, le=12)):
    """Balance sheet at the end of the chosen month, compared with the same date last year."""
    as_of, prev_as_of = month_end(year, month), month_end(year - 1, month)
    y_start, py_start = date(year, 1, 1), date(year - 1, 1, 1)
    data = rows(f"""SELECT f.main_account, MAX(a.account_name) AS account_name, MAX(a.bs_group) AS bs_group,
                           MAX(a.pl_group) AS pl_group,
                           SUM(CASE WHEN f.accounting_date <= :d THEN f.amount ELSE 0 END) AS bal,
                           SUM(CASE WHEN f.accounting_date <= :pd THEN f.amount ELSE 0 END) AS prev_bal,
                           SUM(CASE WHEN f.accounting_date BETWEEN :ys AND :d THEN f.amount ELSE 0 END) AS ytd,
                           SUM(CASE WHEN f.accounting_date BETWEEN :pys AND :pd THEN f.amount ELSE 0 END) AS prev_ytd
                    {FROM_GL} GROUP BY f.main_account""",
                t=tenant, c=company, d=as_of, pd=prev_as_of, ys=y_start, pys=py_start)
    groups = {"Asset": [], "Liability": [], "Equity": []}
    earn = {"current": 0.0, "prev_current": 0.0, "retained": 0.0, "prev_retained": 0.0}
    for r in data:
        if r["pl_group"] in ("Revenue", "Expense", "OCI"):  # P&L and OCI accounts feed the earnings lines
            earn["current"] += -num(r["ytd"])
            earn["prev_current"] += -num(r["prev_ytd"])
            earn["retained"] += -(num(r["bal"]) - num(r["ytd"]))
            earn["prev_retained"] += -(num(r["prev_bal"]) - num(r["prev_ytd"]))
            continue
        g = r["bs_group"] or "Asset"
        sign = 1 if g == "Asset" else -1
        if abs(num(r["bal"])) < 0.005 and abs(num(r["prev_bal"])) < 0.005:
            continue
        groups.setdefault(g, []).append({"main_account": r["main_account"], "account_name": r["account_name"],
                                         "balance": sign * num(r["bal"]), "prev_balance": sign * num(r["prev_bal"])})
    for g in groups.values():
        g.sort(key=lambda e: -abs(e["balance"]))
    tot = lambda g, k: sum(e[k] for e in groups.get(g, []))  # noqa: E731
    assets, liab, eq = tot("Asset", "balance"), tot("Liability", "balance"), tot("Equity", "balance")
    eq_total = eq + earn["retained"] + earn["current"]
    return {"as_of": as_of.isoformat(), "prev_as_of": prev_as_of.isoformat(), "groups": groups, "earnings": earn,
            "totals": {"assets": assets, "prev_assets": tot("Asset", "prev_balance"),
                       "liabilities": liab, "prev_liabilities": tot("Liability", "prev_balance"),
                       "equity": eq_total,
                       "prev_equity": tot("Equity", "prev_balance") + earn["prev_retained"] + earn["prev_current"],
                       "difference": assets - liab - eq_total}}


@app.get("/api/report/trial-balance-full")
def trial_balance_full(tenant: int, company: str, year: int, month: int = Query(12, ge=1, le=12)):
    """Opening balance (before 1 Jan), debits and credits from 1 Jan to month end, closing balance."""
    return rows(f"""SELECT f.main_account, MAX(a.account_name) AS account_name, MAX(a.account_type) AS account_type,
                           SUM(CASE WHEN f.accounting_date < :ys THEN f.amount ELSE 0 END) AS opening,
                           SUM(CASE WHEN f.accounting_date BETWEEN :ys AND :d AND f.amount > 0 THEN f.amount ELSE 0 END) AS debit,
                           SUM(CASE WHEN f.accounting_date BETWEEN :ys AND :d AND f.amount < 0 THEN -f.amount ELSE 0 END) AS credit,
                           SUM(CASE WHEN f.accounting_date <= :d THEN f.amount ELSE 0 END) AS closing
                    {FROM_GL} AND f.accounting_date <= :d
                    GROUP BY f.main_account
                    HAVING SUM(CASE WHEN f.accounting_date <= :d THEN ABS(f.amount) ELSE 0 END) > 0
                    ORDER BY f.main_account""",
                t=tenant, c=company, ys=date(year, 1, 1), d=month_end(year, month))


@app.get("/api/report/expenses")
def expense_analysis(tenant: int, company: str, year: int):
    """Where the money goes: by account, by financial dimension (segments 2 and 3 of the ledger account), by month."""
    base = f"{FROM_GL} AND a.pl_group = 'Expense' AND YEAR(f.accounting_date) = :y"
    by_month = rows(f"""SELECT YEAR(f.accounting_date) AS y, MONTH(f.accounting_date) AS m, SUM(f.amount) AS amount
                        {FROM_GL} AND a.pl_group = 'Expense' AND YEAR(f.accounting_date) IN (:y, :py)
                        GROUP BY YEAR(f.accounting_date), MONTH(f.accounting_date)""",
                    t=tenant, c=company, y=year, py=year - 1)
    cur, prev = [0.0] * 12, [0.0] * 12
    for r in by_month:
        (cur if r["y"] == year else prev)[r["m"] - 1] = num(r["amount"])
    q = lambda col: rows(f"""SELECT TOP 15 ISNULL({col}, '(none)') AS name, SUM(f.amount) AS amount  
                             {base} GROUP BY ISNULL({col}, '(none)') ORDER BY SUM(f.amount) DESC""",
                         t=tenant, c=company, y=year)  # noqa: E731
    accounts = rows(f"""SELECT TOP 15 f.main_account, MAX(a.account_name) AS account_name, SUM(f.amount) AS amount
                        {base} GROUP BY f.main_account ORDER BY SUM(f.amount) DESC""", t=tenant, c=company, y=year)
    return {"by_month": cur, "prev_by_month": prev, "total": sum(cur), "prev_total": sum(prev),
            "accounts": accounts, "dim2": q("f.dim2"), "dim3": q("f.dim3")}


def _month_end_balances(tenant, company, year, where_names):
    """Balance at each month end of `year` for the accounts matching where_names (plus their list)."""
    accts = rows(f"""SELECT a.main_account, MAX(a.account_name) AS account_name,
                            SUM(CASE WHEN f.accounting_date <= :d THEN f.amount ELSE 0 END) AS balance
                     {FROM_GL} AND a.pl_group NOT IN ('Revenue', 'Expense', 'OCI') AND {where_names}
                     GROUP BY a.main_account ORDER BY a.main_account""",
                 t=tenant, c=company, d=month_end(year, 12))
    opening = rows(f"""SELECT ISNULL(SUM(f.amount), 0) AS v {FROM_GL} AND a.pl_group NOT IN ('Revenue', 'Expense', 'OCI')
                       AND {where_names} AND f.accounting_date < :ys""", t=tenant, c=company, ys=date(year, 1, 1))[0]["v"]
    moves = rows(f"""SELECT MONTH(f.accounting_date) AS m,
                            SUM(CASE WHEN f.amount > 0 THEN f.amount ELSE 0 END) AS inflow,
                            SUM(CASE WHEN f.amount < 0 THEN -f.amount ELSE 0 END) AS outflow
                     {FROM_GL} AND a.pl_group NOT IN ('Revenue', 'Expense', 'OCI') AND {where_names}
                       AND YEAR(f.accounting_date) = :y GROUP BY MONTH(f.accounting_date)""",
                 t=tenant, c=company, y=year)
    inflow, outflow = [0.0] * 12, [0.0] * 12
    for r in moves:
        inflow[r["m"] - 1], outflow[r["m"] - 1] = num(r["inflow"]), num(r["outflow"])
    bal, run = [], num(opening)
    for i in range(12):
        run += inflow[i] - outflow[i]
        bal.append(run)
    return accts, bal, inflow, outflow


@app.get("/api/report/cash")
def cash_bank(tenant: int, company: str, year: int):
    """Cash & bank: ledger accounts whose name contains bank / cash (balance sheet accounts only)."""
    accts, bal, inflow, outflow = _month_end_balances(tenant, company, year, CASH_NAMES)
    return {"accounts": accts, "balance": bal, "inflow": inflow, "outflow": outflow,
            "rule": "Ledger accounts whose name contains 'bank' or 'cash'"}


@app.get("/api/report/ar-ap")
def receivables_payables(tenant: int, company: str, year: int):
    """Receivables and payables from the ledger: balances by month end, DSO and DPO (days)."""
    ar_accts, ar_bal, _, _ = _month_end_balances(tenant, company, year, AR_NAMES)
    ap_accts, ap_bal, _, _ = _month_end_balances(tenant, company, year, AP_NAMES)
    ap_bal = [-v for v in ap_bal]                      # payables are credit balances
    for a_ in ap_accts:
        a_["balance"] = -num(a_["balance"])
    pl = rows(f"""SELECT YEAR(f.accounting_date) AS y, MONTH(f.accounting_date) AS m,
                         SUM(CASE WHEN a.pl_group = 'Revenue' THEN -f.amount ELSE 0 END) AS revenue,
                         SUM(CASE WHEN a.pl_group = 'Expense' THEN f.amount ELSE 0 END) AS expenses
                  {FROM_GL} AND f.accounting_date BETWEEN :s AND :e
                  GROUP BY YEAR(f.accounting_date), MONTH(f.accounting_date)""",
              t=tenant, c=company, s=date(year - 1, 1, 1), e=month_end(year, 12))
    by = {(r["y"], r["m"]): r for r in pl}
    dso, dpo = [], []
    for i in range(12):   # trailing 12 months ending at this month
        keys = [((year if i - k >= 0 else year - 1), (i - k) % 12 + 1) for k in range(12)]
        rev12 = sum(num(by.get(k, {}).get("revenue")) for k in keys)
        exp12 = sum(num(by.get(k, {}).get("expenses")) for k in keys)
        dso.append(round(ar_bal[i] / rev12 * 365, 1) if rev12 > 0 else None)
        dpo.append(round(ap_bal[i] / exp12 * 365, 1) if exp12 > 0 else None)
    return {"ar_accounts": ar_accts, "ap_accounts": ap_accts, "ar_balance": ar_bal, "ap_balance": ap_bal,
            "dso": dso, "dpo": dpo,
            "rule": "Ledger accounts whose name contains receivable/debtor (AR) or payable/creditor (AP)"}


@app.get("/api/report/projects")
def projects(tenant: int, company: str, year: int):
    """Project profitability from ledger lines that carry a project id."""
    data = rows(f"""SELECT f.project,
                           SUM(CASE WHEN a.pl_group = 'Revenue' THEN -f.amount ELSE 0 END) AS revenue,
                           SUM(CASE WHEN a.pl_group = 'Expense' THEN f.amount ELSE 0 END) AS cost,
                           COUNT(*) AS lines
                    {FROM_GL} AND f.project IS NOT NULL AND YEAR(f.accounting_date) = :y
                    GROUP BY f.project""", t=tenant, c=company, y=year)
    out = []
    for r in data:
        rev, cost = num(r["revenue"]), num(r["cost"])
        out.append({"project": r["project"], "revenue": rev, "cost": cost, "margin": rev - cost,
                    "margin_pct": round((rev - cost) / rev * 100, 1) if rev else None, "lines": r["lines"]})
    out.sort(key=lambda e: -(e["revenue"] + e["cost"]))
    return {"projects": out, "totals": {"revenue": sum(e["revenue"] for e in out), "cost": sum(e["cost"] for e in out)}}


@app.get("/api/report/diagnose")
def diagnose(tenant: int, company: str = ""):
    """Why is a dashboard empty? Checks each step from D365 tables to dashboard data; the first failing step wins."""
    _co_cache.clear()

    def run():
        with tn.engine().connect() as cn:
            def q(sql, **p):
                return cn.execute(text(sql), p).scalar()

            def stg(t):
                if not q(f"SELECT OBJECT_ID('stg.{t}')"):
                    return None
                return q(f"SELECT COUNT_BIG(*) FROM stg.{t} WHERE _tenant_key=:k", k=tenant)

            new_cols = bool(q("SELECT COL_LENGTH('dw.fact_gl', 'ledger_account')"))
            info = {
                "api_version": API_VERSION,
                "gl_entries": stg("gl_entries"), "gl_headers": stg("gl_headers"), "main_accounts": stg("main_accounts"),
                "new_columns": new_cols,
                "fact_rows": q("SELECT COUNT_BIG(*) FROM dw.fact_gl WHERE tenant_key=:k", k=tenant),
                "fact_rows_company": q("SELECT COUNT_BIG(*) FROM dw.fact_gl WHERE tenant_key=:k AND company=:c", k=tenant, c=company),
                "pl_accounts": q("SELECT COUNT(*) FROM dw.dim_account WHERE tenant_key=:k AND pl_group IN ('Revenue','Expense')", k=tenant),
                "rebuilt_since_update": q("SELECT COUNT_BIG(*) FROM dw.fact_gl WHERE tenant_key=:k AND ledger_account IS NOT NULL",
                                          k=tenant) if new_cols else 0,
                "fact_accounts_matched": q("""SELECT COUNT_BIG(*) FROM dw.fact_gl f WHERE f.tenant_key=:k AND EXISTS
                                             (SELECT 1 FROM dw.dim_account a WHERE a.tenant_key=f.tenant_key AND a.main_account=f.main_account)""", k=tenant),
                "sample_account": q("SELECT TOP 1 main_account FROM dw.fact_gl WHERE tenant_key=:k", k=tenant),
                "companies": [dict(r._mapping) for r in cn.execute(text(
                    """SELECT TOP 10 company, COUNT_BIG(*) AS [rows] FROM dw.fact_gl WHERE tenant_key=:k
                       GROUP BY company ORDER BY COUNT_BIG(*) DESC"""), {"k": tenant})],
                "last_build_at": None, "last_build_msg": None,
            }
            if q("SELECT COL_LENGTH('etl.tenant', 'report_msg')"):
                r = cn.execute(text("SELECT report_at, report_msg FROM etl.tenant WHERE tenant_key=:k"), {"k": tenant}).first()
                if r:
                    info["last_build_at"], info["last_build_msg"] = r[0], r[1]
        built_ok = info["last_build_msg"] in (None, "Dashboard data refreshed.")
        has_all = any(c["company"] == "(all)" for c in info["companies"])
        if not info["gl_entries"]:
            step = ("Ledger lines not loaded.", "ETL › Jobs: tick GeneralJournalAccountEntryBiEntities, click Run ETL.")
        elif info["gl_headers"] is None:
            step = ("Journal headers not loaded.", "ETL › Jobs: tick GeneralJournalEntryBiEntities, click Run ETL.")
        elif not info["main_accounts"]:
            step = ("Main accounts not loaded.", "ETL › Jobs: tick MainAccounts, click Run ETL.")
        elif not built_ok:
            step = (info["last_build_msg"], "Fix the cause, then ETL › Jobs › Rebuild reports.")
        elif not info["fact_rows"]:
            step = ("Dashboard data not built yet.", "ETL › Jobs › Rebuild reports.")
        elif info["fact_rows"] and (info["fact_accounts_matched"] or 0) < info["fact_rows"] / 2:
            step = (f"Ledger accounts do not match the main accounts (e.g. {info['sample_account']}).",
                    "Restart uvicorn, then ETL › Jobs › Rebuild reports.")
        elif not info["rebuilt_since_update"]:
            step = ("Dashboard data was built by the old version.", "ETL › Jobs › Rebuild reports.")
        elif company and not info["fact_rows_company"] and not has_all:
            have = ", ".join(str(c["company"]) for c in info["companies"]) or "none"
            step = (f"No ledger lines for company {company}.", f"Pick a company that has data: {have}.")
        elif not info["pl_accounts"]:
            step = ("No revenue or expense accounts found.", "Run ETL for MainAccounts, then ETL › Jobs › Rebuild reports.")
        else:
            step = (None, None)
        info["problem"], info["fix"] = step
        info["companies"] = [c for c in info["companies"] if security.can_see(security.current_user(), tenant, c["company"])]
        return info
    return db.retry(run)


@app.get("/api/report/etl-status")
def etl_status(tenant: int):
    return rows("""SELECT entity, last_run_utc, last_ok_utc FROM dw.vw_etl_status
                   WHERE tenant_key=:t ORDER BY entity""", t=tenant)


# ============================================================ admin =========
def require_admin():
    """Sign-in and the permission for each path are checked by security.AuthMiddleware."""
    if security.current_user() is None:
        raise HTTPException(401, "Please sign in.")


admin = [Depends(require_admin)]

import fs_reports                                  # noqa: E402  Reports module (Income statement, Balance sheet ...)
fs_reports.register(app, rows, admin, tn.engine)
security.register(app, tn.engine, store, log)    # sign-in, users, roles, audit log
health.register(app, tn.engine, os.path.join(HERE, "logs", "api.log"), API_VERSION)
audit_logs.register(app, tn.engine, os.path.join(HERE, "logs", "api.log"))
adjustments.register(app, tn.engine)               # adjustments & eliminations journal
settings = app_config.Settings(tn.engine, log)
app_config.register(app, tn.engine, store, settings)  # Administration › System Configuration
ai_assistant.register(app, store, settings, log, tn.engine)      # AI Assistant (local engine, read-only report data)

# ---- planning, close, consolidation and operations modules ----
import ageing, alerts, analytics, budget, consolidation, period_close, reconciliation, report_pack, scheduler  # noqa: E402,E401
from modlib import OpsSettings                                                                                # noqa: E402
ops = OpsSettings(tn.engine)
budget.register(app, tn.engine, rows)                       # Reports › Budget vs Actual
ageing.register(app, tn.engine)                             # Reports › Customer & Vendor Ageing
import bookmarks                                                                                 # noqa: E402
bookmarks.register(app, tn.engine)                          # star in the top bar → Home › Bookmarks
import manual_pdf                                                                                # noqa: E402
manual_pdf.register(app)                                    # System Manual › Download › PDF
import cash_forecast                                                                             # noqa: E402
cash_forecast.register(app, tn.engine, rows, FROM_GL, CASH_NAMES)   # Reports › Cash Flow Forecast
analytics.register(app, tn.engine, rows)                    # Dashboards › Sales / Purchasing / Fixed Assets
period_close.register(app, tn.engine, store, rows)                # Close › Period Close (locks adjustments)
consolidation.register(app, tn.engine, rows, settings, ops, store)   # Close › Consolidation
_pack_due = report_pack.register(app, tn.engine, settings, ops, store, log)   # Administration › Report Pack
_alerts_eval = alerts.register(app, tn.engine, ops, store, log)               # Administration › Alerts
_recon_nightly = reconciliation.register(app, tn.engine, ops, store, log)     # Close › Reconciliation


@app.on_event("startup")
def _start_scheduler():
    scheduler.start(log, _pack_due, _recon_nightly, _alerts_eval)


class TenantIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    aad_tenant_id: str = Field(min_length=1)
    client_id: str = Field(min_length=1)
    client_secret: str | None = None          # blank on edit = keep the stored secret
    base_url: str = Field(min_length=1)
    default_company: str | None = None
    is_active: bool = True


class TestIn(BaseModel):
    tenant_key: int | None = None             # set when testing a saved connection
    aad_tenant_id: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    base_url: str | None = None


class SyncIn(BaseModel):
    entities: list[str] | None = None         # None = all in entities.yaml
    full_reload: bool = False


@app.get("/api/admin/ping", dependencies=admin)
def ping():
    return {"ok": True}


@app.get("/api/admin/tenants", dependencies=admin)
def list_tenants():
    return tn.list_tenants()


@app.post("/api/admin/tenants", dependencies=admin)
def create_tenant(t: TenantIn):
    try:
        return tn.get_tenant(tn.save_tenant(t.model_dump()))
    except (ValueError, D365Error) as ex:
        raise HTTPException(400, str(ex))
    except Exception as ex:
        if "UNIQUE" in str(ex).upper() or "duplicate" in str(ex).lower():
            raise HTTPException(409, f"A connection named '{t.name}' already exists.")
        raise


@app.put("/api/admin/tenants/{key}", dependencies=admin)
def update_tenant(key: int, t: TenantIn):
    if not tn.get_tenant(key):
        raise HTTPException(404, "Connection not found")
    try:
        return tn.get_tenant(tn.save_tenant(t.model_dump(), key))
    except (ValueError, D365Error) as ex:
        raise HTTPException(400, str(ex))


@app.delete("/api/admin/tenants/{key}", dependencies=admin)
def delete_tenant(key: int, delete_data: bool = True):
    tn.delete_tenant(key, delete_data)
    return {"deleted": key}


@app.post("/api/admin/test-connection", dependencies=admin)
def test_connection(t: TestIn):
    """Token + legal entities. Works for unsaved form values or a saved connection."""
    try:
        secret = t.client_secret or (tn.stored_secret(t.tenant_key) if t.tenant_key else None)
        client = D365Client(t.aad_tenant_id, t.client_id, secret, t.base_url)
        companies = client.test()
        _, cmp = normalize_env_url(t.base_url)
        result = {"ok": True, "companies": companies, "company_from_url": cmp,
                  "message": f"Connected. {len(companies)} legal entities visible."}
    except (D365Error, KeyError, RuntimeError) as ex:
        result = {"ok": False, "companies": [], "message": str(ex)}
    except Exception as ex:
        result = {"ok": False, "companies": [], "message": f"Unexpected error: {ex}"}
    if t.tenant_key:
        tn.record_test(t.tenant_key, result["ok"], result["message"])
    return result


class EntityPick(BaseModel):
    name: str
    mode: str = "full"
    date_field: str | None = None
    enabled: bool = True
    table: str | None = None                  # stg table name; empty = derived from the entity name


def _need_tenant(key: int):
    if not tn.get_tenant(key):
        raise HTTPException(404, "Connection not found")


@app.get("/api/admin/tenants/{key}/entities", dependencies=admin)
def selected_entities(key: int):
    """Entities this connection syncs (seeded from entities.yaml the first time)."""
    _need_tenant(key)
    return catalog.get_selection(key)


@app.put("/api/admin/tenants/{key}/entities", dependencies=admin)
def save_entities(key: int, items: list[EntityPick]):
    _need_tenant(key)
    n = catalog.save_selection(key, [i.model_dump() for i in items])
    return {"saved": n, "entities": catalog.get_selection(key)}


@app.get("/api/admin/tenants/{key}/catalog", dependencies=admin)
def entity_catalog(key: int, refresh: bool = False):
    """Every public entity of the environment (from $metadata; cached, refresh=true re-reads D365)."""
    _need_tenant(key)
    try:
        md = catalog.get_metadata(key, refresh=refresh)
    except (D365Error, RuntimeError) as ex:
        raise HTTPException(400, str(ex))
    picked = {e["name"]: e for e in catalog.get_selection(key)}
    items = []
    for c in md.catalog():
        p = picked.get(c["name"])
        items.append({**c, "selected": bool(p), "mode": p["mode"] if p else None,
                      "date_field": p["date_field"] if p else None})
    return {"info": catalog.metadata_info(key), "entities": items}


@app.get("/api/admin/tenants/{key}/catalog/{entity}", dependencies=admin)
def entity_fields(key: int, entity: str):
    md = catalog.get_metadata(key)
    if not md.has(entity):
        raise HTTPException(404, f"{entity} not found")
    cols, keys = md.columns(entity)
    return {"name": entity, "keys": keys, "fields": [{"name": c, "type": t, "key": c in keys} for c, t in cols]}


@app.post("/api/admin/tenants/{key}/sync", dependencies=admin)
def start_sync(key: int, body: SyncIn):
    try:
        job_id = etl_sync.create_job(key, body.entities, body.full_reload,
                                     requested_by=(security.current_user() or {}).get("username", "api"))
    except KeyError:
        raise HTTPException(404, "Connection not found")
    except etl_sync.JobAlreadyRunning as ex:
        raise HTTPException(409, str(ex))
    _spawn_job(job_id)
    return {"job_id": job_id}


def _spawn_job(job_id: int):
    """Run the sync in its OWN process (etl.py --run-job N). The API stays fast while it runs, and the
    sync keeps going if the API window is closed or restarted. Output: etl/logs/job_<N>.log"""
    import subprocess
    logs = os.path.join(ETL_DIR, "logs")
    os.makedirs(logs, exist_ok=True)
    flags = 0
    if os.name == "nt":  # detach from the uvicorn console so Ctrl+C there does not stop the sync
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    with open(os.path.join(logs, f"job_{job_id}.log"), "ab") as out:
        p = subprocess.Popen([sys.executable, "-u", os.path.join(ETL_DIR, "etl.py"), "--run-job", str(job_id)],
                             cwd=ETL_DIR, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             creationflags=flags)
    try:
        with tn.engine().begin() as cn:
            cn.execute(text("UPDATE etl.sync_job SET worker_pid=:p, heartbeat_at=SYSUTCDATETIME() WHERE job_id=:j"),
                       {"p": p.pid, "j": job_id})
    except Exception as ex:  # bookkeeping only - the sync itself is already running
        log.warning("could not record worker pid for job %s: %s", job_id, str(ex)[:200])


@app.post("/api/admin/tenants/{key}/refresh-reporting", dependencies=admin)
def refresh_reporting(key: int):
    """Rebuild dw.dim_account / dw.fact_gl from the stg data already loaded (no D365 download)."""
    _need_tenant(key)
    msg = etl_sync._refresh_reporting(key)
    return {"ok": msg == "Dashboard data refreshed.", "message": msg}


@app.get("/api/admin/jobs/{job_id}", dependencies=admin)
def job(job_id: int):
    j = etl_sync.job_status(job_id)
    if not j:
        raise HTTPException(404, "Job not found")
    return j


@app.get("/api/admin/tenants/{key}/jobs", dependencies=admin)
def tenant_jobs(key: int, limit: int = Query(10, le=100)):
    with tn.engine().connect() as cn:
        return [dict(r) for r in cn.execute(text("""
            SELECT TOP (:n) job_id, status, full_reload, requested_by, started_at, finished_at, message,
                   (SELECT ISNULL(SUM(rows_loaded),0) FROM etl.run_log l WHERE l.job_id = j.job_id) AS rows_loaded
            FROM etl.sync_job j WHERE tenant_key=:k ORDER BY job_id DESC"""), {"n": limit, "k": key}).mappings()]


def admin_rows(sql: str, **p):
    def run():
        with tn.engine().connect() as cn:
            security.set_rls(cn)
            return [dict(r) for r in cn.execute(text(sql), p).mappings()]
    return db.retry(run)


@app.get("/api/admin/tenants/{key}/tables", dependencies=admin)
def tenant_tables(key: int):
    """Row counts of this connection's data per stg table (kept in etl.table_stats by the sync)."""
    return admin_rows("""SELECT 'stg.' + table_name AS [table], entity_name AS entity, row_count AS [rows],
                                last_loaded_rows, last_loaded_at AS last_loaded
                         FROM etl.table_stats WHERE tenant_key=:k ORDER BY table_name""", k=key)


# ------------------------------------------------------- ETL pages ----
@app.get("/api/admin/tenants/{key}/table-status", dependencies=admin)
def table_status(key: int):
    """Every D365 table chosen for this tenant + its SQL row count + its last ETL result (Jobs page)."""
    _need_tenant(key)
    last = {r["entity"]: r for r in admin_rows("""
        SELECT l.entity, l.status, l.rows_loaded, l.run_at, l.duration_sec, l.message, l.job_id
        FROM etl.run_log l
        JOIN (SELECT entity, MAX(id) AS id FROM etl.run_log WHERE tenant_key = :k GROUP BY entity) m ON m.id = l.id""",
        k=key)}
    stats = {r["table_name"]: r for r in admin_rows(
        "SELECT table_name, row_count, last_loaded_at FROM etl.table_stats WHERE tenant_key = :k", k=key)}
    out = []
    for e in catalog.get_selection(key):
        l, st = last.get(e["name"], {}), stats.get(e["table"], {})
        out.append({"name": e["name"], "table": e["table"], "mode": e["mode"], "date_field": e["date_field"],
                    "enabled": bool(e["enabled"]), "rows": st.get("row_count"), "last_loaded": st.get("last_loaded_at"),
                    "last_status": l.get("status"), "last_run": l.get("run_at"), "last_rows": l.get("rows_loaded"),
                    "last_seconds": l.get("duration_sec"), "last_message": l.get("message"), "last_job": l.get("job_id")})
    running = admin_rows("SELECT TOP 1 job_id FROM etl.sync_job WHERE tenant_key=:k AND status='Running' ORDER BY job_id DESC",
                         k=key)
    return {"tables": out, "running_job": running[0]["job_id"] if running else None}


@app.get("/api/admin/overview", dependencies=admin)
def overview():
    tenants = admin_rows("""
        SELECT t.tenant_key, t.name, t.base_url, t.default_company, t.is_active, t.last_sync_at, t.last_sync_status,
               (SELECT COUNT(*) FROM etl.tenant_entity e WHERE e.tenant_key=t.tenant_key AND e.enabled=1) AS entities,
               (SELECT COUNT(*) FROM etl.table_stats s WHERE s.tenant_key=t.tenant_key) AS tables_loaded,
               (SELECT ISNULL(SUM(row_count),0) FROM etl.table_stats s WHERE s.tenant_key=t.tenant_key) AS total_rows
        FROM etl.tenant t ORDER BY t.name""")
    totals = admin_rows("""
        SELECT (SELECT COUNT(*) FROM etl.sync_job WHERE status='Running') AS running_jobs,
               (SELECT COUNT(*) FROM etl.sync_job WHERE started_at >= DATEADD(day,-7,SYSUTCDATETIME())) AS jobs_7d,
               (SELECT COUNT(*) FROM etl.run_log WHERE status='FAILED' AND run_at >= DATEADD(day,-7,SYSUTCDATETIME())) AS failures_7d,
               (SELECT ISNULL(SUM(row_count),0) FROM etl.table_stats) AS total_rows,
               (SELECT COUNT(*) FROM etl.table_stats) AS tables_loaded""")[0]
    db_size = admin_rows("""SELECT CAST(SUM(CAST(size AS bigint)) * 8 / 1024.0 AS decimal(12,1)) AS data_mb,
                                   CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition
                            FROM sys.database_files WHERE type = 0""")[0]
    recent = jobs(limit=8)
    return {"tenants": tenants, "totals": totals, "database": db_size, "recent_jobs": recent}


@app.get("/api/admin/summary", dependencies=admin)
def summary(tenant: int | None = None):
    """Home page: one view of the whole project - companies with their figures, the group's monthly
    revenue / expenses, ETL health, dashboard build and FS-mapping coverage."""
    tenants = admin_rows("SELECT tenant_key, name, default_company, report_at, report_msg FROM etl.tenant WHERE is_active = 1 ORDER BY name") \
        if admin_rows("SELECT COL_LENGTH('etl.tenant', 'report_msg') AS c")[0]["c"] else \
        admin_rows("SELECT tenant_key, name, default_company, NULL AS report_at, NULL AS report_msg FROM etl.tenant WHERE is_active = 1 ORDER BY name")
    tenants = [x for x in tenants if security.can_see(security.current_user(), x["tenant_key"], None)]
    if not tenants:
        return {"tenant": None}
    t = next((x for x in tenants if x["tenant_key"] == tenant), tenants[0])
    k = t["tenant_key"]
    last = admin_rows("SELECT MAX(accounting_date) AS d FROM dw.fact_gl WHERE tenant_key=:k AND is_close=0", k=k)[0]["d"]
    year = min(date.today().year, last.year) if last else date.today().year
    names = {}
    if admin_rows("SELECT OBJECT_ID('stg.legal_entities') AS o")[0]["o"]:
        names = {str(r["c"]).lower(): r["n"] for r in admin_rows(
            "SELECT LegalEntityId AS c, Name AS n FROM stg.legal_entities WHERE _tenant_key=:k", k=k)}
    cos = admin_rows(f"""
        SELECT LOWER(f.company) AS company, COUNT_BIG(*) AS lines, MIN(f.accounting_date) AS first_date, MAX(f.accounting_date) AS last_date,
               SUM(CASE WHEN YEAR(f.accounting_date)=:y AND a.pl_group='Revenue' THEN -f.amount ELSE 0 END) AS revenue,
               SUM(CASE WHEN YEAR(f.accounting_date)=:y AND a.pl_group='Expense' THEN f.amount ELSE 0 END) AS expenses,
               SUM(CASE WHEN YEAR(f.accounting_date)=:y-1 AND a.pl_group='Revenue' THEN -f.amount ELSE 0 END) AS prev_revenue,
               SUM(CASE WHEN YEAR(f.accounting_date)=:y-1 AND a.pl_group='Expense' THEN f.amount ELSE 0 END) AS prev_expenses,
               SUM(CASE WHEN a.pl_group NOT IN ('Revenue','Expense','OCI') AND a.bs_group='Asset' THEN f.amount ELSE 0 END) AS assets,
               SUM(CASE WHEN a.pl_group NOT IN ('Revenue','Expense','OCI') AND {CASH_NAMES} THEN f.amount ELSE 0 END) AS cash
        FROM dw.fact_gl f LEFT JOIN dw.dim_account a ON a.tenant_key=f.tenant_key AND a.main_account=f.main_account
        WHERE f.tenant_key=:k AND f.is_close=0
        GROUP BY LOWER(f.company) ORDER BY COUNT_BIG(*) DESC""", k=k, y=year)
    for c in cos:
        c["name"] = names.get(c["company"], "")
        for f_ in ("revenue", "expenses", "prev_revenue", "prev_expenses", "assets", "cash"):
            c[f_] = float(c[f_] or 0)
        c["net"] = c["revenue"] - c["expenses"]
    u = security.current_user()
    names = {co: n for co, n in names.items() if security.can_see(u, k, co)}
    for co, n in names.items():                       # companies in D365 without postings
        if not any(c["company"] == co for c in cos):
            cos.append({"company": co, "name": n, "lines": 0, "first_date": None, "last_date": None, "revenue": 0.0,
                        "expenses": 0.0, "prev_revenue": 0.0, "prev_expenses": 0.0, "assets": 0.0, "cash": 0.0, "net": 0.0})
    monthly = admin_rows("""
        SELECT MONTH(f.accounting_date) AS m,
               SUM(CASE WHEN a.pl_group='Revenue' THEN -f.amount ELSE 0 END) AS revenue,
               SUM(CASE WHEN a.pl_group='Expense' THEN f.amount ELSE 0 END) AS expenses
        FROM dw.fact_gl f JOIN dw.dim_account a ON a.tenant_key=f.tenant_key AND a.main_account=f.main_account
        WHERE f.tenant_key=:k AND f.is_close=0 AND YEAR(f.accounting_date)=:y GROUP BY MONTH(f.accounting_date)""", k=k, y=year)
    rev, exp = [None] * 12, [None] * 12
    for r in monthly:
        rev[r["m"] - 1], exp[r["m"] - 1] = float(r["revenue"] or 0), float(r["expenses"] or 0)
    mapping = {"accounts": 0, "workbook": 0}
    if admin_rows("SELECT OBJECT_ID('rpt.fs_map') AS o")[0]["o"]:
        mapping = admin_rows("""
            SELECT COUNT(*) AS accounts, SUM(CASE WHEN m.main_account IS NOT NULL THEN 1 ELSE 0 END) AS workbook
            FROM (SELECT DISTINCT main_account FROM dw.fact_gl WHERE tenant_key=:k) f
            LEFT JOIN (SELECT DISTINCT main_account FROM rpt.fs_map WHERE tenant_key IS NULL OR tenant_key=:k) m
                   ON m.main_account = f.main_account""", k=k)[0]
    matched = admin_rows("""SELECT COUNT_BIG(*) AS n,
                                   SUM(CASE WHEN a.main_account IS NULL THEN 0 ELSE 1 END) AS matched
                            FROM dw.fact_gl f LEFT JOIN dw.dim_account a ON a.tenant_key=f.tenant_key AND a.main_account=f.main_account
                            WHERE f.tenant_key=:k""", k=k)[0]
    return {"tenant": {"tenant_key": k, "name": t["name"], "default_company": t["default_company"]},
            "tenants": [{"tenant_key": x["tenant_key"], "name": x["name"]} for x in tenants],
            "year": year, "last_posting": last, "companies": cos,
            "monthly": {"revenue": rev, "expenses": exp},
            "build": {"at": t["report_at"], "message": t["report_msg"]},
            "mapping": {"accounts": mapping["accounts"] or 0, "workbook": mapping["workbook"] or 0},
            "ledger": {"lines": matched["n"] or 0, "matched": matched["matched"] or 0}}


@app.get("/api/admin/jobs", dependencies=admin)
def jobs(tenant: int | None = None, status: str | None = None, limit: int = Query(50, le=500)):
    return admin_rows("""
        SELECT TOP (:n) j.job_id, j.tenant_key, t.name AS tenant, j.status, j.full_reload, j.requested_by,
               j.started_at, j.finished_at, j.message,
               DATEDIFF(second, j.started_at, ISNULL(j.finished_at, SYSUTCDATETIME())) AS seconds,
               (SELECT COUNT(*) FROM etl.run_log l WHERE l.job_id=j.job_id AND l.status='OK') AS ok_entities,
               (SELECT COUNT(*) FROM etl.run_log l WHERE l.job_id=j.job_id AND l.status='FAILED') AS failed_entities,
               (SELECT ISNULL(SUM(CAST(rows_loaded AS bigint)),0) FROM etl.run_log l WHERE l.job_id=j.job_id) AS rows_loaded
        FROM etl.sync_job j JOIN etl.tenant t ON t.tenant_key = j.tenant_key
        WHERE (:t IS NULL OR j.tenant_key = :t) AND (:s IS NULL OR j.status = :s)
        ORDER BY j.job_id DESC""", n=limit, t=tenant, s=status)


@app.get("/api/admin/counts", dependencies=admin)
def counts(tenant: int | None = None):
    return admin_rows("""
        SELECT s.tenant_key, t.name AS tenant, 'stg.' + s.table_name AS [table], s.entity_name AS entity,
               s.row_count AS [rows], s.last_loaded_rows, s.last_loaded_at
        FROM etl.table_stats s JOIN etl.tenant t ON t.tenant_key = s.tenant_key
        WHERE (:t IS NULL OR s.tenant_key = :t)
        ORDER BY s.row_count DESC""", t=tenant)


@app.post("/api/admin/counts/recount", dependencies=admin)
def recount(tenant: int):
    """Recount every stg table for one connection (fills the Counts page for data loaded before it existed)."""
    _need_tenant(tenant)
    names = [r["name"] for r in admin_rows("""
        SELECT t.name FROM sys.tables t WHERE t.schema_id = SCHEMA_ID('stg')
          AND COL_LENGTH('stg.' + QUOTENAME(t.name), '_tenant_key') IS NOT NULL""")]
    sel = {e["table"]: e["name"] for e in catalog.get_selection(tenant)}
    done = 0
    for n in names:
        def run(n=n):
            with tn.engine().begin() as cn:
                c = cn.execute(text(f"SELECT COUNT_BIG(*) FROM stg.[{n}] WHERE _tenant_key=:k"), {"k": tenant}).scalar()
                if not c:
                    return 0
                cn.execute(text("DELETE etl.table_stats WHERE tenant_key=:k AND table_name=:t"), {"k": tenant, "t": n})
                cn.execute(text("""INSERT etl.table_stats (tenant_key, table_name, entity_name, row_count)
                                   VALUES (:k, :t, :e, :c)"""), {"k": tenant, "t": n, "e": sel.get(n), "c": c})
                return 1
        done += db.retry(run)
    return {"tables": done}


@app.get("/api/admin/history", dependencies=admin)
def history(tenant: int | None = None, status: str | None = None, entity: str | None = None,
            limit: int = Query(100, le=1000), offset: int = 0):
    where = "(:t IS NULL OR l.tenant_key = :t) AND (:s IS NULL OR l.status = :s) AND (:e IS NULL OR l.entity LIKE :e)"
    p = {"t": tenant, "s": status, "e": f"%{entity}%" if entity else None}
    total = admin_rows(f"SELECT COUNT(*) AS n FROM etl.run_log l WHERE {where}", **p)[0]["n"]
    items = admin_rows(f"""
        SELECT l.id, l.job_id, l.tenant_key, t.name AS tenant, l.entity, l.status, l.rows_loaded,
               l.duration_sec, l.run_at, l.message
        FROM etl.run_log l JOIN etl.tenant t ON t.tenant_key = l.tenant_key
        WHERE {where}
        ORDER BY l.id DESC OFFSET :o ROWS FETCH NEXT :n ROWS ONLY""", o=offset, n=limit, **p)
    return {"total": total, "items": items}

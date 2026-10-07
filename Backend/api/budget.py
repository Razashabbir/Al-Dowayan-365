"""Budget vs Actual (Reports › Budget vs Actual).

Budgets are uploaded per company and year (CSV or Excel: one row per main account, columns Jan..Dec) or generated
from last year's actuals plus a growth %. Amounts use the natural sign: revenue and expenses both positive.
Actuals come from dw.vw_account_monthly (same data as the dashboards, year-end closing excluded, RLS applied).
"""
import base64
import csv
import io
import re

from fastapi import HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text

import security
from modlib import MONTHS, need_company, num

MONTH_KEYS = {m.lower(): i + 1 for i, m in enumerate(MONTHS)}
MONTH_KEYS.update({n: i + 1 for i, n in enumerate(["january", "february", "march", "april", "may", "june", "july",
                                                   "august", "september", "october", "november", "december"])})
MONTH_KEYS.update({str(i): i for i in range(1, 13)})
MONTH_KEYS.update({f"m{i}": i for i in range(1, 13)})


class UploadIn(BaseModel):
    tenant_key: int
    company: str
    year: int
    name: str = Field(min_length=1, max_length=100)
    filename: str
    content_b64: str


class GenerateIn(BaseModel):
    tenant_key: int
    company: str
    year: int
    name: str = Field(min_length=1, max_length=100)
    growth_pct: float = 0


def _cells(filename: str, raw: bytes) -> list[list]:
    if filename.lower().endswith((".xlsx", ".xlsm")):
        try:
            import openpyxl
        except ImportError:
            raise HTTPException(400, "Reading Excel needs openpyxl (pip install openpyxl) - or upload the CSV template.")
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
        ws = wb.worksheets[0]
        return [list(r) for r in ws.iter_rows(values_only=True)]
    txt = raw.decode("utf-8-sig", errors="replace")
    dialect = csv.Sniffer().sniff(txt[:2000], delimiters=",;\t") if txt.strip() else csv.excel
    return [r for r in csv.reader(io.StringIO(txt), dialect)]


def _parse(filename: str, raw: bytes) -> dict:
    rows = _cells(filename, raw)
    head_i, acc_col, mcols = None, None, {}
    for i, r in enumerate(rows[:20]):                     # find the header row
        keys = [re.sub(r"[^a-z0-9]", "", str(c or "").lower()) for c in r]
        months = {j: MONTH_KEYS[k] for j, k in enumerate(keys) if k in MONTH_KEYS}
        acc = next((j for j, k in enumerate(keys) if k in ("account", "mainaccount", "accountno", "accountnumber", "mainaccountid", "code")), None)
        if acc is not None and len(months) >= 1:
            head_i, acc_col, mcols = i, acc, months
            break
    if head_i is None:
        raise HTTPException(400, "Header row not found: the file needs a column 'Account' and month columns Jan..Dec (download the template).")
    out, bad = {}, []
    for n, r in enumerate(rows[head_i + 1:], start=head_i + 2):
        acc = str(r[acc_col] if acc_col < len(r) and r[acc_col] is not None else "").strip()
        if acc.endswith(".0"):
            acc = acc[:-2]
        if not acc or acc.lower().startswith("total"):
            continue
        for j, m in mcols.items():
            v = r[j] if j < len(r) else None
            if v in (None, ""):
                continue
            try:
                amt = float(str(v).replace(",", "").replace(" ", "")) if not isinstance(v, (int, float)) else float(v)
            except ValueError:
                bad.append(f"row {n} {MONTHS[m - 1]}")
                continue
            out[(acc, m)] = out.get((acc, m), 0.0) + amt
    if bad:
        raise HTTPException(400, f"Not a number: {', '.join(bad[:8])}{' …' if len(bad) > 8 else ''}.")
    if not out:
        raise HTTPException(400, "The file has no amounts.")
    return out


def register(app, engine, rows):
    def _save(t, c, y, name, src, amounts: dict):
        u = security.current_user()
        with engine().begin() as cn:
            old = cn.execute(text("SELECT budget_id FROM bud.budget WHERE tenant_key=:t AND company=:c AND [year]=:y AND name=:n"),
                             {"t": t, "c": c, "y": y, "n": name}).scalar()
            if old:
                cn.execute(text("DELETE FROM bud.budget WHERE budget_id=:b"), {"b": old})
            bid = cn.execute(text("""INSERT INTO bud.budget (tenant_key, company, [year], name, source, created_by)
                                     OUTPUT inserted.budget_id VALUES (:t, :c, :y, :n, :s, :u)"""),
                             {"t": t, "c": c, "y": y, "n": name, "s": src[:200], "u": u and u["username"]}).scalar()
            cn.execute(text("INSERT INTO bud.line (budget_id, main_account, [month], amount) VALUES (:b, :a, :m, :v)"),
                       [{"b": bid, "a": a, "m": m, "v": round(v, 2)} for (a, m), v in amounts.items()])
        return bid

    @app.get("/api/report/budget/list")
    def budgets(tenant: int, company: str):
        with engine().connect() as cn:
            return [dict(r) for r in cn.execute(text("""
                SELECT b.budget_id, b.[year], b.name, b.source, b.created_by, b.created_at,
                       (SELECT COUNT(DISTINCT main_account) FROM bud.line l WHERE l.budget_id = b.budget_id) AS accounts,
                       (SELECT SUM(amount) FROM bud.line l WHERE l.budget_id = b.budget_id) AS total
                FROM bud.budget b WHERE b.tenant_key = :t AND b.company = :c ORDER BY b.[year] DESC, b.name"""),
                {"t": tenant, "c": company.lower()}).mappings()]

    @app.get("/api/report/budget/template")
    def template(tenant: int, company: str, year: int):
        """CSV with every P&L account and last year's actual per month as a starting point."""
        acts = rows("""SELECT main_account, MAX(account_name) AS account_name, MAX(pl_group) AS pl_group, [month],
                              SUM(CASE WHEN pl_group = 'Revenue' THEN -amount ELSE amount END) AS amount
                       FROM dw.vw_account_monthly WHERE tenant_key=:t AND company=:c AND [year]=:y AND pl_group IN ('Revenue','Expense')
                       GROUP BY main_account, [month]""", t=tenant, c=company, y=year - 1)
        accts = rows("""SELECT main_account, account_name, pl_group FROM dw.dim_account
                        WHERE tenant_key=:t AND pl_group IN ('Revenue','Expense') ORDER BY main_account""", t=tenant, c=company)
        by = {}
        for r in acts:
            by.setdefault(r["main_account"], {})[r["month"]] = num(r["amount"])
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(["Account", "Account name", "Type"] + MONTHS)
        for a in accts:
            w.writerow([a["main_account"], a["account_name"] or "", a["pl_group"]] + [round(by.get(a["main_account"], {}).get(m, 0), 2) for m in range(1, 13)])
        return Response(out.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="budget_{company}_{year}.csv"'})

    @app.post("/api/admin/budget/upload")
    def upload(body: UploadIn):
        need_company(body.tenant_key, body.company)
        try:
            raw = base64.b64decode(body.content_b64.split(",")[-1])
        except ValueError:
            raise HTTPException(400, "The file could not be read.")
        if len(raw) > 5_000_000:
            raise HTTPException(400, "The file is larger than 5 MB.")
        amounts = _parse(body.filename, raw)
        bid = _save(body.tenant_key, body.company.lower(), body.year, body.name.strip(), body.filename, amounts)
        return {"ok": True, "budget_id": bid, "accounts": len({a for a, _ in amounts}), "cells": len(amounts)}

    @app.post("/api/admin/budget/generate")
    def generate(body: GenerateIn):
        need_company(body.tenant_key, body.company)
        acts = rows("""SELECT main_account, [month], SUM(CASE WHEN pl_group = 'Revenue' THEN -amount ELSE amount END) AS amount
                       FROM dw.vw_account_monthly WHERE tenant_key=:t AND company=:c AND [year]=:y AND pl_group IN ('Revenue','Expense')
                       GROUP BY main_account, [month]""", t=body.tenant_key, c=body.company, y=body.year - 1)
        if not acts:
            raise HTTPException(400, f"No actuals in {body.year - 1} to build the budget from.")
        f = 1 + body.growth_pct / 100
        amounts = {(r["main_account"], int(r["month"])): num(r["amount"]) * f for r in acts}
        src = f"{body.year - 1} actuals {'+' if body.growth_pct >= 0 else ''}{body.growth_pct:g}%"
        bid = _save(body.tenant_key, body.company.lower(), body.year, body.name.strip(), src, amounts)
        return {"ok": True, "budget_id": bid, "accounts": len({a for a, _ in amounts})}

    @app.delete("/api/admin/budget/{budget_id}")
    def delete(budget_id: int):
        with engine().begin() as cn:
            b = cn.execute(text("SELECT tenant_key, company FROM bud.budget WHERE budget_id=:b"), {"b": budget_id}).mappings().first()
            if not b:
                raise HTTPException(404, "Budget not found.")
            need_company(b["tenant_key"], b["company"])
            cn.execute(text("DELETE FROM bud.budget WHERE budget_id=:b"), {"b": budget_id})
        return {"ok": True}

    @app.get("/api/report/budget/variance")
    def variance(tenant: int, company: str, budget_id: int, month: int = Query(12, ge=1, le=12)):
        """Actual vs budget per account and month; YTD = Jan..month. Favourable variance is positive."""
        with engine().connect() as cn:
            b = cn.execute(text("SELECT * FROM bud.budget WHERE budget_id=:b AND tenant_key=:t AND company=:c"),
                           {"b": budget_id, "t": tenant, "c": company.lower()}).mappings().first()
            if not b:
                raise HTTPException(404, "Budget not found for this company.")
            bl = [dict(r) for r in cn.execute(text("SELECT main_account, [month], amount FROM bud.line WHERE budget_id=:b"), {"b": budget_id}).mappings()]
        y = b["year"]
        acts = rows("""SELECT main_account, MAX(account_name) AS account_name, MAX(pl_group) AS pl_group, [month],
                              SUM(CASE WHEN pl_group = 'Revenue' THEN -amount ELSE amount END) AS amount
                       FROM dw.vw_account_monthly WHERE tenant_key=:t AND company=:c AND [year]=:y AND pl_group IN ('Revenue','Expense')
                       GROUP BY main_account, [month]""", t=tenant, c=company, y=y)
        names = {r["main_account"]: r for r in rows("""SELECT main_account, account_name, pl_group FROM dw.dim_account
                                                      WHERE tenant_key=:t""", t=tenant, c=company)}
        acc = {}

        def row(a):
            n = names.get(a) or {}
            return acc.setdefault(a, {"main_account": a, "account_name": n.get("account_name") or "", "group": n.get("pl_group") or "Expense",
                                      "actual": [0.0] * 12, "budget": [0.0] * 12})
        for r in acts:
            e = row(r["main_account"])
            e["group"] = r["pl_group"] or e["group"]
            e["actual"][r["month"] - 1] += num(r["amount"])
        for r in bl:
            row(r["main_account"])["budget"][r["month"] - 1] += num(r["amount"])
        lines = []
        for e in acc.values():
            if e["group"] not in ("Revenue", "Expense"):
                continue
            a_ytd, b_ytd = sum(e["actual"][:month]), sum(e["budget"][:month])
            sign = 1 if e["group"] == "Revenue" else -1                 # more revenue / less cost = favourable
            e.update(actual_ytd=a_ytd, budget_ytd=b_ytd, variance=sign * (a_ytd - b_ytd),
                     variance_pct=(a_ytd - b_ytd) / abs(b_ytd) * 100 if abs(b_ytd) > 0.5 else None,
                     actual_month=e["actual"][month - 1], budget_month=e["budget"][month - 1],
                     full_year_budget=sum(e["budget"]))
            if abs(a_ytd) + abs(b_ytd) + abs(e["full_year_budget"]) > 0.5:
                lines.append(e)
        lines.sort(key=lambda e: (e["group"] != "Revenue", e["main_account"]))

        def tot(g, k):
            return sum(e[k] for e in lines if e["group"] == g)
        months = []
        for i in range(12):
            ra = sum(e["actual"][i] for e in lines if e["group"] == "Revenue"); rb = sum(e["budget"][i] for e in lines if e["group"] == "Revenue")
            xa = sum(e["actual"][i] for e in lines if e["group"] == "Expense"); xb = sum(e["budget"][i] for e in lines if e["group"] == "Expense")
            months.append({"month": i + 1, "revenue_actual": ra, "revenue_budget": rb, "expense_actual": xa, "expense_budget": xb,
                           "net_actual": ra - xa, "net_budget": rb - xb})
        totals = {g: {"actual": tot(g, "actual_ytd"), "budget": tot(g, "budget_ytd"), "full_year_budget": tot(g, "full_year_budget")}
                  for g in ("Revenue", "Expense")}
        totals["Net"] = {k: totals["Revenue"][k] - totals["Expense"][k] for k in ("actual", "budget", "full_year_budget")}
        return {"budget": {k: b[k] for k in ("budget_id", "name", "year", "source", "created_by")}, "month": month,
                "lines": lines, "months": months, "totals": totals}

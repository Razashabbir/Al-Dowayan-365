"""AI Assistant (local engine): answers questions about the figures from the reporting database - fully local.

No AI model, no internet, no API key. The question is read with a built-in finance vocabulary
(revenue, expenses, profit, margin, cash, receivables, payables, balance sheet, cash flow, trial balance,
projects, accounts, months, years, companies, "why", "compare", "top 5", "by month" ...), the matching
reports are read and the answer is calculated and written as text, tables and a chart.

Security: every number comes from an existing report endpoint, called in-process *as the signed-in user*
with the same permission, company (row-level security) and report-access checks as the dashboards.
It only reads. Every question is written to the audit log (action ai.question).
"""
import re
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from pydantic import BaseModel, Field

import security

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_WORDS = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                               "september", "october", "november", "december"])}
MONTH_WORDS.update({m.lower(): i + 1 for i, m in enumerate(MONTHS)})
MONTH_WORDS.update({"sept": 9, "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "ابريل": 4, "مايو": 5, "يونيو": 6, "يوليو": 7,
                    "أغسطس": 8, "اغسطس": 8, "سبتمبر": 9, "أكتوبر": 10, "اكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12})

# report endpoints the assistant may read: name -> (path, fixed query params)
SOURCES = {
    "companies": ("/api/report/companies-all", {}),
    "years": ("/api/report/years", {}),
    "kpis": ("/api/report/kpis", {}),
    "monthly": ("/api/report/pnl-monthly", {}),
    "pnl": ("/api/report/pnl", {}),
    "is": ("/api/report/fs/statement", {"kind": "IS"}),
    "bs": ("/api/report/fs/statement", {"kind": "BS"}),
    "cf": ("/api/report/fs/cashflow", {}),
    "tb": ("/api/report/trial-balance-full", {}),
    "balance": ("/api/report/balance-sheet", {}),
    "expenses": ("/api/report/expenses", {}),
    "cash": ("/api/report/cash", {}),
    "arap": ("/api/report/ar-ap", {}),
    "projects": ("/api/report/projects", {}),
}
LABELS = {"companies": "Companies", "years": "Years", "kpis": "KPIs", "monthly": "Monthly P&L", "pnl": "Profit & Loss by account",
          "is": "Income Statement", "bs": "Financial Position", "cf": "Cash Flow", "tb": "Trial Balance",
          "balance": "Balance Sheet", "expenses": "Expenses", "cash": "Cash & Bank", "arap": "Receivables & Payables",
          "projects": "Projects"}

# intent -> words that point to it (English + Arabic)
WORDS = {
    "help": ["help", "what can you", "how do i use", "hello", "hi ", "hey", "مرحبا", "مساعدة", "ماذا يمكنك"],
    "why": ["why", "driver", "drove", "drive", "reason", "explain", "cause", "behind", "variance", "لماذا", "سبب"],
    "revenue": ["revenue", "sales", "turnover", "income from", "rental income", "earned", "الإيرادات", "ايرادات", "مبيعات"],
    "expense": ["expense", "cost", "spend", "spent", "spending", "overhead", "opex", "المصروفات", "مصروفات", "تكاليف"],
    "profit": ["profit", "net income", "earnings", "loss", "margin", "bottom line", "الربح", "أرباح", "صافي"],
    "monthly": ["by month", "monthly", "each month", "per month", "month by month", "trend", "over the year", "شهري"],
    "bs": ["balance sheet", "financial position", "assets", "liabilities", "equity", "balanced", "net worth",
           "الميزانية", "المركز المالي", "الأصول", "الخصوم"],
    "cash": ["cash", "bank", "liquidity", "النقد", "البنك"],
    "ar": ["receivable", "debtor", "dso", "owe us", "customers owe", "collection", "المدينين", "الذمم المدينة"],
    "ap": ["payable", "creditor", "dpo", "we owe", "suppliers", "vendors", "الدائنين", "الذمم الدائنة"],
    "project": ["project", "projects", "مشروع", "المشاريع"],
    "tb": ["trial balance", "debit", "credit", "ميزان المراجعة"],
    "cf": ["cash flow", "cashflow", "operating activities", "investing", "financing", "التدفقات النقدية"],
    "is": ["income statement", "p&l statement", "profit and loss statement", "statement of profit", "قائمة الدخل"],
    "companies": ["by company", "each company", "every company", "all companies", "compare companies", "per company",
                  "which company", "companies", "group", "consolidated", "الشركات"],
    "summary": ["summary", "summarise", "summarize", "overview", "performance", "how are we", "how did we", "highlights",
                "health", "ملخص", "الأداء"],
    "top": ["top", "biggest", "largest", "highest", "most", "main", "major", "أكبر", "أعلى"],
    "compare": ["compare", " vs", "versus", "against", "last year", "previous year", "prior year", "growth", "change",
                "increase", "decrease", "grew", "fell", "than", "مقارنة"],
}
STOP = set("""the a an of for in on at to and or is are was were be been our we us my me i you your what which who how much many
show give tell list please can could would should this that these those with from by as it its do does did about than vs year years
month months total amount balance value figure figures number numbers account accounts company companies current last previous
prior compare compared versus top biggest largest highest most main major ytd full whole jan feb mar apr may jun jul aug sep sept oct nov dec
january february march april june july august september october november december report reports data all each every per""".split())


class Ask(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=8000)


class ChatIn(BaseModel):
    messages: list[Ask] = Field(min_length=1, max_length=60)
    tenant: int | None = None
    company: str | None = None
    year: int | None = None
    month: int | None = None
    chat_id: int | None = None


class NoData(Exception):
    pass


def _num(v):
    if v is None:
        return 0.0
    return float(v) if isinstance(v, (Decimal, int, float)) else float(v or 0)


def _endpoint(app, path):
    for r in app.routes:
        if getattr(r, "path", None) == path and "GET" in (getattr(r, "methods", None) or ()):
            return r.endpoint
    return None


class Engine:
    def __init__(self, app, settings, body: ChatIn):
        self.app, self.cfg, self.body = app, settings.all(), body
        self.u = security.current_user()
        self.used = []
        self.chart = None

    # ------------------------------------------------------------------ data access ----
    def get(self, name, **params):
        """Read one report as the signed-in user (same checks as the HTTP middleware)."""
        path, fixed = SOURCES[name]
        params = {**params, **fixed}
        if "company" in params and params["company"] is not None:
            params["company"] = str(params["company"]).lower()
        perm = security.needed("GET", path)
        opts = perm if isinstance(perm, tuple) else (perm,)
        if perm not in ("public", None) and not any(p in self.u["permissions"] for p in opts):
            raise NoData(f"your role ({self.u['role']}) cannot see the {LABELS[name]} report")
        if not security.can_see(self.u, params.get("tenant"), params.get("company") or None):
            raise NoData(f"you have no access to company {str(params.get('company')).upper()}")
        if not security.page_ok(self.u, path, {"kind": params.get("kind", "IS")}):
            raise NoData(f"the {LABELS[name]} report is not enabled for your user")
        fn = _endpoint(self.app, path)
        if fn is None:
            raise NoData(f"the {LABELS[name]} report is not available")
        try:
            data = fn(**params)
        except HTTPException as ex:
            raise NoData(str(ex.detail))
        label = LABELS[name]
        if params.get("company"):
            label += f" · {'all companies' if params['company'] == '*' else params['company'].upper()}"
        if params.get("year"):
            label += f" · {params['year']}"
        if label not in [s["label"] for s in self.used]:
            self.used.append({"tool": name, "label": label, "ok": True})
        return data

    # ------------------------------------------------------------------ formatting ----
    def n(self, v, sign=False):
        v = _num(v)
        d = int(self.cfg.get("decimals") or 0)
        s = f"{abs(v):,.{d}f}"
        if v < 0:
            s = f"({s})" if self.cfg.get("negatives") == "brackets" else f"-{s}"
        elif sign and v > 0:
            s = f"+{s}"
        return s

    def m(self, v, sign=False):
        return f"{self.n(v, sign)} {self.cfg.get('currency') or ''}".strip()

    @staticmethod
    def pct(cur, prev):
        cur, prev = _num(cur), _num(prev)
        if abs(prev) < 0.5:
            return "n/a"
        p = (cur - prev) / abs(prev) * 100
        return f"{'+' if p >= 0 else ''}{p:.1f}%"

    @staticmethod
    def table(head, rows, right=None):
        right = right if right is not None else set(range(1, len(head)))
        out = ["| " + " | ".join(head) + " |", "|" + "|".join("---:" if i in right else "---" for i in range(len(head))) + "|"]
        out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
        return "\n".join(out)

    def period(self, y, m, single=False):
        if single:
            return f"{MONTHS[m - 1]} {y}"
        return f"{y}" if m == 12 else f"Jan–{MONTHS[m - 1]} {y}"

    # ------------------------------------------------------------------ understanding ----
    def parse(self, q):
        s = " " + re.sub(r"\s+", " ", q.lower().replace("’", "'")) + " "
        has = {k: any(w in s for w in ws) for k, ws in WORDS.items()}
        b = self.body
        today = date.today()
        cy = b.year or today.year
        cm = b.month or (today.month if cy == today.year else 12)

        years = [int(y) for y in re.findall(r"\b(20\d\d)\b", s)]
        year = years[0] if years else cy
        compare_year = years[1] if len(years) > 1 else None
        if not years and re.search(r"\b(last|previous|prior) year\b", s) and not re.search(r"(than|vs|versus|against|compared?|to) (the )?(last|previous|prior) year", s):
            year = cy - 1

        month, single = None, False
        for w, i in MONTH_WORDS.items():
            if re.search(rf"(?<![a-z]){re.escape(w)}(?![a-z])", s):
                month = i
                single = bool(re.search(rf"\b(in|for|during|of|month of)\s+{re.escape(w)}\b", s)) and not re.search(
                    r"\b(to|until|till|up to|through|ytd|year to date|as at|as of|end of)\b", s)
                break
        qm = re.search(r"\bq([1-4])\b", s)
        if month is None and qm:
            month = int(qm.group(1)) * 3
        if month is None:
            month = 12 if (re.search(r"\b(full|whole) year\b", s) or (years and year != cy) or year < cy) else cm
        if "this month" in s or "current month" in s:
            month, single = cm, True

        top = re.search(r"\b(?:top|biggest|largest|highest)\s+(\d{1,2})\b", s)
        acct = [a for a in re.findall(r"\b(\d{5,9})\b", s) if not re.fullmatch(r"20\d\d", a)]

        # company: id or name of a company the user may see
        comps = []
        try:
            comps = self.get("companies")
        except NoData:
            pass
        tenant, company = b.tenant, (b.company or "").lower() or None
        named = None
        for c in comps:
            cid = c["company"].lower()
            words = [w for w in re.findall(r"[a-z]{4,}", (c.get("name") or "").lower()) if w not in ("dowayan", "aldowayan", "company", "holding", "trading", "group", "limited")]
            if re.search(rf"\b{re.escape(cid)}\b", s) or any(re.search(rf"\b{w}\b", s) for w in words):
                named = c
                break
        if named:
            tenant, company = named["tenant_key"], named["company"].lower()
        known = {c["company"].lower() for c in comps}
        blocked = [x for x in re.findall(r"\b(\d\d[a-z]{2})\b", s) if x not in known]
        if tenant is None and comps:
            d = next((c for c in comps if c.get("is_default")), comps[0])
            tenant, company = d["tenant_key"], d["company"].lower()
        if not b.year and tenant is not None and company:
            try:                                   # no period on the page: use the latest year with ledger data
                ys = [int(r["year"]) for r in self.get("years", tenant=tenant, company=company)]
                self.used = [x for x in self.used if x["tool"] != "years"]
                latest = max((y for y in ys if y <= today.year), default=None)
                if latest and latest < cy:
                    if year == cy:
                        year = latest
                    if month == cm:
                        month = 12
                    cy, cm = latest, 12
            except NoData:
                pass
        all_cos = bool(re.search(r"\b(all|each|every|per|by) compan|compare compan|which company|group|consolidat|الشركات", s)) and not named
        tenant_cos = [c for c in comps if c["tenant_key"] == tenant]
        return dict(s=s, has=has, year=year, month=month, single=single, compare_year=compare_year or year - 1,
                    top=int(top.group(1)) if top else None, acct=acct, tenant=tenant, company=company,
                    all_cos=all_cos, companies=tenant_cos, named=named, blocked=blocked)

    # ------------------------------------------------------------------ building blocks ----
    def pl(self, p, year, month, single=False, company=None):
        """Revenue / expenses / net for Jan..month (or the single month) from the monthly P&L."""
        rows = self.get("monthly", tenant=p["tenant"], company=company or p["company"], year=year)
        sel = [r for r in rows if (r["month"] == month if single else r["month"] <= month)]
        rev, exp = sum(_num(r["revenue"]) for r in sel), sum(_num(r["expenses"]) for r in sel)
        last = max((r["month"] for r in rows if abs(_num(r["revenue"])) + abs(_num(r["expenses"])) > 0.5), default=None)
        return {"revenue": rev, "expenses": exp, "net": rev - exp, "last": last, "rows": rows}

    def accounts(self, p, year, month, single=False):
        d = self.get("pnl", tenant=p["tenant"], company=p["company"], year=year)
        pick = (lambda ms: ms[month - 1]) if single else (lambda ms: sum(ms[:month]))
        return {l["main_account"]: {"name": l["account_name"], "group": l["group"], "amount": pick(l["months"])} for l in d["lines"]}

    def data_note(self, p, cur):
        if cur["last"] and cur["last"] < p["month"] and not p["single"] and p["year"] >= date.today().year - 1:
            return f"\n\n_Ledger data for {p['year']} runs to {MONTHS[cur['last'] - 1]}; later months are empty._"
        return ""

    # ------------------------------------------------------------------ answers ----
    def answer(self, q):
        p = self.parse(q)
        h, s = p["has"], p["s"]
        if not p["company"]:
            return "I cannot see any company yet. Pick a company in the top bar (or ask an Admin to give you access).", []
        self.p = p
        if p["blocked"] and not p["named"]:
            return (f"I cannot read company **{p['blocked'][0].upper()}** - it does not exist or you have no access to it. "
                    f"Your companies: {', '.join(c['company'].upper() for c in p['companies']) or 'none'}."), ["Compare all companies"]
        if h["help"] and len(s.split()) < 8:
            return self.a_help()
        if p["acct"]:
            return self.a_account(p, p["acct"][0])
        if h["cf"]:
            return self.a_cashflow(p)
        if h["tb"]:
            return self.a_tb(p)
        if h["is"]:
            return self.a_income_statement(p)
        if h["ar"] or h["ap"]:
            return self.a_arap(p, h["ar"], h["ap"])
        if h["project"]:
            return self.a_projects(p)
        if h["bs"]:
            return self.a_bs(p)
        if h["cash"]:
            return self.a_cash(p)
        if p["all_cos"] and (h["revenue"] or h["expense"] or h["profit"] or h["summary"] or "compan" in s):
            return self.a_companies(p)
        metric = "profit" if h["profit"] else "revenue" if h["revenue"] else "expense" if h["expense"] else None
        if self.specific_words(p) and not h["why"] and not h["top"] and not h["monthly"]:
            found = self.a_account_search(p)
            if found:
                return found
        if h["monthly"]:
            return self.a_monthly(p, metric)
        if h["why"] and metric:
            return self.a_why(p, metric)
        if h["top"] and metric in ("expense", "revenue"):
            return self.a_top(p, metric)
        if metric:
            return self.a_metric(p, metric)
        if h["summary"] or h["compare"]:
            return self.a_summary(p)
        found = self.a_account_search(p)
        if found:
            return found
        return self.a_help(unknown=True)

    def a_help(self, unknown=False):
        self.used = []
        intro = ("I could not match that question to the reports. " if unknown else "") + \
            "I answer from the reporting database (D365 ledger), for the company and period in the top bar unless you name another. Try:"
        return intro + """

- **Profit & loss:** *revenue this year vs last year*, *net profit in March*, *profit margin 2025*
- **Why:** *why did net profit change?*, *what drove expenses up?*
- **Rankings:** *top 10 expenses*, *biggest revenue accounts 2025*
- **Trends:** *revenue and profit by month*, *monthly expenses 2025*
- **Balance sheet:** *is the balance sheet balanced?*, *total assets and liabilities*
- **Cash & working capital:** *cash position*, *receivables and DSO*, *payables*
- **Statements:** *income statement*, *cash flow 2025*, *trial balance check*
- **Accounts:** *balance of account 4111001*, *rent expense*, *salaries*
- **Companies:** *compare all companies*, *revenue for 02td*
- **Projects:** *project margins*""", ["Summarise this year against last year", "Why did net profit change?", "Top 10 expenses", "Compare all companies"]

    def a_metric(self, p, metric):
        cur = self.pl(p, p["year"], p["month"], p["single"])
        prev = self.pl(p, p["compare_year"], p["month"], p["single"])
        per, pper = self.period(p["year"], p["month"], p["single"]), self.period(p["compare_year"], p["month"], p["single"])
        key = {"revenue": "revenue", "expense": "expenses", "profit": "net"}[metric]
        name = {"revenue": "Revenue", "expense": "Expenses", "profit": "Net profit"}[metric]
        c, pv = cur[key], prev[key]
        diff = c - pv
        txt = f"**{name} for {per}: {self.m(c)}** - {'up' if diff >= 0 else 'down'} {self.m(abs(diff))} ({self.pct(c, pv)}) on {pper} ({self.m(pv)})."
        if metric == "profit":
            mg, pmg = (c / cur["revenue"] * 100 if cur["revenue"] else None), (pv / prev["revenue"] * 100 if prev["revenue"] else None)
            if mg is not None:
                txt += f"\n\nNet margin is **{mg:.1f}%**" + (f" (was {pmg:.1f}%)." if pmg is not None else ".")
        rows = [["Revenue", self.n(cur["revenue"]), self.n(prev["revenue"]), self.pct(cur["revenue"], prev["revenue"])],
                ["Expenses", self.n(cur["expenses"]), self.n(prev["expenses"]), self.pct(cur["expenses"], prev["expenses"])],
                ["**Net profit**", f"**{self.n(cur['net'])}**", f"**{self.n(prev['net'])}**", f"**{self.pct(cur['net'], prev['net'])}**"]]
        txt += "\n\n" + self.table(["", per, pper, "Change"], rows)
        txt += self.data_note(p, cur)
        txt += f"\n\nCompany **{p['company'].upper()}** · year-end closing entries excluded."
        follow = {"revenue": ["Why did revenue change?", "Top 5 revenue accounts", "Revenue by month"],
                  "expense": ["Why did expenses change?", "Top 10 expenses", "Expenses by month"],
                  "profit": ["Why did net profit change?", "Revenue and profit by month", "Compare all companies"]}[metric]
        return txt, follow

    def a_why(self, p, metric):
        y, py, mth, single = p["year"], p["compare_year"], p["month"], p["single"]
        a, b = self.accounts(p, y, mth, single), self.accounts(p, py, mth, single)
        per, pper = self.period(y, mth, single), self.period(py, mth, single)
        rows = []
        for acc in set(a) | set(b):
            g = (a.get(acc) or b.get(acc))["group"]
            if metric == "revenue" and g != "Revenue" or metric == "expense" and g != "Expense":
                continue
            cur, prev = (a.get(acc) or {}).get("amount", 0.0), (b.get(acc) or {}).get("amount", 0.0)
            delta = cur - prev
            impact = delta if g == "Revenue" else -delta           # effect on profit
            if abs(delta) >= 0.5:
                rows.append((acc, (a.get(acc) or b.get(acc))["name"], g, cur, prev, delta, impact))
        tot_c = sum(r[3] * (1 if r[2] == "Revenue" else -1) for r in rows) if metric == "profit" else sum(r[3] for r in rows)
        tot_p = sum(r[4] * (1 if r[2] == "Revenue" else -1) for r in rows) if metric == "profit" else sum(r[4] for r in rows)
        name = {"revenue": "Revenue", "expense": "Expenses", "profit": "Net profit"}[metric]
        if not rows:
            return f"{name} did not change between {pper} and {per} for {p['company'].upper()} - or there is no data for these periods.", []
        chg = tot_c - tot_p
        if abs(chg) < 0.5:
            txt = f"**{name} is unchanged at {self.m(tot_c)}** ({pper} → {per}), but accounts moved in opposite directions:\n\n"
        else:
            txt = ""
        txt += "" if abs(chg) < 0.5 else f"**{name} {'rose' if chg >= 0 else 'fell'} by {self.m(abs(chg))} ({self.pct(tot_c, tot_p)})** - {self.m(tot_p)} in {pper} → {self.m(tot_c)} in {per}.\n\n"
        k = p["top"] or 5
        if metric == "profit":
            up = sorted([r for r in rows if r[6] > 0], key=lambda r: -r[6])[:k]
            down = sorted([r for r in rows if r[6] < 0], key=lambda r: r[6])[:k]
            if up:
                txt += "**What helped profit**\n\n" + self.table(["Account", "Type", per, pper, "Effect on profit"],
                    [[f"{r[0]} {r[1]}", r[2], self.n(r[3]), self.n(r[4]), self.n(r[6], True)] for r in up]) + "\n\n"
            if down:
                txt += "**What reduced profit**\n\n" + self.table(["Account", "Type", per, pper, "Effect on profit"],
                    [[f"{r[0]} {r[1]}", r[2], self.n(r[3]), self.n(r[4]), self.n(r[6], True)] for r in down]) + "\n\n"
        else:
            big = sorted(rows, key=lambda r: -abs(r[5]))[:k]
            txt += f"**Largest movements**\n\n" + self.table(["Account", per, pper, "Change", "%"],
                [[f"{r[0]} {r[1]}", self.n(r[3]), self.n(r[4]), self.n(r[5], True), self.pct(r[3], r[4])] for r in big]) + "\n\n"
        share = sum(abs(r[5]) for r in sorted(rows, key=lambda r: -abs(r[5]))[:k])
        total_move = sum(abs(r[5]) for r in rows) or 1
        txt += f"These {min(k, len(rows))} accounts explain {share / total_move * 100:.0f}% of all account movements. Company **{p['company'].upper()}**."
        return txt, [f"Top 10 {'expenses' if metric != 'revenue' else 'revenue accounts'}", f"{name} by month", "Summarise this year against last year"]

    def a_top(self, p, metric):
        k = p["top"] or 10
        a = self.accounts(p, p["year"], p["month"], p["single"])
        b = self.accounts(p, p["compare_year"], p["month"], p["single"])
        g = "Expense" if metric == "expense" else "Revenue"
        rows = sorted([(acc, v["name"], v["amount"]) for acc, v in a.items() if v["group"] == g and abs(v["amount"]) >= 0.5], key=lambda r: -r[2])[:k]
        if not rows:
            return f"No {g.lower()} accounts with amounts in {self.period(p['year'], p['month'], p['single'])} for {p['company'].upper()}.", []
        total = sum(v["amount"] for v in a.values() if v["group"] == g) or 1
        per = self.period(p["year"], p["month"], p["single"])
        txt = f"**Top {len(rows)} {'expense' if g == 'Expense' else 'revenue'} accounts - {per}** (total {self.m(total)}):\n\n"
        txt += self.table(["#", "Account", per, "Share", f"vs {p['compare_year']}"],
                          [[i + 1, f"{r[0]} {r[1]}", self.n(r[2]), f"{r[2] / total * 100:.1f}%", self.pct(r[2], (b.get(r[0]) or {}).get("amount", 0))]
                           for i, r in enumerate(rows)], right={0, 2, 3, 4})
        top_share = sum(r[2] for r in rows) / total * 100
        txt += f"\n\nThese accounts are **{top_share:.0f}%** of all {g.lower()}s. Company **{p['company'].upper()}**."
        self.chart = {"type": "bar", "labels": [r[1][:22] or r[0] for r in rows], "series": [{"name": per, "values": [round(r[2], 2) for r in rows]}]}
        return txt, [f"Why did {'expenses' if g == 'Expense' else 'revenue'} change?", f"{'Expenses' if g == 'Expense' else 'Revenue'} by month"]

    def a_monthly(self, p, metric):
        cur = self.pl(p, p["year"], 12)
        prev = self.pl(p, p["compare_year"], 12)
        last = cur["last"] or 12
        by = {r["month"]: r for r in cur["rows"]}
        pby = {r["month"]: r for r in prev["rows"]}
        rows, labels, rv, nv, ev = [], [], [], [], []
        for mth in range(1, last + 1):
            r, pr = by.get(mth, {}), pby.get(mth, {})
            rev, exp = _num(r.get("revenue")), _num(r.get("expenses"))
            rows.append([MONTHS[mth - 1], self.n(rev), self.n(exp), self.n(rev - exp), self.n(_num(pr.get("revenue")) - _num(pr.get("expenses")))])
            labels.append(MONTHS[mth - 1]); rv.append(round(rev, 2)); ev.append(round(exp, 2)); nv.append(round(rev - exp, 2))
        tr, te = sum(rv), sum(ev)
        rows.append(["**Total**", f"**{self.n(tr)}**", f"**{self.n(te)}**", f"**{self.n(tr - te)}**",
                     f"**{self.n(sum(_num(pby.get(m_, {}).get('revenue')) - _num(pby.get(m_, {}).get('expenses')) for m_ in range(1, last + 1)))}**"])
        best = max(range(len(nv)), key=lambda i: nv[i]) if nv else None
        worst = min(range(len(nv)), key=lambda i: nv[i]) if nv else None
        txt = f"**Monthly P&L - {p['year']}** ({p['company'].upper()}):\n\n" + self.table(
            ["Month", "Revenue", "Expenses", "Net profit", f"Net {p['compare_year']}"], rows)
        if best is not None:
            txt += f"\n\nBest month: **{labels[best]}** ({self.m(nv[best])}); weakest: **{labels[worst]}** ({self.m(nv[worst])})."
        series = {"revenue": [{"name": "Revenue", "values": rv}], "expense": [{"name": "Expenses", "values": ev}],
                  "profit": [{"name": "Net profit", "values": nv}]}.get(metric) or [{"name": "Revenue", "values": rv}, {"name": "Expenses", "values": ev}, {"name": "Net profit", "values": nv}]
        self.chart = {"type": "bar", "labels": labels, "series": series}
        return txt, ["Why did net profit change?", "Top 10 expenses", "Summarise this year against last year"]

    def a_summary(self, p):
        cur = self.pl(p, p["year"], p["month"], p["single"])
        prev = self.pl(p, p["compare_year"], p["month"], p["single"])
        per, pper = self.period(p["year"], p["month"], p["single"]), self.period(p["compare_year"], p["month"], p["single"])
        lines = [f"**{p['company'].upper()} - {per} compared with {pper}**", ""]
        lines.append(f"- **Revenue** {self.m(cur['revenue'])} ({self.pct(cur['revenue'], prev['revenue'])})")
        lines.append(f"- **Expenses** {self.m(cur['expenses'])} ({self.pct(cur['expenses'], prev['expenses'])})")
        mg = f", margin {cur['net'] / cur['revenue'] * 100:.1f}%" if cur["revenue"] else ""
        lines.append(f"- **Net profit** {self.m(cur['net'])} ({self.pct(cur['net'], prev['net'])}{mg})")
        for name, fn in (("cash", lambda: self.get("cash", tenant=p["tenant"], company=p["company"], year=p["year"])),
                         ("arap", lambda: self.get("arap", tenant=p["tenant"], company=p["company"], year=p["year"])),
                         ("bal", lambda: self.get("balance", tenant=p["tenant"], company=p["company"], year=p["year"], month=p["month"]))):
            try:
                d = fn()
            except NoData:
                continue
            i = p["month"] - 1
            if name == "cash":
                lines.append(f"- **Cash & bank** {self.m(d['balance'][i])} at end of {MONTHS[i]}")
            elif name == "arap":
                dso = d["dso"][i]
                lines.append(f"- **Receivables** {self.m(d['ar_balance'][i])}" + (f" (DSO {dso:.0f} days)" if dso is not None else "")
                             + f" · **Payables** {self.m(d['ap_balance'][i])}")
            else:
                t = d["totals"]
                lines.append(f"- **Total assets** {self.m(t['assets'])} · liabilities {self.m(t['liabilities'])} · equity {self.m(t['equity'])}"
                             + ("" if abs(t["difference"]) < 1 else f" - ⚠ out of balance by {self.m(t['difference'])}"))
        try:
            a, b = self.accounts(p, p["year"], p["month"], p["single"]), self.accounts(p, p["compare_year"], p["month"], p["single"])
            moves = []
            for acc in set(a) | set(b):
                v = a.get(acc) or b.get(acc)
                d_ = (a.get(acc) or {}).get("amount", 0) - (b.get(acc) or {}).get("amount", 0)
                moves.append((acc, v["name"], d_ if v["group"] == "Revenue" else -d_))
            moves.sort(key=lambda r: -abs(r[2]))
            if moves and abs(moves[0][2]) >= 0.5:
                lines += ["", "**Biggest effects on profit:** " + "; ".join(f"{r[0]} {r[1]} {self.n(r[2], True)}" for r in moves[:3])]
        except NoData:
            pass
        txt = "\n".join(lines) + self.data_note(p, cur)
        return txt, ["Why did net profit change?", "Revenue and profit by month", "Compare all companies", "Is the balance sheet balanced?"]

    def a_companies(self, p):
        rows, labels, vals = [], [], []
        per = self.period(p["year"], p["month"], p["single"])
        skipped = []
        for c in p["companies"]:
            try:
                cur = self.pl(p, p["year"], p["month"], p["single"], company=c["company"])
                prev = self.pl(p, p["compare_year"], p["month"], p["single"], company=c["company"])
            except NoData:
                skipped.append(c["company"].upper())
                continue
            if abs(cur["revenue"]) + abs(cur["expenses"]) + abs(prev["revenue"]) < 0.5:
                continue
            mg = f"{cur['net'] / cur['revenue'] * 100:.1f}%" if cur["revenue"] else "n/a"
            rows.append([f"{c['company'].upper()} {c.get('name') or ''}".strip(), self.n(cur["revenue"]), self.n(cur["expenses"]),
                         self.n(cur["net"]), mg, self.pct(cur["net"], prev["net"])])
            labels.append(c["company"].upper()); vals.append(round(cur["net"], 2))
        if not rows:
            return f"None of your companies has P&L data for {per}.", []
        txt = f"**Companies - {per}** (each company on its own, before eliminations):\n\n" + self.table(
            ["Company", "Revenue", "Expenses", "Net profit", "Margin", f"Net vs {p['compare_year']}"], rows)
        if skipped:
            txt += f"\n\n_Not included (no access): {', '.join(skipped)}._"
        self.chart = {"type": "bar", "labels": labels, "series": [{"name": "Net profit", "values": vals}]}
        return txt, ["Consolidated income statement", "Why did net profit change?"]

    def _statement_rows(self, d, only_totals=False):
        out = []
        for r in d["rows"]:
            if r["kind"] == "H" or (only_totals and r["kind"] != "T"):
                continue
            if abs(_num(r.get("cur"))) < 0.5 and abs(_num(r.get("prev"))) < 0.5:
                continue
            lab = f"**{r['label']}**" if r["kind"] == "T" else r["label"]
            out.append([lab, self.n(r["cur"]), self.n(r["prev"]), self.pct(r["cur"], r["prev"])])
        return out

    def a_income_statement(self, p):
        co = "*" if p["all_cos"] else p["company"]
        d = self.get("is", tenant=p["tenant"], company=co, year=p["year"], month=p["month"], basis="final")
        rows = self._statement_rows(d)
        who = "all companies combined" if co == "*" else co.upper()
        txt = f"**Income statement - {who}, {d['headings'][0]}** (final basis: D365 ledger + posted adjustments):\n\n" + self.table(
            ["", d["headings"][0], d["headings"][1], "Change"], rows)
        txt += "\n\nOpen **Reports › Income Statement** for notes and accounts behind each line."
        return txt, ["Why did net profit change?", "Cash flow", "Financial position"]

    def a_bs(self, p):
        co = "*" if p["all_cos"] else p["company"]
        d = self.get("bs", tenant=p["tenant"], company=co, year=p["year"], month=p["month"], basis="final")
        rows = self._statement_rows(d, only_totals=("detail" not in p["s"] and "lines" not in p["s"]))
        chk = _num(d.get("check", {}).get("cur"))
        who = "all companies combined" if co == "*" else co.upper()
        head = (f"**The balance sheet balances** - total assets equal equity plus liabilities at {d['headings'][0]}." if abs(chk) < 1
                else f"**⚠ The balance sheet is out of balance by {self.m(chk)}** at {d['headings'][0]} - usually accounts missing from the FS mapping (Reports › FS Mapping).")
        txt = f"{head}\n\n**Financial position - {who}**\n\n" + self.table(["", d["headings"][0], d["headings"][1], "Change"], rows)
        if d.get("unmapped"):
            txt += f"\n\n_{d['unmapped']} account(s) are not mapped and sit on 'not mapped' lines._"
        return txt, ["Cash position", "Receivables and payables", "Show balance sheet lines in detail"]

    def a_cashflow(self, p):
        co = "*" if p["all_cos"] else p["company"]
        d = self.get("cf", tenant=p["tenant"], company=co, year=p["year"], month=p["month"], basis="final")
        rows = self._statement_rows(d, only_totals="detail" not in p["s"])
        net = next((r for r in d["rows"] if r["code"] in ("CF_NET",)), None)
        txt = f"**Cash flow - {'all companies' if co == '*' else co.upper()}, {d['headings'][0]}** (indirect method):\n\n"
        if net:
            txt += f"Net change in cash: **{self.m(net['cur'])}** (last year {self.m(net['prev'])}).\n\n"
        txt += self.table(["", d["headings"][0], d["headings"][1], "Change"], rows)
        if abs(_num(d.get("check", {}).get("cur"))) > 1:
            txt += f"\n\n_The cash flow differs from the change in cash on the balance sheet by {self.m(d['check']['cur'])}._"
        return txt, ["Cash position", "Cash flow in detail", "Financial position"]

    def a_cash(self, p):
        d = self.get("cash", tenant=p["tenant"], company=p["company"], year=p["year"])
        i = p["month"] - 1
        bal, inflow, outflow = d["balance"], d["inflow"], d["outflow"]
        start = bal[0] - inflow[0] + outflow[0]
        txt = (f"**Cash & bank at end of {MONTHS[i]} {p['year']}: {self.m(bal[i])}** ({p['company'].upper()}).\n\n"
               f"Since 1 Jan: opening {self.m(start)}, money in {self.m(sum(inflow[:i + 1]))}, money out {self.m(sum(outflow[:i + 1]))}.\n\n")
        accts = sorted(d["accounts"], key=lambda a: -abs(_num(a["balance"])))[: p["top"] or 8]
        if accts:
            txt += f"**Accounts (balance at 31 Dec {p['year']} or latest):**\n\n" + self.table(
                ["Account", "Balance"], [[f"{a['main_account']} {a['account_name']}", self.n(a["balance"])] for a in accts])
        txt += f"\n\n_{d.get('rule', '')}._"
        self.chart = {"type": "line", "labels": MONTHS[: i + 1], "series": [{"name": "Cash balance", "values": [round(v, 2) for v in bal[: i + 1]]}]}
        return txt, ["Cash flow", "Receivables and payables", "Is the balance sheet balanced?"]

    def a_arap(self, p, ar, ap):
        d = self.get("arap", tenant=p["tenant"], company=p["company"], year=p["year"])
        i = p["month"] - 1
        both = ar == ap
        parts = []
        if ar or both:
            dso = d["dso"][i]
            parts.append(f"**Receivables {self.m(d['ar_balance'][i])}** at end of {MONTHS[i]} {p['year']}"
                         + (f", about **{dso:.0f} days** of sales (DSO)" if dso is not None else "") + ".")
        if ap or both:
            dpo = d["dpo"][i]
            parts.append(f"**Payables {self.m(d['ap_balance'][i])}**" + (f", about **{dpo:.0f} days** of costs (DPO)" if dpo is not None else "") + ".")
        txt = " ".join(parts) + f" ({p['company'].upper()})\n\n"
        rows = []
        for mth in range(i + 1):
            r = [MONTHS[mth]]
            if ar or both:
                r += [self.n(d["ar_balance"][mth]), "–" if d["dso"][mth] is None else f"{d['dso'][mth]:.0f}"]
            if ap or both:
                r += [self.n(d["ap_balance"][mth]), "–" if d["dpo"][mth] is None else f"{d['dpo'][mth]:.0f}"]
            rows.append(r)
        head = ["Month"] + (["Receivables", "DSO"] if ar or both else []) + (["Payables", "DPO"] if ap or both else [])
        txt += self.table(head, rows)
        key = "ar_accounts" if (ar and not ap) else "ap_accounts" if ap and not ar else None
        if key and d[key]:
            top = sorted(d[key], key=lambda a: -abs(_num(a["balance"])))[:5]
            txt += "\n\n**Largest accounts:** " + "; ".join(f"{a['main_account']} {a['account_name']} {self.n(a['balance'])}" for a in top)
        txt += f"\n\n_{d.get('rule', '')}. DSO/DPO use the last 12 months of revenue / expenses._"
        series = []
        if ar or both:
            series.append({"name": "Receivables", "values": [round(v, 2) for v in d["ar_balance"][: i + 1]]})
        if ap or both:
            series.append({"name": "Payables", "values": [round(v, 2) for v in d["ap_balance"][: i + 1]]})
        self.chart = {"type": "line", "labels": MONTHS[: i + 1], "series": series}
        return txt, ["Cash position", "Summarise this year against last year"]

    def a_projects(self, p):
        d = self.get("projects", tenant=p["tenant"], company=p["company"], year=p["year"])
        pr = d["projects"]
        if not pr:
            return f"No ledger lines with a project in {p['year']} for {p['company'].upper()}.", []
        s = p["s"]
        key = (lambda e: -e["margin"]) if ("margin" in s or "profit" in s) else (lambda e: e["margin"]) if ("loss" in s or "worst" in s) else (lambda e: -e["revenue"])
        rows = sorted(pr, key=key)[: p["top"] or 10]
        t = d["totals"]
        txt = (f"**Projects {p['year']}** ({p['company'].upper()}): {len(pr)} projects, revenue {self.m(t['revenue'])}, "
               f"cost {self.m(t['cost'])}, margin {self.m(t['revenue'] - t['cost'])}.\n\n")
        txt += self.table(["Project", "Revenue", "Cost", "Margin", "Margin %"],
                          [[e["project"], self.n(e["revenue"]), self.n(e["cost"]), self.n(e["margin"]),
                            "n/a" if e["margin_pct"] is None else f"{e['margin_pct']:.1f}%"] for e in rows])
        losses = [e for e in pr if e["margin"] < -0.5]
        if losses:
            txt += f"\n\n**{len(losses)} project(s) lose money**, together {self.m(sum(e['margin'] for e in losses))}."
        return txt, ["Projects with losses", "Top projects by margin"]

    def a_tb(self, p):
        rows = self.get("tb", tenant=p["tenant"], company=p["company"], year=p["year"], month=p["month"])
        dr, cr = sum(_num(r["debit"]) for r in rows), sum(_num(r["credit"]) for r in rows)
        cl = sum(_num(r["closing"]) for r in rows)
        per = self.period(p["year"], p["month"])
        ok = abs(cl) < 1
        txt = (f"**Trial balance {p['company'].upper()} - {per}:** {len(rows)} accounts. Debits {self.m(dr)}, credits {self.m(cr)}. "
               + ("**Closing balances net to zero - the trial balance balances.**" if ok else f"**⚠ Closing balances net to {self.m(cl)}**, not zero."))
        types = {}
        for r in rows:
            types[r.get("account_type") or "Other"] = types.get(r.get("account_type") or "Other", 0) + _num(r["closing"])
        txt += "\n\n" + self.table(["Account type", "Closing balance (Dr + / Cr −)"], [[k, self.n(v)] for k, v in sorted(types.items())])
        return txt, ["Is the balance sheet balanced?", "Balance of account 4111001"]

    def _tb_lines(self, p, match):
        rows = self.get("tb", tenant=p["tenant"], company=p["company"], year=p["year"], month=p["month"])
        return [r for r in rows if match(r)]

    def a_account(self, p, acc):
        rows = self._tb_lines(p, lambda r: str(r["main_account"]).startswith(acc))
        if not rows:
            return f"Account **{acc}** has no postings up to {self.period(p['year'], p['month'])} in {p['company'].upper()} (or it does not exist).", []
        return self._accounts_answer(p, rows, f"account {acc}")

    @staticmethod
    def specific_words(p):
        """Words that are not finance vocabulary or filler - e.g. 'rent', 'salaries', 'zakat' - to look up account names."""
        generic = {w.strip() for ws in WORDS.values() for x in ws for w in x.split()} | STOP | {
            "expenses", "costs", "revenues", "profits", "income", "net", "change", "changed", "what", "why"}
        return [w for w in re.findall(r"[a-z\u0600-\u06ff]{3,}", p["s"]) if w not in generic]

    def a_account_search(self, p):
        words = self.specific_words(p)
        if not words:
            return None
        before = len(self.used)
        try:
            rows = self._tb_lines(p, lambda r: any(w in (r.get("account_name") or "").lower() for w in words))
        except NoData:
            rows = []
        if not rows:
            del self.used[before:]                 # nothing found - do not list the trial balance as used
            return None
        h = p["has"]
        want = "expense" if h["expense"] and not h["revenue"] else "revenue" if h["revenue"] and not h["expense"] else None
        if want:                                   # 'rent expense' -> prefer expense accounts over 'rental income'
            narrowed = [r for r in rows if want in str(r.get("account_type") or "").lower()]
            rows = narrowed or rows
        return self._accounts_answer(p, rows, " / ".join(words))

    def _accounts_answer(self, p, rows, what):
        per = self.period(p["year"], p["month"])
        rows = sorted(rows, key=lambda r: -abs(_num(r["debit"]) - _num(r["credit"])))[:15]
        tr = [[f"{r['main_account']} {r['account_name']}", r.get("account_type") or "", self.n(_num(r["debit"]) - _num(r["credit"])), self.n(r["closing"])] for r in rows]
        mv = sum(_num(r["debit"]) - _num(r["credit"]) for r in rows)
        txt = f"**{len(rows)} account(s) matching “{what}” - {per}** ({p['company'].upper()}): movement this year {self.m(mv)} (debit + / credit −).\n\n"
        txt += self.table(["Account", "Type", f"Movement {per}", "Closing balance"], tr, right={2, 3})
        txt += "\n\n_Debit positive, credit negative. For expense accounts the movement is the cost of the period; for revenue it shows as negative (credit)._"
        return txt, ["Top 10 expenses", "Why did expenses change?"]


class RenameIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


def register(app, store, settings, log, engine):
    """AI Assistant endpoints. Chats are saved per user in sec.ai_chat / sec.ai_message (sql/06_ai_chat.sql)."""
    from sqlalchemy import text as sql
    import json

    def own(cn, chat_id, u):
        r = cn.execute(sql("SELECT chat_id, title FROM sec.ai_chat WHERE chat_id = :c AND user_id = :u"),
                       {"c": chat_id, "u": u["user_id"]}).mappings().first()
        if not r:
            raise HTTPException(404, "Chat not found.")
        return r

    @app.get("/api/ai/status")
    def ai_status():
        return {"enabled": True, "ready": True, "engine": "local"}

    @app.get("/api/ai/chats")
    def chats():
        u = security.current_user()
        with engine().connect() as cn:
            return [dict(r) for r in cn.execute(sql("""
                SELECT TOP 200 c.chat_id, c.title, c.created_at, c.updated_at,
                       (SELECT COUNT(*) FROM sec.ai_message m WHERE m.chat_id = c.chat_id AND m.role = 'user') AS questions
                FROM sec.ai_chat c WHERE c.user_id = :u ORDER BY c.updated_at DESC, c.chat_id DESC"""), {"u": u["user_id"]}).mappings()]

    @app.get("/api/ai/chats/{chat_id}")
    def chat_messages(chat_id: int):
        u = security.current_user()
        with engine().connect() as cn:
            c = own(cn, chat_id, u)
            msgs = []
            for r in cn.execute(sql("SELECT role, content, payload, at FROM sec.ai_message WHERE chat_id = :c ORDER BY id"), {"c": chat_id}).mappings():
                m = {"role": r["role"], "content": r["content"], "at": r["at"]}
                if r["payload"]:
                    try:
                        m.update(json.loads(r["payload"]))
                    except ValueError:
                        pass
                msgs.append(m)
        return {"chat_id": chat_id, "title": c["title"], "messages": msgs}

    @app.put("/api/ai/chats/{chat_id}")
    def rename_chat(chat_id: int, body: RenameIn):
        u = security.current_user()
        with engine().begin() as cn:
            own(cn, chat_id, u)
            cn.execute(sql("UPDATE sec.ai_chat SET title = :t WHERE chat_id = :c"), {"t": body.title.strip()[:120], "c": chat_id})
        return {"ok": True}

    @app.delete("/api/ai/chats/{chat_id}")
    def delete_chat(chat_id: int):
        u = security.current_user()
        with engine().begin() as cn:
            own(cn, chat_id, u)
            cn.execute(sql("DELETE FROM sec.ai_message WHERE chat_id = :c"), {"c": chat_id})
            cn.execute(sql("DELETE FROM sec.ai_chat WHERE chat_id = :c"), {"c": chat_id})
        return {"ok": True}

    @app.post("/api/ai/chat")
    def ai_chat(body: ChatIn):
        q = next((m.content for m in reversed(body.messages) if m.role == "user"), "").strip()
        if not q:
            raise HTTPException(400, "Ask a question.")
        u = security.current_user()
        store.write(u, "ai.question", q[:900])
        eng = Engine(app, settings, body)
        try:
            text, follow = eng.answer(q)
        except NoData as ex:
            text, follow = f"I cannot answer that: {ex}.", ["What can you do?"]
        except Exception as ex:                                     # noqa: BLE001
            log.exception("assistant failed for %r", q)
            text, follow = f"Something went wrong while reading the reports ({str(ex).splitlines()[0][:160]}). The error is in api\\logs\\api.log.", []
        out = {"answer": text, "sources": eng.used, "suggest": follow[:4], "chart": eng.chart, "engine": "local"}
        # save the question and the answer in the user's chat (a new chat when none is given)
        try:
            with engine().begin() as cn:
                cid = body.chat_id
                if cid:
                    own(cn, cid, u)
                else:
                    title = re.sub(r"\s+", " ", q)[:80] + ("…" if len(q) > 80 else "")
                    cid = cn.execute(sql("INSERT INTO sec.ai_chat (user_id, title) OUTPUT inserted.chat_id VALUES (:u, :t)"),
                                     {"u": u["user_id"], "t": title}).scalar()
                ctx = {"tenant": body.tenant, "company": body.company, "year": body.year, "month": body.month}
                cn.execute(sql("INSERT INTO sec.ai_message (chat_id, role, content, payload) VALUES (:c, 'user', :t, :p)"),
                           {"c": cid, "t": q, "p": json.dumps({"context": ctx})})
                cn.execute(sql("INSERT INTO sec.ai_message (chat_id, role, content, payload) VALUES (:c, 'assistant', :t, :p)"),
                           {"c": cid, "t": text, "p": json.dumps({k: out[k] for k in ("sources", "suggest", "chart")}, default=str)})
                cn.execute(sql("UPDATE sec.ai_chat SET updated_at = SYSUTCDATETIME() WHERE chat_id = :c"), {"c": cid})
            out["chat_id"] = cid
        except HTTPException:
            raise
        except Exception as ex:                                     # noqa: BLE001  answer still shown, just not saved
            log.warning("ai chat not saved: %s", str(ex).splitlines()[0][:300])
            out["chat_id"] = body.chat_id
            out["not_saved"] = True
        return out

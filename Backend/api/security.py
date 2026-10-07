"""Sign-in, roles, permissions and row-level security for the API.

* Users sign in with username + password (PBKDF2-SHA256 hashes in sec.app_user) and get a signed token
  (HMAC-SHA256 with SECRET_KEY, 12 h).  Every /api call except sign-in needs "Authorization: Bearer <token>".
* Roles Admin / Accountant / Finance / Viewer; what each may do is sec.role_permission (editable).
* Row-level security: a user sees only the companies in sec.user_company (or all, if all_companies = 1).
  The API checks the ?tenant=&company= of every request, and SQL Server enforces the same rule on
  dw.fact_gl through the security policy in sql/03_security.sql (SESSION_CONTEXT app_user / app_all).
"""
import base64
import contextvars
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime, timedelta

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import event, text

ROLES = ["Admin", "Accountant", "Finance", "Viewer"]
PERMISSIONS = [
    ("home.view", "Home - project overview"),
    ("dashboards.view", "Dashboards"),
    ("reports.view", "Reports (statements, TB mapping, notes)"),
    ("reports.export", "Export CSV / print reports"),
    ("mapping.edit", "Change the FS mapping"),
    ("etl.view", "See ETL: tenants, jobs, counts, history"),
    ("etl.run", "Run ETL and Rebuild reports"),
    ("tenants.manage", "Add / edit D365 tenants and credentials"),
    ("users.manage", "Manage users and roles"),
    ("health.view", "System health"),
    ("audit.view", "Audit logs"),
    ("adjust.view", "See adjustments & eliminations"),
    ("adjust.edit", "Create / edit adjustment entries (draft)"),
    ("adjust.post", "Post, unpost and reverse adjustment entries"),
    ("config.manage", "System configuration (name, logo, defaults, assistant on/off)"),
    ("ai.use", "AI Assistant - ask questions about the figures"),
    ("budget.edit", "Upload, generate and delete budgets"),
    ("forecast.edit", "Cash flow forecast: save assumptions, add and edit cash items"),
    ("close.view", "See period close status and checklist"),
    ("close.manage", "Tick the close checklist, lock and reopen periods"),
    ("consol.view", "See consolidation: group pack and intercompany matching"),
    ("consol.manage", "Consolidation setup: currencies, rates, intercompany accounts, propose eliminations"),
    ("pack.manage", "Scheduled report pack: email settings and schedules"),
    ("alerts.view", "See and acknowledge alerts"),
    ("recon.view", "See and run the D365 reconciliation"),
]

# Dashboards and reports a user can be limited to (on top of the role). key = page route.
PAGES = [
    ("/dashboards/overview", "Overview", "Dashboards"),
    ("/dashboards/profit-loss", "Profit & Loss", "Dashboards"),
    ("/dashboards/balance-sheet", "Balance Sheet", "Dashboards"),
    ("/dashboards/trial-balance", "Trial Balance", "Dashboards"),
    ("/dashboards/expenses", "Expenses", "Dashboards"),
    ("/dashboards/cash", "Cash & Bank", "Dashboards"),
    ("/dashboards/ar-ap", "Receivables & Payables", "Dashboards"),
    ("/dashboards/projects", "Projects", "Dashboards"),
    ("/dashboards/sales", "Sales", "Dashboards"),
    ("/dashboards/purchasing", "Purchasing", "Dashboards"),
    ("/dashboards/fixed-assets", "Fixed Assets", "Dashboards"),
    ("/reports/income-statement", "Income Statement", "Reports"),
    ("/reports/balance-sheet", "Financial Position", "Reports"),
    ("/reports/tb-mapping", "Trial Balance Mapping", "Reports"),
    ("/reports/notes", "Notes", "Reports"),
    ("/reports/cash-flow", "Cash Flow", "Reports"),
    ("/reports/mapping", "FS Mapping", "Reports"),
    ("/reports/budget", "Budget vs Actual", "Reports"),
    ("/reports/ageing", "Customer & Vendor Ageing", "Reports"),
    ("/reports/cash-forecast", "Cash Flow Forecast", "Reports"),
    ("/adjustments/journal", "Adjustments & Eliminations", "Adjustments"),
    ("/adjustments/worksheet", "Adjusted Statements", "Adjustments"),
]
PAGE_KEYS = {k for k, _, _ in PAGES}
# API data -> the pages that use it (a user needs at least one of them). Shared lookups are not listed.
PAGE_API = [
    (r"^/api/report/(kpis|pnl-monthly|top-expenses|trial-balance)$", {"/dashboards/overview"}),
    (r"^/api/report/pnl$", {"/dashboards/profit-loss"}),
    (r"^/api/report/balance-sheet$", {"/dashboards/balance-sheet"}),
    (r"^/api/report/trial-balance-full$", {"/dashboards/trial-balance"}),
    (r"^/api/report/expenses$", {"/dashboards/expenses"}),
    (r"^/api/report/cash$", {"/dashboards/cash"}),
    (r"^/api/report/ar-ap$", {"/dashboards/ar-ap"}),
    (r"^/api/report/projects$", {"/dashboards/projects"}),
    (r"^/api/report/analytics/sales$", {"/dashboards/sales"}),
    (r"^/api/report/analytics/purchasing$", {"/dashboards/purchasing"}),
    (r"^/api/report/analytics/fixed-assets$", {"/dashboards/fixed-assets"}),
    (r"^/api/report/budget/", {"/reports/budget"}),
    (r"^/api/report/ageing", {"/reports/ageing"}),
    (r"^/api/(report|admin)/cash-forecast", {"/reports/cash-forecast"}),
    (r"^/api/report/fs/statement$", None),           # depends on ?kind= (see page_ok)
    (r"^/api/report/fs/cashflow$", {"/reports/cash-flow", "/adjustments/worksheet"}),
    (r"^/api/admin/adj/", {"/adjustments/journal", "/adjustments/worksheet"}),
    (r"^/api/report/fs/tb$", {"/reports/tb-mapping"}),
    (r"^/api/report/fs/mapping$", {"/reports/mapping"}),
    (r"^/api/admin/fs/", {"/reports/mapping"}),
]


def page_ok(u, path, query) -> bool:
    if u is None or u.get("all_pages", True):
        return True
    for pat, pages in PAGE_API:
        if re.match(pat, path):
            if pages is None:
                pages = {"/reports/notes", "/adjustments/worksheet",
                         "/reports/income-statement" if query.get("kind", "IS") == "IS" else "/reports/balance-sheet"}
            return bool(pages & u["pages"])
    return True
TOKEN_HOURS = int(os.getenv("TOKEN_HOURS", "12"))
MAX_FAILED = 5
LOCK_MINUTES = 15

_user = contextvars.ContextVar("app_user", default=None)


def current_user():
    return _user.get()


# ---------------------------------------------------------------- passwords + tokens ----
def hash_password(pw: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 200_000).hex()
    return f"pbkdf2${200_000}${salt}${h}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, it, salt, h = stored.split("$")
        return hmac.compare_digest(hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), int(it)).hex(), h)
    except Exception:
        return False


def password_problem(pw: str) -> str | None:
    if len(pw) < 8:
        return "Password must be at least 8 characters."
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        return "Password must contain letters and numbers."
    return None


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def make_token(uid: int, ver: int) -> str:
    body = _b64(json.dumps({"u": uid, "v": ver, "e": int(time.time()) + TOKEN_HOURS * 3600}).encode())
    sig = _b64(hmac.new(os.environ["SECRET_KEY"].encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_token(tok: str):
    try:
        body, sig = tok.split(".")
        good = _b64(hmac.new(os.environ["SECRET_KEY"].encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        return data if data["e"] > time.time() else None
    except Exception:
        return None


# ---------------------------------------------------------------- path -> permission ----
# first match wins; None = signed-in user is enough; "public" = no sign-in
RULES = [
    (r"^POST /api/auth/login$", "public"),
    (r"^GET /api/health/ping$", "public"),
    (r"^GET /api/config/public$", "public"),
    (r"^GET /api/auth/demo-users$", "public"),        # sign-in page: demo accounts (empty unless DEMO_USERS=1)
    (r"^\w+ /api/ai/", "ai.use"),
    (r"^\w+ /api/admin/config", "config.manage"),
    (r"^GET /api/report/budget/", "reports.view"),
    (r"^(POST|PUT|DELETE) /api/admin/budget", "budget.edit"),
    (r"^GET /api/report/ageing", "reports.view"),
    (r"^GET /api/report/cash-forecast", "reports.view"),
    (r"^(PUT|POST|DELETE) /api/admin/cash-forecast/", "forecast.edit"),
    (r"^GET /api/report/analytics/", "dashboards.view"),
    (r"^GET /api/admin/close", "close.view"),
    (r"^(POST|PUT|DELETE) /api/admin/close", "close.manage"),
    (r"^GET /api/admin/consol", "consol.view"),
    (r"^(POST|PUT|DELETE) /api/admin/consol", "consol.manage"),
    (r"^\w+ /api/admin/pack", "pack.manage"),
    (r"^PUT /api/admin/alerts/settings$", "config.manage"),
    (r"^\w+ /api/admin/alerts", "alerts.view"),
    (r"^GET /api/admin/recon", "recon.view"),
    (r"^POST /api/admin/recon", "recon.view"),
    (r"^\w+ /api/auth/", None),
    (r"^GET /api/admin/logs", "audit.view"),
    (r"^GET /api/admin/pages$", "users.manage"),
    (r"^GET /api/admin/adj/", "adjust.view"),
    (r"^POST /api/admin/adj/entries/\d+/(post|unpost|reverse)$", "adjust.post"),
    (r"^(POST|PUT|DELETE) /api/admin/adj/", "adjust.edit"),
    (r"^\w+ /api/admin/(users|roles|audit)", "users.manage"),
    (r"^GET /api/admin/health", "health.view"),
    (r"^GET /api/admin/summary$", "home.view"),
    (r"^PUT /api/admin/fs/", "mapping.edit"),
    (r"^POST /api/admin/test-connection$", "tenants.manage"),
    (r"^(POST|PUT|DELETE) /api/admin/tenants(/\d+)?$", "tenants.manage"),
    (r"^(POST|PUT) /api/admin/", "etl.run"),
    (r"^GET /api/admin/ping$", None),
    (r"^GET /api/admin/", "etl.view"),
    (r"^GET /api/report/fs/", "reports.view"),
    (r"^GET /api/report/(tenants|companies-all|years|diagnose)", ("dashboards.view", "reports.view")),
    (r"^GET /api/report/", "dashboards.view"),
]


def needed(method: str, path: str):
    key = f"{method} {path}"
    for pat, perm in RULES:
        if re.match(pat, key):
            return perm
    return "users.manage" if path.startswith("/api/") else "public"   # unknown API paths: admins only


# ---------------------------------------------------------------- users ----
class Store:
    """Loads users (cached 20 s) and the permission matrix from SQL."""

    def __init__(self, engine):
        self.engine = engine
        self._cache: dict = {}
        self._perm: tuple = (0, {})

    def perms(self) -> dict:
        if time.time() - self._perm[0] > 20:
            with self.engine().connect() as cn:
                m: dict = {r: set() for r in ROLES}
                for r in cn.execute(text("SELECT role, permission FROM sec.role_permission WHERE allowed = 1")):
                    m.setdefault(r.role, set()).add(r.permission)
            m["Admin"] |= {p for p, _ in PERMISSIONS}          # Admin always keeps everything
            self._perm = (time.time(), m)
        return self._perm[1]

    def clear(self):
        self._cache.clear()
        self._perm = (0, {})

    def write(self, u, action, detail="", ip=None):
        try:
            with self.engine().begin() as cn:
                cn.execute(text("INSERT sec.audit_log (user_id, username, action, detail, ip) VALUES (:i, :n, :a, :d, :p)"),
                           {"i": u and u.get("user_id"), "n": u and u.get("username"), "a": action[:40], "d": (detail or "")[:1000], "p": ip})
        except Exception:
            pass

    def user(self, uid: int):
        hit = self._cache.get(uid)
        if hit and hit[0] > time.time():
            return hit[1]
        with self.engine().connect() as cn:
            r = cn.execute(text("""SELECT user_id, username, full_name, email, role, must_change, all_companies,
                                          ISNULL(all_pages, 1) AS all_pages, is_active, token_version
                                   FROM sec.app_user WHERE user_id = :u"""), {"u": uid}).mappings().first()
            if not r:
                return None
            u = dict(r)
            u["companies"] = {(c.tenant_key, c.company.lower()) for c in cn.execute(text(
                "SELECT tenant_key, company FROM sec.user_company WHERE user_id = :u"), {"u": uid})}
            u["pages"] = {r.page_key for r in cn.execute(text("SELECT page_key FROM sec.user_page WHERE user_id = :u"), {"u": uid})}
        u["permissions"] = sorted(self.perms().get(u["role"], set()))
        self._cache[uid] = (time.time() + 20, u)
        return u


def can_see(u, tenant, company) -> bool:
    if u is None or u["all_companies"]:
        return True
    if company in (None, "", "*"):
        return tenant is None or any(t == int(tenant) for t, _ in u["companies"])
    return (int(tenant), str(company).lower()) in u["companies"] if tenant not in (None, "") else \
        any(c == str(company).lower() for _, c in u["companies"])


def filter_companies(rows, tenant_key="tenant_key", company="company"):
    u = current_user()
    return [r for r in rows if can_see(u, r[tenant_key], r[company])] if u else rows


def set_rls(conn):
    """Put the signed-in user into SESSION_CONTEXT so the SQL Server security policy filters dw.fact_gl."""
    u = current_user()
    if u is None:
        return
    conn.exec_driver_sql("EXEC sp_set_session_context N'app_user', ?; EXEC sp_set_session_context N'app_all', ?",
                         (u["user_id"], 1 if u["all_companies"] else 0))


def install_reset(engine):
    """Pooled connections are shared - clear the user from SESSION_CONTEXT whenever one is handed out."""
    @event.listens_for(engine, "checkout")
    def _reset(dbapi_conn, *_):
        cur = dbapi_conn.cursor()
        try:
            cur.execute("EXEC sp_set_session_context N'app_user', NULL; EXEC sp_set_session_context N'app_all', NULL")
        except Exception:
            pass
        finally:
            cur.close()


# ---------------------------------------------------------------- middleware ----
class AuthMiddleware:
    """Pure ASGI middleware: checks the token, the permission for the path, and the company in the query."""

    def __init__(self, app, store: Store, log):
        self.app, self.store, self.log = app, store, log

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/") or scope["method"] == "OPTIONS":
            return await self.app(scope, receive, send)
        req = Request(scope)
        perm = needed(scope["method"], scope["path"])
        if perm == "public":
            return await self.app(scope, receive, send)
        auth = req.headers.get("authorization", "")
        data = read_token(auth[7:]) if auth.lower().startswith("bearer ") else None
        if not data:
            return await _deny(scope, receive, send, 401, "Please sign in.")
        try:
            u = self.store.user(data["u"])
        except Exception as ex:
            return await _deny(scope, receive, send, 503, f"Cannot check the user: {str(ex).splitlines()[0][:200]}")
        if not u or not u["is_active"] or u["token_version"] != data["v"]:
            return await _deny(scope, receive, send, 401, "Your session has ended. Please sign in again.")
        if u["must_change"] and not scope["path"].startswith("/api/auth/"):
            return await _deny(scope, receive, send, 403, "Please change your password first.")
        if perm is not None:
            options = perm if isinstance(perm, tuple) else (perm,)
            if not any(p in u["permissions"] for p in options):
                return await _deny(scope, receive, send, 403, f"Your role ({u['role']}) cannot do this.")
        q = req.query_params
        t = q.get("tenant")
        t = int(t) if t and t.isdigit() else None
        if not can_see(u, t, q.get("company") or None):
            return await _deny(scope, receive, send, 403, f"You have no access to company {q.get('company')}.")
        if not page_ok(u, scope["path"], q):
            return await _deny(scope, receive, send, 403, "This report is not enabled for your user.")
        token = _user.set(u)
        status = {}

        async def send_(msg):
            if msg["type"] == "http.response.start":
                status["code"] = msg["status"]
            await send(msg)
        try:
            return await self.app(scope, receive, send_)
        finally:
            _user.reset(token)
            # every change (POST / PUT / DELETE) is written to the audit log; sign-in / user changes write their own
            if scope["method"] in ("POST", "PUT", "DELETE") and not re.match(r"^/api/(auth/|admin/(users|roles))", scope["path"]):
                from starlette.concurrency import run_in_threadpool
                ip = req.client.host if req.client else None
                await run_in_threadpool(self.store.write, u, f"api.{scope['method'].lower()}",
                                        f"{scope['path']}{'?' + scope['query_string'].decode() if scope['query_string'] else ''} -> {status.get('code', '?')}", ip)


async def _deny(scope, receive, send, status, msg):
    from fastapi.responses import JSONResponse
    await JSONResponse({"detail": msg}, status_code=status)(scope, receive, send)


# ---------------------------------------------------------------- endpoints ----
class LoginIn(BaseModel):
    username: str
    password: str


class PasswordIn(BaseModel):
    current: str
    new: str


class CompanyIn(BaseModel):
    tenant_key: int
    company: str


class UserIn(BaseModel):
    username: str = Field(min_length=2, max_length=60)
    full_name: str = ""
    email: str = ""
    role: str
    password: str = ""                      # required for a new user; "" = keep on edit
    must_change: bool = True
    all_companies: bool = False
    is_active: bool = True
    companies: list[CompanyIn] = []
    all_pages: bool = True                  # every dashboard / report the role allows
    pages: list[str] = []                   # else only these (PAGES keys)


class MatrixIn(BaseModel):
    matrix: dict[str, list[str]]           # role -> allowed permissions


def register(app, engine, store: Store, log):
    def audit(action, detail="", user=None, ip=None):
        u = user or current_user()
        try:
            with engine().begin() as cn:
                cn.execute(text("INSERT sec.audit_log (user_id, username, action, detail, ip) VALUES (:i, :n, :a, :d, :p)"),
                           {"i": u and u.get("user_id"), "n": u and u.get("username"), "a": action, "d": detail[:1000], "p": ip})
        except Exception as ex:
            log.warning("audit failed: %s", ex)

    def public_user(u):
        return {k: u[k] for k in ("user_id", "username", "full_name", "email", "role", "must_change", "all_companies",
                                  "all_pages", "permissions")} | {
            "companies": [{"tenant_key": t, "company": c} for t, c in sorted(u["companies"])],
            "pages": sorted(u["pages"])}

    @app.post("/api/auth/login")
    def login(body: LoginIn, request: Request):
        ip = request.client.host if request.client else None
        with engine().begin() as cn:
            r = cn.execute(text("SELECT * FROM sec.app_user WHERE username = :n"), {"n": body.username.strip()}).mappings().first()
            if not r or not r["is_active"]:
                audit("login.failed", f"unknown or disabled user '{body.username[:60]}'", user={}, ip=ip)
                raise HTTPException(401, "Wrong username or password.")
            if r["locked_until"] and r["locked_until"] > datetime.utcnow():
                raise HTTPException(423, f"Too many wrong passwords. Try again after {LOCK_MINUTES} minutes.")
            if not verify_password(body.password, r["password_hash"]):
                fails = r["failed_logins"] + 1
                cn.execute(text("UPDATE sec.app_user SET failed_logins = :f, locked_until = :l WHERE user_id = :u"),
                           {"f": 0 if fails >= MAX_FAILED else fails, "u": r["user_id"],
                            "l": datetime.utcnow() + timedelta(minutes=LOCK_MINUTES) if fails >= MAX_FAILED else None})
                audit("login.failed", "wrong password", user=dict(r), ip=ip)
                raise HTTPException(401, "Wrong username or password.")
            cn.execute(text("UPDATE sec.app_user SET failed_logins = 0, locked_until = NULL, last_login_at = SYSUTCDATETIME() WHERE user_id = :u"),
                       {"u": r["user_id"]})
        store.clear()
        u = store.user(r["user_id"])
        audit("login", "", user=u, ip=ip)
        return {"token": make_token(u["user_id"], u["token_version"]), "user": public_user(u)}

    @app.get("/api/auth/me")
    def me():
        return public_user(current_user())

    @app.get("/api/auth/demo-users")
    def demo_users():
        """Demo accounts shown on the sign-in page (only while DEMO_USERS=1 in etl/.env)."""
        if not demo_enabled():
            return []
        return [{"username": n, "full_name": f, "role": r, "password": DEMO_PASSWORD, "about": a} for n, f, r, a in DEMO_USERS]

    @app.post("/api/auth/change-password")
    def change_password(body: PasswordIn):
        u = current_user()
        if is_demo(u["username"]):
            raise HTTPException(403, "Demo accounts share one password, so it cannot be changed.")
        with engine().begin() as cn:
            h = cn.execute(text("SELECT password_hash FROM sec.app_user WHERE user_id = :u"), {"u": u["user_id"]}).scalar()
            if not verify_password(body.current, h):
                raise HTTPException(400, "Current password is wrong.")
            if (p := password_problem(body.new)):
                raise HTTPException(400, p)
            cn.execute(text("""UPDATE sec.app_user SET password_hash = :h, must_change = 0, token_version = token_version + 1
                               WHERE user_id = :u"""), {"h": hash_password(body.new), "u": u["user_id"]})
        store.clear()
        nu = store.user(u["user_id"])
        audit("password.change")
        return {"token": make_token(nu["user_id"], nu["token_version"]), "user": public_user(nu)}

    @app.post("/api/auth/logout")
    def logout():
        audit("logout")
        return {"ok": True}

    # ---- users (Admin) ----
    @app.get("/api/admin/users")
    def users():
        with engine().connect() as cn:
            rows = [dict(r) for r in cn.execute(text("""
                SELECT user_id, username, full_name, email, role, must_change, all_companies, ISNULL(all_pages, 1) AS all_pages,
                       is_active, last_login_at, created_at, locked_until FROM sec.app_user ORDER BY username""")).mappings()]
            comp, pages = {}, {}
            for r in cn.execute(text("SELECT user_id, tenant_key, company FROM sec.user_company")):
                comp.setdefault(r.user_id, []).append({"tenant_key": r.tenant_key, "company": r.company})
            for r in cn.execute(text("SELECT user_id, page_key FROM sec.user_page")):
                pages.setdefault(r.user_id, []).append(r.page_key)
        for r in rows:
            r["companies"] = comp.get(r["user_id"], [])
            r["pages"] = sorted(pages.get(r["user_id"], []))
        return rows

    @app.get("/api/admin/pages")
    def page_list():
        return [{"key": k, "label": l, "group": g} for k, l, g in PAGES]

    def _save_pages(cn, uid, body):
        cn.execute(text("UPDATE sec.app_user SET all_pages = :a WHERE user_id = :u"), {"a": body.all_pages, "u": uid})
        cn.execute(text("DELETE FROM sec.user_page WHERE user_id = :u"), {"u": uid})
        if not body.all_pages:
            for k in set(body.pages) & PAGE_KEYS:
                cn.execute(text("INSERT sec.user_page (user_id, page_key) VALUES (:u, :k)"), {"u": uid, "k": k})

    def _save_companies(cn, uid, items):
        cn.execute(text("DELETE FROM sec.user_company WHERE user_id = :u"), {"u": uid})
        for c in {(i.tenant_key, i.company.lower()) for i in items}:
            cn.execute(text("INSERT sec.user_company (user_id, tenant_key, company) VALUES (:u, :t, :c)"),
                       {"u": uid, "t": c[0], "c": c[1]})

    def _check(body: UserIn, new: bool):
        if body.role not in ROLES:
            raise HTTPException(400, f"Role must be one of {', '.join(ROLES)}.")
        if new and not body.password:
            raise HTTPException(400, "Give the new user a password.")
        if body.password and (p := password_problem(body.password)):
            raise HTTPException(400, p)
        if not body.all_companies and not body.companies:
            raise HTTPException(400, "Choose at least one company, or 'All companies'.")
        if not body.all_pages and not set(body.pages) & PAGE_KEYS:
            raise HTTPException(400, "Choose at least one dashboard or report, or 'All that the role allows'.")

    @app.post("/api/admin/users")
    def create_user(body: UserIn):
        _check(body, True)
        with engine().begin() as cn:
            if cn.execute(text("SELECT 1 FROM sec.app_user WHERE username = :n"), {"n": body.username.strip()}).first():
                raise HTTPException(409, f"User '{body.username}' already exists.")
            uid = cn.execute(text("""INSERT sec.app_user (username, full_name, email, role, password_hash, must_change, all_companies, is_active)
                                     OUTPUT inserted.user_id VALUES (:n, :f, :e, :r, :h, :m, :a, :i)"""),
                             {"n": body.username.strip(), "f": body.full_name, "e": body.email, "r": body.role,
                              "h": hash_password(body.password), "m": body.must_change, "a": body.all_companies,
                              "i": body.is_active}).scalar()
            _save_companies(cn, uid, body.companies)
            _save_pages(cn, uid, body)
        store.clear()
        audit("user.create", f"{body.username} ({body.role})")
        return {"ok": True, "user_id": uid}

    @app.put("/api/admin/users/{uid}")
    def update_user(uid: int, body: UserIn):
        _check(body, False)
        me_ = current_user()
        if uid == me_["user_id"] and (body.role != "Admin" or not body.is_active):
            raise HTTPException(400, "You cannot remove your own Admin role or disable yourself.")
        with engine().begin() as cn:
            old = cn.execute(text("SELECT role, is_active FROM sec.app_user WHERE user_id = :u"), {"u": uid}).mappings().first()
            if not old:
                raise HTTPException(404, "User not found.")
            if old["role"] == "Admin" and (body.role != "Admin" or not body.is_active):
                admins = cn.execute(text("SELECT COUNT(*) FROM sec.app_user WHERE role = 'Admin' AND is_active = 1")).scalar()
                if admins <= 1:
                    raise HTTPException(400, "Keep at least one active Admin.")
            cn.execute(text(f"""UPDATE sec.app_user SET username = :n, full_name = :f, email = :e, role = :r, all_companies = :a,
                                   is_active = :i, must_change = :m, token_version = token_version + 1
                                   {", password_hash = :h, failed_logins = 0, locked_until = NULL" if body.password else ""}
                               WHERE user_id = :u"""),
                       {"n": body.username.strip(), "f": body.full_name, "e": body.email, "r": body.role, "a": body.all_companies,
                        "i": body.is_active, "m": body.must_change, "u": uid,
                        **({"h": hash_password(body.password)} if body.password else {})})
            _save_companies(cn, uid, body.companies)
            _save_pages(cn, uid, body)
        store.clear()
        audit("user.update", f"{body.username} ({body.role}{', password reset' if body.password else ''})")
        return {"ok": True}

    @app.delete("/api/admin/users/{uid}")
    def delete_user(uid: int):
        if uid == current_user()["user_id"]:
            raise HTTPException(400, "You cannot delete yourself.")
        with engine().begin() as cn:
            r = cn.execute(text("SELECT username, role FROM sec.app_user WHERE user_id = :u"), {"u": uid}).mappings().first()
            if not r:
                raise HTTPException(404, "User not found.")
            if r["role"] == "Admin" and cn.execute(text("SELECT COUNT(*) FROM sec.app_user WHERE role='Admin' AND is_active=1")).scalar() <= 1:
                raise HTTPException(400, "Keep at least one active Admin.")
            cn.execute(text("DELETE FROM sec.app_user WHERE user_id = :u"), {"u": uid})
        store.clear()
        audit("user.delete", r["username"])
        return {"ok": True}

    @app.get("/api/admin/roles")
    def roles():
        m = store.perms()
        return {"roles": ROLES, "permissions": [{"key": k, "label": l} for k, l in PERMISSIONS],
                "matrix": {r: sorted(m.get(r, set())) for r in ROLES}}

    @app.put("/api/admin/roles")
    def save_roles(body: MatrixIn):
        keys = {k for k, _ in PERMISSIONS}
        with engine().begin() as cn:
            for role in ROLES:
                if role == "Admin":
                    continue                                   # Admin always has everything
                allowed = set(body.matrix.get(role, [])) & keys
                for k in keys:
                    prm = {"a": 1 if k in allowed else 0, "r": role, "p": k}
                    done = cn.execute(text("UPDATE sec.role_permission SET allowed = :a WHERE role = :r AND permission = :p"), prm)
                    if not done.rowcount:
                        cn.execute(text("INSERT INTO sec.role_permission (role, permission, allowed) VALUES (:r, :p, :a)"), prm)
        store.clear()
        audit("roles.update", json.dumps({r: sorted(v) for r, v in body.matrix.items() if r != "Admin"})[:1000])
        return roles()

    @app.get("/api/admin/audit")
    def audit_log(limit: int = 200):
        with engine().connect() as cn:
            return [dict(r) for r in cn.execute(text(
                "SELECT TOP (:n) at, username, action, detail, ip FROM sec.audit_log ORDER BY id DESC"), {"n": min(limit, 1000)}).mappings()]

    return audit


# Demo accounts for trying the system (one per role). Only active while DEMO_USERS=1 in etl/.env;
# without it they are disabled at the next API start. They share one password, which cannot be changed.
DEMO_PASSWORD = "Demo1234"
DEMO_USERS = [
    ("demo.admin", "Demo Admin", "Admin", "Everything: users, D365 tenants, configuration, all modules"),
    ("demo.accountant", "Demo Accountant", "Accountant", "Run ETL, map accounts, post adjustments, close periods"),
    ("demo.finance", "Demo Finance", "Finance", "Dashboards, reports and exports"),
    ("demo.viewer", "Demo Viewer", "Viewer", "Read-only dashboards and reports"),
]


def demo_enabled() -> bool:
    return os.getenv("DEMO_USERS", "").strip().lower() in ("1", "true", "yes", "on")


def is_demo(username: str) -> bool:
    return any(username == n for n, *_ in DEMO_USERS)


def ensure_demo_users(engine) -> str:
    """Create the demo accounts that are missing and enable them - or disable them when DEMO_USERS is off."""
    names = [n for n, *_ in DEMO_USERS]
    try:
        with engine().begin() as cn:
            if not demo_enabled():
                n = cn.execute(text(f"UPDATE sec.app_user SET is_active = 0, token_version = token_version + 1 "
                                    f"WHERE is_active = 1 AND username IN ({', '.join(':u%d' % i for i in range(len(names)))})"),
                               {f"u{i}": n for i, n in enumerate(names)}).rowcount
                return f"demo users off{f' ({n} disabled)' if n else ''}"
            h = hash_password(DEMO_PASSWORD)
            for name, full, role, _ in DEMO_USERS:
                if cn.execute(text("SELECT COUNT(*) FROM sec.app_user WHERE username = :n"), {"n": name}).scalar():
                    cn.execute(text("""UPDATE sec.app_user SET is_active = 1, must_change = 0, password_hash = :h, failed_logins = 0,
                                              locked_until = NULL WHERE username = :n"""), {"n": name, "h": h})
                else:
                    cn.execute(text("""INSERT sec.app_user (username, full_name, role, password_hash, must_change, all_companies)
                                       VALUES (:n, :f, :r, :h, 0, 1)"""), {"n": name, "f": full, "r": role, "h": h})
        return f"demo users on: {', '.join(names)} (password {DEMO_PASSWORD})"
    except Exception as ex:
        return f"demo users not set up: {str(ex).splitlines()[0][:200]}"


def bootstrap(engine, log) -> str:
    """First start: create user 'admin' whose password is the current ADMIN_API_KEY (must be changed at first sign-in)."""
    try:
        with engine().begin() as cn:
            if cn.execute(text("SELECT COUNT(*) FROM sec.app_user")).scalar():
                return "users ready"
            cn.execute(text("""INSERT sec.app_user (username, full_name, role, password_hash, must_change, all_companies)
                               VALUES ('admin', 'Administrator', 'Admin', :h, 1, 1)"""),
                       {"h": hash_password(os.environ.get("ADMIN_API_KEY", "ChangeMe123"))})
        return "first user created: admin (password = ADMIN_API_KEY from etl\\.env, change it at first sign-in)"
    except Exception as ex:
        return f"users not ready: {str(ex).splitlines()[0][:200]}"

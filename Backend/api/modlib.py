"""Small helpers shared by the newer modules (budget, ageing, analytics, close, consolidation, pack, alerts, reconciliation)."""
import calendar
from datetime import date, datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import text

import security

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def as_date(v):
    """date from a date / datetime / ISO string (drivers differ)."""
    if v is None or (isinstance(v, date) and not isinstance(v, datetime)):
        return v
    if isinstance(v, datetime):
        return v.date()
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def as_datetime(v):
    if v is None or isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day)
    try:
        return datetime.fromisoformat(str(v)[:19])
    except ValueError:
        return None


def month_end(y: int, m: int) -> date:
    return date(y, m, calendar.monthrange(y, m)[1])


def num(v) -> float:
    if v is None:
        return 0.0
    return float(v) if isinstance(v, (Decimal, int, float)) else float(v or 0)


def clean(v):
    """JSON-safe copy (Decimal -> float, dates -> ISO)."""
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    return v


def endpoint(app, path, method="GET"):
    for r in app.routes:
        if getattr(r, "path", None) == path and method in (getattr(r, "methods", None) or ()):
            return r.endpoint
    raise HTTPException(500, f"{path} is not available")


def call(app, path, **params):
    """Call another report endpoint in-process (the caller has already checked access)."""
    return endpoint(app, path)(**params)


def need_company(tenant, company):
    if not security.can_see(security.current_user(), tenant, company):
        raise HTTPException(403, f"You have no access to company {company}.")


def table_exists(cn, full_name: str) -> bool:
    return bool(cn.execute(text("SELECT OBJECT_ID(:n)"), {"n": full_name}).scalar())


def columns(cn, schema: str, table: str) -> list[str]:
    return [r[0] for r in cn.execute(text("""SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                                             WHERE TABLE_SCHEMA = :s AND TABLE_NAME = :t ORDER BY ORDINAL_POSITION"""),
                                     {"s": schema, "t": table})]


def pick(cols, *candidates):
    low = {c.lower(): c for c in cols}
    for c in candidates:
        if c.lower() in low:
            return low[c.lower()]
    return None


class OpsSettings:
    """Key/value settings of the operations modules (ops.setting)."""

    DEFAULTS = {
        "smtp_host": "", "smtp_port": "587", "smtp_from": "", "smtp_user": "", "smtp_tls": "1",
        "recon_hour": "2", "alerts_spike_pct": "50", "alerts_spike_min": "10000", "alerts_stale_days": "2",
        "ic_tolerance": "1",
    }

    def __init__(self, engine):
        self.engine = engine

    def all(self) -> dict:
        out = dict(self.DEFAULTS)
        try:
            with self.engine().connect() as cn:
                for r in cn.execute(text("SELECT k, v FROM ops.setting")):
                    out[r.k] = r.v if r.v is not None else ""
        except Exception:
            pass
        return out

    def get(self, k):
        return self.all().get(k, self.DEFAULTS.get(k, ""))

    def save(self, values: dict):
        with self.engine().begin() as cn:
            for k, v in values.items():
                p = {"k": k, "v": "" if v is None else str(v)}
                if not cn.execute(text("UPDATE ops.setting SET v = :v, updated_at = SYSUTCDATETIME() WHERE k = :k"), p).rowcount:
                    cn.execute(text("INSERT INTO ops.setting (k, v) VALUES (:k, :v)"), p)

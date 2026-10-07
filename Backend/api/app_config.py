"""System Configuration (Administration › System Configuration).

Settings live in sec.app_config (one row per key). Every value is checked here before it is saved.
The AI Assistant runs locally - no keys or external services are needed.
"""
import re
import time

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import text

import security

THEMES = ["teal", "ocean", "royal", "aurora", "emerald", "sunset", "rose", "midnight"]   # same ids as dashboard/src/theme.jsx

DEFAULTS = {
    "company_name": "Al-Dowayan",
    "short_name": "AD",
    "tagline": "Financial Reporting",
    "login_message": "Financial reporting from Dynamics 365 - dashboards, statements and data pipeline in one place.",
    "logo": "",
    "default_theme": "teal",
    "default_language": "en",
    "currency": "SAR",
    "decimals": 0,
    "negatives": "minus",
}
PUBLIC = ["company_name", "short_name", "tagline", "login_message", "logo", "default_theme", "default_language",
          "currency", "decimals", "negatives"]
MAX_LOGO = 300_000            # characters of the data: URL (about 220 KB of image)


class ConfigIn(BaseModel):
    company_name: str
    short_name: str
    tagline: str = ""
    login_message: str = ""
    logo: str = ""
    default_theme: str
    default_language: str
    currency: str
    decimals: int
    negatives: str


def check(c: ConfigIn) -> dict:
    v = c.model_dump()
    for k in ("company_name", "short_name", "tagline", "login_message", "currency"):
        v[k] = (v[k] or "").strip()
    if not 1 <= len(v["company_name"]) <= 100:
        raise HTTPException(400, "Company name must be 1 to 100 characters.")
    if not 1 <= len(v["short_name"]) <= 4:
        raise HTTPException(400, "Logo letters must be 1 to 4 characters.")
    if len(v["tagline"]) > 80 or len(v["login_message"]) > 300:
        raise HTTPException(400, "Tagline is at most 80 characters and the sign-in message at most 300.")
    if v["logo"] and not re.match(r"^data:image/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$", v["logo"]):
        raise HTTPException(400, "The logo must be a PNG, JPG, WEBP or SVG image.")
    if len(v["logo"]) > MAX_LOGO:
        raise HTTPException(400, "The logo is too large - use an image under 200 KB.")
    if v["default_theme"] not in THEMES:
        raise HTTPException(400, f"Theme must be one of {', '.join(THEMES)}.")
    if v["default_language"] not in ("en", "ar"):
        raise HTTPException(400, "Language must be English or Arabic.")
    if not re.match(r"^[A-Za-z]{3}$", v["currency"]):
        raise HTTPException(400, "Currency must be a 3-letter code such as SAR, AED or USD.")
    v["currency"] = v["currency"].upper()
    if v["decimals"] not in (0, 2):
        raise HTTPException(400, "Decimals must be 0 or 2.")
    if v["negatives"] not in ("minus", "brackets"):
        raise HTTPException(400, "Negative numbers must be shown with a minus or in brackets.")
    return v


class Settings:
    """Reads sec.app_config with a 10 s cache; missing keys use DEFAULTS."""

    def __init__(self, engine, log=None):
        self.engine = engine
        self.log = log
        self._cache = (0.0, None)

    def all(self) -> dict:
        if self._cache[1] is not None and time.time() - self._cache[0] < 10:
            return self._cache[1]
        out = dict(DEFAULTS)
        try:
            with self.engine().connect() as cn:
                for r in cn.execute(text("SELECT k, v FROM sec.app_config")):
                    if r.k in DEFAULTS and r.v is not None:
                        d = DEFAULTS[r.k]
                        out[r.k] = (r.v == "1") if isinstance(d, bool) else int(r.v) if isinstance(d, int) else r.v
            if out["default_theme"] not in THEMES:      # a theme that was removed from the list -> the default one
                out["default_theme"] = DEFAULTS["default_theme"]
        except Exception as ex:                    # table not there yet - defaults, but say why
            if self.log:
                self.log.warning("system configuration not read, defaults used: %s", str(ex).splitlines()[0][:300])
        self._cache = (time.time(), out)
        return out

    def get(self, key):
        return self.all().get(key, DEFAULTS.get(key))

    def save(self, values: dict, username: str):
        """Upsert every value as two separate statements (a single UPDATE ...; IF @@ROWCOUNT = 0 INSERT batch
        is not reliable through pyodbc), then read the values back so a failed save is reported, never silent."""
        want = {}
        with self.engine().begin() as cn:
            for k, val in values.items():
                s = ("1" if val else "0") if isinstance(val, bool) else str(val)
                want[k] = s
                p = {"k": k, "v": s, "u": username}
                done = cn.execute(text("UPDATE sec.app_config SET v = :v, updated_at = SYSUTCDATETIME(), updated_by = :u WHERE k = :k"), p)
                if not done.rowcount:
                    cn.execute(text("INSERT INTO sec.app_config (k, v, updated_by) VALUES (:k, :v, :u)"), p)
        with self.engine().connect() as cn:
            got = {r.k: r.v for r in cn.execute(text("SELECT k, v FROM sec.app_config"))}
        bad = [k for k, s in want.items() if got.get(k) != s]
        self._cache = (0.0, None)
        if bad:
            raise HTTPException(500, f"The settings were not stored in sec.app_config ({', '.join(bad)}). Check api\\logs\\api.log.")


def register(app, engine, store, settings: Settings):
    @app.get("/api/config/public")
    def public_config():
        """Branding and display defaults - also needed on the sign-in page, so no sign-in is required."""
        c = settings.all()
        return {k: c[k] for k in PUBLIC}

    @app.get("/api/admin/config")
    def get_config():
        c = settings.all()
        with engine().connect() as cn:
            last = cn.execute(text("SELECT TOP 1 updated_at, updated_by FROM sec.app_config ORDER BY updated_at DESC")).mappings().first()
        return {"values": c, "defaults": DEFAULTS, "themes": THEMES, "last_change": dict(last) if last else None}

    @app.put("/api/admin/config")
    def put_config(body: ConfigIn):
        v = check(body)
        old = settings.all()
        changed = [k for k in v if str(v[k]) != str(old.get(k))]
        u = security.current_user()
        settings.save(v, u["username"])
        store.write(u, "config.update", ", ".join("logo" if k == "logo" else f"{k}={v[k]}" for k in changed)[:1000] or "no changes")
        return get_config()

"""D365 connections ("tenants") stored in etl.tenant. Client secrets are encrypted with SECRET_KEY."""
from sqlalchemy import text

from d365_client import D365Client, normalize_env_url
from db import decrypt, encrypt, engine

PUBLIC_COLS = """tenant_key, name, aad_tenant_id, client_id, base_url, default_company, is_active,
                 created_at, updated_at, last_test_at, last_test_ok, last_test_message,
                 last_sync_at, last_sync_status"""


def _rows(sql, **p):
    with engine().connect() as cn:
        return [dict(r._mapping) for r in cn.execute(text(sql), p)]


def list_tenants(active_only=False) -> list[dict]:
    where = "WHERE is_active = 1" if active_only else ""
    return _rows(f"SELECT {PUBLIC_COLS} FROM etl.tenant {where} ORDER BY name")


def get_tenant(key: int) -> dict | None:
    r = _rows(f"SELECT {PUBLIC_COLS} FROM etl.tenant WHERE tenant_key = :k", k=key)
    return r[0] if r else None


def get_tenant_by_name(name: str) -> dict | None:
    r = _rows(f"SELECT {PUBLIC_COLS} FROM etl.tenant WHERE name = :n", n=name)
    return r[0] if r else None


def client_for(key: int) -> D365Client:
    r = _rows("SELECT aad_tenant_id, client_id, client_secret_enc, base_url FROM etl.tenant WHERE tenant_key = :k",
              k=key)
    if not r:
        raise KeyError(f"Tenant {key} not found")
    t = r[0]
    return D365Client(t["aad_tenant_id"], t["client_id"], decrypt(t["client_secret_enc"]), t["base_url"])


def stored_secret(key: int) -> str:
    r = _rows("SELECT client_secret_enc FROM etl.tenant WHERE tenant_key = :k", k=key)
    if not r:
        raise KeyError(f"Tenant {key} not found")
    return decrypt(r[0]["client_secret_enc"])


def save_tenant(data: dict, key: int | None = None) -> int:
    """Insert (key=None) or update. An empty client_secret on update keeps the stored one."""
    base_url, cmp = normalize_env_url(data["base_url"])
    p = {
        "name": data["name"].strip(),
        "aad": data["aad_tenant_id"].strip(),
        "cid": data["client_id"].strip(),
        "url": base_url,
        "co": (data.get("default_company") or cmp or "").strip() or None,
        "act": 1 if data.get("is_active", True) else 0,
    }
    secret = (data.get("client_secret") or "").strip()
    with engine().begin() as cn:
        if key is None:
            if not secret:
                raise ValueError("Client secret is required for a new connection.")
            p["sec"] = encrypt(secret)
            return cn.execute(text("""
                INSERT etl.tenant (name, aad_tenant_id, client_id, client_secret_enc, base_url, default_company, is_active)
                OUTPUT inserted.tenant_key
                VALUES (:name, :aad, :cid, :sec, :url, :co, :act)"""), p).scalar()
        sets = "name=:name, aad_tenant_id=:aad, client_id=:cid, base_url=:url, default_company=:co, is_active=:act"
        if secret:
            p["sec"] = encrypt(secret)
            sets += ", client_secret_enc=:sec"
        p["k"] = key
        cn.execute(text(f"UPDATE etl.tenant SET {sets}, updated_at=SYSUTCDATETIME() WHERE tenant_key=:k"), p)
        return key


def delete_tenant(key: int, delete_data: bool = True):
    from sqlalchemy import inspect
    with engine().begin() as cn:
        if delete_data:
            for t in inspect(engine()).get_table_names(schema="stg"):
                cn.execute(text(f"IF COL_LENGTH('stg.[{t}]', '_tenant_key') IS NOT NULL "
                                f"DELETE FROM stg.[{t}] WHERE _tenant_key = :k"), {"k": key})
            for t in ("dw.fact_gl", "dw.dim_account", "etl.watermark"):
                cn.execute(text(f"DELETE FROM {t} WHERE tenant_key = :k"), {"k": key})
        cn.execute(text("DELETE FROM etl.tenant WHERE tenant_key = :k"), {"k": key})


def record_test(key: int, ok: bool, message: str):
    with engine().begin() as cn:
        cn.execute(text("""UPDATE etl.tenant SET last_test_at=SYSUTCDATETIME(), last_test_ok=:ok,
                           last_test_message=:m WHERE tenant_key=:k"""), {"ok": 1 if ok else 0, "m": message[:1000], "k": key})

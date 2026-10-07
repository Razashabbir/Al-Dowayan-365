"""Per-connection entity catalog (from $metadata, cached) and the entities chosen for syncing.

etl.metadata_cache  - compact JSON of all entities in one D365 environment
etl.tenant_entity   - which entities a connection syncs, and how (full / incremental)
"""
import json
import re
import os
import threading
import time

import yaml
from sqlalchemy import text

from db import engine
from schema_builder import Metadata, snake

HERE = os.path.dirname(os.path.abspath(__file__))
_mem: dict[int, Metadata] = {}
_lock = threading.Lock()


# ------------------------------------------------------------ metadata ----
_download_locks: dict[int, threading.Lock] = {}
_fetched_at: dict[int, float] = {}


def _tenant_lock(tenant_key: int) -> threading.Lock:
    with _lock:
        return _download_locks.setdefault(tenant_key, threading.Lock())


def _save_cache(tenant_key: int, md: Metadata):
    """Upsert under a key-range lock so two writers can never both INSERT."""
    p = {"k": tenant_key, "j": json.dumps(md.entities, separators=(",", ":")), "n": len(md.entities)}
    with engine().begin() as cn:
        updated = cn.execute(text("""
            UPDATE etl.metadata_cache WITH (UPDLOCK, HOLDLOCK)
            SET entities_json=:j, entity_count=:n, fetched_at=SYSUTCDATETIME() WHERE tenant_key=:k"""), p).rowcount
        if not updated:
            cn.execute(text("""
                INSERT etl.metadata_cache (tenant_key, entities_json, entity_count)
                SELECT :k, :j, :n WHERE NOT EXISTS
                    (SELECT 1 FROM etl.metadata_cache WITH (UPDLOCK, HOLDLOCK) WHERE tenant_key=:k)"""), p)


def get_metadata(tenant_key: int, client=None, refresh: bool = False) -> Metadata:
    """Cached metadata; downloads from D365 (about 1 minute) when missing or refresh=True.
    Only one download per connection runs at a time; callers arriving meanwhile reuse its result."""
    with _lock:
        if not refresh and tenant_key in _mem:
            return _mem[tenant_key]
    if not refresh:
        with engine().connect() as cn:
            raw = cn.execute(text("SELECT entities_json FROM etl.metadata_cache WHERE tenant_key=:k"),
                             {"k": tenant_key}).scalar()
        if raw:
            md = Metadata(json.loads(raw))
            with _lock:
                _mem[tenant_key] = md
            return md

    asked_at = time.time()
    with _tenant_lock(tenant_key):
        with _lock:  # someone else finished a download while we waited -> use it
            if tenant_key in _mem and _fetched_at.get(tenant_key, 0) >= asked_at - 1:
                return _mem[tenant_key]
        if client is None:
            from tenants import client_for
            client = client_for(tenant_key)
        md = Metadata.from_xml(client.metadata())
        try:
            _save_cache(tenant_key, md)
        except Exception as ex:  # cache is an optimisation - never fail the sync because of it
            print(f"metadata cache not saved: {str(ex)[:200]}")
        with _lock:
            _mem[tenant_key] = md
            _fetched_at[tenant_key] = time.time()
        return md


def metadata_info(tenant_key: int) -> dict | None:
    with engine().connect() as cn:
        r = cn.execute(text("SELECT entity_count, fetched_at FROM etl.metadata_cache WHERE tenant_key=:k"),
                       {"k": tenant_key}).mappings().first()
    return dict(r) if r else None


# ----------------------------------------------------------- selection ----
def default_entities() -> list[dict]:
    with open(os.path.join(HERE, "entities.yaml"), encoding="utf-8") as f:
        return yaml.safe_load(f)["entities"]


def get_selection(tenant_key: int) -> list[dict]:
    """Entities this connection syncs. First call seeds it from entities.yaml."""
    with engine().connect() as cn:
        rows = cn.execute(text("""SELECT entity_name AS name, table_name AS [table], mode, date_field, enabled
                                  FROM etl.tenant_entity WHERE tenant_key=:k ORDER BY entity_name"""),
                          {"k": tenant_key}).mappings().all()
    if rows:
        return [dict(r) for r in rows]
    seed = [{"name": e["name"], "table": e.get("table") or snake(e["name"]), "mode": e.get("mode", "full"),
             "date_field": e.get("date_field"), "enabled": True} for e in default_entities()]
    save_selection(tenant_key, seed)
    return seed


def save_selection(tenant_key: int, items: list[dict]):
    """Replace the connection's entity list. Each item: name, mode, date_field, enabled, table (optional)."""
    seen = set()
    clean = []
    # an item without a table keeps the table it already loads into (else the entities.yaml one) - never rename
    # silently, or the next ETL run would write to a new empty table (e.g. gl_entries -> general_journal_..._entities)
    with engine().connect() as cn:
        current = {r.entity_name: r.table_name for r in cn.execute(text(
            "SELECT entity_name, table_name FROM etl.tenant_entity WHERE tenant_key=:k"), {"k": tenant_key})}
    defaults = {e["name"]: e.get("table") for e in default_entities()}
    for i in items:
        name = i["name"].strip()
        if not name or name in seen:
            continue
        seen.add(name)
        mode = i.get("mode") if i.get("mode") in ("full", "incremental") else "full"
        date_field = i.get("date_field") or None
        if mode == "incremental" and not date_field:
            mode = "full"
        tbl = (i.get("table") or current.get(name) or defaults.get(name) or "").strip().lower()
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,119}", tbl):     # only safe stg table names
            tbl = snake(name)
        clean.append({"k": tenant_key, "n": name, "t": tbl, "m": mode,
                      "d": date_field, "e": 1 if i.get("enabled", True) else 0})
    with engine().begin() as cn:
        cn.execute(text("DELETE FROM etl.tenant_entity WHERE tenant_key=:k"), {"k": tenant_key})
        if clean:
            cn.execute(text("""INSERT etl.tenant_entity (tenant_key, entity_name, table_name, mode, date_field, enabled)
                               VALUES (:k, :n, :t, :m, :d, :e)"""), clean)
    return len(clean)

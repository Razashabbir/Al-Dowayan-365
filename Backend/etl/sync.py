"""Sync engine: pull the selected entities of ONE D365 connection (tenant) into the stg tables.

Used by etl.py (scheduled / command line) and by the API's "Sync now" button.
Every run is a row in etl.sync_job; every entity in it is a row in etl.run_log.
Entities load in parallel (SYNC_WORKERS, default 4) and rows are inserted in chunks while downloading.
"""
import os
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone

import pandas as pd
from sqlalchemy import inspect, text

from catalog import default_entities, get_metadata, get_selection
from db import engine, is_transient, retry
from schema_builder import Metadata, ensure_table
from tenants import client_for, get_tenant

LOOKBACK = int(os.getenv("ETL_LOOKBACK_DAYS", "7"))
INITIAL_FROM = date.fromisoformat(os.getenv("ETL_INITIAL_FROM", "2024-01-01"))
WORKERS = max(1, int(os.getenv("SYNC_WORKERS", "4")))
CHUNK = 10_000


def entity_config() -> list[dict]:
    """Default list (entities.yaml) - kept for older callers."""
    return default_entities()


# ---------------------------------------------------------------- jobs ----
class JobAlreadyRunning(RuntimeError):
    pass


def create_job(tenant_key: int, entities: list[str] | None, full: bool, requested_by: str = "") -> int:
    if not get_tenant(tenant_key):
        raise KeyError(f"Tenant {tenant_key} not found")
    try:
        mark_interrupted_jobs()
    except Exception:
        pass
    with engine().begin() as cn:
        running = cn.execute(text("""SELECT job_id FROM etl.sync_job WITH (UPDLOCK, HOLDLOCK)
                                     WHERE tenant_key=:k AND status='Running'"""), {"k": tenant_key}).scalar()
        if running:
            raise JobAlreadyRunning(f"A sync is already running for this connection (job {running}).")
        return cn.execute(text("""
            INSERT etl.sync_job (tenant_key, status, full_reload, entities, requested_by, message)
            OUTPUT inserted.job_id VALUES (:k, 'Running', :f, :e, :r, 'Queued')"""),
            {"k": tenant_key, "f": 1 if full else 0, "e": ",".join(entities or []) or None,
             "r": requested_by[:100]}).scalar()


def _exec(sql: str, p: dict, scalar: bool = False):
    """Small bookkeeping statement with retry on transient SQL errors."""
    def run():
        with engine().begin() as cn:
            r = cn.execute(text(sql), p)
            return r.scalar() if scalar else None
    return retry(run, what="bookkeeping")


def _job_msg(job_id: int, msg: str):
    try:
        try:
            _exec("UPDATE etl.sync_job SET message=:m, heartbeat_at=SYSUTCDATETIME() WHERE job_id=:j",
                  {"m": msg[:4000], "j": job_id})
        except Exception:  # older schema without heartbeat_at
            _exec("UPDATE etl.sync_job SET message=:m WHERE job_id=:j", {"m": msg[:4000], "j": job_id})
    except Exception as ex:  # a progress message must never stop the sync
        print("progress message not saved:", str(ex)[:150])


_last_beat: dict[int, float] = {}


def _heartbeat(job_id: int):
    """'Still alive' stamp, at most every 30 s - lets a crashed job be told apart from a slow one."""
    now = time.time()
    if now - _last_beat.get(job_id, 0) < 30:
        return
    _last_beat[job_id] = now
    try:
        _exec("UPDATE etl.sync_job SET heartbeat_at=SYSUTCDATETIME() WHERE job_id=:j", {"j": job_id})
    except Exception:
        pass


def _log_start(job_id, tenant_key, entity) -> int:
    return _exec("""INSERT etl.run_log (job_id, tenant_key, entity, rows_loaded, status)
                    OUTPUT inserted.id VALUES (:j, :k, :e, 0, 'Running')""",
                 {"j": job_id, "k": tenant_key, "e": entity}, scalar=True)


def _log_update(log_id, rows, status=None, seconds=None, message=None):
    sets, p = ["rows_loaded=:r"], {"r": rows, "i": log_id}
    if status:
        sets.append("status=:s"); p["s"] = status
    if seconds is not None:
        sets.append("duration_sec=:d"); p["d"] = round(seconds, 1)
    if message is not None:
        sets.append("message=:m"); p["m"] = message[:4000]
    try:
        _exec(f"UPDATE etl.run_log SET {', '.join(sets)} WHERE id=:i", p)
    except Exception as ex:
        if status:  # final status matters; progress ticks may be skipped
            raise
        print("progress not saved:", str(ex)[:150])


# ------------------------------------------------------------- loading ----
def to_frame(rows: list[dict], tenant_key: int) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    df = df[[c for c in df.columns if not c.startswith("@odata")]]
    df.insert(0, "_tenant_key", tenant_key)
    df["_loaded_at"] = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    return df


def _shape(df: pd.DataFrame, cols: list[dict]) -> pd.DataFrame:
    """Match the SQL table: column order, unknown fields dropped, dates/bits converted, NaN -> NULL."""
    df = df.reindex(columns=[c["name"] for c in cols])
    for c in cols:
        t, name = str(c["type"]).upper(), c["name"]
        if t.startswith(("DATETIME", "DATE")) and name != "_loaded_at":
            df[name] = pd.to_datetime(df[name], errors="coerce", utc=True).dt.tz_localize(None)
            df.loc[df[name] <= pd.Timestamp("1900-01-02"), name] = pd.NaT  # D365 "empty" date
            if t == "DATE":
                df[name] = df[name].dt.date
        elif t == "BIT":
            df[name] = df[name].map({True: 1, False: 0, "Yes": 1, "No": 0})
    return df.astype(object).where(pd.notna(df), None)


def write_table(df: pd.DataFrame, table: str, tenant_key: int, field: str | None = None, start: date | None = None):
    """Delete this tenant's rows (all, or from `start` on `field`) and insert df, in one transaction."""
    cols = inspect(engine()).get_columns(table, schema="stg")
    df = _shape(df, cols)
    with engine().begin() as cn:
        _delete(cn, table, tenant_key, field, start)
        if len(df):
            df.to_sql(table, cn, schema="stg", if_exists="append", index=False, chunksize=5000)


def _delete(cn, table, tenant_key, field=None, start=None):
    if field and start:
        cn.execute(text(f"DELETE FROM stg.[{table}] WHERE _tenant_key=:k AND [{field}] >= :s"),
                   {"k": tenant_key, "s": start})
    else:
        cn.execute(text(f"DELETE FROM stg.[{table}] WHERE _tenant_key=:k"), {"k": tenant_key})


def _delete_in_batches(table, tenant_key, field=None, start=None, batch=50_000):
    """Delete old rows in small committed batches so the transaction log stays small."""
    where = "_tenant_key=:k" + (f" AND [{field}] >= :s" if field and start else "")
    p = {"k": tenant_key, "s": start}
    while True:
        def run():
            with engine().begin() as cn:
                return cn.execute(text(f"DELETE TOP ({batch}) FROM stg.[{table}] WHERE {where}"), p).rowcount
        if retry(run, what=f"delete {table}") < batch:
            break


def stream_load(records, table, tenant_key, field=None, start=None, progress=None) -> tuple[int, date | None]:
    """Download + insert in chunks. Every chunk is committed on its own so the SQL transaction log
    never has to hold a whole entity (one giant transaction filled the disk on SQL Server Express).
    If a load fails half-way the table is incomplete until the next successful sync; the job
    history shows that entity as FAILED."""
    cols = inspect(engine()).get_columns(table, schema="stg")
    n, newest, buf = 0, None, []

    def flush():
        nonlocal n, newest, buf
        df = to_frame(buf, tenant_key)
        if field and field in df:
            m = pd.to_datetime(df[field], errors="coerce", utc=True).max()
            if pd.notna(m) and (newest is None or m.date() > newest):
                newest = m.date()
        shaped = _shape(df, cols)

        def run():
            with engine().begin() as cn:
                shaped.to_sql(table, cn, schema="stg", if_exists="append", index=False, chunksize=5000)
        retry(run, what=f"insert {table}")
        n += len(buf)
        buf = []
        if progress:
            progress(n)

    _delete_in_batches(table, tenant_key, field, start)
    for rec in records:
        buf.append(rec)
        if len(buf) >= CHUNK:
            flush()
    if buf:
        flush()
    return n, newest


def _watermark(tenant_key, table) -> date | None:
    with engine().connect() as cn:
        v = cn.execute(text("SELECT last_value FROM etl.watermark WHERE tenant_key=:k AND table_name=:t"),
                       {"k": tenant_key, "t": table}).scalar()
    return date.fromisoformat(v) if v else None


def _set_watermark(tenant_key, table, value: date):
    with engine().begin() as cn:
        cn.execute(text("""
            MERGE etl.watermark WITH (HOLDLOCK) AS w USING (SELECT :k AS tenant_key, :t AS table_name, :v AS last_value) s
              ON w.tenant_key = s.tenant_key AND w.table_name = s.table_name
            WHEN MATCHED THEN UPDATE SET last_value = s.last_value, updated_at = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN INSERT (tenant_key, table_name, last_value)
                 VALUES (s.tenant_key, s.table_name, s.last_value);"""),
            {"k": tenant_key, "t": table, "v": value.isoformat()})


def sync_entity(client, md: Metadata, tenant_key: int, e: dict, full: bool, progress=None) -> tuple[int, str]:
    name, table = e["name"], e["table"]
    alias_note = ""
    if not md.has(name):  # same data under another name in this D365 version?
        alt = next((a for a in _alternatives().get(name, []) if md.has(a)), None)
        if alt:
            alias_note, name = f"; loaded from {alt} (this environment's name for {name})", alt
    if not md.has(name) and name in _optional_entities():
        return 0, "skipped: this environment does not publish this optional entity"
    if not md.has(name):
        hint = md.similar(name)
        raise RuntimeError(f"Entity '{name}' does not exist in this environment."
                           + (f" Similar: {', '.join(hint)}" if hint else ""))
    schema_note = ensure_table(engine(), md, name, table, e.get("select"))

    field = e.get("date_field") if e.get("mode") == "incremental" else None
    fallback = ""
    if field and field not in md.date_fields(name):
        fallback = f"; '{field}' is not a date field here, loaded in full"
        field = None

    if field:
        wm = None if full else _watermark(tenant_key, table)
        start = (wm - timedelta(days=LOOKBACK)) if wm else INITIAL_FROM
        recs = client.iter_entity(name, e.get("select"), f"{field} ge {start.isoformat()}T00:00:00Z")
        # first load / full: replace all of this tenant's rows; otherwise replace only the window
        n, newest = stream_load(recs, table, tenant_key, field if wm else None, start if wm else None, progress)
        _set_watermark(tenant_key, table, newest or start)
        note = f"{field} from {start}"
    else:
        n, _ = stream_load(client.iter_entity(name, e.get("select")), table, tenant_key, progress=progress)
        note = "full"
    return n, f"{note}; {schema_note}{fallback}{alias_note}"


def _record_stats(tenant_key: int, e: dict, loaded: int):
    """Row count per connection + table (Counts page), refreshed after each successful load."""
    t = e["table"]
    try:
        _exec(f"""
            DECLARE @n bigint = (SELECT COUNT_BIG(*) FROM stg.[{t}] WHERE _tenant_key = :k);
            UPDATE etl.table_stats WITH (UPDLOCK, HOLDLOCK)
               SET entity_name=:e, row_count=@n, last_loaded_rows=:l, last_loaded_at=SYSUTCDATETIME()
             WHERE tenant_key=:k AND table_name=:t;
            IF @@ROWCOUNT = 0
                INSERT etl.table_stats (tenant_key, table_name, entity_name, row_count, last_loaded_rows)
                VALUES (:k, :t, :e, @n, :l);""", {"k": tenant_key, "t": t, "e": e["name"], "l": loaded})
    except Exception as ex:
        print("row count not saved:", str(ex)[:150])


def _alternatives() -> dict[str, list[str]]:
    return {e["name"]: list(e.get("alternatives") or []) for e in default_entities()}


def _optional_entities() -> set[str]:
    return {e["name"] for e in default_entities() if e.get("optional")}


EXPRESS_LIMIT_MB = int(os.getenv("EXPRESS_STOP_AT_MB", "9200"))


def _size_guard():
    """SQL Server Express stops at 10 GB per database. Stop loading new entities before that."""
    def run():
        with engine().connect() as cn:
            return cn.execute(text("""SELECT CAST(SERVERPROPERTY('EngineEdition') AS int),
                                             SUM(CAST(size AS bigint)) * 8 / 1024
                                      FROM sys.database_files WHERE type = 0""")).one()
    edition, mb = retry(run)
    if edition == 4 and mb >= EXPRESS_LIMIT_MB:  # 4 = Express
        raise RuntimeError(f"Skipped: the database is {mb:,} MB and SQL Server Express stops at 10,240 MB. "
                           f"Remove entities you do not need, or use SQL Server Developer/Standard edition.")


PRECISE = [  # (pattern in the technical text, short message shown on screen)
    (r"stg\.gl_entries is missing:", "Ledger lines not loaded yet. Run ETL for GeneralJournalAccountEntryBiEntities."),
    (r"stg\.main_accounts is missing", "Main accounts not loaded yet. Run ETL for MainAccounts."),
    (r"journal headers .* are not loaded", "Posting dates missing. Run ETL for GeneralJournalEntryBiEntities (journal headers), then Rebuild reports."),
    (r"gl_headers has no (SourceKey|RecId)", "Journal headers cannot be linked to ledger lines (no SourceKey column)."),
    (r"gl_headers has no AccountingDate", "Journal headers have no AccountingDate column."),
    (r"missing a posting date", "Posting dates missing. Run ETL for GeneralJournalEntryBiEntities (journal headers), then Rebuild reports."),
    (r"missing .*an amount", "No amount column found in the ledger lines."),
    (r"missing .*a main account", "No main account column found in the ledger lines."),
    (r"No account-number column", "No account number column found in MainAccounts."),
    (r"Login timeout|TCP Provider|Login failed", "Cannot connect to SQL Server (login or network timeout)."),
]


def precise(msg: str) -> str:
    """Short, specific message for the screen. The full text still goes to the job log."""
    import re
    text_ = str(msg)
    m = re.search(r"\[SQL Server\]([^\[]+?)(?:\s*\(\d+\))?(?:\s*\(SQL\w+\))?\s*(?:;|$)", text_)
    if m:
        text_ = m.group(1).strip()
    text_ = re.split(r"\s*\.?\s*Columns found:", text_)[0]
    m = re.match(r"(Cannot reach \S+ after \d+ tries \([^)]*\))", text_)   # keep the reason, drop the advice
    if m:
        return m.group(1).replace("https://", "") + "."
    for pat, short in PRECISE:
        if re.search(pat, text_, re.I):
            if short:
                return short
            break
    text_ = re.sub(r"\s+", " ", text_).strip()
    return text_ if len(text_) <= 220 else text_[:217] + "..."


def _refresh_reporting(tenant_key) -> str:
    with engine().connect() as cn:
        exists = cn.execute(text("SELECT OBJECT_ID('dw.usp_refresh')")).scalar()
    if not exists:
        return "Dashboard data skipped: restart the API once to create the reporting objects."
    try:
        with engine().begin() as cn:
            cn.execute(text("EXEC dw.usp_refresh @tenant_key=:k"), {"k": tenant_key})
        msg = "Dashboard data refreshed."
    except Exception as ex:
        print(f"dw.usp_refresh failed for tenant {tenant_key}: {ex}")   # full text -> job log
        msg = f"Dashboard data not built: {precise(ex)}"
    try:   # remembered so the dashboards can say why they are empty
        with engine().begin() as cn:
            cn.execute(text("UPDATE etl.tenant SET report_at = SYSUTCDATETIME(), report_msg = :m WHERE tenant_key = :k"),
                       {"m": msg[:1000], "k": tenant_key})
    except Exception:
        pass
    return msg


def run_job(job_id: int, log=print):
    """Execute a job created by create_job(). Never raises - the outcome is written to etl.sync_job."""
    with engine().connect() as cn:
        job = dict(cn.execute(text("SELECT * FROM etl.sync_job WHERE job_id=:j"), {"j": job_id}).mappings().one())
    k = job["tenant_key"]
    wanted = set(filter(None, (job["entities"] or "").split(",")))
    selection = [e for e in get_selection(k) if e.get("enabled", True)]
    todo = [e for e in selection if not wanted or e["name"] in wanted]
    full = bool(job["full_reload"])
    ok = failed = 0
    failed_tables: list[str] = []
    try:
        _job_msg(job_id, "Connecting to D365 ...")
        client_for(k).token()
        _job_msg(job_id, "Reading D365 metadata ...")
        md = get_metadata(k, client_for(k), refresh=False)
        if any(not md.has(e["name"]) for e in todo):  # cache may be old - refresh once
            md = get_metadata(k, client_for(k), refresh=True)

        done = 0

        def one(e):
            lid, t0 = None, time.time()
            try:
                lid = _log_start(job_id, k, e["name"])
                _size_guard()
                for attempt in (1, 2):  # one retry when SQL/D365 had a transient hiccup
                    try:
                        client = client_for(k)  # own HTTP session per worker
                        n, note = sync_entity(client, md, k, e, full,
                                              progress=lambda rows: (_log_update(lid, rows), _heartbeat(job_id)))
                        break
                    except Exception as ex:
                        if attempt == 2 or not is_transient(ex):
                            raise
                        log(f"  {e['name']}: transient error, retrying once ({str(ex)[:120]})")
                        time.sleep(15)
                _record_stats(k, e, n)
                _log_update(lid, n, "OK", time.time() - t0, note)
                log(f"  {e['name']}: {n:,} rows ({note})")
                return True
            except Exception as ex:
                failed_tables.append(e["table"])
                log(f"  {e['name']}: FAILED {ex}")
                try:
                    if lid:
                        _log_update(lid, 0, "FAILED", time.time() - t0, precise(ex))
                except Exception:
                    pass
                return False

        _job_msg(job_id, f"Loading {len(todo)} entities ({WORKERS} at a time) ...")
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for fut in as_completed([pool.submit(one, e) for e in todo]):
                done += 1
                if fut.result():
                    ok += 1
                else:
                    failed += 1
                _job_msg(job_id, f"Loaded {done} of {len(todo)} entities ...")

        _job_msg(job_id, "Building reporting tables ...")
        broken = sorted(set(failed_tables) & {"gl_entries", "gl_headers", "main_accounts"})
        if broken:
            # a half-loaded ledger must never reach the dashboards: keep the last good reporting tables
            refresh = (f"Dashboard data NOT rebuilt: {', '.join('stg.' + t for t in broken)} failed to load; "
                       f"dashboards keep the last good data.")
        else:
            refresh = _refresh_reporting(k)
        report_failed = refresh.startswith("Dashboard data not built") or "NOT rebuilt" in refresh
        log(refresh)
        status = "OK" if not failed and not report_failed else ("Partial" if ok else "Failed")
        message = (f"{ok} of {len(todo)} D365 tables loaded" + (f", {failed} failed" if failed else "")
                   + f". {refresh}")
    except Exception as ex:
        status, message = "Failed", precise(ex)
        log(f"FAILED: {ex}\n{traceback.format_exc()}")

    with engine().begin() as cn:
        cn.execute(text("""UPDATE etl.sync_job SET status=:s, message=:m, finished_at=SYSUTCDATETIME() WHERE job_id=:j;
                           UPDATE etl.tenant SET last_sync_at=SYSUTCDATETIME(), last_sync_status=:s WHERE tenant_key=:k"""),
                   {"s": status, "m": message[:4000], "j": job_id, "k": k})
    return status


def job_status(job_id: int) -> dict | None:
    with engine().connect() as cn:
        job = cn.execute(text("SELECT * FROM etl.sync_job WHERE job_id=:j"), {"j": job_id}).mappings().first()
        if not job:
            return None
        steps = cn.execute(text("""SELECT entity, status, rows_loaded, duration_sec, message, run_at
                                   FROM etl.run_log WHERE job_id=:j ORDER BY id"""), {"j": job_id}).mappings().all()
        total = len(set(filter(None, (job["entities"] or "").split(",")))) or cn.execute(text(
            "SELECT COUNT(*) FROM etl.tenant_entity WHERE tenant_key=:k AND enabled=1"),
            {"k": job["tenant_key"]}).scalar()
        now = cn.execute(text("SELECT SYSUTCDATETIME()")).scalar()   # lets the page count running steps' seconds on the server clock
    return {**dict(job), "total_entities": total, "steps": [dict(s) for s in steps], "server_now": now}


STALE_MINUTES = int(os.getenv("JOB_STALE_MINUTES", "30"))


def mark_interrupted_jobs():
    """A job still 'Running' without any progress for STALE_MINUTES is dead (its process was stopped or
    the PC restarted). Mark it Failed so a new sync for that tenant can start."""
    with engine().connect() as cn:  # column may be missing if the schema update has not run yet
        has_beat = cn.execute(text("SELECT COL_LENGTH('etl.sync_job', 'heartbeat_at')")).scalar() is not None
    beat = "ISNULL(j.heartbeat_at, j.started_at)" if has_beat else "j.started_at"
    with engine().begin() as cn:
        cn.execute(text(f"""
            DECLARE @cut datetime2(0) = DATEADD(minute, -{STALE_MINUTES}, SYSUTCDATETIME());
            UPDATE l SET status='FAILED', message='Interrupted (sync process stopped)'
              FROM etl.run_log l JOIN etl.sync_job j ON j.job_id = l.job_id
             WHERE l.status='Running' AND j.status='Running' AND {beat} < @cut;
            UPDATE etl.sync_job SET status='Failed', finished_at=SYSUTCDATETIME(),
                   message='Interrupted: no progress for {STALE_MINUTES} minutes (sync process stopped or PC restarted)'
             WHERE status='Running' AND {beat.replace('j.', '')} < @cut;"""))

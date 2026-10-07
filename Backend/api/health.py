"""System Health: one call that checks every part of the system and says what needs attention."""
import os
import platform
import re
import time
from datetime import datetime, timedelta

from sqlalchemy import text

STARTED = time.time()
LOG_LINE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),\d+ (\w+) (.*)$")


def _q(cn, sql, **p):
    return [dict(r) for r in cn.execute(text(sql), p).mappings()]


def _one(cn, sql, **p):
    r = cn.execute(text(sql), p).first()
    return r[0] if r else None


def _log_errors(path, hours=24):
    """ERROR lines of api.log in the last `hours` (newest first)."""
    out, since = [], datetime.now() - timedelta(hours=hours)
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                m = LOG_LINE.match(line)
                if m and m.group(2) == "ERROR" and datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S") >= since:
                    out.append({"at": m.group(1), "message": m.group(3)[:200]})
    except FileNotFoundError:
        pass
    return out[::-1]


def register(app, engine, log_path, version):
    @app.get("/api/admin/health")
    def health():
        checks = []          # {area, name, status: ok|warn|bad, detail}

        def add(area, name, status, detail=""):
            checks.append({"area": area, "name": name, "status": status, "detail": detail})

        # ---------------- API
        api = {"version": version, "uptime_sec": int(time.time() - STARTED), "python": platform.python_version(),
               "pid": os.getpid(), "host": platform.node()}
        add("API", "API running", "ok", f"version {version}, up {api['uptime_sec'] // 3600} h {(api['uptime_sec'] % 3600) // 60} min")

        # ---------------- database
        db = {"online": False}
        t0 = time.perf_counter()
        try:
            with engine().connect() as cn:
                _one(cn, "SELECT 1")
                db["ping_ms"] = round((time.perf_counter() - t0) * 1000, 1)
                db["online"] = True
                info = _q(cn, """SELECT DB_NAME() AS name, CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
                                        CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(40)) AS version,
                                        CAST(SERVERPROPERTY('MachineName') AS nvarchar(128)) AS server,
                                        d.recovery_model_desc AS recovery, d.is_read_committed_snapshot_on AS rcsi
                                 FROM sys.databases d WHERE d.name = DB_NAME()""")[0]
                db.update(info)
                sizes = _q(cn, """SELECT type, CAST(SUM(CAST(size AS bigint)) * 8 / 1024.0 AS decimal(12,1)) AS mb,
                                         CAST(SUM(CAST(FILEPROPERTY(name, 'SpaceUsed') AS bigint)) * 8 / 1024.0 AS decimal(12,1)) AS used
                                  FROM sys.database_files GROUP BY type""")
                for s in sizes:
                    db["data_mb" if s["type"] == 0 else "log_mb"] = float(s["mb"] or 0)
                    if s["type"] == 0:
                        db["data_used_mb"] = float(s["used"] or 0)
                add("Database", "SQL Server reachable", "ok" if db["ping_ms"] < 500 else "warn", f"{db['ping_ms']} ms · {db['server']}")
                express = "Express" in (db.get("edition") or "")
                if express:
                    pct = db.get("data_mb", 0) / 10240 * 100
                    db["express_pct"] = round(pct, 1)
                    add("Database", "Express 10 GB limit", "ok" if pct < 70 else "warn" if pct < 90 else "bad",
                        f"{db.get('data_mb', 0):,.0f} MB of 10,240 MB ({pct:.0f}%)")
                add("Database", "Read-committed snapshot", "ok" if db.get("rcsi") else "warn",
                    "on - dashboards never wait for ETL" if db.get("rcsi") else "off - dashboards may wait while ETL loads")
                add("Database", "Recovery model", "ok" if db.get("recovery") == "SIMPLE" else "warn", db.get("recovery", ""))
                if db.get("log_mb", 0) > 2048:
                    add("Database", "Transaction log size", "warn", f"{db['log_mb']:,.0f} MB")

                # ---------------- schema objects
                objs = {"etl.tenant": "U", "etl.sync_job": "U", "dw.fact_gl": "U", "dw.dim_account": "U",
                        "dw.usp_refresh": "P", "dw.fn_segment": "FN", "rpt.fs_map": "U", "sec.app_user": "U"}
                missing = [o for o in objs if not _one(cn, "SELECT OBJECT_ID(:o)", o=o)]
                add("Schema", "Tables, procedures and functions", "bad" if missing else "ok",
                    f"missing: {', '.join(missing)} - restart the API" if missing else f"{len(objs)} core objects present")
                pol = _q(cn, """SELECT is_enabled FROM sys.security_policies WHERE name = 'company_policy' AND schema_id = SCHEMA_ID('sec')""")
                add("Security", "Row-level security on dw.fact_gl", "ok" if pol and pol[0]["is_enabled"] else "bad",
                    "security policy sec.company_policy is on" if pol and pol[0]["is_enabled"] else "policy missing or off")
                maps = _one(cn, "SELECT COUNT(*) FROM rpt.fs_map") if "rpt.fs_map" not in missing else 0
                add("Reports", "FS mapping loaded", "ok" if maps else "warn", f"{maps or 0} account mappings")

                # ---------------- users
                users = _q(cn, """SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
                                         SUM(CASE WHEN role = 'Admin' AND is_active = 1 THEN 1 ELSE 0 END) AS admins,
                                         SUM(CASE WHEN locked_until > SYSUTCDATETIME() THEN 1 ELSE 0 END) AS locked,
                                         SUM(CASE WHEN must_change = 1 THEN 1 ELSE 0 END) AS must_change
                                  FROM sec.app_user""")[0] if "sec.app_user" not in missing else {}
                fails = _one(cn, "SELECT COUNT(*) FROM sec.audit_log WHERE action = 'login.failed' AND at > DATEADD(hour, -24, SYSUTCDATETIME())") or 0
                users["failed_logins_24h"] = fails
                add("Security", "Users", "ok" if users.get("admins") else "bad",
                    f"{users.get('active', 0)} active, {users.get('admins', 0)} admin(s), {users.get('locked', 0) or 0} locked")
                add("Security", "Failed sign-ins (24 h)", "ok" if fails < 10 else "warn", str(fails))

                # ---------------- ETL
                etl = _q(cn, """SELECT (SELECT COUNT(*) FROM etl.sync_job WHERE status = 'Running') AS running,
                                       (SELECT COUNT(*) FROM etl.sync_job WHERE status = 'Running'
                                          AND ISNULL(heartbeat_at, started_at) < DATEADD(minute, -10, SYSUTCDATETIME())) AS stale,
                                       (SELECT COUNT(*) FROM etl.run_log WHERE status = 'FAILED' AND run_at > DATEADD(day, -1, SYSUTCDATETIME())) AS failed_24h,
                                       (SELECT COUNT(*) FROM etl.run_log WHERE status = 'FAILED' AND run_at > DATEADD(day, -7, SYSUTCDATETIME())) AS failed_7d,
                                       (SELECT COUNT(*) FROM etl.table_stats) AS tables,
                                       (SELECT ISNULL(SUM(row_count), 0) FROM etl.table_stats) AS rows""")[0]
                add("ETL", "Running jobs", "warn" if etl["stale"] else "ok",
                    f"{etl['running']} running" + (f", {etl['stale']} without heartbeat for 10 min" if etl["stale"] else ""))
                add("ETL", "Failed D365 tables", "ok" if not etl["failed_24h"] else "warn",
                    f"{etl['failed_24h']} in 24 h, {etl['failed_7d']} in 7 days")

                tenants = _q(cn, """
                    SELECT t.tenant_key, t.name, t.is_active, t.last_test_at, t.last_test_ok, t.last_test_message,
                           t.last_sync_at, t.last_sync_status, t.report_at, t.report_msg,
                           (SELECT COUNT_BIG(*) FROM dw.fact_gl f WHERE f.tenant_key = t.tenant_key) AS fact_rows,
                           (SELECT MAX(accounting_date) FROM dw.fact_gl f WHERE f.tenant_key = t.tenant_key) AS last_posting,
                           (SELECT COUNT_BIG(*) FROM dw.fact_gl f WHERE f.tenant_key = t.tenant_key AND NOT EXISTS
                               (SELECT 1 FROM dw.dim_account a WHERE a.tenant_key = f.tenant_key AND a.main_account = f.main_account)) AS unmatched
                    FROM etl.tenant t ORDER BY t.name""")
                for t in tenants:
                    nm = t["name"]
                    if t["last_test_at"]:
                        add("D365", f"{nm}: connection test", "ok" if t["last_test_ok"] else "bad",
                            (t["last_test_message"] or "")[:160] or f"tested {t['last_test_at']:%Y-%m-%d %H:%M}")
                    age = (datetime.utcnow() - t["last_sync_at"]).days if t["last_sync_at"] else None
                    add("D365", f"{nm}: last ETL", "bad" if t["last_sync_status"] == "Failed" else "warn" if age is None or age > 2 else "ok",
                        f"{t['last_sync_status'] or 'never'}" + (f", {age} day(s) ago" if age is not None else ""))
                    built = t["report_msg"] == "Dashboard data refreshed."
                    add("Data", f"{nm}: dashboard data", "ok" if built and t["fact_rows"] else "bad" if t["report_msg"] else "warn",
                        f"{t['fact_rows']:,} ledger lines, built {t['report_at']:%Y-%m-%d %H:%M}" if t["report_at"] else (t["report_msg"] or "never built - ETL › Jobs › Rebuild reports"))
                    if t["fact_rows"]:
                        pct = 100 - t["unmatched"] / t["fact_rows"] * 100
                        add("Data", f"{nm}: ledger lines matched to accounts", "ok" if pct >= 99 else "warn" if pct >= 90 else "bad", f"{pct:.1f}%")
                    for t2 in ("report_at", "last_test_at", "last_sync_at", "last_posting"):
                        t[t2] = t[t2].isoformat() if t[t2] else None
                biggest = _q(cn, """SELECT TOP 8 s.name + '.' + t.name AS [table], SUM(p.rows) AS [rows],
                                           CAST(SUM(a.used_pages) * 8 / 1024.0 AS decimal(12,1)) AS mb
                                    FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
                                    JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
                                    JOIN sys.allocation_units a ON a.container_id = p.partition_id
                                    GROUP BY s.name, t.name ORDER BY SUM(a.used_pages) DESC""")
        except Exception as ex:
            add("Database", "SQL Server reachable", "bad", str(ex).splitlines()[0][:250])
            etl, tenants, users, biggest = {}, [], {}, []

        errors = _log_errors(log_path)
        add("API", "Errors in api.log (24 h)", "ok" if not errors else "warn" if len(errors) < 10 else "bad", str(len(errors)))

        worst = "bad" if any(c["status"] == "bad" for c in checks) else "warn" if any(c["status"] == "warn" for c in checks) else "ok"
        return {"status": worst, "checked_at": datetime.utcnow().isoformat(), "api": api, "db": db, "etl": etl,
                "tenants": tenants, "users": users, "tables": biggest, "errors": errors[:15], "checks": checks}

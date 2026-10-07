"""Audit Logs: one time-ordered list of everything that happened, from four places:

  Security   sign-ins, failed sign-ins, password changes, user and role changes   (sec.audit_log)
  Activity   which dashboard / report each user opened                          (sec.audit_log, action view)
  Changes    every change made through the API (run ETL, rebuild, tenants, mapping ...) (sec.audit_log, api.*)
  ETL        sync jobs and every D365 table loaded or failed                     (etl.sync_job, etl.run_log)
  System     API start-ups, warnings and errors                                   (api/logs/api.log)
"""
import re
import time
from datetime import datetime, timedelta

from fastapi import Query
from sqlalchemy import text

LINE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),\d+ (INFO|WARNING|ERROR) (.*)$")
SOURCES = ["Security", "Activity", "Changes", "ETL", "System"]


def _source(action: str) -> str:
    if action == "view":
        return "Activity"
    if action.startswith("ai."):
        return "Activity"
    if action.startswith("api.") or action.startswith("config."):
        return "Changes"
    return "Security"


def _level(source, action, status=None):
    a = (action or "").lower()
    if source == "ETL":
        return {"FAILED": "error", "Failed": "error", "Partial": "warn", "Running": "info"}.get(status or "", "info")
    if "failed" in a or "-> 4" in (status or "") or "-> 5" in (status or ""):
        return "warn"
    if a.endswith("delete") or a.startswith("api.delete"):
        return "warn"
    return "info"


def _api_log(path, since):
    out = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                m = LINE.match(line.rstrip("\n"))
                if not m:
                    continue
                local = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")
                at = datetime.utcfromtimestamp(time.mktime(local.timetuple()))   # api.log is local time
                if at < since:
                    continue
                lvl = {"ERROR": "error", "WARNING": "warn"}.get(m.group(2), "info")
                msg = m.group(3)
                out.append({"at": at, "source": "System", "level": lvl, "user": None,
                            "action": "api.error" if lvl == "error" else "api.startup" if msg.startswith("startup") else "api.log",
                            "detail": msg[:500], "ip": None})
    except FileNotFoundError:
        pass
    return out


def register(app, engine, log_path):
    @app.post("/api/auth/track")
    def track(body: dict):
        """The app reports each dashboard / report a user opens (one row per page view)."""
        from security import current_user
        page = str(body.get("page", ""))[:200]
        title = str(body.get("title", ""))[:200]
        u = current_user()
        with engine().begin() as cn:
            cn.execute(text("INSERT sec.audit_log (user_id, username, action, detail) VALUES (:i, :n, 'view', :d)"),
                       {"i": u["user_id"], "n": u["username"], "d": f"{title} ({page})" if title else page})
        return {"ok": True}

    @app.get("/api/admin/logs")
    def logs(source: str = "all", q: str = "", user: str = "", level: str = "", days: int = Query(7, ge=1, le=365),
             limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
        since = datetime.utcnow() - timedelta(days=days)
        rows = []
        with engine().connect() as cn:
            for r in cn.execute(text("""SELECT TOP 20000 at, username, action, detail, ip FROM sec.audit_log
                                        WHERE at >= :s ORDER BY id DESC"""), {"s": since}).mappings():
                src = _source(r["action"])
                rows.append({"at": r["at"], "source": src, "level": _level(src, r["action"], r["detail"]), "user": r["username"],
                             "action": r["action"], "detail": r["detail"] or "", "ip": r["ip"]})
            for r in cn.execute(text("""SELECT TOP 5000 j.job_id, t.name AS tenant, j.status, j.started_at, j.finished_at,
                                               j.requested_by, j.message
                                        FROM etl.sync_job j LEFT JOIN etl.tenant t ON t.tenant_key = j.tenant_key
                                        WHERE j.started_at >= :s ORDER BY j.job_id DESC"""), {"s": since}).mappings():
                rows.append({"at": r["finished_at"] or r["started_at"], "source": "ETL", "level": _level("ETL", "", r["status"]),
                             "user": r["requested_by"], "action": f"job.{(r['status'] or '').lower()}",
                             "detail": f"Job #{r['job_id']} · {r['tenant'] or ''} · {r['status']}" + (f" - {r['message'][:300]}" if r["message"] else ""),
                             "ip": None})
            for r in cn.execute(text("""SELECT TOP 20000 l.run_at, l.job_id, l.entity, l.rows_loaded, l.status, l.duration_sec, l.message,
                                               t.name AS tenant
                                        FROM etl.run_log l LEFT JOIN etl.tenant t ON t.tenant_key = l.tenant_key
                                        WHERE l.run_at >= :s ORDER BY l.id DESC"""), {"s": since}).mappings():
                rows.append({"at": r["run_at"], "source": "ETL", "level": _level("ETL", "", r["status"]), "user": None,
                             "action": f"table.{(r['status'] or '').lower()}",
                             "detail": f"{r['entity']} · {r['rows_loaded']:,} rows · {r['duration_sec'] or 0}s · job #{r['job_id']}"
                                       + (f" - {r['message'][:300]}" if r["message"] and r["status"] != "OK" else ""),
                             "ip": None})
        rows += _api_log(log_path, since)

        counts = {s: 0 for s in SOURCES}
        for r in rows:
            counts[r["source"]] = counts.get(r["source"], 0) + 1
        users = sorted({r["user"] for r in rows if r["user"]})
        today = datetime.utcnow() - timedelta(hours=24)
        stats = {
            "events_24h": sum(1 for r in rows if r["at"] >= today),
            "signins_24h": sum(1 for r in rows if r["at"] >= today and r["action"] == "login"),
            "failed_signins_24h": sum(1 for r in rows if r["at"] >= today and r["action"] == "login.failed"),
            "views_24h": sum(1 for r in rows if r["at"] >= today and r["action"] == "view"),
            "etl_errors": sum(1 for r in rows if r["source"] == "ETL" and r["level"] == "error"),
            "api_errors": sum(1 for r in rows if r["source"] == "System" and r["level"] == "error"),
        }
        ql = q.lower().strip()
        sel = [r for r in rows
               if (source == "all" or r["source"].lower() == source.lower())
               and (not user or (r["user"] or "") == user)
               and (not level or r["level"] == level)
               and (not ql or ql in f"{r['action']} {r['detail']} {r['user'] or ''} {r['ip'] or ''}".lower())]
        sel.sort(key=lambda r: r["at"], reverse=True)
        page = sel[offset:offset + limit]
        for r in page:
            r["at"] = r["at"].isoformat()
        return {"rows": page, "total": len(sel), "counts": counts, "users": users, "stats": stats, "days": days}

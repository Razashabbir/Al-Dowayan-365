"""Reconciliation (Close › Reconciliation): D365 → staging → reporting, every night and on demand.

Checks per tenant
  1. Ledger lines: D365 count (OData $count) = stg.gl_entries = dw.fact_gl
  2. Journal headers: D365 count = stg.gl_headers
  3. Per company: the trial balance nets to zero (debits = credits) in dw.fact_gl
  4. Every ledger account is in Main Accounts (dw.dim_account)
A difference in (1) right after new postings in D365 is normal until the next ETL run.
"""
from datetime import datetime

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import text

import security
import tenants as tn
from modlib import num, table_exists


class RunIn(BaseModel):
    tenant_key: int


def register(app, engine, ops, store, log):
    def d365_count(client, entity):
        r = client.get(f"{client.base_url}/data/{entity}/$count", params={"cross-company": "true"})
        return int(str(r.text).strip().lstrip("﻿"))

    def run(tenant_key: int, by: str = "scheduler") -> int:
        with engine().begin() as cn:
            rid = cn.execute(text("INSERT INTO ops.recon_run (tenant_key, triggered_by) OUTPUT inserted.run_id VALUES (:t, :b)"),
                             {"t": tenant_key, "b": by}).scalar()
        lines, status, err = [], "OK", None

        def add(check, company=None, d365=None, stg=None, rep=None, diff=None, st="OK", note=None):
            lines.append({"r": rid, "c": company, "n": check, "d": d365, "s": stg, "p": rep, "f": diff, "st": st, "no": (note or "")[:600]})
        try:
            with engine().connect() as cn:
                ents = {r["table_name"]: r["entity_name"] for r in cn.execute(text(
                    "SELECT entity_name, table_name FROM etl.tenant_entity WHERE tenant_key=:t AND enabled=1"), {"t": tenant_key}).mappings()}
                stg_lines = cn.execute(text("SELECT COUNT_BIG(*) FROM stg.gl_entries WHERE _tenant_key=:t"), {"t": tenant_key}).scalar() \
                    if table_exists(cn, "stg.gl_entries") else None
                stg_hdr = cn.execute(text("SELECT COUNT_BIG(*) FROM stg.gl_headers WHERE _tenant_key=:t"), {"t": tenant_key}).scalar() \
                    if table_exists(cn, "stg.gl_headers") else None
                fact = cn.execute(text("SELECT COUNT_BIG(*) FROM dw.fact_gl WHERE tenant_key=:t"), {"t": tenant_key}).scalar()
                per_co = [dict(r) for r in cn.execute(text("""SELECT company, COUNT_BIG(*) AS n,
                                SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS dr, SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS cr
                                FROM dw.fact_gl WHERE tenant_key=:t GROUP BY company ORDER BY company"""), {"t": tenant_key}).mappings()]
                unknown = cn.execute(text("""SELECT COUNT(DISTINCT f.main_account) FROM dw.fact_gl f LEFT JOIN dw.dim_account a
                                             ON a.tenant_key=f.tenant_key AND a.main_account=f.main_account
                                             WHERE f.tenant_key=:t AND a.main_account IS NULL"""), {"t": tenant_key}).scalar()
            d365_lines = d365_hdr = None
            try:
                client = tn.client_for(tenant_key)
                if ents.get("gl_entries"):
                    d365_lines = d365_count(client, ents["gl_entries"])
                if ents.get("gl_headers"):
                    d365_hdr = d365_count(client, ents["gl_headers"])
            except Exception as ex:                              # noqa: BLE001
                add("D365 connection", st="Error", note=f"D365 counts not read: {str(ex).splitlines()[0][:300]}")
            if d365_lines is not None or stg_lines is not None:
                diff = (d365_lines - stg_lines) if d365_lines is not None and stg_lines is not None else None
                add("Ledger lines D365 → staging", d365=d365_lines, stg=stg_lines, diff=diff,
                    st="OK" if not diff else "Diff",
                    note=None if not diff else ("D365 has more lines - posted after the last ETL, or the ETL date window skipped them. Run ETL."
                                                if diff > 0 else "Staging has more lines than D365 - deleted / re-numbered in D365. Run a full reload."))
            if stg_lines is not None:
                miss = stg_lines - fact
                add("Ledger lines staging → reporting", stg=stg_lines, rep=fact, diff=miss,
                    st="OK" if miss == 0 else ("Diff" if abs(miss) > max(10, stg_lines * 0.001) else "Info"),
                    note=None if miss == 0 else "Lines without a journal header / posting date are not in the reports. Run ETL for the journal headers, then Rebuild reports.")
            if d365_hdr is not None or stg_hdr is not None:
                diff = (d365_hdr - stg_hdr) if d365_hdr is not None and stg_hdr is not None else None
                add("Journal headers D365 → staging", d365=d365_hdr, stg=stg_hdr, diff=diff, st="OK" if not diff else "Diff",
                    note=None if not diff else "Run ETL for the journal headers.")
            for c in per_co:
                net = num(c["dr"]) - num(c["cr"])
                add("Trial balance nets to zero", company=c["company"], rep=net, diff=net, st="OK" if abs(net) < 1 else "Diff",
                    note=f"{c['n']:,} lines · debits {num(c['dr']):,.2f} · credits {num(c['cr']):,.2f}")
            add("Ledger accounts found in Main Accounts", rep=unknown, diff=unknown, st="OK" if not unknown else "Diff",
                note=None if not unknown else f"{unknown} account(s) used in the ledger are missing in Main Accounts - run ETL for MainAccounts, then Rebuild reports.")
            if any(l["st"] in ("Diff",) for l in lines):
                status = "Differences"
            if any(l["st"] == "Error" for l in lines) and status == "OK":
                status = "Differences"
        except Exception as ex:                                  # noqa: BLE001
            status, err = "Failed", str(ex).splitlines()[0][:500]
            log.warning("reconciliation tenant %s failed: %s", tenant_key, err)
        bad = [l for l in lines if l["st"] in ("Diff", "Error")]
        summary = err or (f"{len(bad)} check(s) with differences: " + "; ".join(f"{(l['c'] or '').upper()} {l['n']}".strip() for l in bad)
                          if bad else f"All {len(lines)} checks OK")
        with engine().begin() as cn:
            if lines:
                cn.execute(text("""INSERT INTO ops.recon_line (run_id, company, check_name, d365, staging, reporting, difference, status, note)
                                   VALUES (:r, :c, :n, :d, :s, :p, :f, :st, :no)"""), lines)
            cn.execute(text("UPDATE ops.recon_run SET finished_at=SYSUTCDATETIME(), status=:s, summary=:m WHERE run_id=:r"),
                       {"s": status, "m": summary[:2000], "r": rid})
        return rid

    def nightly(now: datetime | None = None):
        """Scheduler: once a day at the configured hour (local server time), for every active tenant."""
        now = now or datetime.now()
        try:
            hour = int(num(ops.get("recon_hour")) or 2)
            if now.hour != hour:
                return False
            with engine().connect() as cn:
                tenants = [r[0] for r in cn.execute(text("SELECT tenant_key FROM etl.tenant WHERE is_active = 1"))]
                done = {r[0] for r in cn.execute(text("SELECT tenant_key FROM ops.recon_run WHERE CAST(started_at AS date) >= CAST(SYSUTCDATETIME() AS date) AND triggered_by='scheduler'"))}
        except Exception:                                        # noqa: BLE001
            return False
        ran = False
        for t in tenants:
            if t not in done:
                run(t, "scheduler")
                ran = True
        return ran

    def visible_tenant(tenant):
        u = security.current_user()
        if u and not u["all_companies"] and not security.can_see(u, tenant, None):
            raise HTTPException(403, "No access to this tenant.")

    @app.get("/api/admin/recon")
    def runs(tenant: int):
        visible_tenant(tenant)
        with engine().connect() as cn:
            rr = [dict(r) for r in cn.execute(text("SELECT TOP 30 * FROM ops.recon_run WHERE tenant_key=:t ORDER BY run_id DESC"), {"t": tenant}).mappings()]
        return {"runs": rr, "recon_hour": int(num(ops.get("recon_hour")) or 2)}

    @app.get("/api/admin/recon/{run_id}")
    def run_lines(run_id: int):
        with engine().connect() as cn:
            r = cn.execute(text("SELECT * FROM ops.recon_run WHERE run_id=:r"), {"r": run_id}).mappings().first()
            if not r:
                raise HTTPException(404, "Run not found.")
            visible_tenant(r["tenant_key"])
            ls = [dict(x) for x in cn.execute(text("SELECT * FROM ops.recon_line WHERE run_id=:r ORDER BY id"), {"r": run_id}).mappings()]
        u = security.current_user()
        ls = [l for l in ls if not l["company"] or security.can_see(u, r["tenant_key"], l["company"])]
        return {"run": dict(r), "lines": ls}

    @app.post("/api/admin/recon/run")
    def run_now(body: RunIn):
        visible_tenant(body.tenant_key)
        rid = run(body.tenant_key, (security.current_user() or {}).get("username", "api"))
        store.write(security.current_user(), "recon.run", f"tenant {body.tenant_key} run #{rid}")
        return run_lines(rid)

    return nightly

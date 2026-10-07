"""Scheduled / command-line sync for every ACTIVE D365 connection saved on the "D365 Connections" screen.

    python etl.py                          # all active connections, all entities in entities.yaml
    python etl.py --tenant "Al-Dowayan UAT" # one connection (by name)
    python etl.py --entities MainAccounts  # only some entities
    python etl.py --full                   # reload all history of incremental entities
"""
import argparse
import sys

from db import ensure_schema
from sync import JobAlreadyRunning, create_job, run_job
from tenants import get_tenant_by_name, list_tenants


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", help="connection name (default: all active)")
    ap.add_argument("--entities", nargs="*")
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--run-job", type=int, help=argparse.SUPPRESS)  # used by the API's "Sync now"
    a = ap.parse_args()

    if a.run_job:  # run ONE job that the API already created, in this separate process
        sys.exit(0 if run_job(a.run_job) in ("OK", "Partial") else 1)

    print("database:", ensure_schema())

    if a.tenant:
        t = get_tenant_by_name(a.tenant)
        if not t:
            sys.exit(f"No connection named '{a.tenant}'. Add it on the D365 Connections screen.")
        tenants = [t]
    else:
        tenants = list_tenants(active_only=True)
    if not tenants:
        sys.exit("No active D365 connections. Add one on the dashboard's D365 Connections screen.")

    bad = 0
    for t in tenants:
        print(f"=== {t['name']} ({t['base_url']}) ===")
        try:
            job = create_job(t["tenant_key"], a.entities, a.full, requested_by="scheduler")
        except JobAlreadyRunning as ex:
            print(f"  skipped: {ex}")
            continue
        status = run_job(job)
        print(f"=== {t['name']}: {status} (job {job}) ===\n")
        bad += status != "OK"
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()

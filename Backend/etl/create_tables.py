"""Create the stg tables from a D365 environment's OData $metadata without loading data.
(The sync does this automatically; use this to review the SQL in SSMS first.)

    python create_tables.py --tenant "Al-Dowayan UAT"               # create in SQL Server
    python create_tables.py --tenant "Al-Dowayan UAT" --sql-only    # write sql/00_stg_tables.sql for SSMS
    python create_tables.py --tenant "Al-Dowayan UAT" --entities SalesOrderHeadersV2 ProjectsV2
    python create_tables.py --sql-only                             # use D365_* values in etl/.env instead
"""
import argparse
import os
import sys

from d365_client import D365Client
from schema_builder import Metadata, create_ddl, ensure_table, snake
from sync import entity_config

OUT_SQL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sql", "00_stg_tables.sql")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", help="connection name saved on the D365 Connections screen")
    ap.add_argument("--entities", nargs="*", help="OData entity names (default: entities.yaml)")
    ap.add_argument("--sql-only", action="store_true")
    a = ap.parse_args()

    if a.tenant:
        from tenants import client_for, get_tenant_by_name
        t = get_tenant_by_name(a.tenant) or sys.exit(f"No connection named '{a.tenant}'")
        client = client_for(t["tenant_key"])
    else:
        client = D365Client()  # D365_* from .env

    todo = [{"name": e, "table": snake(e)} for e in a.entities] if a.entities else entity_config()
    print("Reading $metadata (about 1 minute) ...")
    md = Metadata.from_xml(client.metadata())

    parts = ["USE AlDowyanReporting;", "GO", "IF SCHEMA_ID('stg') IS NULL EXEC('CREATE SCHEMA stg');", "GO", ""]
    for e in todo:
        if not md.has(e["name"]):
            print(f"  [MISSING] {e['name']}  similar: {md.similar(e['name'])}")
            continue
        if a.sql_only:
            parts += [create_ddl(md, e["name"], e["table"], e.get("select")), "GO", ""]
            print(f"  [SQL] {e['name']} -> stg.{e['table']}")
        else:
            from db import engine
            print(f"  [{ensure_table(engine(), md, e['name'], e['table'], e.get('select'))}] stg.{e['table']}")

    if a.sql_only:
        with open(OUT_SQL, "w", encoding="utf-8") as f:
            f.write("\n".join(parts))
        print(f"Wrote {os.path.normpath(OUT_SQL)} - open it in SSMS and press F5.")


if __name__ == "__main__":
    main()

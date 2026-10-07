"""Optional command-line check of D365 credentials (the D365 Connections screen does the same).

Uses D365_* values from etl/.env, or a saved connection with --tenant.
    python test_connection.py
    python test_connection.py --tenant "Al-Dowayan UAT" GeneralJournalAccountEntries MainAccounts
"""
import argparse

from d365_client import D365Client, D365Error
from schema_builder import Metadata
from sync import entity_config

ap = argparse.ArgumentParser()
ap.add_argument("--tenant")
ap.add_argument("fields_of", nargs="*", help="print the fields of these entities")
a = ap.parse_args()

if a.tenant:
    from tenants import client_for, get_tenant_by_name
    client = client_for(get_tenant_by_name(a.tenant)["tenant_key"])
else:
    client = D365Client()

try:
    companies = client.test()
except D365Error as ex:
    raise SystemExit(f"FAILED: {ex}")
print(f"OK - token issued, {len(companies)} legal entities:")
for c in companies:
    print(f"   {c['LegalEntityId']:<6} {c['Name']}")

print("Reading $metadata ...")
md = Metadata.from_xml(client.metadata())
print(f"{len(md.sets)} public entities. Checking entities.yaml:")
for e in entity_config():
    print(f"   [{'OK' if md.has(e['name']) else 'MISSING'}] {e['name']}"
          + ("" if md.has(e["name"]) else f"   similar: {md.similar(e['name'])}"))

for name in a.fields_of:
    print(f"\nFields of {name}:")
    if not md.has(name):
        print("   not found. Similar:", md.similar(name, 20))
        continue
    cols, keys = md.columns(name)
    for c, t in cols:
        print(f"   {c:<45} {t}{'  (key)' if c in keys else ''}")

"""Build / evolve stg tables from the D365 OData $metadata.

Every stg table carries [_tenant_key] (which D365 connection the row came from) and [_loaded_at].
The raw $metadata XML (tens of MB) is reduced once to a compact dict that is cached in etl.metadata_cache.
"""
import re
import xml.etree.ElementTree as ET

from sqlalchemy import inspect, text

NS = {"edm": "http://docs.oasis-open.org/odata/ns/edm"}
SIMPLE = {
    "Edm.Int32": "int", "Edm.Int64": "bigint", "Edm.Int16": "smallint", "Edm.Byte": "tinyint",
    "Edm.Double": "float", "Edm.Single": "real", "Edm.Boolean": "bit", "Edm.Decimal": "decimal(32,6)",
    "Edm.DateTimeOffset": "datetime2(0)", "Edm.Date": "date", "Edm.TimeOfDay": "time(0)",
    "Edm.Guid": "uniqueidentifier", "Edm.Binary": "varbinary(max)",
}
KEY_BYTES = {"int": 4, "bigint": 8, "smallint": 2, "tinyint": 1, "bit": 1, "date": 3, "datetime2(0)": 6,
             "uniqueidentifier": 16, "float": 8, "real": 4, "decimal(32,6)": 17, "time(0)": 3}
DATE_TYPES = ("date", "datetime2(0)")


def snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z][a-z])", "_", name).lower()[:120]


def _sql_type(p: ET.Element, enums: set[str]) -> str:
    t = p.get("Type")
    if t == "Edm.String":
        n = p.get("MaxLength")
        return f"nvarchar({n})" if n and n.isdigit() and int(n) <= 4000 else "nvarchar(max)"
    if t in SIMPLE:
        return SIMPLE[t]
    if t.split(".")[-1] in enums:
        return "nvarchar(100)"  # enums arrive as text, e.g. 'Yes', 'Revenue'
    return "nvarchar(max)"


class Metadata:
    """Entities of one D365 environment: {entity_set: {"keys": [...], "fields": [[name, sql_type], ...]}}"""

    def __init__(self, entities: dict):
        self.entities = entities

    @classmethod
    def from_xml(cls, xml_text: str) -> "Metadata":
        root = ET.fromstring(xml_text)
        enums = {en.get("Name") for en in root.iterfind(".//edm:EnumType", NS)}
        types = {et.get("Name"): et for et in root.iterfind(".//edm:EntityType", NS)}
        out = {}
        for es in root.iterfind(".//edm:EntitySet", NS):
            et = types.get(es.get("EntityType").split(".")[-1])
            if et is None:
                continue
            out[es.get("Name")] = {
                "keys": [k.get("Name") for k in et.iterfind("edm:Key/edm:PropertyRef", NS)],
                "fields": [[p.get("Name"), _sql_type(p, enums)] for p in et.iterfind("edm:Property", NS)],
            }
        return cls(out)

    # backwards compatible name used by older scripts
    sets = property(lambda self: self.entities)

    def has(self, entity: str) -> bool:
        return entity in self.entities

    def similar(self, entity: str, n: int = 6) -> list[str]:
        k = entity[:8].lower()
        return [s for s in self.entities if k in s.lower()][:n]

    def columns(self, entity: str, select: list[str] | None = None) -> tuple[list[tuple[str, str]], list[str]]:
        """[(column, sql_type)], [key columns]"""
        e = self.entities[entity]
        cols = [(c, t) for c, t in e["fields"] if not select or c in select]
        return cols, list(e["keys"])

    def date_fields(self, entity: str) -> list[str]:
        return [c for c, t in self.entities[entity]["fields"] if t in DATE_TYPES]

    def catalog(self) -> list[dict]:
        return [{"name": n, "fields": len(e["fields"]), "keys": e["keys"],
                 "date_fields": [c for c, t in e["fields"] if t in DATE_TYPES]}
                for n, e in sorted(self.entities.items())]


def create_ddl(md: Metadata, entity: str, table: str, select=None, recreate=False) -> str:
    cols, keys = md.columns(entity, select)
    if len(cols) > 1020:
        raise RuntimeError(f"{entity} has {len(cols)} fields; SQL Server allows 1024 columns. "
                           f"Add a field selection for it.")
    types = dict(cols)
    lines = ["    [_tenant_key] int NOT NULL"]
    lines += [f"    [{c}] {t} {'NOT NULL' if c in keys else 'NULL'}" for c, t in cols]
    lines.append("    [_loaded_at] datetime2(0) NULL")

    def key_bytes(t):
        m = re.match(r"nvarchar\((\d+)\)", t)
        return int(m.group(1)) * 2 if m else KEY_BYTES.get(t, 10_000)

    if keys and all(k in types for k in keys) and 4 + sum(key_bytes(types[k]) for k in keys) <= 900:
        lines.append(f"    CONSTRAINT [PK_stg_{table}] PRIMARY KEY ([_tenant_key], [{'], ['.join(keys)}])")
    else:  # no usable key (or too wide for a SQL Server index)
        lines.append(f"    INDEX [IX_stg_{table}_tenant] ([_tenant_key])")
    drop = f"DROP TABLE IF EXISTS stg.[{table}];\n" if recreate else ""
    return (f"-- {entity}  ({len(cols)} columns, key: {', '.join(keys) or 'none'})\n"
            f"{drop}IF OBJECT_ID('stg.[{table}]') IS NULL\nCREATE TABLE stg.[{table}] (\n"
            + ",\n".join(lines) + "\n);\n")


def ensure_table(engine, md: Metadata, entity: str, table: str, select=None) -> str:
    """Create the table if missing, or add columns D365 has gained since. Returns what was done."""
    insp = inspect(engine)
    if not insp.has_table(table, schema="stg"):
        with engine.begin() as cn:
            cn.execute(text(create_ddl(md, entity, table, select)))
        return "table created"
    existing = {c["name"].lower() for c in insp.get_columns(table, schema="stg")}
    if "_tenant_key" not in existing:
        raise RuntimeError(f"stg.{table} was created by an older version (no _tenant_key). "
                           f"Drop it in SSMS: DROP TABLE stg.[{table}] and sync again.")
    cols, _ = md.columns(entity, select)
    missing = [(c, t) for c, t in cols if c.lower() not in existing]
    if missing:
        with engine.begin() as cn:
            for c, t in missing:
                cn.execute(text(f"ALTER TABLE stg.[{table}] ADD [{c}] {t} NULL"))
        return f"added {len(missing)} columns"
    return "table ok"

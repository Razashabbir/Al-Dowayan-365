"""Shared SQL Server engine + secret encryption."""
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


LOGIN_TIMEOUT = int(os.getenv("SQL_LOGIN_TIMEOUT", "60"))   # seconds (ODBC default is 15)
TRANSIENT = ("08001", "08S01", "HYT00", "40001", "1205", "Login timeout", "TCP Provider", "deadlock")


@lru_cache
def engine():
    """Read/write engine (etl_user) used by the ETL and by the API's admin endpoints.
    A fixed-size pool keeps the number of SQL logins low - many parallel logins were what
    made SQL Server answer 'Login timeout expired / delay in prelogin response'."""
    workers = int(os.getenv("SYNC_WORKERS", "4"))
    return create_engine(URL.create("mssql+pyodbc", query={"odbc_connect": os.environ["SQL_CONN"]}),
                         fast_executemany=True, pool_pre_ping=True,
                         pool_size=workers * 2 + 4, max_overflow=4, pool_timeout=120, pool_recycle=1800,
                         connect_args={"timeout": LOGIN_TIMEOUT})


def is_transient(ex: Exception) -> bool:
    s = str(ex)
    return any(t in s for t in TRANSIENT)


def retry(fn, attempts: int = 5, what: str = "SQL"):
    """Run fn(); on a transient SQL error (timeout, dropped connection, deadlock) wait and try again."""
    import time
    for i in range(attempts):
        try:
            return fn()
        except Exception as ex:
            if i == attempts - 1 or not is_transient(ex):
                raise
            wait = 5 * (i + 1)
            print(f"{what}: transient error, retrying in {wait}s ({str(ex).splitlines()[0][:120]})")
            time.sleep(wait)


SQL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sql")


def _batches(name: str) -> list[str]:
    import re
    with open(os.path.join(SQL_DIR, name), encoding="utf-8") as f:
        return [b for b in re.split(r"^\s*GO\s*$", f.read(), flags=re.M | re.I) if b.strip()]


def _conn_parts() -> tuple[str, str]:
    """(connection string pointing at master, database name) from SQL_CONN."""
    import re
    cs = os.environ["SQL_CONN"]
    m = re.search(r"(?i)(?:DATABASE|Initial Catalog)=([^;]+)", cs)
    dbname = m.group(1).strip() if m else "AlDowyanReporting"
    master = re.sub(r"(?i)(DATABASE|Initial Catalog)=[^;]+", r"\1=master", cs) if m else cs + ";DATABASE=master"
    return master, dbname


def create_database_if_missing() -> str:
    """Create the database (and its recovery model) through master if it does not exist yet."""
    import pyodbc
    master, dbname = _conn_parts()
    with pyodbc.connect(master, autocommit=True, timeout=LOGIN_TIMEOUT) as cn:
        state = cn.execute("SELECT state_desc FROM sys.databases WHERE name = ?", dbname).fetchone()
        if state is None:
            cn.execute(f"CREATE DATABASE [{dbname}]")
            cn.execute(f"ALTER DATABASE [{dbname}] SET RECOVERY SIMPLE")
            return f"database {dbname} created"
        if state[0] != "ONLINE":
            raise RuntimeError(f"database {dbname} is {state[0]} - fix it in SSMS (see README 'Recovery Pending')")
        return f"database {dbname} online"


def _run_batches(names: list[str], skip_pattern: str) -> list[str]:
    """Run every batch; a failing batch is reported but never stops the batches after it."""
    import re
    errors = []
    with engine().connect() as cn:
        raw = cn.connection.dbapi_connection
        raw.autocommit = True
        cur = raw.cursor()
        try:
            for name in names:
                for b in _batches(name):
                    if re.search(skip_pattern, b, re.I | re.M):
                        continue
                    try:
                        cur.execute(b)
                        while cur.nextset():   # drain all result sets / messages of the batch
                            pass
                    except Exception as ex:
                        first = next((l.strip() for l in b.splitlines() if l.strip() and not l.strip().startswith("--")), "")
                        errors.append(f"{name} [{first[:60]}]: {str(ex).splitlines()[0][:250]}")
        finally:
            raw.autocommit = False
    return errors


def ensure_schema() -> str:
    """Make the database ready, every start: create it if missing, apply sql/01_schema.sql (tables)
    and sql/02_reporting.sql (reporting procedure + views). All scripts are idempotent.
    Login/user/grant batches are skipped - with Windows authentication they are not needed."""
    try:
        state = create_database_if_missing()
        engine().dispose()  # reconnect now that the database exists
        errors = _run_batches(["01_schema.sql", "02_reporting.sql", "03_security.sql", "04_adjustments.sql", "05_config.sql", "06_ai_chat.sql", "07_modules.sql", "08_bookmarks.sql", "09_cash_forecast.sql"],
                              r"\bLOGIN\b|CREATE USER|CREATE DATABASE|^\s*USE\s")
        if errors:
            return f"{state}; {len(errors)} schema step(s) FAILED: " + " | ".join(errors)
        return f"{state}; schema and reporting objects up to date"
    except Exception as ex:
        return f"database setup FAILED: {str(ex).splitlines()[0][:300]}"


def _fernet() -> Fernet:
    key = os.getenv("SECRET_KEY")
    if not key:
        raise RuntimeError(
            "SECRET_KEY is missing in etl/.env. Generate one with:\n"
            '  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"')
    return Fernet(key.encode())


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as ex:
        raise RuntimeError("Stored client secret cannot be decrypted - SECRET_KEY changed? "
                           "Re-enter the secret on the D365 Connections screen.") from ex

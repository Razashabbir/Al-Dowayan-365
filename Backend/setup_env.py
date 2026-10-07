"""One-time setup: creates etl\\.env and api\\.env and tests the SQL Server connection.

    cd D:\\games\\Al-Dowayan-Clone\\Backend
    etl\\.venv\\Scripts\\activate
    python setup_env.py
"""
import getpass
import os
import secrets

ROOT = os.path.dirname(os.path.abspath(__file__))
ETL_ENV = os.path.join(ROOT, "etl", ".env")
API_ENV = os.path.join(ROOT, "api", ".env")


def ask(prompt, default=""):
    v = input(f"{prompt}{f' [{default}]' if default else ''}: ").strip()
    return v or default


def conn(server, database, user=None, pwd=None):
    base = f"DRIVER={{ODBC Driver 18 for SQL Server}};SERVER={server};DATABASE={database};TrustServerCertificate=yes"
    return f"{base};Trusted_Connection=yes" if user is None else f"{base};UID={user};PWD={{{pwd.replace('}', '}}')}}}"


def test(name, cs):
    try:
        import pyodbc
        with pyodbc.connect(cs, timeout=10) as cn:
            cn.execute("SELECT 1")
        print(f"  OK  - {name} can connect")
        return True
    except Exception as ex:
        print(f"  FAIL - {name}: {str(ex).splitlines()[0][:300]}")
        return False


def database_exists(server, database) -> bool | None:
    """True/False, or None if we cannot even log in with Windows authentication."""
    try:
        import pyodbc
        with pyodbc.connect(conn(server, "master"), timeout=10) as cn:
            return cn.execute("SELECT DB_ID(?)", database).fetchone()[0] is not None
    except Exception as ex:
        print(f"  Cannot log in to {server} with Windows authentication: {str(ex).splitlines()[0][:200]}")
        return None


def create_database(server, windows: bool) -> bool:
    """Run sql\\01_schema.sql through master. With Windows auth the SQL logins are skipped."""
    import re
    import pyodbc
    path = os.path.join(ROOT, "sql", "01_schema.sql")
    with open(path, encoding="utf-8") as f:
        batches = [b for b in re.split(r"^\s*GO\s*$", f.read(), flags=re.M | re.I) if b.strip()]
    try:
        with pyodbc.connect(conn(server, "master"), autocommit=True, timeout=30) as cn:
            for b in batches:
                if windows and re.search(r"\bLOGIN\b|CREATE USER", b, re.I):
                    continue  # not needed when the app signs in with Windows authentication
                cn.execute(b)
        print("  OK  - database, schemas and tables created (sql\\01_schema.sql)")
        return True
    except Exception as ex:
        print(f"  FAIL - creating the database: {str(ex).splitlines()[0][:300]}")
        print("         Open sql\\01_schema.sql in SSMS and run it (F5), then run setup_env.py again.")
        return False


def main():
    print("Al-Dowayan Reporting - environment setup\n")
    for p in (ETL_ENV, API_ENV):
        if os.path.exists(p) and ask(f"{p} already exists. Overwrite? (y/n)", "n").lower() != "y":
            print("Nothing changed.")
            return

    server = ask("SQL Server name (as in SSMS 'Server name')", "localhost")
    database = ask("Database", "AlDowyanReporting")
    windows = ask("Use Windows authentication instead of the etl_user/api_reader logins? (y/n)", "n").lower() == "y"

    exists = database_exists(server, database)
    if exists is False:
        print(f"Database {database} does not exist yet.")
        if ask("Create it now by running sql\\01_schema.sql? (y/n)", "y").lower() == "y":
            if not create_database(server, windows):
                return

    if windows:
        etl_cs = api_cs = conn(server, database)
    else:
        print("Passwords you set in sql\\01_schema.sql (input is hidden):")
        etl_cs = conn(server, database, "etl_user", getpass.getpass("  etl_user password: "))
        api_cs = conn(server, database, "api_reader", getpass.getpass("  api_reader password: "))

    print("\nThe admin key is a NEW password you invent for the app's D365 Connections screen.")
    print("It is NOT a D365 / Azure ID. Press Enter to generate one.")
    admin_key = getpass.getpass("Admin key: ").strip() or secrets.token_urlsafe(18)
    from cryptography.fernet import Fernet
    secret_key = Fernet.generate_key().decode()

    with open(ETL_ENV, "w", encoding="utf-8") as f:
        f.write(f"""# Created by setup_env.py - never commit this file.
SQL_CONN={etl_cs}
# Encrypts the D365 client secrets. BACK IT UP: if lost, re-enter every secret on the Connections screen.
SECRET_KEY={secret_key}
ADMIN_API_KEY={admin_key}
ETL_LOOKBACK_DAYS=7
ETL_INITIAL_FROM=2024-01-01
""")
    with open(API_ENV, "w", encoding="utf-8") as f:
        f.write(f"""# Created by setup_env.py - never commit this file.
API_SQL_CONN={api_cs}
CORS_ORIGINS=http://localhost:5173
""")
    print(f"\nWrote {ETL_ENV}\nWrote {API_ENV}")

    print("\nTesting SQL Server connections ...")
    ok = test("ETL / admin connection", etl_cs) & test("Dashboard (read-only) connection", api_cs)
    print(f"\nYour admin key for the D365 Connections screen: {admin_key}")
    if ok:
        print("\nAll set. Start the API:  cd api  &&  uvicorn main:app --port 8000")
    else:
        print("\nFix the SQL problem above (did you run sql\\01_schema.sql? correct server/password?), "
              "then run setup_env.py again.")


if __name__ == "__main__":
    main()

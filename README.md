# Al-Dowayan Reporting System

Financial reporting for Microsoft Dynamics 365 Finance & Operations. The system copies D365 data into SQL Server
and turns it into dashboards, statutory-style financial statements, budgets, ageing, cash-flow forecasts,
period close and consolidation, in a web app with users, roles and row-level security.

```
D365 F&O (OData)  ──►  Python ETL  ──►  SQL Server  ──►  FastAPI (port 8000)  ──►  React app (port 5173)
                       Backend/etl/     stg → dw          Backend/api/              Frontend/
```

- **ETL** (`Backend/etl/`) reads D365 entities through OData and writes them to schema `stg` (one table per entity).
- **Reporting build** (`Backend/sql/02_reporting.sql`) turns `stg` into the reporting tables in schema `dw` (ledger fact, accounts, companies).
- **API** (`Backend/api/`) serves the reports, runs ETL jobs on request, and runs a background scheduler (alerts, reconciliation, report packs).
- **App** (`Frontend/`) is a React + Vite single-page app; every number comes from the API.

---

## Contents
1. [Requirements](#1-requirements)
2. [First-time setup](#2-first-time-setup)
3. [Running the app (development)](#3-running-the-app-development)
4. [Building for production](#4-building-for-production)
5. [Configuration (.env)](#5-configuration-env)
6. [First data load](#6-first-data-load)
7. [Scheduled ETL](#7-scheduled-etl)
8. [Modules](#8-modules)
9. [Users, roles and security](#9-users-roles-and-security)
10. [Database](#10-database)
11. [Project layout](#11-project-layout)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Requirements

| Component | Version | Notes |
|---|---|---|
| Windows | 10 / 11 / Server 2019+ | Commands below are for `cmd`. |
| Python | 3.11 or newer | Tested with 3.13. |
| Node.js | 20 or newer | Only needed to run or build the React app. Tested with 24. |
| SQL Server | 2019 or newer | Express works (10 GB database limit - see System Health). |
| ODBC Driver 18 for SQL Server | 18 | Used by both the ETL and the API. |
| SSMS | any | Optional, to look at the data. |
| D365 app registration | - | Microsoft Entra tenant ID, client ID and client secret with access to the D365 environment. |

---

## 2. First-time setup

Run these once, from the project folder (e.g. `D:\games\Al-Dowayan-Clone`).

```bat
:: 1. Python environment (shared by the ETL and the API)
cd Backend\etl
python -m venv .venv
.venv\Scripts\activate
pip install -r ..\api\requirements.txt        :: also installs etl\requirements.txt
cd ..

:: 2. Settings (run in Backend\): writes etl\.env and api\.env, creates the database if missing, tests the connection
python setup_env.py
cd ..

:: 3. React app packages
cd Frontend
npm install
cd ..
```

`setup_env.py` asks for the SQL Server name (as in SSMS), the database name (default **`AlDowyanReporting`**) and
whether to use Windows authentication. It generates `SECRET_KEY` and `ADMIN_API_KEY`.
**Back up `Backend\etl\.env`** - without its `SECRET_KEY` the stored D365 client secrets cannot be decrypted.

You do not need to run the other SQL scripts by hand: **the API applies every script in `Backend\sql\` on each start**
(they are all safe to re-run). If `Backend\setup_env.py` cannot create the database, open `Backend\sql\01_schema.sql` in SSMS,
press F5, and run `setup_env.py` again.

---

## 3. Running the app (development)

Two windows, both kept open.

**Window 1 - API**
```bat
cd Backend\api
..\etl\.venv\Scripts\activate
uvicorn main:app --port 8000
```
- API documentation: http://localhost:8000/docs
- On start it updates the database schema, creates the first user and the demo users, loads the FS mapping and starts the scheduler. The result of each step is printed and written to `Backend\api\logs\api.log`.
- **After changing any Python file, stop it (Ctrl+C) and start it again.** For automatic restarts while developing use `uvicorn main:app --port 8000 --reload`.

**Window 2 - React app**
```bat
cd Frontend
npm run dev
```
- Open http://localhost:5173. Calls to `/api/...` are forwarded to port 8000 (`Frontend\vite.config.js`).
- Changes to `.jsx` / `.css` files appear in the browser immediately.

**Signing in**
- First start creates the user **`admin`** whose password is `ADMIN_API_KEY` from `Backend\etl\.env`; you must choose a new password at the first sign-in.
- With `DEMO_USERS=1` in `Backend\etl\.env` the sign-in page also lists demo accounts (see [section 9](#9-users-roles-and-security)).

---

## 4. Building for production

```bat
cd Frontend
npm run build
```
This writes a static site to `Frontend\dist\` (git-ignored). The API does **not** serve these files - put them on a
web server and run the API next to it:

1. **Web server** (IIS, nginx, …): serve `Frontend\dist\` and forward every request under `/api/` to `http://localhost:8000`.
   With that reverse proxy the app and the API share one address and nothing else needs changing.
2. **Without a reverse proxy**: build with the API address baked in and allow that origin in the API:
   ```bat
   set VITE_API_URL=https://reports-api.example.com
   npm run build
   ```
   and in `Backend\api\.env`: `CORS_ORIGINS=https://reports.example.com` (comma-separated list).
3. **API as a service**: run `uvicorn main:app --host 127.0.0.1 --port 8000` from `Backend\api\` with the venv's Python
   (e.g. with NSSM or Task Scheduler "at startup"). Keep a single API process: the scheduler for alerts,
   reconciliation and report packs runs inside it.
4. **Before going live**: use HTTPS, remove `DEMO_USERS` (or set `0`), and restrict who can reach the server.

To check a production build locally: `npm run preview` (serves `dist\` on http://localhost:4173).

---

## 5. Configuration (.env)

Both files are created by `Backend\setup_env.py` and are git-ignored. **Never commit them.** Restart the API after editing.

**`Backend\etl\.env`** (read by the ETL and the API)

| Setting | Required | Meaning |
|---|---|---|
| `SQL_CONN` | yes | ODBC connection string to the reporting database (server, database `AlDowyanReporting`, login). |
| `SECRET_KEY` | yes | Encrypts D365 client secrets and signs sign-in tokens. Back it up; changing it signs everyone out and makes stored secrets unreadable. |
| `ADMIN_API_KEY` | yes | Password of the first `admin` user (only used when no user exists yet). |
| `ETL_LOOKBACK_DAYS` | no (7) | Incremental loads re-read this many days before the last load, to catch late postings. |
| `ETL_INITIAL_FROM` | no (2024-01-01) | First date loaded for incremental entities (e.g. the ledger). |
| `DEMO_USERS` | no (off) | `1` = create and show the demo accounts (Admin, Accountant, Finance, Viewer) on the sign-in page; off = they are disabled at the next start. |
| `SYNC_WORKERS` | no (4) | Parallel D365 downloads per job. |
| `SQL_LOGIN_TIMEOUT` | no (60) | Seconds to wait for SQL Server to accept a connection. |
| `JOB_STALE_MINUTES` | no (30) | A running job without progress for this long is marked Failed (e.g. after a PC restart). |
| `EXPRESS_STOP_AT_MB` | no (9200) | ETL stops loading before the database reaches the SQL Express 10 GB limit. |

**`Backend\api\.env`**

| Setting | Required | Meaning |
|---|---|---|
| `API_SQL_CONN` | yes | Connection used for report queries (a read-only login, or the same as `SQL_CONN` with Windows authentication). The API does not start without it. |
| `CORS_ORIGINS` | no (http://localhost:5173) | Web addresses allowed to call the API from a browser. |
| `TOKEN_HOURS` | no (12) | How long a sign-in lasts. |
| `SMTP_PASSWORD` | no | Password of the mail account that sends report packs (other mail settings are on the Report Pack page). |

D365 connection details (environment URL, tenant ID, client ID, client secret) are **not** in `.env`: they are
entered in the app under **ETL › Tenants** and stored encrypted in `etl.tenant`.

---

## 6. First data load

1. Sign in as `admin` and open **ETL › Tenants → + New tenant**: name, environment URL (paste the D365 browser
   link), tenant ID, client ID, client secret → **Test connection** → **Save tenant**.
2. **ETL › Jobs**: pick the tenant and click **Run ETL** for all tables (or tick tables and run those). Each D365
   entity is loaded into its own `stg` table, created automatically from the OData metadata. The default list
   (`Backend\etl\entities.yaml`) is:

   | D365 entity | SQL table | Load |
   |---|---|---|
   | LegalEntities | `stg.legal_entities` | full |
   | MainAccounts | `stg.main_accounts` | full |
   | CustomersV3 | `stg.customers` | full |
   | VendorsV2 | `stg.vendors` | full |
   | GeneralJournalAccountEntryBiEntities (ledger lines) | `stg.gl_entries` | incremental by AccountingDate |
   | GeneralJournalEntryBiEntities (journal headers) | `stg.gl_headers` | full |

   **Always load the ledger lines and the journal headers in the same run**: the posting date and company are on the
   header, and the dashboards cannot be built without both.
3. At the end of each job the reporting tables are rebuilt ("Dashboard data refreshed"). **Rebuild reports** on the
   Jobs page does the same without downloading anything.
4. Pick the company in the top bar and open **Dashboards**.
5. Optional: open **Reports › Customer & Vendor Ageing** to load the customer and vendor open transactions
   (`stg.cust_open_trans`, `stg.vend_open_trans`) - they feed Ageing and the Cash Flow Forecast.

**If a run fails half-way** (internet drop, D365 down):
- Each D365 request is retried up to 8 times over about 7 minutes, resuming at the same page.
- Only the table that cannot be loaded is marked FAILED; the others continue. Click **Retry N failed D365 tables**.
- The last good dashboard data is kept: reports are not rebuilt from a half-loaded ledger.
- Re-running is always safe: a table's rows are replaced, and incremental tables keep their old watermark after a failure.

---

## 7. Scheduled ETL

Windows **Task Scheduler** → run `Backend\etl\run_etl.bat` (daily or every 2 hours), *Start in* = the `Backend\etl` folder.
It syncs every tenant marked *Active* and writes `Backend\etl\logs\etl_YYYYMMDD.log`.

Command line (with the venv active, in `Backend\etl\`):
```bat
python etl.py                                   :: every active tenant
python etl.py --tenant "Al-Dowayan UAT"         :: one tenant
python etl.py --tenant "Al-Dowayan UAT" --entities MainAccounts LegalEntities
python etl.py --tenant "Al-Dowayan UAT" --full  :: full reload instead of incremental
```

---

## 8. Modules

| Area | Pages | What it does |
|---|---|---|
| **Home** | Home | Project overview, data freshness and your **bookmarks** (star in the top bar on any page). |
| **ETL** | Tenants, Jobs, Counts, History | D365 connections; run ETL per table with live progress; row counts; run history. |
| **Dashboards** | Overview, Profit & Loss, Balance Sheet, Trial Balance, Expenses, Cash & Bank, Receivables & Payables, Projects, Sales, Purchasing, Fixed Assets | Interactive charts and tables from the ledger, per company and year. |
| **Reports** | Income Statement, Financial Position, Trial Balance Mapping, Cash Flow, Notes, FS Mapping | Statutory-style statements using the FS mapping workbooks (ADD SPF, Tazayud); print / PDF / CSV. |
| | Budget vs Actual | Upload budgets (CSV / Excel template) or generate from last year + growth %; variances by account and month. |
| | Customer & Vendor Ageing | Open items in Not due / 0–30 / 31–60 / 61–90 / 90+ day buckets. |
| | Cash Flow Forecast | Weekly cash position for 8 / 13 / 26 weeks: opening bank balance + open receivables and payables (netted per customer / vendor) + planned items (payroll, rent, loans, VAT, capex); what-if assumptions and a minimum-cash warning. |
| **Adjustments** | Adjustments & Eliminations, Adjusted Statements | Journal entries kept in this system only (audit adjustments, reclassifications, intercompany eliminations). |
| **Close & Consolidation** | Period Close, Consolidation, Reconciliation | Close checklist and period lock; group consolidation with currencies and eliminations; D365-to-report reconciliation. |
| **Administration** | User Management, System Health, Audit Logs, Alerts, Report Pack, System Configuration | Users / roles / company access; health checks; full audit trail; alerts (bell in the top bar); monthly PDF pack by e-mail; branding and number format. |
| **Help** | System Manual, AI Assistant | Built-in manual; questions about the figures in plain English (runs locally, no external AI). |

The interface is available in **English and Arabic** (button in the top bar) with light / dark themes.

**FS mapping**: loaded into `rpt.fs_map` on API start from `Backend\api\fs_mapping_seed.json`. To re-import a workbook:
```bat
cd Backend\api
python fs_import.py "D:\path\FS Tazaiud Mapping YE2025 (DEC).xlsx" Tazayud
```
Year-end closing entries (TransferOpeningClosing on 31 Dec / 1 Jan) are left out of reports and dashboards, so a
closed year still shows its full income statement.

---

## 9. Users, roles and security

- **Sign-in**: username + password (PBKDF2 hashes). 5 wrong passwords lock the account for 15 minutes.
- **Roles**: **Admin** (everything), **Accountant** (run ETL, mapping, adjustments, budgets, forecast, close), **Finance**
  (dashboards, reports, export), **Viewer** (read only). What each role may do is editable under
  **User Management › Roles & permissions**.
- **Company access**: each user sees only their companies (or all). Enforced twice - the API refuses other
  companies, and SQL Server row-level security (`sec.company_policy` on `dw.fact_gl`, `Backend\sql\03_security.sql`)
  filters every report query.
- **Report access**: per user, all pages the role allows or only chosen ones.
- **Audit Logs**: sign-ins, failed sign-ins, user and role changes, every report opened, every change made through
  the app, ETL jobs, API start-ups and errors.
- **Demo accounts** (only while `DEMO_USERS=1` in `Backend\etl\.env`), listed on the sign-in page for one-click sign-in:

  | Username | Role | Password |
  |---|---|---|
  | `demo.admin` | Admin | `Demo1234` |
  | `demo.accountant` | Accountant | `Demo1234` |
  | `demo.finance` | Finance | `Demo1234` |
  | `demo.viewer` | Viewer | `Demo1234` |

  The demo password cannot be changed by the demo users and is reset at every API start. `demo.admin` can manage
  users, D365 tenants and configuration, so **turn `DEMO_USERS` off on any server that is not a demo.**
- **Secrets**: `.env` files are git-ignored; D365 client secrets are encrypted with `SECRET_KEY`. Rotate any client
  secret that has been shared by e-mail or chat, and enter the new one under ETL › Tenants.

---

## 10. Database

One database (default `AlDowyanReporting`) with these schemas:

| Schema | Contents |
|---|---|
| `etl` | Tenants (D365 connections), entity lists, jobs, run log, table statistics. |
| `stg` | Raw copies of the D365 entities, one table per entity (+ `_tenant_key`). |
| `dw` | Reporting tables and views: ledger fact (`dw.fact_gl`), accounts, companies. |
| `rpt` | FS mapping (statement lines and notes). |
| `sec` | Users, roles, permissions, company access, audit log, configuration, AI chats, bookmarks. |
| `adj` | Adjustment and elimination entries. |
| `bud`, `cls`, `cons`, `ops` | Budgets; period close; consolidation; alerts, reconciliation, report packs and settings. |
| `cff` | Cash flow forecast assumptions and cash items. |

Scripts in `Backend\sql\`, applied in order on every API start (all idempotent):
`01_schema` · `02_reporting` · `03_security` · `04_adjustments` · `05_config` · `06_ai_chat` · `07_modules` · `08_bookmarks` · `09_cash_forecast`.
New modules add a numbered script here and its name to the list in `Backend\etl\db.py` (`ensure_schema`).

---

## 11. Project layout

```
Backend/              everything that runs on the server (Python + SQL)
  api/                FastAPI app
    main.py           app start-up, dashboard endpoints, ETL/admin endpoints, module registration
    security.py       users, roles, permissions, tokens, row-level security, demo users
    modlib.py         helpers shared by the modules
    budget.py, ageing.py, cash_forecast.py, analytics.py, period_close.py, consolidation.py,
    reconciliation.py, alerts.py, report_pack.py, adjustments.py, fs_*.py, bookmarks.py,
    ai_assistant.py, health.py, audit_logs.py, app_config.py      one file per module
    logs/api.log      API log (start-up steps, errors)
    .env              API settings (git-ignored)
  etl/                sync engine
    d365_client.py    OData client (Entra sign-in, paging, retries)
    sync.py           jobs: load entities, rebuild reporting tables
    catalog.py        D365 $metadata catalogue and each tenant's entity list
    db.py             SQL connection and schema set-up (runs the sql/ scripts)
    etl.py            command line / scheduled runs;  run_etl.bat for Task Scheduler
    entities.yaml     default entity list for new tenants
    .venv/            Python environment shared by the ETL and the API (git-ignored)
    .env              database connection and secrets (git-ignored)
  sql/                database scripts 01 … 09
  setup_env.py        one-time settings and database creation
Frontend/             React + Vite app (runs in the browser)
  src/App.jsx         pages and routes;  src/components/Sidebar.jsx menu
  src/pages/          one file per page (dash/, rpt/, adj/, close/ sub-folders)
  src/api.js          API calls and number formatting;  src/i18n.js Arabic translation
  vite.config.js      dev server; forwards /api to the API on port 8000
  package.json        npm scripts: dev, build, preview
```

`Backend\api`, `Backend\etl` and `Backend\sql` must stay side by side: the API loads the ETL code and settings from
`..\etl`, and the ETL reads the database scripts from `..\sql`. The Python environment lives in `Backend\etl\.venv`;
if the project folder is ever moved, recreate it (step 1 of the setup) - a moved venv keeps pointing at the old path.

---

## 12. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| A page or button says **Not Found** | The API is running older code than the app. Stop uvicorn (Ctrl+C), start it again, then press Ctrl+F5 in the browser. |
| **Cannot reach the API** | uvicorn is not running, or is on another port than 8000. |
| `TCP Provider: Timeout error` / `Login timeout expired` | SQL Server is not running or not reachable: check the *SQL Server (SQLEXPRESS)* service and the server name in `SQL_CONN`. |
| `insufficient system memory in resource pool` | SQL Server Express ran short of memory - close other programs or restart the SQL Server service. |
| ETL job is OK but the table is "not in the database" | Look in database **`AlDowyanReporting`** (spelled without the second *a*), schema **`stg`**, under the snake-case name (e.g. `AQLDefectTypes` → `stg.aql_defect_types`); refresh Object Explorer in SSMS. |
| "Posting dates missing. Run ETL for GeneralJournalEntryBiEntities" | Load the journal headers together with the ledger lines, then **Rebuild reports**. |
| Dashboards are empty for a company | The page explains which step is missing (loaded → built → company); usually Run ETL, then Rebuild reports. |
| Ageing / Cash Flow Forecast says open transactions are not loaded | Load them from Reports › Customer & Vendor Ageing (needs *Run ETL*). |
| Times in `etl.*` tables differ from the app | The database stores UTC; the app shows local time. |

Logs: `Backend\api\logs\api.log` (API) and `Backend\etl\logs\etl_YYYYMMDD.log` (scheduled ETL). **Administration › System Health**
checks the database, schema, security policy, jobs, D365 connections and data freshness in one page.

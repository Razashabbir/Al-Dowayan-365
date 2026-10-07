/* System Manual - every section of the in-app manual (Help › System Manual).
   Each section: id, group, title, tech (only shown to users who run ETL or manage users), md (markdown text).
   Keep this file in step with the app when modules change. */

export const GROUPS = ['Getting started', 'Using the system', 'Planning, close & consolidation', 'Data & ETL', 'Administration', 'Technical reference', 'Help']

export const SECTIONS = [
  /* ------------------------------------------------------------------ Getting started ---- */
  {
    id: 'introduction', group: 'Getting started', title: 'Introduction',
    md: `The **Financial Reporting System** turns the general ledger of **Microsoft Dynamics 365 Finance & Operations** into
dashboards, audited-style financial statements, adjustments and eliminations, and plain-language answers - in one web application.

#### How the data flows

| Step | What happens | Where |
|---|---|---|
| 1. Extract | D365 tables are read through OData (ledger lines, journal headers, main accounts, legal entities, customers, vendors …) | ETL › Jobs |
| 2. Load | Each D365 table is copied into SQL Server schema **stg** (created automatically) | Database AlDowyanReporting |
| 3. Build | *Rebuild reports* turns the ledger into **dw.fact_gl** (one row per ledger line) and **dw.dim_account** | Runs at the end of every ETL job |
| 4. Report | The API reads dw.fact_gl for dashboards, statements, the AI Assistant and Home | FastAPI on port 8000 |
| 5. Show | The React app shows everything, checked against each user's role, companies and reports | Browser, port 5173 |

#### Main modules

- **Home** - project overview: group figures, data health, companies.
- **ETL** - D365 connections (tenants), loading data (jobs), row counts and history.
- **Dashboards** - eight interactive dashboards (Overview, Profit & Loss, Balance Sheet, Trial Balance, Expenses, Cash & Bank, Receivables & Payables, Projects).
- **Reports** - Income Statement, Financial Position, Trial Balance Mapping, Cash Flow, Notes, FS Mapping.
- **Adjustments** - adjustments, reclassifications and eliminations on top of the D365 ledger, and the adjusted statements worksheet.
- **Administration** - User Management, System Health, Audit Logs, System Configuration.
- **System Manual** - this guide. **AI Assistant** - ask questions about the figures.

> Everything is read-only towards D365: the system never writes back to Dynamics 365.`,
  },
  {
    id: 'sign-in', group: 'Getting started', title: 'Signing in and your account',
    md: `#### Signing in
- Open the app (normally **http://localhost:5173**) and sign in with your **username and password**.
- The first time, or after an Admin resets your password, you must choose a **new password**: at least **8 characters, with letters and numbers**.
- After **5 wrong passwords** the user is locked for **15 minutes**.
- A session lasts **12 hours**; after that you are asked to sign in again. Changing your password signs you out everywhere else.

#### Your user menu (top right)
- **Change password** and **Sign out**.
- Your role is shown next to your name (Admin, Accountant, Finance or Viewer).

#### Top bar
| Control | What it does |
|---|---|
| **Theme** | Colour theme of the app (five themes or your own gradient). Stored in this browser. |
| **العربية / English** | Arabic interface (right-to-left, Arabic font and labels). Data such as account names stays as in D365. |
| **Company** | The company (D365 legal entity) every dashboard and report shows. You only see companies you have access to. |

> If a page says *No access*, ask an Admin to give you the permission or the report under **User Management**.`,
  },
  {
    id: 'navigation', group: 'Getting started', title: 'Navigating the app',
    md: `The sidebar shows only what your role may open:

1. **Home**
2. **ETL** › Tenants, Jobs, Counts, History
3. **Dashboards** › Overview, Profit & Loss, Balance Sheet, Trial Balance, Expenses, Cash & Bank, Receivables & Payables, Projects
4. **Reports** › Income Statement, Financial Position, Trial Balance Mapping, Cash Flow, Notes, FS Mapping
5. **Adjustments** › Adjustments & Eliminations, Adjusted Statements
6. **User Management**, **System Health**, **Audit Logs**, **System Configuration**
7. **System Manual**
8. **AI Assistant**

Groups open by themselves when one of their pages is shown. The button next to the logo **collapses the sidebar** to a slim row of icons (hover an icon to see its name; click a group icon to open the sidebar again) - your choice is remembered in this browser. On a phone the sidebar opens from the menu button.

#### Common controls on dashboards and reports
- **Year / Month** pickers in the page header. Month means *up to the end of that month* (year-to-date) for P&L, and *as at the end of that month* for balances.
- **2D / 3D** switch on charts that support it; drag a 3D chart to rotate it.
- **Print / PDF** and **Export CSV** (needs the permission *Export CSV / print reports*).
- Click statement lines to open notes and ledger accounts.`,
  },

  /* ------------------------------------------------------------------ Using the system ---- */
  {
    id: 'home', group: 'Using the system', title: 'Home',
    md: `Home is the overview of the whole project:

- **Group figures** - revenue, expenses, net profit, total assets and cash of all companies you can see, compared with last year.
- **Data health** - last ETL run, last *Rebuild reports*, share of ledger lines whose account is found in Main Accounts, FS mapping coverage.
- **Monthly chart** of revenue and expenses for the group, and revenue / net profit by company.
- **Companies table** - each company with its period, figures and buttons to open its dashboard or reports (this also switches the company in the top bar).
- **Module cards** - shortcuts to ETL, dashboards and reports.
- **Tenants and recent jobs.**`,
  },
  {
    id: 'dashboards', group: 'Using the system', title: 'Dashboards',
    md: `All dashboards use the company in the top bar and the year (and month) in the page header.

| Dashboard | Shows |
|---|---|
| **Overview** | Revenue, expenses, net profit and margin (with last year), monthly P&L chart, top expenses, trial balance summary |
| **Profit & Loss** | Every revenue and expense account by month, totals and last year |
| **Balance Sheet** | Assets, liabilities and equity by account at the month end, compared with the same date last year; current-year and retained earnings |
| **Trial Balance** | Opening, debit, credit and closing per account; account type shown in colour |
| **Expenses** | Expenses by month (this vs last year), top accounts and top financial dimensions |
| **Cash & Bank** | Month-end cash balance, money in and out, cash and bank accounts |
| **Receivables & Payables** | Month-end receivables and payables, DSO and DPO (days) |
| **Projects** | Revenue, cost and margin per project (ledger lines that carry a project id) |
| **Sales** | Revenue by month (this vs last year), top revenue accounts, by project and dimension, customers by group, receivables and DSO |
| **Purchasing** | Costs and direct purchases by month, top cost accounts, payables trend and DPO, vendors by group |
| **Fixed Assets** | Gross cost, accumulated depreciation, net book value, additions, disposals and depreciation by month, asset register by account |

> **Year-end closing entries are left out** (D365 posting type *Transfer opening/closing* on 31 Dec / 1 Jan), so a closed year still shows its full profit and loss.

If a dashboard is empty, the yellow box says which step is missing (no ledger lines, no posting dates, reports not built, wrong company …) and how to fix it.`,
  },
  {
    id: 'reports', group: 'Using the system', title: 'Reports',
    md: `Reports follow the layout of the **audited financial statements** and use the **FS mapping** (which statement line and note each main account belongs to).

| Report | Purpose |
|---|---|
| **Income Statement** | Statement of profit or loss and OCI, Jan to the chosen month, with the same period last year. Click a line for its notes, a note for its accounts. |
| **Financial Position** | Statement of financial position at the month end, compared with 31 Dec of the previous year. Shows a check that assets = equity + liabilities. |
| **Trial Balance Mapping** | Opening, debit, credit and closing per account with its FS line and note (like the *TB Dec* working). |
| **Cash Flow** | Statement of cash flows, **indirect method**, built from the profit and the movement of every balance sheet line; it ties to the change in cash. |
| **Notes** | Every statement line broken down by note. |
| **FS Mapping** | Change the line / note of an account, choose which mapping workbook a company uses (needs *Change the FS mapping*). |
| **Budget vs Actual** | Actual against budget per account and month, variances in amount and %, see below. |
| **Customer & Vendor Ageing** | Open receivables and payables in Not due / 0–30 / 31–60 / 61–90 / 90+ day buckets per customer and vendor, see below. |
| **Cash Flow Forecast** | Weekly cash position for the next 8, 13 or 26 weeks from open receivables, payables and planned cash items, see below. |

#### Companies and basis
- **Companies:** one company, or **All companies (combined)**.
- **Basis:** *D365 ledger only*, *With adjustments* (posted adjustments and reclassifications) or *Final* (adjustments, plus **eliminations** when all companies are combined).

#### How an account finds its line
1. A manual mapping made on the FS Mapping page,
2. the mapping workbook assigned to the company (e.g. ADD SPF, Tazayud),
3. any other workbook that has the account,
4. the chart-of-accounts range rule (flagged as *not mapped* if nothing fits).`,
  },
  {
    id: 'adjustments', group: 'Using the system', title: 'Adjustments & Eliminations',
    md: `Adjustments are journal entries **kept in this system only** (never posted to D365). They change the reports when their basis includes them.

| Type | Use it for | Companies |
|---|---|---|
| **Adjustment** | Audit adjustments (e.g. PwC AJE), accruals, corrections | One company |
| **Reclassification** | Moving an amount between lines (e.g. current to non-current) | One company |
| **Elimination** | Intercompany revenue/cost, balances, investments | **At least two companies**; only applied when *All companies (combined)* and basis *Final* |

#### Workflow
1. **Adjustments › Adjustments & Eliminations › + New entry** - choose type, date (period), reference and description; optionally start from a template.
2. Add lines: company, **main account or FS line**, debit or credit, memo. Debits must equal credits.
3. **Save draft** (not in reports) or **Save & post** (needs *Post, unpost and reverse*).
4. To correct a posted entry: **Unpost**, edit, post again - or **Reverse** it (a mirror entry).

#### Seeing the effect
- **Adjustments › Adjusted Statements** shows each line of the P&L, Financial Position and Cash Flow as *D365 ledger + Adjustments (+ Eliminations) = Final*.
- A yellow note on the statements explains entries that are not included (drafts, later dates, another company, ledger-only basis).

> Entries count in the period of their **date**: an entry dated 31 Dec 2025 is in 2025, not in 2026.`,
  },
  {
    id: 'assistant', group: 'Using the system', title: 'AI Assistant',
    md: `Ask questions about the figures in plain English (Arabic keywords work too). It uses the company and month/year shown on its page unless you name others.

| Ask about | Examples |
|---|---|
| Profit & loss | *revenue this year*, *net profit in March*, *Q2 expenses*, *profit 2025* |
| Why it changed | *why did net profit change?*, *why did expenses go up?* |
| Rankings | *top 10 expenses*, *biggest revenue accounts 2025* |
| Trends | *revenue by month*, *monthly expenses* |
| Balance sheet | *is the balance sheet balanced?*, *total assets* |
| Cash & working capital | *cash position*, *receivables and DSO*, *payables* |
| Statements | *income statement*, *cash flow 2025*, *trial balance check* |
| Accounts | *balance of account 4111001*, *rent expense*, *salaries* |
| Companies | *compare all companies*, *revenue for 02td* |
| Projects | *project margins*, *projects with losses* |

- Answers come with tables, a chart where useful, the **reports used**, and **follow-up questions** you can click.
- It runs **locally on the API server** - no internet, no external AI service, no API key - and only **reads** data.
- It sees exactly what you could open yourself (same role, companies and report access). Every question is written to the **Audit Logs**.
- **Chats are saved** for your user: the AI Assistant page lists them on the left (Today, Yesterday, Previous 7 days, Older) - open, rename (✎) or delete (×) a chat, or start a **New chat**.
- The round **Ask** button at the bottom right of every page opens a small assistant window without leaving the page. It uses the company in the top bar and the current year; ☰ shows your chats, ⤢ opens the full page.
- Who may use it is the permission *AI Assistant* (User Management › Roles & permissions).`,
  },

  /* ------------------------------------------------------------------ Planning, close & consolidation ---- */
  {
    id: 'budget', group: 'Planning, close & consolidation', title: 'Budget vs Actual',
    md: `**Reports › Budget vs Actual** compares the ledger with a budget per account and month.

#### Creating a budget (permission *Upload, generate and delete budgets*)
1. Click **+ Budget**, choose the year and a name.
2. Either **Download template** (every P&L account with last year's actuals per month), fill it in Excel and **Upload budget** (CSV or Excel: column *Account* and columns *Jan … Dec*; revenue and expenses as **positive** amounts),
3. or **Generate from last year's actuals** with a growth % (e.g. +5%).

A budget with the same name and year is replaced. Several budgets per year are possible (e.g. *Original*, *Forecast Q2*).

#### Reading the report
- Choose the budget and **Up to** month: actual and budget are year-to-date (Jan to that month).
- **Variance** is favourable (green) when revenue is above budget or expenses below it.
- The chart shows net result by month (bars = actual, dashed = budget) and revenue actual vs budget.`,
  },
  {
    id: 'ageing', group: 'Planning, close & consolidation', title: 'Customer & Vendor Ageing',
    md: `Needs the D365 **open-transaction** tables (open invoices and payments with due dates). They are loaded into \`stg.cust_open_trans\` and \`stg.vend_open_trans\`.

**First time:** open the page - it lists the D365 entities that look right (open-transaction entities first, e.g. *CustTransOpen…* / *VendTransOpen…*). Click one to add it to the tenant's tables and start loading it (needs *Run ETL*). If the catalogue was not read yet, click **Search the D365 catalogue** or type the entity name.

**The report:** choose Customers or Vendors, the month (ageing is at that month end) and **Age by** due date or invoice date. Buckets: *Not due*, *0–30*, *31–60*, *61–90*, *90+* days past due. Tiles show the total, overdue and 90+ amounts; the table shows every customer / vendor with its spread bar, oldest item and an Export CSV.

Columns are detected by name (account, amount in accounting currency, settled amount, due date, transaction date), so different D365 entity versions work. Re-run ETL for the entity to refresh.`,
  },
  {
    id: 'cash-forecast', group: 'Planning, close & consolidation', title: 'Cash Flow Forecast',
    md: `**Reports › Cash Flow Forecast** shows the expected bank balance week by week, starting today, for the company in the top bar.

| Line | Where it comes from |
|---|---|
| **Opening cash** | Ledger balance today of the accounts whose name contains *bank* or *cash* (same as Dashboards › Cash & Bank). |
| **Customer collections** | Every open customer item (\`stg.cust_open_trans\`) on its due date plus the collection delay. |
| **Vendor payments** | Every open vendor item (\`stg.vend_open_trans\`) on its due date plus the payment delay. |
| **Other receipts / payments** | Cash items you add: salaries, rent, loan instalments, VAT and zakat, capex - once, weekly or monthly. |

The open items are the same tables as Customer & Vendor Ageing - load them there first. They are **netted per customer / vendor**: payments and credit notes that were not settled against invoices in D365 are applied to the oldest invoices first, so only the newest invoices of the net balance are forecast. A customer or vendor with a credit balance (advance, overpayment) adds nothing. Opening cash uses **asset** accounts only, so a *Bank loan* is not counted as cash.

#### Assumptions (saved per company)
- **Customers pay / we pay vendors (days after due)** - shifts every receipt or payment by that many days.
- **Receivables collected (%)** - e.g. 90% if one in ten invoices is usually not paid.
- **Leave out receivables overdue more than N days** - treated as doubtful and not forecast.
- **Spread overdue items over N weeks** - amounts already past due are spread evenly over the first weeks.
- **Payment terms when no due date** - used when the D365 entity has no due-date column.
- **Minimum cash balance** - weeks closing below it are red, with a warning at the top.

**Try these (what-if)** recalculates with other values without saving them; **Save for <company>** makes them the default (permission *Cash flow forecast*).

#### Cash items
**+ Cash item** adds a receipt or payment; monthly items repeat on the day of the first date. **Suggest from ledger** proposes monthly salaries and rent from the average of the last three months of postings - check the amount, as accruals are included.

Click a week in the table to see its largest receipts and payments. The note under the table lists what is left out (doubtful, not collected, due after the horizon). **Export CSV** downloads the weekly table.`,
  },
  {
    id: 'period-close', group: 'Planning, close & consolidation', title: 'Period Close and lock',
    md: `**Close & Consolidation › Period Close** shows the 12 months of the year for the company in the top bar, with the checklist progress and a lock for closed months.

1. Click a month: tick the **checklist** tasks (bank reconciliations, accruals, depreciation …) - each tick records who and when.
2. Check the **automatic checks**: ETL loaded after month end, no draft adjustments left, financial position balances, all accounts mapped, ledger lines exist.
3. **Close & lock** the company, or **Close all companies**.

A closed month **refuses new, changed, posted, unposted or reversed adjustment entries dated in it** (also proposed eliminations). To correct something, **Reopen** the month (permission *Lock and reopen periods*), then close it again. Every lock and reopen is in the Audit Logs.

**Edit checklist** changes the tasks for everyone.`,
  },
  {
    id: 'consolidation', group: 'Planning, close & consolidation', title: 'Consolidation',
    md: `**Close & Consolidation › Consolidation** has three tabs.

| Tab | What it does |
|---|---|
| **Setup** | Per company: functional **currency**, **ownership %** and whether it is included. **Exchange rates** per currency and month (closing rate and year-to-date average; 1 unit = x group currency). **Intercompany accounts**: which account of which company is with which counterparty - *Find intercompany accounts* suggests accounts named due from / due to / related party / intercompany. |
| **Intercompany matching** | For every pair of companies, A's balance with B plus B's balance with A must net to zero (receivable vs payable, revenue vs cost). Matched / Difference per pair. **Propose eliminations** creates *draft* Elimination entries for the matched pairs - review and post them under Adjustments. |
| **Group pack** | Consolidated profit or loss and financial position: each company (D365 + posted adjustments) translated - P&L at the average rate, balance sheet at the closing rate - plus posted eliminations = group. Shows the translation difference, non-controlling interests (from ownership %) and a balance check. Print / PDF. |

The group currency is the currency in **System Configuration**.`,
  },
  {
    id: 'reconciliation', group: 'Planning, close & consolidation', title: 'Reconciliation',
    md: `**Close & Consolidation › Reconciliation** checks D365 against the reporting database **every night** (hour set under Alerts › Rules, default 02:00) and when you click **Run now**:

| Check | Meaning of a difference |
|---|---|
| Ledger lines D365 → staging | D365 *$count* vs stg.gl_entries. More in D365 = postings after the last ETL - run ETL. |
| Ledger lines staging → reporting | Lines without a journal header / posting date are not in the reports - load the headers and Rebuild reports. |
| Journal headers D365 → staging | Run ETL for the journal headers. |
| Trial balance nets to zero (per company) | Debits must equal credits in dw.fact_gl. |
| Ledger accounts found in Main Accounts | Load MainAccounts and Rebuild reports. |

Runs with differences also raise an **alert**.`,
  },
  /* ------------------------------------------------------------------ Data & ETL ---- */
  {
    id: 'tenants', group: 'Data & ETL', title: 'Tenants (D365 connections)',
    md: `A **tenant** is one D365 environment (e.g. *Al-Dowayan UAT*, *Al-Dowayan PROD*).

1. **ETL › Tenants › + New tenant**.
2. Enter a name, the **environment URL** (paste the D365 link from the browser), the Microsoft Entra **tenant ID**, the app **client ID** and **client secret**, and the default company.
3. **Test connection** - shows the legal entities the app can see.
4. **Save tenant**.

- The client secret is stored **encrypted** (with SECRET_KEY from etl\\.env); leave it blank when editing to keep the stored one.
- Only active tenants are synced by the scheduler.
- Needs the permission *Add / edit D365 tenants and credentials*.`,
  },
  {
    id: 'jobs', group: 'Data & ETL', title: 'Jobs (loading data)',
    md: `**ETL › Jobs** loads D365 data into SQL Server.

- **Choose D365 tables…** - pick which D365 entities to load (search the full D365 catalogue, full or incremental load, date field).
- **Run ETL – all tables** or **Run ETL** on one table. Missing stg tables are created from the D365 metadata.
- At the end of a job the reports are rebuilt automatically. **Rebuild reports** does only that step (e.g. after changing account settings).
- A job shows every table with rows, time and message. **Retry N failed D365 tables** reloads only the failed ones.

#### Tables the reports need
| D365 entity | stg table | Used for |
|---|---|---|
| GeneralJournalAccountEntryBiEntities | gl_entries | Ledger lines (amounts, accounts, dimensions) |
| GeneralJournalEntryBiEntities | gl_headers | Posting dates, posting types, journal numbers |
| MainAccounts | main_accounts | Account names and types |
| LegalEntities | legal_entities | Company names |
| CustomersV3, VendorsV2 | customers, vendors | Customer / vendor lists |

#### When D365 or the internet fails
- Each request is retried up to 8 times over about 7 minutes, continuing at the same page.
- Only the failing table is marked FAILED; the others continue, and the last good dashboard data is kept.
- Re-running is always safe: nothing is duplicated or skipped.`,
  },
  {
    id: 'counts-history', group: 'Data & ETL', title: 'Counts, History and scheduled sync',
    md: `- **Counts** - number of rows in every stg table per tenant, and when it was last loaded. *Recount* refreshes the numbers.
- **History** - every table load of every job: status, rows, duration and message; filter and search.

#### Scheduled sync
Windows **Task Scheduler** → run \`etl\\run_etl.bat\` daily or every 2 hours ("Start in" = the etl folder). It syncs every active tenant.

\`\`\`
python etl.py --tenant "Al-Dowayan UAT" --full
\`\`\``,
  },
  {
    id: 'calculations', group: 'Data & ETL', title: 'How the figures are calculated',
    md: `- **Ledger account** in D365 looks like \`4111001_00000005_00000011_Aldowayan\`. The first segment is the **main account**; the next segments are financial dimensions (dim2, dim3 …).
- **Signs:** in the ledger debit is positive and credit negative. Dashboards and statements show revenue, income and assets as positive numbers.
- **Account types:** from Main Accounts; generic P&L / balance sheet types are classified by the first digit (1 assets, 2 liabilities, 3 equity, 4 revenue, 5 expenses, 6 OCI).
- **Closing entries** (31 Dec / 1 Jan, *Transfer opening/closing*) are excluded everywhere.
- **Year-to-date:** P&L figures run from 1 Jan to the end of the chosen month and are compared with the same months last year.
- **Cash & Bank, Receivables, Payables** dashboards find accounts by name (*bank/cash*, *receivable/debtor*, *payable/creditor*).
- **DSO** = receivables ÷ last 12 months' revenue × 365; **DPO** = payables ÷ last 12 months' expenses × 365.
- **Cash flow** (indirect): profit before zakat + non-cash items + change in working capital + investing + financing = change in cash.
- **Eliminations** only apply to *All companies (combined)* on the *Final* basis.`,
  },

  /* ------------------------------------------------------------------ Administration ---- */
  {
    id: 'users', group: 'Administration', title: 'User Management',
    md: `**Users tab** - add, edit, disable or delete users:

| Field | Meaning |
|---|---|
| Username, full name, email | Sign-in name and display |
| Role | Admin, Accountant, Finance or Viewer |
| Password | Required for a new user; leave blank to keep. *Must change at next sign-in* forces a new password. |
| Companies | **All companies**, or only the ticked companies (row-level security) |
| Report access | **All that the role allows**, or only the ticked dashboards / reports / adjustment pages |
| Active | A disabled user cannot sign in |

**Roles & permissions tab** - tick what each role may do. Changes apply within 20 seconds. Admin always keeps every permission, and at least one active Admin must remain.`,
  },
  {
    id: 'roles', group: 'Administration', title: 'Roles and permissions (defaults)',
    md: `| Permission | Admin | Accountant | Finance | Viewer |
|---|---|---|---|---|
| Home | ✔ | ✔ | ✔ | ✔ |
| Dashboards | ✔ | ✔ | ✔ | ✔ |
| Reports | ✔ | ✔ | ✔ | ✔ |
| Export CSV / print reports | ✔ | ✔ | ✔ | |
| Change the FS mapping | ✔ | ✔ | | |
| See ETL | ✔ | ✔ | | |
| Run ETL and Rebuild reports | ✔ | ✔ | | |
| Add / edit D365 tenants | ✔ | | | |
| Manage users and roles | ✔ | | | |
| System health | ✔ | ✔ | | |
| Audit logs | ✔ | | | |
| See adjustments | ✔ | ✔ | ✔ | |
| Create / edit adjustments | ✔ | ✔ | | |
| Post, unpost, reverse adjustments | ✔ | ✔ | | |
| System configuration | ✔ | | | |
| AI Assistant | ✔ | ✔ | ✔ | ✔ |
| Upload / generate budgets | ✔ | ✔ | | |
| See period close | ✔ | ✔ | ✔ | |
| Tick checklist, lock and reopen periods | ✔ | ✔ | | |
| See consolidation | ✔ | ✔ | ✔ | |
| Consolidation setup, propose eliminations | ✔ | ✔ | | |
| Scheduled report pack | ✔ | | | |
| Alerts | ✔ | ✔ | ✔ | |
| Reconciliation | ✔ | ✔ | | |

These are the defaults; your Admin may have changed them under **User Management › Roles & permissions**.`,
  },
  {
    id: 'rls', group: 'Administration', title: 'Row-level security',
    md: `A user sees only the companies given to them. This is enforced **twice**:

1. The **API** refuses any request for a company the user may not see (*You have no access to company …*).
2. **SQL Server row-level security** - the security policy \`sec.company_policy\` filters the ledger table \`dw.fact_gl\` for every query by the signed-in user (\`SESSION_CONTEXT app_user\`).

ETL and *Rebuild reports* run without a user and therefore see all rows. Report access (which dashboards and reports) is checked by the API in the same way.`,
  },
  {
    id: 'health', group: 'Administration', title: 'System Health',
    md: `Checks every part of the system, every 30 seconds if *Every 30 s* is on:

- **API** - running, version, uptime, errors in the last 24 hours (from api\\logs\\api.log).
- **Database** - response time, size against the **10 GB SQL Server Express limit**, transaction log, recovery model, read-committed snapshot.
- **Schema** - the tables, procedures and functions the app needs.
- **Security** - row-level security policy on, users, admins, locked users, failed sign-ins.
- **ETL** - running, stale or failed jobs and tables.
- **D365 / Data** - per tenant: last connection test, last ETL, last *Rebuild reports*, how many ledger accounts are found in Main Accounts.

Green = healthy, amber = needs attention, red = problem; each check says what to do.`,
  },
  {
    id: 'audit', group: 'Administration', title: 'Audit Logs',
    md: `One searchable log of everything that happens:

| Source | Events |
|---|---|
| **Security** | Sign-ins, failed sign-ins, sign-outs, password changes, user and role changes |
| **Activity** | Every dashboard / report a user opens, every AI Assistant question |
| **Changes** | Every change made through the app (ETL runs, rebuilds, tenants, mapping, adjustments, configuration) with result |
| **ETL** | Jobs and table loads with rows, time and errors |
| **System** | API start-ups and errors |

Filter by source, user, level (info / warning / error), period and text; export to CSV.`,
  },
  {
    id: 'alerts', group: 'Administration', title: 'Alerts',
    md: `**Administration › Alerts** and the **bell** in the top bar (with the number of open alerts) warn about:

| Alert | When |
|---|---|
| ETL failed | The latest job of a tenant failed or partly failed |
| ETL not run | No successful ETL for N days (default 2) |
| Trial balance | A company's ledger does not net to zero |
| Financial position | A company's statement of financial position does not balance (latest month) |
| Expense spike | An expense account's latest month is more than X % (default 50 %) above its 3-month average and above a minimum amount |
| Reconciliation | The latest reconciliation found differences |
| Report pack | A scheduled report pack could not be sent |

Alerts are checked **every hour** and on **Check now**. An alert that is no longer detected is **Resolved** automatically; **Acknowledge** shows that someone is on it. Admins change the thresholds under **Rules**. You only see alerts of your companies.`,
  },
  {
    id: 'report-pack', group: 'Administration', title: 'Report Pack (scheduled e-mail)',
    md: `**Administration › Report Pack** e-mails the monthly statements as a **PDF** automatically.

1. **E-mail settings:** SMTP server (e.g. smtp.office365.com), port (587), sender address, user name, STARTTLS. Put the SMTP **password** in \`api\\.env\` as \`SMTP_PASSWORD=...\` and restart uvicorn - it is never stored in the database.
2. **+ Schedule:** name, tenant, companies (or *All companies combined*), statements (Income Statement, Financial Position, Cash Flow), basis, the **day of the month** and **hour**, recipients.
3. Each month on that day and hour the pack of the **previous month** is sent once. **Preview PDF** and **Send** work any time for the period chosen at the top (e.g. to send a test).

The PDF needs the Python package *reportlab* (\`pip install reportlab\` in the api folder). Every sending is listed under **Sent**.`,
  },
  {
    id: 'configuration', group: 'Administration', title: 'System Configuration',
    md: `Admin only. Click **Save** (top right) - the changes apply at once in the sidebar, sign-in page, browser tab and reports.

| Setting | Effect |
|---|---|
| Company name, tagline | Sidebar, sign-in page, browser tab title, report headings |
| Logo / logo letters | Sidebar, sign-in page and browser tab icon. PNG, JPG, WEBP or SVG; resized to 256 px |
| Sign-in page message | Text under the name on the sign-in page |
| Default theme and language | Used by browsers that have not chosen their own yet |
| Currency, decimals, negative numbers | How amounts are shown on dashboards (statements always use brackets) |

Settings are stored in \`sec.app_config\`; every change is in the Audit Logs. Other users see the change at their next page load.`,
  },

  /* ------------------------------------------------------------------ Technical reference ---- */
  {
    id: 'architecture', group: 'Technical reference', title: 'Architecture and folders', tech: true,
    md: `\`\`\`
D365 F&O (OData)  →  etl (Python sync)  →  SQL Server AlDowyanReporting  →  api (FastAPI :8000)  →  dashboard (React/Vite :5173)
\`\`\`

| Folder | Contents |
|---|---|
| **etl/** | d365_client (OData + retries), schema_builder (stg tables from $metadata), sync (jobs), tenants (encrypted credentials), db (schema setup), etl.py / run_etl.bat (scheduled runs) |
| **sql/** | 01_schema (database, etl/stg/dw tables), 02_reporting (dw.usp_refresh, views, fn_segment), 03_security (users, roles, RLS), 04_adjustments, 05_config, 06_ai_chat, 07_modules |
| **api/** | main.py (dashboard + ETL endpoints), security.py (sign-in, roles, RLS, middleware), fs_model / fs_reports (statements, cash flow), adjustments, health, audit_logs, app_config, ai_assistant, logs\\api.log |
| **dashboard/** | React 18 + Vite, Recharts, three.js / react-three-fiber, framer-motion; src/pages (one file per page), src/components |

The API creates or updates the database by itself on every start (all SQL scripts are safe to re-run).`,
  },
  {
    id: 'install', group: 'Technical reference', title: 'Installation and start-up', tech: true,
    md: `**Needs:** Windows, Python 3.11+, Node.js 20+, SQL Server 2019+ (Express is fine), ODBC Driver 18 for SQL Server.

\`\`\`
:: 1. settings + packages
cd etl
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
cd ..
python setup_env.py              :: writes etl\\.env and api\\.env, tests SQL

:: 2. API (keep the window open)
cd api
pip install -r requirements.txt
uvicorn main:app --port 8000     :: http://localhost:8000/docs

:: 3. Web app (second window)
cd dashboard
npm install
npm run dev                      :: http://localhost:5173
\`\`\`

- First sign-in: user **admin**, password = ADMIN_API_KEY from etl\\.env (you must change it).
- After changing API files: stop uvicorn (Ctrl+C) and start it again. After changing web files: Ctrl+F5 in the browser.`,
  },
  {
    id: 'database', group: 'Technical reference', title: 'Database objects', tech: true,
    md: `| Schema | Objects | Purpose |
|---|---|---|
| **etl** | tenant, tenant_entity, sync_job, run_log, table_stats, watermark, metadata_cache | D365 connections, selected tables, jobs, history, incremental watermarks |
| **stg** | one table per D365 entity (gl_entries, gl_headers, main_accounts, legal_entities …) | Raw D365 data, column \`_tenant_key\` |
| **dw** | fact_gl, dim_account, usp_refresh, vw_pnl_monthly, vw_account_monthly, vw_tenants, vw_etl_status, fn_segment | Reporting model (built by *Rebuild reports*) |
| **rpt** | fs_map, fs_company | FS mapping (account → line / note) and the workbook per company |
| **adj** | entry, line | Adjustments, reclassifications, eliminations |
| **bud** | budget, line | Budgets per company / year and their amounts per account and month |
| **cls** | period, task, task_done | Closed months, the month-end checklist and who ticked what |
| **cons** | company, fx_rate, ic_account | Consolidation setup: currency and ownership, exchange rates, intercompany accounts |
| **ops** | setting, pack_schedule, pack_log, alert, recon_run, recon_line | Report pack, alerts and reconciliation |
| **sec** | app_user, user_company, user_page, role_permission, audit_log, app_config, ai_chat, ai_message, fn_company_access, company_policy | Users, roles, report access, audit, configuration, AI Assistant chats, row-level security |

\`dw.fact_gl\` columns include tenant_key, company, accounting_date, main_account, ledger_account, dim2–dim4, project, posting_type, amount, is_close.`,
  },
  {
    id: 'api', group: 'Technical reference', title: 'API endpoints', tech: true,
    md: `Every call except sign-in and the public configuration needs \`Authorization: Bearer <token>\`. Interactive documentation: **http://localhost:8000/docs**.

| Area | Endpoints |
|---|---|
| Sign-in | POST /api/auth/login, GET /api/auth/me, POST /api/auth/change-password, /logout, /track |
| Dashboards | GET /api/report/ kpis, pnl-monthly, top-expenses, trial-balance, pnl, balance-sheet, trial-balance-full, expenses, cash, ar-ap, projects, tenants, companies-all, years, diagnose |
| Reports | GET /api/report/fs/ layout, statement, cashflow, tb, mapping · PUT /api/admin/fs/mapping, fs/company-set |
| ETL | /api/admin/tenants (CRUD), test-connection, tenants/{key}/entities, catalog, sync, refresh-reporting, jobs, tables, table-status, counts, history, overview, summary |
| Adjustments | /api/admin/adj/entries (CRUD), entries/{id}/post, unpost, reverse, accounts |
| Administration | /api/admin/users, roles, pages, health, logs, config · GET /api/config/public |
| Budget / ageing / analytics | GET /api/report/budget/list, template, variance · POST /api/admin/budget/upload, generate · GET /api/report/ageing, ageing/sources · GET /api/report/analytics/sales, purchasing, fixed-assets |
| Close & consolidation | /api/admin/close (overview, checklist, task, lock, reopen, tasks) · /api/admin/consol/setup, companies, rates, ic-accounts, suggest, matching, eliminate, pack · /api/admin/recon, recon/run |
| Operations | /api/admin/pack (smtp, schedules, send, preview) · /api/admin/alerts (count, run, ack, settings) |
| AI Assistant | GET /api/ai/status, POST /api/ai/chat, GET /api/ai/chats, GET / PUT / DELETE /api/ai/chats/{id} |`,
  },
  {
    id: 'security-notes', group: 'Technical reference', title: 'Security notes', tech: true,
    md: `- Passwords are stored as PBKDF2-SHA256 hashes; sessions use signed tokens (SECRET_KEY, 12 hours).
- D365 client secrets are encrypted in etl.tenant with SECRET_KEY - **keep a backup of SECRET_KEY**, without it the secrets cannot be read.
- \`.env\` files hold secrets: never share or commit them.
- Every change made through the app is in the Audit Logs.
- Before exposing the app outside the office network, put it behind **HTTPS** (reverse proxy) and restrict access.
- Rotate the D365 client secret if it was ever shared, and enter the new one under ETL › Tenants.`,
  },

  /* ------------------------------------------------------------------ Help ---- */
  {
    id: 'troubleshooting', group: 'Help', title: 'Troubleshooting',
    md: `| Problem | Cause and fix |
|---|---|
| *Cannot reach the API* | uvicorn is not running - start it (\`uvicorn main:app --port 8000\` in the api folder). |
| *The API did not answer within 30 s* | The API was still starting or a query is slow - wait a moment and press Ctrl+F5; check the uvicorn window and System Health. |
| A new page or button is missing | Restart uvicorn after API changes and press Ctrl+F5. |
| Dashboards are empty / zero | Read the yellow box on the dashboard. Usually: run ETL for the ledger tables, then **ETL › Jobs › Rebuild reports**, and pick the right company. |
| Report shows *accounts not mapped* | Map them under **Reports › FS Mapping**. |
| Balance sheet does not balance | Unmapped accounts or a missing year-end close - check FS Mapping and the TB Mapping report. |
| Adjustment does not show in a report | Is it **posted**? Is its **date** in the period? Is the **company** right? Is the basis not *D365 ledger only*? Eliminations need *All companies* + *Final*. |
| *You have no access to company …* | Ask an Admin to add the company to your user. |
| *This report is not enabled for your user* | Ask an Admin to tick the report under your user's *Report access*. |
| Locked after wrong passwords | Wait 15 minutes, or ask an Admin to reset the password. |
| ETL table FAILED with 403 | The D365 app user has no role that can read this entity - ask the D365 admin. |
| *Mon YYYY is closed for …* when saving an adjustment | The month is locked under Period Close - reopen it there first. |
| Ageing page says the table is not loaded | Load the D365 open-transaction entity from the page (needs Run ETL), then wait for the job. |
| Report pack *E-mail not sent* | Check the SMTP settings and SMTP_PASSWORD in api\\.env; send a test with Send. |
| Database near 10 GB | SQL Server Express limit - remove unused stg tables or move to Standard edition. |`,
  },
  {
    id: 'glossary', group: 'Help', title: 'Glossary',
    md: `| Term | Meaning |
|---|---|
| **D365 F&O** | Microsoft Dynamics 365 Finance & Operations, the ERP the data comes from |
| **Tenant** | One D365 environment connected to this system |
| **Company / legal entity** | A D365 company (e.g. 01dh, 02td) |
| **Entity** | A D365 data table exposed through OData |
| **ETL** | Extract, transform, load - copying D365 data into SQL Server |
| **Main account** | The chart-of-accounts number (first segment of the ledger account) |
| **Financial dimension** | Extra analysis segments of the ledger account (cost centre, department …) |
| **FS line / note** | Line of the financial statements and the note it belongs to |
| **FS mapping** | Which FS line and note each main account belongs to |
| **Basis** | Ledger only, with adjustments, or final (with eliminations) |
| **Elimination** | Removing intercompany amounts when companies are combined |
| **YTD** | Year to date - 1 Jan to the end of the chosen month |
| **DSO / DPO** | Days sales outstanding / days payables outstanding |
| **RLS** | Row-level security - each user sees only their companies |`,
  },
]

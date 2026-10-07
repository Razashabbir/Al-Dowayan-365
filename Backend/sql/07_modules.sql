/* =====================================================================
   Budget vs Actual, Period Close, Consolidation, Report Pack, Alerts, Reconciliation.
   Idempotent - runs on every API start (etl/db.py ensure_schema).
   ===================================================================== */
IF SCHEMA_ID('bud') IS NULL EXEC('CREATE SCHEMA bud');
IF SCHEMA_ID('cls') IS NULL EXEC('CREATE SCHEMA cls');
IF SCHEMA_ID('cons') IS NULL EXEC('CREATE SCHEMA cons');
IF SCHEMA_ID('ops') IS NULL EXEC('CREATE SCHEMA ops');
GO

/* ---------- Budget vs Actual ---------- */
IF OBJECT_ID('bud.budget') IS NULL
CREATE TABLE bud.budget (
    budget_id   int IDENTITY PRIMARY KEY,
    tenant_key  int            NOT NULL,
    company     nvarchar(10)   NOT NULL,
    [year]      int            NOT NULL,
    name        nvarchar(100)  NOT NULL,
    source      nvarchar(200)  NULL,            -- file name or "generated from 2025 actuals +5%"
    created_by  nvarchar(60)   NULL,
    created_at  datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_budget UNIQUE (tenant_key, company, [year], name)
);
IF OBJECT_ID('bud.line') IS NULL
CREATE TABLE bud.line (
    budget_id     int            NOT NULL REFERENCES bud.budget(budget_id) ON DELETE CASCADE,
    main_account  nvarchar(40)   NOT NULL,
    [month]       tinyint        NOT NULL CHECK ([month] BETWEEN 1 AND 12),
    amount        decimal(19,2)  NOT NULL,      -- natural sign: revenue and expenses both positive
    PRIMARY KEY (budget_id, main_account, [month])
);
GO

/* ---------- Period close and lock ---------- */
IF OBJECT_ID('cls.period') IS NULL
CREATE TABLE cls.period (
    tenant_key  int            NOT NULL,
    company     nvarchar(10)   NOT NULL,
    [year]      int            NOT NULL,
    [month]     tinyint        NOT NULL,
    status      varchar(10)    NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Closed')),
    closed_by   nvarchar(60)   NULL,
    closed_at   datetime2(0)   NULL,
    reopened_by nvarchar(60)   NULL,
    reopened_at datetime2(0)   NULL,
    note        nvarchar(400)  NULL,
    PRIMARY KEY (tenant_key, company, [year], [month])
);
IF OBJECT_ID('cls.task') IS NULL
CREATE TABLE cls.task (
    task_id   int IDENTITY PRIMARY KEY,
    area      nvarchar(60)   NOT NULL,
    title     nvarchar(200)  NOT NULL,
    sort      int            NOT NULL DEFAULT 0,
    is_active bit            NOT NULL DEFAULT 1
);
IF OBJECT_ID('cls.task_done') IS NULL
CREATE TABLE cls.task_done (
    tenant_key  int            NOT NULL,
    company     nvarchar(10)   NOT NULL,
    [year]      int            NOT NULL,
    [month]     tinyint        NOT NULL,
    task_id     int            NOT NULL REFERENCES cls.task(task_id) ON DELETE CASCADE,
    done_by     nvarchar(60)   NULL,
    done_at     datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    note        nvarchar(400)  NULL,
    PRIMARY KEY (tenant_key, company, [year], [month], task_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM cls.task)
INSERT cls.task (area, title, sort) VALUES
 (N'Data', N'ETL run completed for the month and dashboards rebuilt', 10),
 (N'Data', N'D365 trial balance reconciled with the reporting database', 20),
 (N'Revenue', N'All customer invoices for the month posted in D365', 30),
 (N'Revenue', N'Unbilled revenue / contract assets reviewed', 40),
 (N'Costs', N'All vendor invoices and accruals posted', 50),
 (N'Costs', N'Prepayments amortised', 60),
 (N'Assets', N'Depreciation run posted', 70),
 (N'Cash', N'Bank reconciliations completed', 80),
 (N'Balances', N'Receivables and payables ageing reviewed', 90),
 (N'Group', N'Intercompany balances agreed with counterparties', 100),
 (N'Adjustments', N'Adjustments and eliminations for the month posted', 110),
 (N'Review', N'Income statement and financial position reviewed against budget', 120);
GO

/* ---------- Consolidation ---------- */
IF OBJECT_ID('cons.company') IS NULL
CREATE TABLE cons.company (
    tenant_key  int            NOT NULL,
    company     nvarchar(10)   NOT NULL,
    currency    char(3)        NOT NULL DEFAULT 'SAR',
    ownership   decimal(6,2)   NOT NULL DEFAULT 100,
    include     bit            NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_key, company)
);
IF OBJECT_ID('cons.fx_rate') IS NULL
CREATE TABLE cons.fx_rate (
    currency  char(3)        NOT NULL,
    [year]    int            NOT NULL,
    [month]   tinyint        NOT NULL,
    closing   decimal(19,8)  NOT NULL,      -- 1 unit of currency = x group currency, at month end
    average   decimal(19,8)  NOT NULL,      -- average of the year to that month
    PRIMARY KEY (currency, [year], [month])
);
IF OBJECT_ID('cons.ic_account') IS NULL
CREATE TABLE cons.ic_account (
    tenant_key    int            NOT NULL,
    company       nvarchar(10)   NOT NULL,
    main_account  nvarchar(40)   NOT NULL,
    counterparty  nvarchar(10)   NOT NULL,
    kind          varchar(10)    NOT NULL DEFAULT 'Balance' CHECK (kind IN ('Balance', 'PL')),
    PRIMARY KEY (tenant_key, company, main_account)
);
GO

/* ---------- Report pack, alerts, reconciliation (operations) ---------- */
IF OBJECT_ID('ops.setting') IS NULL
CREATE TABLE ops.setting (
    k           varchar(60)     NOT NULL PRIMARY KEY,
    v           nvarchar(1000)  NULL,
    updated_at  datetime2(0)    NOT NULL DEFAULT SYSUTCDATETIME()
);
IF OBJECT_ID('ops.pack_schedule') IS NULL
CREATE TABLE ops.pack_schedule (
    schedule_id   int IDENTITY PRIMARY KEY,
    name          nvarchar(100)  NOT NULL,
    enabled       bit            NOT NULL DEFAULT 1,
    tenant_key    int            NOT NULL,
    companies     nvarchar(400)  NOT NULL,         -- comma list, or * = all companies combined
    reports       varchar(40)    NOT NULL DEFAULT 'IS,BS,CF',
    basis         varchar(10)    NOT NULL DEFAULT 'final',
    day_of_month  tinyint        NOT NULL DEFAULT 5,
    send_hour     tinyint        NOT NULL DEFAULT 8,
    recipients    nvarchar(1000) NOT NULL,
    last_period   char(7)        NULL,             -- YYYY-MM last sent automatically
    last_run_at   datetime2(0)   NULL,
    last_status   nvarchar(400)  NULL,
    created_by    nvarchar(60)   NULL
);
IF OBJECT_ID('ops.pack_log') IS NULL
CREATE TABLE ops.pack_log (
    id           bigint IDENTITY PRIMARY KEY,
    schedule_id  int            NULL,
    period       char(7)        NOT NULL,
    sent_at      datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    recipients   nvarchar(1000) NULL,
    status       varchar(10)    NOT NULL,
    message      nvarchar(1000) NULL,
    sent_by      nvarchar(60)   NULL
);
IF OBJECT_ID('ops.alert') IS NULL
CREATE TABLE ops.alert (
    alert_id     bigint IDENTITY PRIMARY KEY,
    fingerprint  varchar(200)   NOT NULL UNIQUE,
    tenant_key   int            NULL,
    company      nvarchar(10)   NULL,
    kind         varchar(30)    NOT NULL,
    severity     varchar(10)    NOT NULL,          -- bad | warn | info
    title        nvarchar(300)  NOT NULL,
    detail       nvarchar(2000) NULL,
    link         varchar(100)   NULL,
    status       varchar(12)    NOT NULL DEFAULT 'Open',   -- Open | Acknowledged | Resolved
    first_at     datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    last_at      datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    ack_by       nvarchar(60)   NULL,
    ack_at       datetime2(0)   NULL,
    resolved_at  datetime2(0)   NULL
);
IF OBJECT_ID('ops.recon_run') IS NULL
CREATE TABLE ops.recon_run (
    run_id        int IDENTITY PRIMARY KEY,
    tenant_key    int            NOT NULL,
    started_at    datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    finished_at   datetime2(0)   NULL,
    status        varchar(12)    NOT NULL DEFAULT 'Running',  -- Running | OK | Differences | Failed
    summary       nvarchar(2000) NULL,
    triggered_by  nvarchar(60)   NULL
);
IF OBJECT_ID('ops.recon_line') IS NULL
CREATE TABLE ops.recon_line (
    id           bigint IDENTITY PRIMARY KEY,
    run_id       int            NOT NULL REFERENCES ops.recon_run(run_id) ON DELETE CASCADE,
    company      nvarchar(10)   NULL,
    check_name   nvarchar(120)  NOT NULL,
    d365         decimal(21,2)  NULL,
    staging      decimal(21,2)  NULL,
    reporting    decimal(21,2)  NULL,
    difference   decimal(21,2)  NULL,
    status       varchar(10)    NOT NULL,          -- OK | Diff | Info | Error
    note         nvarchar(600)  NULL
);
GO

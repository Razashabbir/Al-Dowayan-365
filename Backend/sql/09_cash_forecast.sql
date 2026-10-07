/* Cash Flow Forecast (Reports › Cash Flow Forecast): assumptions per company and the cash items users add
   (payroll, rent, loans, VAT, capex ...). Idempotent - runs on every API start (etl/db.py ensure_schema). */
IF SCHEMA_ID('cff') IS NULL EXEC('CREATE SCHEMA cff');
GO

IF OBJECT_ID('cff.setting') IS NULL
CREATE TABLE cff.setting (
    tenant_key        int            NOT NULL,
    company           nvarchar(10)   NOT NULL,
    ar_delay_days     int            NOT NULL DEFAULT 0,     -- customers pay this many days after the due date
    ap_delay_days     int            NOT NULL DEFAULT 0,     -- we pay vendors this many days after the due date
    ar_collect_pct    decimal(5,2)   NOT NULL DEFAULT 100,   -- share of receivables expected to be collected
    ar_doubtful_days  int            NOT NULL DEFAULT 90,    -- receivables overdue longer than this are left out
    overdue_weeks     tinyint        NOT NULL DEFAULT 4,     -- overdue items are spread over the first N weeks
    default_terms     int            NOT NULL DEFAULT 30,    -- due date = invoice date + N when the entity has no due date
    min_cash          decimal(19,2)  NOT NULL DEFAULT 0,     -- weeks closing below this are flagged
    updated_by        nvarchar(60)   NULL,
    updated_at        datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (tenant_key, company)
);

IF OBJECT_ID('cff.item') IS NULL
CREATE TABLE cff.item (
    item_id     int IDENTITY PRIMARY KEY,
    tenant_key  int            NOT NULL,
    company     nvarchar(10)   NOT NULL,
    name        nvarchar(100)  NOT NULL,
    category    nvarchar(40)   NOT NULL DEFAULT 'Other',
    direction   varchar(3)     NOT NULL CHECK (direction IN ('in', 'out')),
    amount      decimal(19,2)  NOT NULL CHECK (amount > 0),
    frequency   varchar(8)     NOT NULL CHECK (frequency IN ('once', 'weekly', 'monthly')),
    start_date  date           NOT NULL,                     -- first (or only) date; monthly items repeat on its day
    end_date    date           NULL,
    note        nvarchar(300)  NULL,
    created_by  nvarchar(60)   NULL,
    created_at  datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    INDEX IX_cff_item (tenant_key, company)
);
GO

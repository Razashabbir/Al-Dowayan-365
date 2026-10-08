/* Step 4: run in SQL Server Management Studio (SSMS) as an admin. Safe to re-run:
   it creates what is missing and upgrades objects made by the first version (no tenant columns). */
IF DB_ID('AlDowyanReporting') IS NULL CREATE DATABASE AlDowyanReporting;
GO
USE AlDowyanReporting;
GO
-- SIMPLE recovery: the log is reused after each committed chunk instead of growing until the disk is full
IF (SELECT recovery_model_desc FROM sys.databases WHERE database_id = DB_ID()) <> 'SIMPLE'
    ALTER DATABASE CURRENT SET RECOVERY SIMPLE;
GO
-- Readers (dashboard, ETL pages) never wait for a running sync: they read the last committed version
-- (needs a moment alone with the database; if a sync is running it is simply tried again next start)
IF (SELECT is_read_committed_snapshot_on FROM sys.databases WHERE database_id = DB_ID()) = 0
BEGIN TRY
    ALTER DATABASE CURRENT SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK AFTER 5 SECONDS;
END TRY
BEGIN CATCH
    PRINT CONCAT('READ_COMMITTED_SNAPSHOT not switched on yet: ', ERROR_MESSAGE());
END CATCH
GO
IF SCHEMA_ID('stg') IS NULL EXEC('CREATE SCHEMA stg');   -- raw copies of D365 entities (+ _tenant_key)
IF SCHEMA_ID('dw')  IS NULL EXEC('CREATE SCHEMA dw');    -- reporting tables + views (dashboard reads)
IF SCHEMA_ID('etl') IS NULL EXEC('CREATE SCHEMA etl');   -- connections, jobs, watermarks, run log
GO

/* ---------- upgrade from v1 (tables without tenant columns) ---------- */
IF OBJECT_ID('etl.watermark') IS NOT NULL AND COL_LENGTH('etl.watermark', 'tenant_key') IS NULL DROP TABLE etl.watermark;
IF OBJECT_ID('etl.run_log')   IS NOT NULL AND COL_LENGTH('etl.run_log', 'tenant_key')   IS NULL DROP TABLE etl.run_log;
IF OBJECT_ID('dw.fact_gl')    IS NOT NULL AND COL_LENGTH('dw.fact_gl', 'tenant_key')    IS NULL DROP TABLE dw.fact_gl;
IF OBJECT_ID('dw.dim_account') IS NOT NULL AND COL_LENGTH('dw.dim_account', 'tenant_key') IS NULL DROP TABLE dw.dim_account;
DECLARE @sql nvarchar(max) = N'';
SELECT @sql += N'DROP TABLE stg.' + QUOTENAME(t.name) + N';'
FROM sys.tables t WHERE t.schema_id = SCHEMA_ID('stg') AND COL_LENGTH('stg.' + QUOTENAME(t.name), '_tenant_key') IS NULL;
EXEC (@sql);   -- old stg tables are re-created and re-loaded by the next sync
GO

/* ---------- D365 connections entered on the web screen ---------- */
IF OBJECT_ID('etl.tenant') IS NULL
CREATE TABLE etl.tenant (
    tenant_key         int IDENTITY PRIMARY KEY,
    name               nvarchar(100) NOT NULL UNIQUE,      -- e.g. 'Al-Dowayan UAT'
    aad_tenant_id      nvarchar(64)  NOT NULL,             -- Directory (tenant) ID
    client_id          nvarchar(64)  NOT NULL,             -- Application (client) ID
    client_secret_enc  nvarchar(max) NOT NULL,             -- encrypted with SECRET_KEY, never returned by the API
    base_url           nvarchar(300) NOT NULL,             -- https://xxx.operations.dynamics.com
    default_company    nvarchar(10)  NULL,                 -- e.g. 03aa
    is_active          bit           NOT NULL DEFAULT 1,   -- included in scheduled syncs
    created_at         datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at         datetime2(0)  NULL,
    last_test_at       datetime2(0)  NULL,
    last_test_ok       bit           NULL,
    last_test_message  nvarchar(1000) NULL,
    last_sync_at       datetime2(0)  NULL,
    last_sync_status   varchar(10)   NULL
);

IF OBJECT_ID('etl.sync_job') IS NULL
CREATE TABLE etl.sync_job (
    job_id        int IDENTITY PRIMARY KEY,
    tenant_key    int           NOT NULL REFERENCES etl.tenant(tenant_key) ON DELETE CASCADE,
    status        varchar(10)   NOT NULL,          -- Running | OK | Partial | Failed
    full_reload   bit           NOT NULL DEFAULT 0,
    entities      nvarchar(max) NULL,              -- comma list; NULL = all in entities.yaml
    requested_by  nvarchar(100) NULL,              -- 'api' | 'scheduler'
    started_at    datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    finished_at   datetime2(0)  NULL,
    message       nvarchar(4000) NULL
);

-- Entities each connection syncs (edited on the screen: D365 Connections -> Entity catalog)
IF OBJECT_ID('etl.tenant_entity') IS NULL
CREATE TABLE etl.tenant_entity (
    tenant_key   int           NOT NULL REFERENCES etl.tenant(tenant_key) ON DELETE CASCADE,
    entity_name  nvarchar(200) NOT NULL,          -- OData entity set, e.g. CustomersV3
    table_name   nvarchar(128) NOT NULL,          -- stg.<table_name>
    mode         varchar(12)   NOT NULL DEFAULT 'full',   -- full | incremental
    date_field   nvarchar(128) NULL,              -- for incremental
    enabled      bit           NOT NULL DEFAULT 1,
    added_at     datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (tenant_key, entity_name)
);

-- All entities of an environment, read from $metadata (refreshed from the screen)
IF OBJECT_ID('etl.metadata_cache') IS NULL
CREATE TABLE etl.metadata_cache (
    tenant_key     int           NOT NULL PRIMARY KEY REFERENCES etl.tenant(tenant_key) ON DELETE CASCADE,
    entity_count   int           NOT NULL,
    entities_json  nvarchar(max) NOT NULL,
    fetched_at     datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Rows per connection per stg table (ETL > Counts page), updated after every load
IF OBJECT_ID('etl.table_stats') IS NULL
CREATE TABLE etl.table_stats (
    tenant_key        int           NOT NULL REFERENCES etl.tenant(tenant_key) ON DELETE CASCADE,
    table_name        nvarchar(128) NOT NULL,
    entity_name       nvarchar(200) NULL,
    row_count         bigint        NOT NULL,
    last_loaded_rows  bigint        NULL,
    last_loaded_at    datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (tenant_key, table_name)
);

GO
IF COL_LENGTH('etl.sync_job', 'heartbeat_at') IS NULL ALTER TABLE etl.sync_job ADD heartbeat_at datetime2(0) NULL;
IF COL_LENGTH('etl.sync_job', 'worker_pid')   IS NULL ALTER TABLE etl.sync_job ADD worker_pid int NULL;
GO

IF OBJECT_ID('etl.watermark') IS NULL
CREATE TABLE etl.watermark (
    tenant_key  int           NOT NULL,
    table_name  sysname       NOT NULL,
    last_value  varchar(50)   NULL,
    updated_at  datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (tenant_key, table_name)
);

IF OBJECT_ID('etl.run_log') IS NULL
CREATE TABLE etl.run_log (
    id           int IDENTITY PRIMARY KEY,
    job_id       int           NULL,
    tenant_key   int           NOT NULL,
    run_at       datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    entity       sysname       NOT NULL,
    rows_loaded  int           NOT NULL,
    status       varchar(10)   NOT NULL,           -- Running | OK | FAILED
    duration_sec decimal(9,1)  NULL,
    message      nvarchar(4000) NULL,
    INDEX IX_run_log_job (job_id)
);
GO
IF COL_LENGTH('etl.run_log', 'expected_rows') IS NULL
    ALTER TABLE etl.run_log ADD expected_rows int NULL;    -- rows D365 reported before the load (progress %)
GO

/* ---------- reporting tables (rebuilt by dw.usp_refresh) ---------- */
IF OBJECT_ID('dw.dim_account') IS NULL
CREATE TABLE dw.dim_account (
    tenant_key    int           NOT NULL,
    main_account  nvarchar(40)  NOT NULL,
    account_name  nvarchar(200) NULL,
    account_type  nvarchar(40)  NULL,      -- Revenue, Expense, Asset, Liability, Equity ...
    pl_group      varchar(10)   NOT NULL,  -- 'Revenue' | 'Expense' | 'BS'
    PRIMARY KEY (tenant_key, main_account)
);

IF OBJECT_ID('dw.fact_gl') IS NULL
CREATE TABLE dw.fact_gl (
    tenant_key       int           NOT NULL,
    company          nvarchar(10)  NOT NULL,
    accounting_date  date          NOT NULL,
    main_account     nvarchar(40)  NOT NULL,
    voucher          nvarchar(40)  NULL,
    amount           decimal(19,4) NOT NULL    -- accounting currency; debit +, credit -
);
GO
-- columns added for the dashboards (projects, financial dimensions, balance-sheet grouping)
IF COL_LENGTH('dw.fact_gl', 'ledger_account') IS NULL ALTER TABLE dw.fact_gl ADD ledger_account nvarchar(200) NULL;
IF COL_LENGTH('dw.fact_gl', 'dim2') IS NULL ALTER TABLE dw.fact_gl ADD dim2 nvarchar(60) NULL;
IF COL_LENGTH('dw.fact_gl', 'dim3') IS NULL ALTER TABLE dw.fact_gl ADD dim3 nvarchar(60) NULL;
IF COL_LENGTH('dw.fact_gl', 'dim4') IS NULL ALTER TABLE dw.fact_gl ADD dim4 nvarchar(60) NULL;
IF COL_LENGTH('dw.fact_gl', 'project') IS NULL ALTER TABLE dw.fact_gl ADD project nvarchar(40) NULL;
IF COL_LENGTH('dw.fact_gl', 'posting_type') IS NULL ALTER TABLE dw.fact_gl ADD posting_type nvarchar(60) NULL;
IF COL_LENGTH('dw.fact_gl', 'is_close') IS NULL ALTER TABLE dw.fact_gl ADD is_close bit NOT NULL CONSTRAINT DF_fact_gl_is_close DEFAULT 0;
IF COL_LENGTH('etl.tenant', 'report_at') IS NULL ALTER TABLE etl.tenant ADD report_at datetime2(0) NULL;
IF COL_LENGTH('etl.tenant', 'report_msg') IS NULL ALTER TABLE etl.tenant ADD report_msg nvarchar(1000) NULL;
IF COL_LENGTH('dw.dim_account', 'bs_group') IS NULL ALTER TABLE dw.dim_account ADD bs_group varchar(12) NULL;
IF COL_LENGTH('dw.dim_account', 'pl_group') IS NOT NULL
   AND (SELECT max_length FROM sys.columns WHERE object_id = OBJECT_ID('dw.dim_account') AND name = 'pl_group') < 12
    ALTER TABLE dw.dim_account ALTER COLUMN pl_group varchar(12) NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fact_gl' AND object_id = OBJECT_ID('dw.fact_gl'))
    CREATE INDEX IX_fact_gl ON dw.fact_gl (tenant_key, company, accounting_date) INCLUDE (main_account, amount);
GO

/* ---------- logins (change the passwords, put them in etl\.env and api\.env) ---------- */
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'etl_user')
    CREATE LOGIN etl_user WITH PASSWORD = 'Change_me_ETL_1!';
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'api_reader')
    CREATE LOGIN api_reader WITH PASSWORD = 'Change_me_API_1!';
GO
IF USER_ID('etl_user') IS NULL CREATE USER etl_user FOR LOGIN etl_user;
IF USER_ID('api_reader') IS NULL CREATE USER api_reader FOR LOGIN api_reader;
GRANT CONTROL ON SCHEMA::stg TO etl_user;          -- create / alter / load stg tables
GRANT CREATE TABLE TO etl_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::etl TO etl_user;
GRANT SELECT, INSERT, DELETE, EXECUTE ON SCHEMA::dw TO etl_user;
GRANT SELECT ON SCHEMA::dw TO api_reader;          -- dashboards read only reporting views
GO

/* ---------- Reports module: account -> financial-statement line mapping ---------- */
IF SCHEMA_ID('rpt') IS NULL EXEC('CREATE SCHEMA rpt');
GO
IF OBJECT_ID('rpt.fs_map') IS NULL
CREATE TABLE rpt.fs_map (
    id            int IDENTITY PRIMARY KEY,
    map_set       nvarchar(60)  NOT NULL,      -- workbook name (ADD SPF, Tazayud ...) or 'Manual'
    tenant_key    int           NULL,          -- NULL = shipped/imported mapping; set for manual changes
    main_account  nvarchar(40)  NOT NULL,
    account_name  nvarchar(200) NULL,
    fsli          nvarchar(160) NULL,          -- FSLI text from the workbook
    note_line     nvarchar(160) NULL,          -- note / sub-line shown under the statement line
    line_code     varchar(12)   NOT NULL,      -- statement line (api/fs_model.py)
    updated_at    datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    INDEX IX_fs_map_acc (main_account, map_set)
);
IF OBJECT_ID('rpt.fs_company') IS NULL
CREATE TABLE rpt.fs_company (               -- which mapping set a D365 company uses
    tenant_key  int          NOT NULL,
    company     nvarchar(20) NOT NULL,
    map_set     nvarchar(60) NOT NULL,
    PRIMARY KEY (tenant_key, company)
);
GO

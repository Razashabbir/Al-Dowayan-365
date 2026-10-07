/* =====================================================================
   Users, roles and row-level security (RLS).  Idempotent - runs on every API start.

   Roles: Admin, Accountant, Finance, Viewer.  What each role may do is in sec.role_permission
   (editable on the User Management page).  Which companies a user may see is in sec.user_company.

   Row-level security: a SQL Server SECURITY POLICY filters dw.fact_gl (the table every dashboard,
   report and the Home page read) by the signed-in user's companies.  The API puts the user id in
   SESSION_CONTEXT for each request; ETL / Rebuild run without it and therefore see every row.
   ===================================================================== */
IF SCHEMA_ID('sec') IS NULL EXEC('CREATE SCHEMA sec');
GO

IF OBJECT_ID('sec.app_user') IS NULL
CREATE TABLE sec.app_user (
    user_id         int IDENTITY PRIMARY KEY,
    username        nvarchar(60)   NOT NULL UNIQUE,
    full_name       nvarchar(120)  NULL,
    email           nvarchar(200)  NULL,
    role            varchar(20)    NOT NULL CONSTRAINT CK_app_user_role CHECK (role IN ('Admin', 'Accountant', 'Finance', 'Viewer')),
    password_hash   varchar(200)   NOT NULL,
    must_change     bit            NOT NULL DEFAULT 0,     -- ask for a new password at next sign-in
    all_companies   bit            NOT NULL DEFAULT 0,     -- 1 = every company of every tenant
    is_active       bit            NOT NULL DEFAULT 1,
    token_version   int            NOT NULL DEFAULT 1,     -- +1 signs the user out everywhere
    failed_logins   int            NOT NULL DEFAULT 0,
    locked_until    datetime2(0)   NULL,
    created_at      datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    last_login_at   datetime2(0)   NULL
);

IF OBJECT_ID('sec.user_company') IS NULL
CREATE TABLE sec.user_company (
    user_id     int           NOT NULL REFERENCES sec.app_user(user_id) ON DELETE CASCADE,
    tenant_key  int           NOT NULL,
    company     nvarchar(20)  NOT NULL,
    PRIMARY KEY (user_id, tenant_key, company)
);

IF COL_LENGTH('sec.app_user', 'all_pages') IS NULL
    ALTER TABLE sec.app_user ADD all_pages bit NOT NULL CONSTRAINT DF_app_user_all_pages DEFAULT 1;   -- 0 = only sec.user_page

IF OBJECT_ID('sec.user_page') IS NULL
CREATE TABLE sec.user_page (               -- dashboards / reports a user may open (when all_pages = 0)
    user_id   int           NOT NULL REFERENCES sec.app_user(user_id) ON DELETE CASCADE,
    page_key  varchar(60)   NOT NULL,      -- e.g. /reports/income-statement
    PRIMARY KEY (user_id, page_key)
);

IF OBJECT_ID('sec.role_permission') IS NULL
CREATE TABLE sec.role_permission (
    role        varchar(20)  NOT NULL,
    permission  varchar(40)  NOT NULL,
    allowed     bit          NOT NULL,
    PRIMARY KEY (role, permission)
);

IF OBJECT_ID('sec.audit_log') IS NULL
CREATE TABLE sec.audit_log (
    id        bigint IDENTITY PRIMARY KEY,
    at        datetime2(0)  NOT NULL DEFAULT SYSUTCDATETIME(),
    user_id   int           NULL,
    username  nvarchar(60)  NULL,
    action    varchar(40)   NOT NULL,
    detail    nvarchar(1000) NULL,
    ip        varchar(60)   NULL,
    INDEX IX_audit_at (at DESC)
);
GO

/* default permission matrix - only rows that do not exist yet (changes made on the page are kept) */
;WITH d(role, permission, allowed) AS (
    SELECT r.role, p.permission,
           CASE WHEN r.role = 'Admin' THEN 1
                WHEN r.role = 'Accountant' AND p.permission IN ('home.view','dashboards.view','reports.view','reports.export',
                     'mapping.edit','etl.view','etl.run','health.view','adjust.view','adjust.edit','adjust.post','ai.use',
                     'budget.edit','forecast.edit','close.view','close.manage','consol.view','consol.manage','alerts.view','recon.view') THEN 1
                WHEN r.role = 'Finance' AND p.permission IN ('home.view','dashboards.view','reports.view','reports.export','adjust.view','ai.use','close.view','consol.view','alerts.view') THEN 1
                WHEN r.role = 'Viewer' AND p.permission IN ('home.view','dashboards.view','reports.view','ai.use') THEN 1
                ELSE 0 END
    FROM (VALUES ('Admin'), ('Accountant'), ('Finance'), ('Viewer')) r(role)
    CROSS JOIN (VALUES ('home.view'), ('dashboards.view'), ('reports.view'), ('reports.export'), ('mapping.edit'),
                       ('etl.view'), ('etl.run'), ('tenants.manage'), ('users.manage'), ('health.view'), ('audit.view'),
                       ('adjust.view'), ('adjust.edit'), ('adjust.post'), ('config.manage'), ('ai.use'),
                       ('budget.edit'), ('close.view'), ('close.manage'), ('consol.view'), ('consol.manage'), ('pack.manage'),
                       ('alerts.view'), ('recon.view'), ('forecast.edit')) p(permission))
INSERT sec.role_permission (role, permission, allowed)
SELECT d.role, d.permission, d.allowed FROM d
WHERE NOT EXISTS (SELECT 1 FROM sec.role_permission x WHERE x.role = d.role AND x.permission = d.permission);
GO

/* ---------- row-level security on the reporting fact table ---------- */
IF OBJECT_ID('sec.fn_company_access') IS NULL
EXEC('CREATE FUNCTION sec.fn_company_access (@tenant_key int, @company nvarchar(10))
RETURNS TABLE WITH SCHEMABINDING AS RETURN
    SELECT 1 AS ok
    WHERE SESSION_CONTEXT(N''app_user'') IS NULL                       -- ETL, Rebuild reports, SSMS
       OR CAST(SESSION_CONTEXT(N''app_all'') AS int) = 1                -- user with all companies
       OR EXISTS (SELECT 1 FROM sec.user_company uc
                  WHERE uc.user_id = CAST(SESSION_CONTEXT(N''app_user'') AS int)
                    AND uc.tenant_key = @tenant_key AND uc.company = @company)');
GO
IF OBJECT_ID('dw.fact_gl') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.security_policies WHERE name = 'company_policy' AND schema_id = SCHEMA_ID('sec'))
    EXEC('CREATE SECURITY POLICY sec.company_policy
              ADD FILTER PREDICATE sec.fn_company_access(tenant_key, company) ON dw.fact_gl
              WITH (STATE = ON)');
GO

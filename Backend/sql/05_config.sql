/* =====================================================================
   System Configuration (Administration › System Configuration).  Idempotent - runs on every API start.
   One row per setting; the API checks every value before saving. Secrets (API keys) are NOT stored here -
   they stay in api\.env.
   ===================================================================== */
IF SCHEMA_ID('sec') IS NULL EXEC('CREATE SCHEMA sec');
GO
IF OBJECT_ID('sec.app_config') IS NULL
CREATE TABLE sec.app_config (
    k           varchar(60)    NOT NULL PRIMARY KEY,
    v           nvarchar(max)  NULL,
    updated_at  datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by  nvarchar(60)   NULL
);
GO

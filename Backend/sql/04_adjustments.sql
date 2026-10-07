/* =====================================================================
   Adjustments & eliminations (audit adjustments, reclassifications, consolidation eliminations).
   Posted entries are added on top of the D365 ledger in the Income Statement, Financial Position,
   Cash Flow and the Adjusted Statements worksheet.  Idempotent - runs on every API start.
   ===================================================================== */
IF SCHEMA_ID('adj') IS NULL EXEC('CREATE SCHEMA adj');
GO

IF OBJECT_ID('adj.entry') IS NULL
CREATE TABLE adj.entry (
    entry_id     int IDENTITY PRIMARY KEY,
    tenant_key   int            NOT NULL,
    entry_type   varchar(20)    NOT NULL CONSTRAINT CK_adj_entry_type
                 CHECK (entry_type IN ('Adjustment', 'Reclassification', 'Elimination')),
    entry_date   date           NOT NULL,                 -- period the entry belongs to (e.g. 2025-12-31)
    description  nvarchar(400)  NOT NULL,
    reference    nvarchar(100)  NULL,                     -- e.g. PwC AJE 3, Elim 1
    status       varchar(10)    NOT NULL DEFAULT 'Draft' CONSTRAINT CK_adj_entry_status CHECK (status IN ('Draft', 'Posted')),
    reverses_id  int            NULL,                     -- this entry reverses entry #
    created_by   nvarchar(60)   NULL,
    created_at   datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_by   nvarchar(60)   NULL,
    updated_at   datetime2(0)   NULL,
    posted_by    nvarchar(60)   NULL,
    posted_at    datetime2(0)   NULL,
    INDEX IX_adj_entry_tenant (tenant_key, status, entry_date)
);

IF OBJECT_ID('adj.line') IS NULL
CREATE TABLE adj.line (
    line_id       int IDENTITY PRIMARY KEY,
    entry_id      int            NOT NULL REFERENCES adj.entry(entry_id) ON DELETE CASCADE,
    line_no       int            NOT NULL,
    company       nvarchar(20)   NOT NULL,                -- D365 company the line belongs to
    main_account  nvarchar(40)   NULL,                    -- ledger account (mapped to its statement line) ...
    line_code     varchar(12)    NULL,                    -- ... or a statement line directly (eliminations)
    debit         decimal(19,4)  NOT NULL DEFAULT 0,
    credit        decimal(19,4)  NOT NULL DEFAULT 0,
    memo          nvarchar(200)  NULL,
    CONSTRAINT CK_adj_line_target CHECK (main_account IS NOT NULL OR line_code IS NOT NULL),
    INDEX IX_adj_line_entry (entry_id)
);
GO

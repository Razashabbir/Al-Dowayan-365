/* Reporting layer. Applied automatically when the API starts (safe to re-run in SSMS too).

   dw.usp_refresh builds dw.dim_account and dw.fact_gl from the stg tables of one tenant.
   It DETECTS the column names of the loaded D365 entities (they differ between entities such as
   GeneralJournalAccountEntries and GeneralJournalAccountEntryBiEntities), so no manual mapping is needed.
   If a required column cannot be found it raises an error that lists the columns that do exist. */
USE AlDowyanReporting;
GO

CREATE OR ALTER FUNCTION dw.fn_pick_column (@table sysname, @candidates nvarchar(1000), @want_text bit)
RETURNS sysname AS
/* First column of stg.@table whose name is in the comma list @candidates (in list order).
   @want_text = 1 -> only (n)varchar columns; 0 -> any type. */
BEGIN
    DECLARE @col sysname;
    SELECT TOP 1 @col = c.name
    FROM STRING_SPLIT(@candidates, ',', 1) s
    JOIN sys.columns c ON c.object_id = OBJECT_ID('stg.' + QUOTENAME(@table))
                     AND c.name COLLATE DATABASE_DEFAULT = LTRIM(RTRIM(s.value)) COLLATE DATABASE_DEFAULT
    WHERE @want_text = 0 OR TYPE_NAME(c.user_type_id) IN ('nvarchar', 'varchar', 'nchar', 'char')
    ORDER BY s.ordinal;
    RETURN @col;
END
GO

CREATE OR ALTER FUNCTION dw.fn_segment (@s nvarchar(400), @n int)
RETURNS nvarchar(60) AS
/* n-th part of a ledger account display value (financial dimensions):
   '110100-CC01-DEP02', 2 -> 'CC01'   and   '4111001_00000005_00000011_Aldowayan', 1 -> '4111001'.
   The separator is '_' when the value contains one (Al-Dowayan D365), otherwise '-'. */
BEGIN
    DECLARE @r nvarchar(60);
    DECLARE @d nchar(1) = IIF(CHARINDEX(N'_', @s) > 0, N'_', N'-');
    SELECT @r = NULLIF(LTRIM(RTRIM(value)), '') FROM STRING_SPLIT(@s, @d, 1) WHERE ordinal = @n;
    RETURN @r;
END
GO

CREATE OR ALTER PROCEDURE dw.usp_refresh @tenant_key int AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @sql nvarchar(max), @cols nvarchar(max), @msg nvarchar(2048);

    /* ---------- accounts (stg.main_accounts from entity MainAccounts) ---------- */
    IF OBJECT_ID('stg.main_accounts') IS NULL
        THROW 50001, 'stg.main_accounts is missing: add the entity MainAccounts to this tenant and sync.', 1;

    DECLARE @a_id sysname = dw.fn_pick_column('main_accounts', 'MainAccountId,MainAccount,AccountId', 1),
            @a_name sysname = dw.fn_pick_column('main_accounts', 'Name,AccountName,Description', 1),
            @a_type sysname = dw.fn_pick_column('main_accounts', 'MainAccountType,Type,AccountType', 0);
    IF @a_id IS NULL
    BEGIN
        SELECT @cols = STRING_AGG(CAST(name AS nvarchar(max)), ', ') FROM sys.columns WHERE object_id = OBJECT_ID('stg.main_accounts');
        SET @msg = LEFT(CONCAT('No account-number column in stg.main_accounts. Columns: ', @cols), 2048);
        THROW 50002, @msg, 1;
    END

    /* ---------- GL lines (stg.gl_entries) ---------- */
    IF OBJECT_ID('stg.gl_entries') IS NULL
        THROW 50003, 'stg.gl_entries is missing: the GL entity (e.g. GeneralJournalAccountEntryBiEntities, table gl_entries) has not loaded yet.', 1;

    DECLARE
        @g_date sysname = dw.fn_pick_column('gl_entries', 'AccountingDate,TransDate,PostingDate,TransactionDate,DocumentDate', 0),
        @g_amt  sysname = dw.fn_pick_column('gl_entries', 'AccountingCurrencyAmount,AmountMST,ReportingCurrencyAmount,Amount', 0),
        @g_co   sysname = dw.fn_pick_column('gl_entries', 'dataAreaId,DataAreaId,SubledgerVoucherDataAreaId,LegalEntity,Company,LedgerName', 1),
        @g_vou  sysname = dw.fn_pick_column('gl_entries', 'Voucher,SubledgerVoucher,JournalNumber', 1),
        -- account: a text main-account column, else the first segment of the ledger account display value
        @g_acc  sysname = dw.fn_pick_column('gl_entries', 'MainAccount,MainAccountId,MainAccountNum', 1),
        @g_led  sysname = dw.fn_pick_column('gl_entries', 'LedgerAccount,LedgerDimensionDisplayValue,LedgerDimension,AccountDisplayValue', 1),
        @g_hdr  sysname = dw.fn_pick_column('gl_entries', 'GeneralJournalEntry,GeneralJournalEntryRecId', 0),
        @g_cr   sysname = dw.fn_pick_column('gl_entries', 'IsCredit', 0),
        @g_proj sysname = dw.fn_pick_column('gl_entries', 'ProjId_SA,ProjId,ProjectId,Project', 1),
        @g_pt   sysname = dw.fn_pick_column('gl_entries', 'PostingType', 0);

    -- BI entities keep the posting date on the journal HEADER: join stg.gl_headers (GeneralJournalEntryBiEntities)
    DECLARE @h_key sysname, @h_date sysname, @h_co sysname, @h_vou sysname, @join nvarchar(400) = N'';
    IF @g_date IS NULL AND @g_hdr IS NOT NULL AND OBJECT_ID('stg.gl_headers') IS NOT NULL
    BEGIN
        SELECT @h_key = dw.fn_pick_column('gl_headers', 'SourceKey,RecId1,RecId,RECID,RecordId', 0),
               @h_date = dw.fn_pick_column('gl_headers', 'AccountingDate,TransDate,PostingDate,JournalDate', 0),
               @h_co = dw.fn_pick_column('gl_headers', 'SubledgerVoucherDataAreaId,dataAreaId,DataAreaId,LegalEntity', 1),
               @h_vou = dw.fn_pick_column('gl_headers', 'SubledgerVoucher,Voucher,JournalNumber', 1);
        IF @h_key IS NOT NULL AND @h_date IS NOT NULL
            SET @join = CONCAT(N' JOIN stg.gl_headers h ON h._tenant_key = g._tenant_key AND h.', QUOTENAME(@h_key),
                               N' = g.', QUOTENAME(@g_hdr));
    END

    DECLARE @date_expr nvarchar(300) =
        CASE WHEN @g_date IS NOT NULL THEN CONCAT('g.', QUOTENAME(@g_date))
             WHEN @join <> N'' THEN CONCAT('h.', QUOTENAME(@h_date)) END;
    DECLARE @co_expr nvarchar(300) =
        CASE WHEN @g_co IS NOT NULL THEN CONCAT('g.', QUOTENAME(@g_co))
             WHEN @join <> N'' AND @h_co IS NOT NULL THEN CONCAT('h.', QUOTENAME(@h_co))
             ELSE N'''(all)''' END;
    DECLARE @vou_expr nvarchar(300) =
        CASE WHEN @g_vou IS NOT NULL THEN CONCAT('g.', QUOTENAME(@g_vou))
             WHEN @join <> N'' AND @h_vou IS NOT NULL THEN CONCAT('h.', QUOTENAME(@h_vou)) ELSE N'NULL' END;
    DECLARE @acc_expr nvarchar(400) =
        CASE WHEN @g_acc IS NOT NULL THEN CONCAT('g.', QUOTENAME(@g_acc))
             WHEN @g_led IS NOT NULL THEN CONCAT('dw.fn_segment(g.', QUOTENAME(@g_led), ', 1)') END;
    -- amount sign: some BI entities store positive amounts + an IsCredit flag
    DECLARE @amt_expr nvarchar(400) =
        CASE WHEN @g_cr IS NOT NULL THEN CONCAT('CASE WHEN CAST(g.', QUOTENAME(@g_cr), ' AS nvarchar(10)) IN (''1'',''Yes'',''true'') ',
                                                'AND g.', QUOTENAME(@g_amt), ' > 0 THEN -g.', QUOTENAME(@g_amt), ' ELSE g.', QUOTENAME(@g_amt), ' END')
             ELSE CONCAT('g.', QUOTENAME(@g_amt)) END;

    IF @date_expr IS NULL OR @g_amt IS NULL OR @acc_expr IS NULL
    BEGIN
        SELECT @cols = STRING_AGG(CAST(name AS nvarchar(max)), ', ') FROM sys.columns WHERE object_id = OBJECT_ID('stg.gl_entries');
        SET @msg = LEFT(CONCAT('stg.gl_entries is missing ',
            IIF(@date_expr IS NULL,
                CASE WHEN @g_hdr IS NULL THEN 'a posting date (and no GeneralJournalEntry column to find its header) '
                     WHEN OBJECT_ID('stg.gl_headers') IS NULL THEN 'a posting date - the journal headers (GeneralJournalEntryBiEntities -> table gl_headers) are not loaded yet; add that entity to this tenant and sync '
                     WHEN @h_key IS NULL THEN 'a posting date - stg.gl_headers has no SourceKey/RecId column to join on '
                     ELSE 'a posting date - stg.gl_headers has no AccountingDate column ' END, ''),
            IIF(@g_amt IS NULL, 'an amount ', ''), IIF(@acc_expr IS NULL, 'a main account ', ''),
            '. Columns found: ', @cols), 2048);
        THROW 50004, @msg, 1;
    END

    BEGIN TRAN;

    DELETE dw.dim_account WHERE tenant_key = @tenant_key;
    SET @sql = CONCAT(N'
        INSERT dw.dim_account (tenant_key, main_account, account_name, account_type, pl_group, bs_group)
        SELECT @k, x.acc, MAX(x.nm), MAX(x.tp),
               MAX(CASE WHEN x.tp IN (''Revenue'', ''Operating revenue'') THEN ''Revenue''
                        WHEN x.tp IN (''Expense'', ''Cost of goods sold'', ''Operating expense'') THEN ''Expense''
                        WHEN x.tp IN (''ProfitAndLoss'', ''Profit and loss'') THEN ''PL''
                        ELSE ''BS'' END),
               MAX(CASE WHEN x.tp = ''Asset'' THEN ''Asset''
                        WHEN x.tp = ''Liability'' THEN ''Liability''
                        WHEN x.tp = ''Equity'' THEN ''Equity''
                        WHEN x.tp IN (''BalanceSheet'', ''Balance sheet'') THEN ''BS''
                        ELSE NULL END)
        FROM (SELECT CAST(a.', QUOTENAME(@a_id), N' AS nvarchar(40)) AS acc,
                     ', IIF(@a_name IS NULL, N'NULL', CONCAT(N'CAST(a.', QUOTENAME(@a_name), N' AS nvarchar(200))')), N' AS nm,
                     ', IIF(@a_type IS NULL, N'NULL', CONCAT(N'CAST(a.', QUOTENAME(@a_type), N' AS nvarchar(40))')), N' AS tp
              FROM stg.main_accounts a WHERE a._tenant_key = @k) x
        WHERE x.acc IS NOT NULL
        GROUP BY x.acc;');
    EXEC sp_executesql @sql, N'@k int', @k = @tenant_key;

    DELETE dw.fact_gl WHERE tenant_key = @tenant_key;
    SET @sql = CONCAT(N'
        INSERT dw.fact_gl (tenant_key, company, accounting_date, main_account, voucher, amount,
                           ledger_account, dim2, dim3, dim4, project, posting_type)
        SELECT @k, CAST(', @co_expr, N' AS nvarchar(10)), CAST(', @date_expr, N' AS date),
               CAST(', @acc_expr, N' AS nvarchar(40)), CAST(', @vou_expr, N' AS nvarchar(40)),
               CAST(', @amt_expr, N' AS decimal(19,4)),
               ', IIF(@g_led IS NULL, N'NULL', CONCAT(N'CAST(g.', QUOTENAME(@g_led), N' AS nvarchar(200))')), N',
               ', IIF(@g_led IS NULL, N'NULL', CONCAT(N'dw.fn_segment(g.', QUOTENAME(@g_led), N', 2)')), N',
               ', IIF(@g_led IS NULL, N'NULL', CONCAT(N'dw.fn_segment(g.', QUOTENAME(@g_led), N', 3)')), N',
               ', IIF(@g_led IS NULL, N'NULL', CONCAT(N'dw.fn_segment(g.', QUOTENAME(@g_led), N', 4)')), N',
               ', IIF(@g_proj IS NULL, N'NULL', CONCAT(N'NULLIF(CAST(g.', QUOTENAME(@g_proj), N' AS nvarchar(40)), N'''')')), N',
               ', IIF(@g_pt IS NULL, N'NULL', CONCAT(N'CAST(g.', QUOTENAME(@g_pt), N' AS nvarchar(60))')), N'
        FROM stg.gl_entries g', @join, N'
        WHERE g._tenant_key = @k AND ', @date_expr, N' IS NOT NULL;');
    EXEC sp_executesql @sql, N'@k int', @k = @tenant_key;

    /* Accounts typed only 'Profit and loss' / 'Balance sheet' in D365: classify by the side of their balance
       (credit balance = revenue / liability side, debit balance = expense / asset side). */
    WITH net AS (SELECT main_account, SUM(amount) AS net FROM dw.fact_gl WHERE tenant_key = @tenant_key GROUP BY main_account)
    UPDATE a SET   -- Aldowayan chart: 1 assets, 2 liabilities, 3 equity, 4 revenue, 5 expenses, 6 OCI; else the balance side
        pl_group = CASE WHEN a.pl_group <> 'PL' THEN a.pl_group
                        WHEN LEFT(a.main_account, 1) = '4' THEN 'Revenue' WHEN LEFT(a.main_account, 1) = '5' THEN 'Expense'
                        WHEN LEFT(a.main_account, 1) = '6' THEN 'OCI'
                        ELSE IIF(ISNULL(n.net, 0) < 0, 'Revenue', 'Expense') END,
        bs_group = CASE WHEN a.bs_group <> 'BS' THEN a.bs_group
                        WHEN LEFT(a.main_account, 1) = '1' THEN 'Asset' WHEN LEFT(a.main_account, 1) = '2' THEN 'Liability'
                        WHEN LEFT(a.main_account, 1) = '3' THEN 'Equity'
                        ELSE IIF(ISNULL(n.net, 0) < 0, 'Liability', 'Asset') END
    FROM dw.dim_account a LEFT JOIN net n ON n.main_account = a.main_account
    WHERE a.tenant_key = @tenant_key AND (a.pl_group = 'PL' OR a.bs_group = 'BS');

    /* Year-end close: D365 posts closing lines on 31 Dec and opening lines on 1 Jan (posting type
       TransferOpeningClosing). They cancel out, but would zero the income statement of a closed year,
       so both are flagged and left out of every report. Opening lines without a matching close
       (e.g. a data migration) stay in. */
    UPDATE dw.fact_gl SET is_close = 0 WHERE tenant_key = @tenant_key AND is_close = 1;
    UPDATE dw.fact_gl SET is_close = 1
    WHERE tenant_key = @tenant_key AND posting_type LIKE '%Closing%'
      AND MONTH(accounting_date) = 12 AND DAY(accounting_date) = 31;
    UPDATE f SET is_close = 1
    FROM dw.fact_gl f
    WHERE f.tenant_key = @tenant_key AND f.posting_type LIKE '%Closing%'
      AND MONTH(f.accounting_date) = 1 AND DAY(f.accounting_date) = 1
      AND EXISTS (SELECT 1 FROM dw.fact_gl c WHERE c.tenant_key = f.tenant_key AND c.company = f.company AND c.is_close = 1
                  AND YEAR(c.accounting_date) = YEAR(f.accounting_date) - 1);

    COMMIT;
END
GO

/* ---------- Views the React dashboard reads (via the API) ---------- */

-- Connections the dashboard can show (no credentials)
CREATE OR ALTER VIEW dw.vw_tenants AS
SELECT tenant_key, name, default_company, last_sync_at, last_sync_status
FROM etl.tenant WHERE is_active = 1;
GO

-- Monthly P&L per connection + company. Revenue is posted as credit (negative) so it is flipped.
CREATE OR ALTER VIEW dw.vw_pnl_monthly AS
SELECT f.tenant_key, f.company,
       YEAR(f.accounting_date)  AS [year],
       MONTH(f.accounting_date) AS [month],
       SUM(CASE WHEN a.pl_group = 'Revenue' THEN -f.amount ELSE 0 END) AS revenue,
       SUM(CASE WHEN a.pl_group = 'Expense' THEN  f.amount ELSE 0 END) AS expenses,
       SUM(CASE WHEN a.pl_group IN ('Revenue', 'Expense') THEN -f.amount ELSE 0 END) AS net_profit
FROM dw.fact_gl f
JOIN dw.dim_account a ON a.tenant_key = f.tenant_key AND a.main_account = f.main_account
WHERE f.is_close = 0
GROUP BY f.tenant_key, f.company, YEAR(f.accounting_date), MONTH(f.accounting_date);
GO

-- Amount per account per month (top expenses, trial balance)
CREATE OR ALTER VIEW dw.vw_account_monthly AS
SELECT f.tenant_key, f.company, YEAR(f.accounting_date) AS [year], MONTH(f.accounting_date) AS [month],
       f.main_account, a.account_name, a.account_type, a.pl_group,
       SUM(f.amount) AS amount
FROM dw.fact_gl f
JOIN dw.dim_account a ON a.tenant_key = f.tenant_key AND a.main_account = f.main_account
WHERE f.is_close = 0
GROUP BY f.tenant_key, f.company, YEAR(f.accounting_date), MONTH(f.accounting_date),
         f.main_account, a.account_name, a.account_type, a.pl_group;
GO

-- Data freshness for the dashboard footer
CREATE OR ALTER VIEW dw.vw_etl_status AS
SELECT tenant_key, entity, MAX(run_at) AS last_run_utc,
       MAX(CASE WHEN status = 'OK' THEN run_at END) AS last_ok_utc
FROM etl.run_log GROUP BY tenant_key, entity;
GO

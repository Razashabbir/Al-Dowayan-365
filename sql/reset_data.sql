/* Clear all data loaded from D365 so the next ETL run reloads everything from scratch.

   Run:  sqlcmd -S .\SQLEXPRESS -d AlDowyanReporting -E -i reset_data.sql

   CLEARS : every stg.* table (D365 copies), dw.fact_gl, dw.dim_account,
            ETL watermarks, row counts, job + run history.
   KEEPS  : D365 connections and chosen tables, users/roles, FS mappings, adjustments,
            budgets, close/consolidation setup, report packs, settings, bookmarks.
   Stop the API's running ETL job first - the script refuses to run while a job is Running.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF EXISTS (SELECT 1 FROM etl.sync_job WHERE status IN ('Queued', 'Running'))
BEGIN
    RAISERROR('An ETL job is still queued or running - wait for it to finish (ETL > Jobs) and run this again.', 16, 1);
    RETURN;
END;

BEGIN TRAN;

DECLARE @sql nvarchar(max) = N'';
SELECT @sql += N'DELETE FROM stg.' + QUOTENAME(t.name) + N';' + CHAR(10)
FROM sys.tables t WHERE SCHEMA_NAME(t.schema_id) = 'stg';
EXEC sp_executesql @sql;
PRINT CONCAT('stg tables cleared: ', (SELECT COUNT(*) FROM sys.tables WHERE SCHEMA_NAME(schema_id) = 'stg'));

DELETE FROM dw.fact_gl;      PRINT 'dw.fact_gl cleared';
DELETE FROM dw.dim_account;  PRINT 'dw.dim_account cleared';
DELETE FROM etl.watermark;   PRINT 'watermarks cleared';
DELETE FROM etl.table_stats; PRINT 'row counts cleared';
DELETE FROM etl.run_log;     PRINT 'run history cleared';
DELETE FROM etl.sync_job;    PRINT 'job history cleared';

COMMIT;
PRINT 'Done - now run the ETL (ETL > Jobs > Run ETL - all tables, or: python etl.py --full).';

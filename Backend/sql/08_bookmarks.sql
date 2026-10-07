/* Bookmarks: pages each user saves with the star in the top bar; listed on Home. Idempotent. */
IF OBJECT_ID('sec.bookmark') IS NULL
CREATE TABLE sec.bookmark (
    bookmark_id  int IDENTITY PRIMARY KEY,
    user_id      int            NOT NULL REFERENCES sec.app_user(user_id) ON DELETE CASCADE,
    path         varchar(100)   NOT NULL,          -- page route, e.g. /reports/income-statement
    title        nvarchar(120)  NOT NULL,
    tenant_key   int            NULL,              -- company that was selected when it was saved
    company      nvarchar(10)   NULL,
    created_at   datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    INDEX IX_bookmark_user (user_id)
);
GO

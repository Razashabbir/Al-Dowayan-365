/* =====================================================================
   AI Assistant chats: every user's saved conversations (sidebar of the AI Assistant and the Ask pop-up).
   Idempotent - runs on every API start. A user only ever sees their own chats.
   ===================================================================== */
IF SCHEMA_ID('sec') IS NULL EXEC('CREATE SCHEMA sec');
GO
IF OBJECT_ID('sec.ai_chat') IS NULL
CREATE TABLE sec.ai_chat (
    chat_id     bigint IDENTITY PRIMARY KEY,
    user_id     int            NOT NULL REFERENCES sec.app_user(user_id) ON DELETE CASCADE,
    title       nvarchar(120)  NOT NULL,
    created_at  datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at  datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    INDEX IX_ai_chat_user (user_id, updated_at DESC)
);
GO
IF OBJECT_ID('sec.ai_message') IS NULL
CREATE TABLE sec.ai_message (
    id          bigint IDENTITY PRIMARY KEY,
    chat_id     bigint         NOT NULL REFERENCES sec.ai_chat(chat_id) ON DELETE CASCADE,
    role        varchar(10)    NOT NULL CHECK (role IN ('user', 'assistant')),
    content     nvarchar(max)  NOT NULL,
    payload     nvarchar(max)  NULL,          -- JSON: sources, suggestions, chart, context
    at          datetime2(0)   NOT NULL DEFAULT SYSUTCDATETIME(),
    INDEX IX_ai_message_chat (chat_id, id)
);
GO

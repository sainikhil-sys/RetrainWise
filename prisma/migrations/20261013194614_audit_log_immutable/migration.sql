-- The application audit log is append-only: block UPDATE and DELETE.
-- (SQLite syntax. For PostgreSQL use a trigger function that raises an exception.)
CREATE TRIGGER "AuditLog_no_update" BEFORE UPDATE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'audit log entries are immutable'); END;
CREATE TRIGGER "AuditLog_no_delete" BEFORE DELETE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'audit log entries are immutable'); END;

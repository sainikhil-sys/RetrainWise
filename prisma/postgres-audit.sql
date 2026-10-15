-- PostgreSQL: the application audit log is append-only (block UPDATE and DELETE).
CREATE OR REPLACE FUNCTION rw_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit log entries are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "AuditLog_immutable" ON "AuditLog";
CREATE TRIGGER "AuditLog_immutable" BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION rw_audit_immutable();

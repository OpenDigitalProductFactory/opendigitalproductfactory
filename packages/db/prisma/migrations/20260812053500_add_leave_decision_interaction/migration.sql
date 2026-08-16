-- @migration-safety: data-safe: additive nullable audit-link column; every existing LeaveRequest remains valid with NULL and no row is rewritten.
ALTER TABLE "LeaveRequest" ADD COLUMN "decisionInteractionId" TEXT;

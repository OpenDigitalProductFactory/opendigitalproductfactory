// apps/web/lib/audit-classes.ts
// Canonical audit class values for ToolExecution and future AuditEvent model.
// These are enforced string values — do not add synonyms.
// Stored on ToolExecution.auditClass. The retention windows stated below are
// ENFORCED per class by apps/web/lib/operate/retention/policies.ts
// (BI-A55A651B); the writer in lib/governed-tool-audit.ts blanks the payload
// of metrics_only rows at write time.

export const AUDIT_CLASSES = ["ledger", "journal", "metrics_only"] as const;
export type AuditClass = (typeof AUDIT_CLASSES)[number];

/**
 * ledger      — Always retained in full. Side-effecting writes, destructive actions,
 *               approvals, credential changes, cross-boundary writes.
 * journal     — Retained for 30 days rolling. External reads, reasoning checkpoints,
 *               behavior tests.
 * metrics_only — No payload retained. Read chatter, probes, health pings, list/search.
 */

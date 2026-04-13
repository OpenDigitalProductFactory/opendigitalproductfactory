// apps/web/lib/audit-classes.ts
// Canonical audit class values for ToolExecution and future AuditEvent model.
// These are enforced string values — do not add synonyms.
// Phase 3 will add these as a DB column. Phase 1 just defines the constants.

export const AUDIT_CLASSES = ["ledger", "journal", "metrics_only"] as const;
export type AuditClass = (typeof AUDIT_CLASSES)[number];

/**
 * ledger      — Always retained in full. Side-effecting writes, destructive actions,
 *               approvals, credential changes, cross-boundary writes.
 * journal     — Retained for 30 days rolling. External reads, reasoning checkpoints,
 *               behavior tests.
 * metrics_only — No payload retained. Read chatter, probes, health pings, list/search.
 */

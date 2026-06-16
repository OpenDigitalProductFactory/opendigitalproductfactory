import * as crypto from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Change-management lifecycle state machine — single source of truth.
//
// This is a plain (non-"use server") module so it can be imported by BOTH the
// session-gated server actions (apps/web/lib/actions/change-management.ts) AND
// the background pipeline that registers changes without a web session
// (apps/web/lib/change-management/register-change.ts → the self-upgrade
// change-record mirror). The ITIL-aligned RFC lifecycle is defined once here.
// ─────────────────────────────────────────────────────────────────────────────

/** Valid forward transitions for a ChangeRequest (RFC). */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["assessed", "rejected"],
  assessed: ["approved", "rejected"],
  approved: ["scheduled", "cancelled"],
  scheduled: ["in-progress", "cancelled"],
  "in-progress": ["completed", "rolled-back"],
  completed: ["closed"],
  "rolled-back": ["closed"],
  rejected: ["closed"],
  cancelled: ["closed"],
};

/**
 * Linear "happy path" order of pre-terminal lifecycle stages. Used to stamp the
 * per-stage timestamps when a record is fast-forwarded to a given stage (a
 * standard change skips straight to `scheduled`/`in-progress` rather than being
 * driven one human step at a time).
 */
export const LINEAR_STAGES = [
  "submitted",
  "assessed",
  "approved",
  "scheduled",
  "in-progress",
  "completed",
  "closed",
] as const;

export function assertValidTransition(currentStatus: string, targetStatus: string): void {
  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(targetStatus)) {
    throw new Error(
      `Invalid transition: cannot move from "${currentStatus}" to "${targetStatus}". ` +
        `Allowed transitions from "${currentStatus}": ${allowed?.join(", ") ?? "none"}`,
    );
  }
}

/** Whether `targetStatus` is a legal forward step from `currentStatus`. */
export function isValidTransition(currentStatus: string, targetStatus: string): boolean {
  return (VALID_TRANSITIONS[currentStatus] ?? []).includes(targetStatus);
}

/** The timestamp column that records entry into a given status, if any. */
export function timestampFieldForStatus(status: string): string | null {
  const map: Record<string, string> = {
    submitted: "submittedAt",
    assessed: "assessedAt",
    approved: "approvedAt",
    scheduled: "scheduledAt",
    "in-progress": "startedAt",
    completed: "completedAt",
    closed: "closedAt",
  };
  return map[status] ?? null;
}

/**
 * Timestamp fields to stamp when CREATING a record already fast-forwarded to
 * `status`. Stamps every linear stage up to and including `status` (so a record
 * created directly at `scheduled` carries submittedAt/assessedAt/approvedAt/
 * scheduledAt). Terminal states (cancelled/rolled-back/closed) are applied by
 * `advanceChange` and are not part of the linear fast-forward.
 */
export function stampTimestampsThrough(status: string, now: Date): Record<string, Date> {
  // Only meaningful for a linear pre-terminal/terminal stage. For anything else
  // (e.g. "draft", or a terminal "rolled-back"/"cancelled" reached via
  // advanceChange) stamp nothing rather than walking the whole ladder.
  if (!(LINEAR_STAGES as readonly string[]).includes(status)) return {};
  const out: Record<string, Date> = {};
  for (const stage of LINEAR_STAGES) {
    const field = timestampFieldForStatus(stage);
    if (field) out[field] = now;
    if (stage === status) break;
  }
  return out;
}

/** Generate a human-readable RFC id: `RFC-YYYY-XXXXXXXX`. */
export function makeRfcId(now: Date = new Date()): string {
  const year = now.getFullYear();
  const hex = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `RFC-${year}-${hex}`;
}

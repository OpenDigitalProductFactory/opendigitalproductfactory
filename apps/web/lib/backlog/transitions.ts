export const BACKLOG_STATUSES = [
  "triaging",
  "open",
  "in-progress",
  "done",
  "deferred",
  "retired",
] as const;

export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

export function isBacklogStatus(value: unknown): value is BacklogStatus {
  return typeof value === "string" && (BACKLOG_STATUSES as readonly string[]).includes(value);
}

const LEGAL: Record<BacklogStatus, ReadonlySet<BacklogStatus>> = {
  triaging: new Set<BacklogStatus>(["open", "deferred", "retired"]),
  // Retriage paths: open / in-progress / deferred items can be sent back to triaging
  // when their classification (source, triageOutcome, effortSize) needs reconsideration.
  // Closes BI-7D4AF644.
  open: new Set<BacklogStatus>(["triaging", "in-progress", "done", "deferred", "retired"]),
  "in-progress": new Set<BacklogStatus>(["triaging", "open", "done", "deferred", "retired"]),
  done: new Set<BacklogStatus>(["done", "open", "triaging"]),
  deferred: new Set<BacklogStatus>(["triaging", "open", "in-progress", "retired"]),
  retired: new Set<BacklogStatus>(["retired", "open", "triaging"]),
};

export function isLegalTransition(from: BacklogStatus, to: BacklogStatus): boolean {
  if (from === to) return true;
  return LEGAL[from].has(to);
}

export function requiresAdminGrant(from: BacklogStatus, to: BacklogStatus): boolean {
  return (from === "done" || from === "retired") && to !== from;
}

export function describeTransition(from: BacklogStatus, to: BacklogStatus): string {
  if (from === to) return `no-op (${from})`;
  if (!isLegalTransition(from, to)) {
    return `illegal: ${from} → ${to}`;
  }
  return `${from} → ${to}`;
}

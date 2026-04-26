export const BACKLOG_STATUSES = [
  "triaging",
  "open",
  "in-progress",
  "done",
  "deferred",
] as const;

export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

export function isBacklogStatus(value: unknown): value is BacklogStatus {
  return typeof value === "string" && (BACKLOG_STATUSES as readonly string[]).includes(value);
}

const LEGAL: Record<BacklogStatus, ReadonlySet<BacklogStatus>> = {
  triaging: new Set<BacklogStatus>(["open", "deferred"]),
  open: new Set<BacklogStatus>(["in-progress", "done", "deferred"]),
  "in-progress": new Set<BacklogStatus>(["open", "done", "deferred"]),
  done: new Set<BacklogStatus>(["done"]),
  deferred: new Set<BacklogStatus>(["open", "in-progress"]),
};

export function isLegalTransition(from: BacklogStatus, to: BacklogStatus): boolean {
  if (from === to) return true;
  return LEGAL[from].has(to);
}

export function requiresAdminGrant(from: BacklogStatus, to: BacklogStatus): boolean {
  return from === "done" && to !== "done";
}

export function describeTransition(from: BacklogStatus, to: BacklogStatus): string {
  if (from === to) return `no-op (${from})`;
  if (!isLegalTransition(from, to)) {
    return `illegal: ${from} → ${to}`;
  }
  return `${from} → ${to}`;
}

import {
  BACKLOG_STATUS_VALUES,
  type BacklogStatus,
} from "@/lib/explore/backlog";

export const ACTIVE_BACKLOG_STATUSES = [
  "triaging",
  "open",
  "in-progress",
] as const satisfies readonly BacklogStatus[];

export const TERMINAL_BACKLOG_STATUSES = [
  "done",
  "deferred",
] as const satisfies readonly BacklogStatus[];

const terminalStatuses = new Set<string>(TERMINAL_BACKLOG_STATUSES);

// Keep the operator visibility split exhaustive when the canonical lifecycle
// registry changes. The lists remain readonly so List/Grid consumers cannot
// quietly redefine the domain lens at their call site.
if (
  ACTIVE_BACKLOG_STATUSES.length + TERMINAL_BACKLOG_STATUSES.length
  !== BACKLOG_STATUS_VALUES.length
) {
  throw new Error("Backlog visibility statuses do not cover the lifecycle registry");
}

export function isTerminalBacklogItemStatus(status: string): boolean {
  return terminalStatuses.has(status);
}

export type BacklogStatusSummary = {
  triaging: number;
  open: number;
  inProgress: number;
  done: number;
  deferred: number;
  active: number;
  terminal: number;
  total: number;
};

export function summarizeBacklogStatuses<T extends { status: string }>(
  items: readonly T[],
): BacklogStatusSummary {
  const summary: BacklogStatusSummary = {
    triaging: 0,
    open: 0,
    inProgress: 0,
    done: 0,
    deferred: 0,
    active: 0,
    terminal: 0,
    total: items.length,
  };

  for (const item of items) {
    if (item.status === "triaging") summary.triaging += 1;
    else if (item.status === "open") summary.open += 1;
    else if (item.status === "in-progress") summary.inProgress += 1;
    else if (item.status === "done") summary.done += 1;
    else if (item.status === "deferred") summary.deferred += 1;

    if (isTerminalBacklogItemStatus(item.status)) summary.terminal += 1;
    else summary.active += 1;
  }

  return summary;
}

type BacklogLifecycleInput = {
  status: string;
  triageOutcome?: string | null;
  duplicateOfId?: string | null;
};

export function backlogItemLifecycleLabel(item: BacklogLifecycleInput): string {
  if (item.status !== "deferred") return item.status;
  if (item.triageOutcome === "duplicate" || item.duplicateOfId) return "retired duplicate";
  if (item.triageOutcome === "discard") return "discarded";
  return "deferred";
}

/** Rows shown by the Operations page's default active-work lens. */
export function visibleUnderActiveOnly<T extends { status: string }>(
  items: T[],
  activeOnly: boolean,
): T[] {
  return activeOnly ? items.filter((item) => !isTerminalBacklogItemStatus(item.status)) : items;
}

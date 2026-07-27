export function isTerminalBacklogItemStatus(status: string): boolean {
  return status === "done" || status === "deferred";
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

/**
 * The subset shown while the operator asks for active work only. Terminal items
 * (done + deferred) are removed from the rows, while their distinct counts remain
 * visible in the surrounding status summary.
 */
export function visibleUnderActiveOnly<T extends { status: string }>(
  items: T[],
  activeOnly: boolean,
): T[] {
  return activeOnly ? items.filter((item) => !isTerminalBacklogItemStatus(item.status)) : items;
}

export function isTerminalBacklogItemStatus(status: string): boolean {
  return status === "done" || status === "deferred";
}

/**
 * The subset of items shown under the "hide done" toggle. When hideDone is on
 * (the default), terminal items (done + deferred) are removed so both the list
 * AND its count badges reflect only actionable, unassigned work. Routing counts
 * through the same helper as the list keeps the badge honest — otherwise a badge
 * counts rows the list itself hides (BI-7CB3C1CD: "Unassigned 1692" over a
 * ~239-row list, inflated by the deferred-PIR noise pile).
 */
export function visibleUnderHideDone<T extends { status: string }>(
  items: T[],
  hideDone: boolean,
): T[] {
  return hideDone ? items.filter((item) => !isTerminalBacklogItemStatus(item.status)) : items;
}

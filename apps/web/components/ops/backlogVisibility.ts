export function isTerminalBacklogItemStatus(status: string): boolean {
  return status === "done" || status === "deferred";
}

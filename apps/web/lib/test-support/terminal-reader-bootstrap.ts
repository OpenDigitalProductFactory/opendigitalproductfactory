import type { PersistedTerminalReaderExecution } from "../mcp-task-terminal-writer-context";

export function readerBootstrapTask(metadata: Record<string, unknown>, updatedAt: Date) {
  return {
    id: "task-internal",
    taskRunId: "TR-MCP-ZERO-READER",
    threadId: "thread-external",
    contextId: "thread-external",
    status: "input-required",
    updatedAt,
    progressPayload: {
      summary: "The required governed writer could not be dispatched.",
      terminalWriterWait: {
        schemaVersion: 1,
        kind: "missing-terminal-writer",
        writerToolName: "record_initiative_evidence",
        resumeMode: "same-taskrun", dispatchContract: "required-tool-call",
        attempt: 1,
        observedAt: "2026-08-31T02:59:00.000Z",
      },
    },
    a2aMetadata: metadata,
  };
}

export function readerBootstrapHistory(
  historyKind: string,
  baseline: PersistedTerminalReaderExecution & { parameters: Record<string, unknown> },
): PersistedTerminalReaderExecution[] {
  if (historyKind === "none") return [];
  const rows: Array<PersistedTerminalReaderExecution & { parameters: Record<string, unknown> }> =
    ["start", "1", "0", "initial", "eyJvZmZzZXQiOjB9"].map((cursor, index) => ({
      ...baseline,
      id: `rejected-reader-${index}`,
      parameters: { ...baseline.parameters, cursor },
      result: { error: "invalid_cursor" },
      success: false,
      createdAt: new Date(index + 1),
    }));
  const first = rows[0]!;
  if (historyKind === "denied") first.result = { error: "insufficient_token_scope" };
  if (historyKind === "other-failure") first.result = { error: "provider-unavailable" };
  if (historyKind === "conflicting-binding") first.parameters["version"] = "0".repeat(40);
  if (historyKind === "unauthorized-tool") first.toolName = "search_source_at_version";
  if (historyKind === "malformed-result") first.result = { error: "invalid_cursor", data: { content: "unbound" } };
  if (historyKind === "conflicting-result") first.result = { error: "invalid_cursor", data: { blobId: "0".repeat(40) } };
  if (historyKind === "duplicate-id") rows[1]!.id = first.id;
  if (historyKind === "reversed-order") rows.reverse();
  if (historyKind === "continuation") first.parameters["startLine"] = 2;
  if (historyKind === "success-conflict") first.result = { error: "invalid_cursor", success: true };
  if (historyKind === "malformed-data-array") first.result = { error: "invalid_cursor", data: [] };
  if (historyKind === "malformed-data-primitive") first.result = { error: "invalid_cursor", data: "invalid" };
  if (historyKind === "malformed-data-null") first.result = { error: "invalid_cursor", data: null };
  return rows;
}

import { describe, expect, it } from "vitest";
import { describeToolRouteFailureOutcome } from "./inference-dead-ends";
import { NativeCliExecutionUncertainError } from "../routing/cli-owned-runner";
import { projectRemoteTaskReplay } from "../mcp-task-replay-projection";

const message = "Native CLI execution on anthropic-sub did not return a settled result. Review the existing execution before retrying.";
const original = {
  taskRunId: "TR-ORIGINAL-UNCERTAIN",
  status: "input-required",
  a2aMetadata: { idempotencyKey: "original-immutable-request" },
  progressPayload: {
    terminalWriterWait: {
      schemaVersion: 1, kind: "missing-terminal-writer", writerToolName: "record_initiative_design_review",
      resumeMode: "same-taskrun", attempt: 1, observedAt: "2026-10-15T22:15:48.811Z",
    },
    executionUncertainty: { schemaVersion: 1, kind: "execution-uncertain", providerId: "anthropic-sub",
      observedAt: "2026-10-15T22:15:48.811Z", settlement: "unknown" },
  },
};

describe("native execution uncertainty is never a missing-writer retry", () => {
  it.each([1, 3])("holds original legacy evidence without an injected marker (attempt %s)", (attempt) => {
    const progressPayload = { terminalWriterWait: { ...original.progressPayload.terminalWriterWait, attempt },
      ...(attempt === 3 ? { terminalWriterEscalation: { schemaVersion: 1,
        code: "terminal_writer_retry_exhausted", writerToolName: "record_initiative_design_review",
        attempt, observedAt: "2026-10-15T23:12:03.896Z", action: "select-different-reviewer-provider" } } : {}) };
    const { result } = projectRemoteTaskReplay({ existing: { ...original, progressPayload }, requestMatches: true });
    expect(result).toMatchObject({ resumable: false, waitReason: "execution-uncertain" });
    expect(JSON.stringify(result.content)).not.toMatch(/different.*provider|resumable/);
    expect(progressPayload.terminalWriterWait.attempt).toBe(attempt);
  });
  it.each([
    new NativeCliExecutionUncertainError("anthropic-sub"),
    { name: "NativeCliExecutionUncertainError", message },
    message,
  ])("preserves a live or serialized uncertain execution instead of a configuration guess", (error) => {
    const result = describeToolRouteFailureOutcome(message, 2, error);
    expect(result.kind).toBe("execution-uncertain");
    expect(result.message).toMatch(/existing|recorded/i);
    expect(result.message).not.toMatch(/reconnect|send.*again|try again/i);
  });

  it("refuses same-task replay with writer budget remaining and retains the original evidence", () => {
    const snapshot = structuredClone(original);
    const { result } = projectRemoteTaskReplay({ existing: original, requestMatches: true });
    expect(result).toMatchObject({ taskRunId: original.taskRunId, status: "input-required",
      requiresApproval: false, resumable: false, waitReason: "execution-uncertain" });
    expect(original).toEqual(snapshot);
    expect(original.progressPayload.terminalWriterWait.attempt).toBe(1);
  });

  it("does not turn uncertainty into permission to replace an exhausted reviewer", () => {
    const existing = { ...original, progressPayload: { ...original.progressPayload,
      terminalWriterEscalation: { schemaVersion: 1, code: "terminal_writer_retry_exhausted",
        writerToolName: "record_initiative_design_review", attempt: 3,
        observedAt: "2026-10-15T23:12:03.896Z", action: "select-different-reviewer-provider" } } };
    const { result } = projectRemoteTaskReplay({ existing, requestMatches: true });
    expect(result).toMatchObject({ resumable: false, waitReason: "execution-uncertain" });
  });
});

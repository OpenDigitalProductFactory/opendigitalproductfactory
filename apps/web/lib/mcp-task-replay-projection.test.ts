import { describe, expect, it } from "vitest";
import { projectRemoteTaskReplay } from "./mcp-task-replay-projection";

const terminalWriterWait = {
  schemaVersion: 1,
  kind: "missing-terminal-writer",
  writerToolName: "record_initiative_evidence",
  resumeMode: "same-taskrun",
  attempt: 2,
  observedAt: "2026-09-05T01:00:00.000Z",
  dispatchContract: "required-tool-call",
} as const;

function project(progressPayload: Record<string, unknown>) {
  return projectRemoteTaskReplay({
    existing: {
      taskRunId: "TR-MCP-7ECDD7A53D18",
      status: "input-required",
      progressPayload,
      a2aMetadata: { requestDigest: "immutable" },
    },
    requestMatches: true,
  });
}

describe("projectRemoteTaskReplay required terminal writer dispatch", () => {
  it("preserves the actionable adapter-enforceability cause on an identical replay", () => {
    const progressPayload = {
      terminalWriterWait,
      terminalWriterDispatchFailure: {
        schemaVersion: 1,
        code: "required-terminal-writer-not-enforceable",
        writerToolName: "record_initiative_evidence",
        observedAt: "2026-09-05T01:00:00.000Z",
      },
    };

    expect(project(progressPayload)).toEqual({
      kind: "result",
      result: expect.objectContaining({
        taskRunId: "TR-MCP-7ECDD7A53D18",
        status: "input-required",
        idempotentReplay: true,
        requiresApproval: false,
        resumable: true,
        waitReason: "required-terminal-writer-not-enforceable",
        structuredContent: { error: "required-terminal-writer-not-enforceable" },
        isError: true,
        progressPayload,
      }),
    });
  });

  it("does not trust a dispatch failure whose writer differs from the bound wait", () => {
    expect(project({
      terminalWriterWait,
      terminalWriterDispatchFailure: {
        schemaVersion: 1,
        code: "required-terminal-writer-not-enforceable",
        writerToolName: "record_initiative_design_review",
        observedAt: "2026-09-05T01:00:00.000Z",
      },
    })).toMatchObject({
      kind: "result",
      result: {
        resumable: true,
        waitReason: "missing-terminal-writer",
      },
    });
  });

  it("does not let a stale dispatch failure override a later writer wait", () => {
    expect(project({
      terminalWriterWait,
      terminalWriterDispatchFailure: {
        schemaVersion: 1,
        code: "required-terminal-writer-not-enforceable",
        writerToolName: "record_initiative_evidence",
        observedAt: "2026-09-05T00:00:00.000Z",
      },
    })).toMatchObject({
      kind: "result",
      result: {
        resumable: true,
        waitReason: "missing-terminal-writer",
      },
    });
  });
});

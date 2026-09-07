import { describe, expect, it } from "vitest";

import { recoverTerminalWriterEscalation } from "./mcp-task-terminal-writer-escalation";

function legacyWait(attempt: number) {
  return {
    terminalWriterWait: {
      schemaVersion: 1,
      kind: "missing-terminal-writer",
      writerToolName: "record_initiative_evidence",
      resumeMode: "same-taskrun",
      attempt,
      observedAt: "2026-09-01T02:22:19.237Z",
    },
  };
}

describe("recoverTerminalWriterEscalation", () => {
  it("recovers an exhausted pre-marker wait without dispatching another attempt", () => {
    expect(recoverTerminalWriterEscalation(legacyWait(4))).toMatchObject({
      schemaVersion: 1,
      code: "terminal_writer_retry_exhausted",
      writerToolName: "record_initiative_evidence",
      attempt: 4,
      action: "select-different-reviewer-provider",
    });
  });

  it("keeps a pre-marker wait below the retry ceiling resumable", () => {
    expect(recoverTerminalWriterEscalation(legacyWait(2))).toBeNull();
  });

  it("BI-A57B6185 never escalates a wait that carries a writer rejection, whatever the attempt", () => {
    const wait = legacyWait(4);
    (wait.terminalWriterWait as Record<string, unknown>)["writerRejection"] = {
      schemaVersion: 1,
      error: "CANONICAL_DESIGN_AMBIGUOUS",
      message: "No live workroom records head abc123.",
      observedAt: "2026-09-06T19:07:46.000Z",
    };
    expect(recoverTerminalWriterEscalation(wait)).toBeNull();
  });
});

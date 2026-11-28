import { describe, expect, it } from "vitest";

import { INITIATIVE_CORRECTABLE_ERRORS, APPROVAL_CORRECTION_ERROR } from "./backlog/initiative-readiness/disposition-contract";
import { lastTerminalWriterRejection, recoverTerminalWriterEscalation, terminalWriterRejectionStructuredContent } from "./mcp-task-terminal-writer-escalation";

function legacyWait(attempt: number, returnedExecution = true) {
  return {
    terminalWriterWait: {
      schemaVersion: 1,
      kind: "missing-terminal-writer",
      writerToolName: "record_initiative_evidence",
      resumeMode: "same-taskrun",
      ...(returnedExecution ? { dispatchContract: "required-tool-call" } : {}),
      attempt,
      observedAt: "2026-09-01T02:22:19.237Z",
    },
  };
}

describe("recoverTerminalWriterEscalation", () => {
  it("never turns the original contractless uncertainty into authority to replace its reviewer", () => {
    expect(recoverTerminalWriterEscalation(legacyWait(3, false))).toBeNull();
    expect(recoverTerminalWriterEscalation({ ...legacyWait(3, false), terminalWriterEscalation: {
      schemaVersion: 1, code: "terminal_writer_retry_exhausted", writerToolName: "record_initiative_evidence",
      attempt: 3, action: "select-different-reviewer-provider", observedAt: "2026-09-01T02:22:19.237Z",
    } })).toBeNull();
  });
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

describe("amended approval correction", () => {
  it("does not admit the approval refusal to automatic writer correction", () => {
    expect(INITIATIVE_CORRECTABLE_ERRORS.has(APPROVAL_CORRECTION_ERROR)).toBe(false);
  });

  const writer = "record_initiative_design_review";
  const correction = { expectedCurrentBaselineId: "baseline-a", requiredStatementIds: ["AC-1", "AC-2", "AC-3", "AC-4"],
    missingStatementIds: ["AC-3", "AC-4"] };
  const record = { name: writer, result: { success: false, error: "supersession-dispositions-invalid",
    message: "Reviewer dispositions are incomplete.", data: { ...correction, privateEvidence: "do not copy" } } };

  it("retains only bounded correction facts and does not advertise a provider replay", () => {
    const rejection = lastTerminalWriterRejection(writer, [record]);
    expect(rejection).toMatchObject({ approvalCorrection: correction });
    const projected = terminalWriterRejectionStructuredContent(writer, 1, rejection!);
    expect(projected).toMatchObject({ action: "reconcile-approval-correction", approvalCorrection: correction });
    expect(JSON.stringify(projected)).not.toContain("privateEvidence");
  });

  it("does not reinterpret a malformed or unrelated writer error as an approval correction", () => {
    expect(lastTerminalWriterRejection("record_initiative_evidence", [
      { ...record, name: "record_initiative_evidence" },
    ])).not.toHaveProperty("approvalCorrection");
    expect(lastTerminalWriterRejection(writer, [{ ...record,
      result: { ...record.result, data: { ...correction, missingStatementIds: ["AC-5"] } },
    }])).not.toHaveProperty("approvalCorrection");
  });
});

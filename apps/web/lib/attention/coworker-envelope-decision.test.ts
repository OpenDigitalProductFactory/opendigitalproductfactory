import { describe, expect, it } from "vitest";

import {
  envelopeIdFromExecutionResult,
  originalToolParameters,
  summarizeCoworkerEnvelopeDecision,
} from "./coworker-envelope-decision";

const RESEARCH = {
  toolName: "record_initiative_evidence",
  reviewBinding: { gate: "research", itemId: "BI-B3584737" },
  recommenderAgentId: "AGT-WS-BUILD",
  authorizerUserId: "user-1",
};

describe("summarizeCoworkerEnvelopeDecision", () => {
  it("states a research pass with no findings as recommendation versus authorization", () => {
    const summary = summarizeCoworkerEnvelopeDecision({
      ...RESEARCH,
      proposedParameters: { decision: "pass" },
    });

    expect(summary.kind).toBe("known");
    expect(summary.headline).toBe("Authorize this research receipt?");
    expect(summary.recommendation).toBe("research passes with no findings");
    expect(summary.authorization).toBe(
      "record that receipt so implementation planning may continue",
    );
    expect(`AI recommendation: ${summary.recommendation}. Human authorization needed: ${summary.authorization}.`)
      .toBe(
        "AI recommendation: research passes with no findings. Human authorization needed: record that receipt so implementation planning may continue.",
      );
    expect(summary.authorizeDoes).toMatch(/receipt/i);
    expect(summary.declineDoes).toMatch(/does not record/i);
    expect(summary.authorizeDoes.toLowerCase()).not.toContain("approv");
    expect(summary.declineDoes.toLowerCase()).not.toContain("approv");
    expect(summary.headline.toLowerCase()).not.toContain("approv");
    expect(summary.decision).toBe("pass");
    expect(summary.findings).toEqual([]);
    expect(summary.subjectId).toBe("BI-B3584737");
    expect(summary.gate).toBe("research");
    expect(summary.recommenderLabel).toBe("Your coworker");
    expect(summary.authorizerLabel).toBe("You");
  });

  it("states a research fail and lists findings without inventing a pass", () => {
    const summary = summarizeCoworkerEnvelopeDecision({
      ...RESEARCH,
      proposedParameters: {
        decision: "fail",
        findings: [{ issue: "The defect was not reproduced on the named ref.", severity: "critical" }],
      },
    });

    expect(summary.recommendation).toBe("research does not pass with 1 finding");
    expect(summary.authorization).toMatch(/stays blocked/i);
    expect(summary.findings).toEqual([
      { issue: "The defect was not reproduced on the named ref.", severity: "critical" },
    ]);
    expect(summary.decision).toBe("fail");
  });

  it("states not-applicable without claiming the work passed", () => {
    const summary = summarizeCoworkerEnvelopeDecision({
      ...RESEARCH,
      proposedParameters: { decision: "not-applicable", reason: "This item is documentation-only." },
    });

    expect(summary.recommendation).toBe("research is not applicable");
    expect(summary.authorization).toMatch(/does not apply/i);
    expect(summary.reason).toBe("This item is documentation-only.");
    expect(summary.decision).toBe("not-applicable");
  });

  it("fails closed on an unknown tool shape and does not invent a consequence", () => {
    const summary = summarizeCoworkerEnvelopeDecision({
      toolName: "browser.click",
      proposedParameters: { selector: "#pay" },
      recommenderAgentId: "AGT-WS-BUILD",
      authorizerUserId: "user-1",
    });

    expect(summary.kind).toBe("unknown");
    expect(summary.recommendation).not.toMatch(/pass|fail|research/i);
    expect(summary.authorization).not.toMatch(/implementation planning/i);
    expect(summary.recordedIfAuthorized).toMatch(/not summarized/i);
    expect(summary.headline.toLowerCase()).not.toContain("approv");
  });

  it("does not treat a missing decision as a pass even when the gate is bound", () => {
    const summary = summarizeCoworkerEnvelopeDecision({
      ...RESEARCH,
      proposedParameters: {},
    });

    expect(summary.kind).toBe("unknown");
    expect(summary.recommendation).not.toMatch(/passes/i);
  });

  it("reads argsJson when no ToolExecution parameters exist, ignoring the approval binding", () => {
    const summary = summarizeCoworkerEnvelopeDecision({
      ...RESEARCH,
      proposedParameters: undefined,
      argsJson: { approvalBinding: { toolName: "record_initiative_evidence" }, decision: "pass" },
    });

    expect(summary.kind).toBe("known");
    expect(summary.recommendation).toBe("research passes with no findings");
  });
});

describe("originalToolParameters", () => {
  it("drops audit keys and the stored approval binding", () => {
    expect(originalToolParameters({
      decision: "pass",
      approvalBinding: { toolName: "record_initiative_evidence" },
      _surface: "mcp",
    })).toEqual({ decision: "pass" });
  });
});

describe("envelopeIdFromExecutionResult", () => {
  it("reads the pending execution's envelope id", () => {
    expect(envelopeIdFromExecutionResult({
      success: false,
      data: { envelopeId: "cmti2racd18zq01lht28321dp" },
      error: "approval_required",
    })).toBe("cmti2racd18zq01lht28321dp");
  });
});

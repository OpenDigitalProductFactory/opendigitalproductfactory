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

  it("shows the exact proposal for a tool with no specific summary, without inventing a consequence", () => {
    const summary = summarizeCoworkerEnvelopeDecision({
      toolName: "browser.click",
      proposedParameters: { selector: "#pay" },
      recommenderAgentId: "AGT-WS-BUILD",
      authorizerUserId: "user-1",
    });

    expect(summary.kind).toBe("exact");
    expect(summary.recommendation).not.toMatch(/pass|fail|research/i);
    expect(summary.authorization).not.toMatch(/implementation planning/i);
    expect(summary.proposed).toEqual([{ label: "Selector", value: "#pay" }]);
    expect(summary.consequence).toMatch(/none declared/i);
    expect(summary.headline.toLowerCase()).not.toContain("approv");
  });

  it("states the effect as unresolved when the proposal cannot be loaded (BI-12E5DD91)", () => {
    const summary = summarizeCoworkerEnvelopeDecision({
      toolName: "record_workroom_evidence",
      proposedParameters: undefined,
      argsJson: { approvalBinding: { toolName: "record_workroom_evidence" } },
      recommenderAgentId: "AGT-EXT-CODEX",
      authorizerUserId: "user-1",
    });

    expect(summary.kind).toBe("unknown");
    expect(summary.headline).toMatch(/unresolved/i);
    expect(summary.authorization).toMatch(/decline unless/i);
    expect(summary.proposed).toEqual([]);
    expect(summary.target).toMatch(/could not be loaded/i);
  });

  it("names action, target, content, consequence, reason and scope for an evidence entry (BI-12E5DD91)", () => {
    const summary = summarizeCoworkerEnvelopeDecision({
      toolName: "record_workroom_evidence",
      proposedParameters: {
        capsuleId: "WC-04ED087E",
        kind: "note",
        summary: "OAuth acceptance A; separate explicit target.",
        _surface: "mcp",
      },
      recommenderAgentId: "AGT-EXT-CODEX",
      authorizerUserId: "user-1",
      consequence: null,
      rationale: "This action is authorized to proceed only after employee approval. It changes a record, and no recorded delegation covers it.",
    });

    expect(summary.kind).toBe("exact");
    expect(summary.action).toBe("Add an evidence entry to a Workroom timeline");
    expect(summary.target).toBe("Workroom WC-04ED087E");
    expect(summary.proposed).toEqual([
      { label: "Capsule Id", value: "WC-04ED087E" },
      { label: "Kind", value: "note" },
      { label: "Summary", value: "OAuth acceptance A; separate explicit target." },
    ]);
    expect(summary.whyAPerson).toMatch(/no recorded delegation/);
    expect(summary.scope).toMatch(/does not review the content or confirm that any test/);
  });

  it("names the backlog as the destination of a new item and states an authority consequence", () => {
    const created = summarizeCoworkerEnvelopeDecision({
      toolName: "create_backlog_item",
      proposedParameters: { title: "T", epicId: "EP-0AF96937", body: "x".repeat(700) },
      recommenderAgentId: "AGT-EXT-CODEX",
      authorizerUserId: "user-1",
    });
    expect(created.target).toBe("The backlog, under epic EP-0AF96937");
    expect(created.proposed.find((f) => f.label === "Body")?.value).toMatch(/100 more characters\)$/);

    const invite = summarizeCoworkerEnvelopeDecision({
      toolName: "invite_room_participant",
      proposedParameters: { agentId: "AGT-EXT-CODEX", canAct: true },
      recommenderAgentId: "AGT-EXT-CODEX",
      authorizerUserId: "user-1",
      consequence: "authority",
    });
    expect(invite.consequence).toBe("Changes who may do what.");
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

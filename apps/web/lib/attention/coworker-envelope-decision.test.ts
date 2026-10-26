import { describe, expect, it } from "vitest";

import {
  envelopeIdFromExecutionResult,
  originalToolParameters,
  summarizeCoworkerEnvelopeDecision,
  envelopePrimaryDecision,
} from "./coworker-envelope-decision";

const RESEARCH = {
  toolName: "record_initiative_evidence",
  reviewBinding: { gate: "research", itemId: "BI-B3584737" },
  recommenderAgentId: "AGT-WS-BUILD",
  authorizerUserId: "user-1",
};

describe("primary decision disclosure", () => {
  it.each(["grant", "revoke"])("keeps the full permission-change intent visible: %s", action => {
    const decision = summarizeCoworkerEnvelopeDecision({ ...RESEARCH, toolName: "manage_coworker_tool_grant", consequence: "authority",
      proposedParameters: { coworker: "Build Lead", grantKey: "admin_write", action } });
    const primary = envelopePrimaryDecision(decision);
    expect(primary.facts).toEqual(expect.arrayContaining([
      { label: "Coworker", value: "Build Lead" }, { label: "Grant Key", value: "admin_write" }, { label: "Action", value: action },
    ]));
    expect(primary.target).not.toBe("Work name unavailable");
    expect(primary.unresolved).toBe(true);
  });

  it("keeps the target and direction of an irreversible unknown operation visible", () => {
    const decision = summarizeCoworkerEnvelopeDecision({ ...RESEARCH, toolName: "unknown_operation", consequence: "irreversible",
      proposedParameters: { path: "/reports/closing.csv", action: "delete", routingId: "internal-only" } });
    expect(envelopePrimaryDecision(decision).facts).toEqual([
      { label: "Path", value: "/reports/closing.csv" }, { label: "Action", value: "delete" },
    ]);
  });

  it.each(["record_workroom_evidence", "record_initiative_evidence", "reassign_workroom_executor"])("keeps the declared irreversible effect visible for %s", toolName => {
    const decision = summarizeCoworkerEnvelopeDecision({ ...RESEARCH, toolName, recommenderAgentId: "AGT-EXT-CODEX", consequence: "irreversible",
      proposedParameters: { capsuleId: "WC-1", summary: "Reported result", decision: "pass", toExecutorKind: "codex-desktop" } });
    expect(envelopePrimaryDecision(decision).consequence).toContain("Cannot be undone");
  });

  it("keeps a missing record proposal unresolved", () => {
    const decision = summarizeCoworkerEnvelopeDecision({ ...RESEARCH, toolName: "record_workroom_evidence", proposedParameters: undefined });
    expect(envelopePrimaryDecision(decision).unresolved).toBe(true);
  });

  it("preserves complete material values and missing recipients without exposing unrelated routing", () => {
    const recipient = "long-recipient-" + "x".repeat(800) + "@example.test";
    const decision = summarizeCoworkerEnvelopeDecision({ ...RESEARCH, toolName: "unrecognized_action", proposedParameters: {
      routingId: "internal-only", recipients: [], payment: { amount: 1250, currency: "USD", recipient },
    } });
    const primary = envelopePrimaryDecision(decision);
    expect(primary.facts.some(fact => fact.value === recipient)).toBe(true);
    expect(primary.facts.some(fact => /recipients/i.test(fact.label) && fact.value === "Not provided")).toBe(true);
    expect(primary.facts.some(fact => fact.value === "internal-only")).toBe(false);
  });

  it("does not present permission names inside a report as a permission change", () => {
    const decision = summarizeCoworkerEnvelopeDecision({ ...RESEARCH, toolName: "record_workroom_evidence", proposedParameters: {
      capsuleId: "WC-REPORT", kind: "note", summary: "Reviewed permissions", result: { permissions: ["admin_write"] },
    } });
    expect(envelopePrimaryDecision(decision).facts).toEqual([]);
    expect(JSON.parse(decision.completeProposedContent!).result.permissions).toEqual(["admin_write"]);
  });
});

describe("summarizeCoworkerEnvelopeDecision", () => {
  it("preserves the complete proposal beyond summary limits, including clearing values", () => {
    const params = {
      itemId: "BI-12E5DD91", body: "x".repeat(700), reference: null,
      emptyText: "", enabled: false,
      ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`field${i}`, { value: i }])),
    };
    const summary = summarizeCoworkerEnvelopeDecision({
      ...RESEARCH, toolName: "update_backlog_item", proposedParameters: { ...params, _surface: "mcp" },
    });
    expect(JSON.parse(summary.completeProposedContent!)).toEqual(params);
    expect(summary.proposed.find((field) => field.label === "Body")?.value).toMatch(/100 more characters/);
    expect(summary.proposed.find((field) => field.label === "Reference")?.value).toBe("null");
    expect(summary.proposed.find((field) => field.label === "Empty Text")?.value).toBe('""');
  });

  it("never invents reversibility for an unclassified action", () => {
    const summary = summarizeCoworkerEnvelopeDecision({ ...RESEARCH, toolName: "browser.click", proposedParameters: { selector: "#pay" } });
    expect(summary.consequence).not.toMatch(/can be corrected afterwards/);
    expect(summary.consequence).toMatch(/not established/i);
  });

  it("provides complete content for known receipts and leaves missing content unresolved", () => {
    const params = { decision: "pass", reason: "x".repeat(700) };
    const known = summarizeCoworkerEnvelopeDecision({ ...RESEARCH, proposedParameters: params });
    expect(known.kind).toBe("known");
    expect(JSON.parse(known.completeProposedContent!)).toEqual(params);
    const missing = summarizeCoworkerEnvelopeDecision({ ...RESEARCH, proposedParameters: undefined });
    expect(missing.completeProposedContent).toBeNull();
  });

  it("preserves the full handover manifest in the shared proposal projection", () => {
    const params = { capsuleId: "WC-1", toExecutorKind: "codex-desktop", handoffManifest: { nextAction: "Continue", evidence: "x".repeat(900) } };
    const summary = summarizeCoworkerEnvelopeDecision({ ...RESEARCH, toolName: "reassign_workroom_executor", recommenderAgentId: "AGT-EXT-CODEX", proposedParameters: params });
    expect(summary.kind).toBe("handover");
    expect(JSON.parse(summary.completeProposedContent!)).toEqual(params);
  });

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

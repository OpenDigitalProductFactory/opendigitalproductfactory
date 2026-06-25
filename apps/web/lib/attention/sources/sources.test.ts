import { describe, it, expect } from "vitest";
import { escalationToAttentionItem } from "./escalation";
import { aiDecisionToAttentionItem, type DecisionInteractionRow } from "./ai-decision";
import { pausedAiToAttentionItem, type TaskRunRow } from "./paused-ai";
import { agentProposalToAttentionItem, type AgentActionProposalRow } from "./agent-proposal";
import type { OpenEscalation } from "@/lib/quality/escalation-attention";

describe("escalationToAttentionItem", () => {
  const base: OpenEscalation = {
    reportId: "PIR-1",
    title: "Build stalled on auth",
    description: "Unresolved blocking issues\n- missing authz on the route",
    severity: "high",
    selfFixClass: "needs-human",
    status: "awaiting_escalation_ack",
    createdAt: "2026-06-23T10:00:00.000Z",
    buildId: "FB-9",
    backlogItemId: "BI-42",
    backlogItemStatus: "in-progress",
  };

  it("projects an escalation as unscorable self-fix-exhausted residue with the blocker as context", () => {
    const item = escalationToAttentionItem(base);
    expect(item.id).toBe("escalation:PIR-1");
    expect(item.source).toBe("escalation");
    expect(item.decisionClass.scorability).toBe("unscorable");
    expect(item.triage.residueReason).toBe("self-fix-exhausted");
    expect(item.riskClass).toBe("high-risk"); // severity high
    expect(item.triage.blastRadius).toBe("BI-42");
    expect(item.context).toContain("missing authz");
    expect(item.deepLink).toBe("/build?buildId=FB-9");
  });

  it("falls back to the evidence trail when no build is linked", () => {
    const item = escalationToAttentionItem({ ...base, buildId: null });
    expect(item.deepLink).toBe("/admin/issue-reports");
  });
});

describe("aiDecisionToAttentionItem", () => {
  const base: DecisionInteractionRow = {
    interactionId: "DI-1",
    question: "Should we adopt approach A or B for the migration?",
    outcomeType: "escalate",
    riskTier: "high",
    principleConflict: false,
    rationale: "Confidence below threshold for a high-risk call.",
    buildId: "FB-3",
    taskRunId: null,
    createdAt: new Date("2026-06-23T08:00:00.000Z"),
  };

  it("maps an escalated high-risk decision", () => {
    const item = aiDecisionToAttentionItem(base);
    expect(item.id).toBe("ai-decision:DI-1");
    expect(item.decisionClass.scorability).toBe("unscorable"); // residue — never a verdict
    expect(item.riskClass).toBe("high-risk");
    expect(item.triage.residueReason).toBe("high-risk-gate");
    expect(item.triage.blastRadius).toBe("build FB-3");
    expect(item.deepLink).toBe("/platform/ai/founder-review");
  });

  it("maps a principle conflict ahead of the outcome type", () => {
    expect(aiDecisionToAttentionItem({ ...base, principleConflict: true }).triage.residueReason).toBe(
      "principle-conflict",
    );
  });

  it("maps a defer to a coverage gap and medium risk to bounded-write", () => {
    const item = aiDecisionToAttentionItem({ ...base, outcomeType: "defer", riskTier: "medium" });
    expect(item.triage.residueReason).toBe("coverage-gap");
    expect(item.riskClass).toBe("bounded-write");
  });
});

describe("pausedAiToAttentionItem", () => {
  const base: TaskRunRow = {
    taskRunId: "TR-1",
    title: "Send the campaign",
    status: "input-required",
    userId: "principal-7",
    a2aMetadata: { riskClass: "high-risk" },
    progressPayload: { summary: "Ready to send to 4,000 recipients." },
    startedAt: new Date("2026-06-23T09:30:00.000Z"),
  };

  it("treats a high-risk input-required pause as irreversible (override-eligible)", () => {
    const item = pausedAiToAttentionItem(base);
    expect(item.riskClass).toBe("high-risk");
    expect(item.triage.residueReason).toBe("input-required");
    expect(item.triage.irreversible).toBe(true);
    expect(item.context).toContain("4,000 recipients");
    expect(item.audience.assigneePrincipalId).toBe("principal-7");
  });

  it("treats auth-required as a missing-credential review, not judgment or irreversible", () => {
    const item = pausedAiToAttentionItem({ ...base, status: "auth-required" });
    expect(item.triage.residueReason).toBe("needs-credential");
    expect(item.triage.decideEffort).toBe("review");
    expect(item.triage.irreversible).toBe(false);
  });

  it("defaults risk to unknown when metadata carries none", () => {
    const item = pausedAiToAttentionItem({ ...base, a2aMetadata: null, progressPayload: null });
    expect(item.riskClass).toBe("unknown");
    expect(item.context).toContain("needs your input");
  });
});

describe("agentProposalToAttentionItem", () => {
  it("projects a proposed action as policy-approval residue with a humanized title", () => {
    const row: AgentActionProposalRow = {
      proposalId: "AP-1",
      actionType: "create_invoice",
      proposedAt: new Date("2026-06-23T07:00:00.000Z"),
    };
    const item = agentProposalToAttentionItem(row);
    expect(item.id).toBe("agent-proposal:AP-1");
    expect(item.title).toBe("Approve: Create invoice");
    expect(item.triage.residueReason).toBe("policy-approval");
    expect(item.decisionClass.scorability).toBe("unscorable");
  });
});

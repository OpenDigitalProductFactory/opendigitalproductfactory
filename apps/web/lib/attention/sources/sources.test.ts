import { describe, it, expect } from "vitest";
import { escalationToAttentionItem } from "./escalation";
import {
  aiDecisionToAttentionItem,
  isAgentInternalKernelConsult,
  type DecisionInteractionRow,
} from "./ai-decision";
import { pausedAiToAttentionItem, type TaskRunRow } from "./paused-ai";
import { agentProposalToAttentionItem, type AgentActionProposalRow } from "./agent-proposal";
import { loadScheduledTaskItems, scheduledTaskToAttentionItem, type ScheduledTaskAttentionRow } from "./scheduled-task";
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
    routeContext: "/build",
    domainClass: "plan-readiness",
    gateKey: "build-studio",
    createdAt: new Date("2026-06-23T08:00:00.000Z"),
  };

  it("classifies unlinked mcp:principle_decide rows as agent-internal (BI-9026B96C)", () => {
    expect(
      isAgentInternalKernelConsult({
        buildId: null,
        taskRunId: null,
        routeContext: "mcp:principle_decide",
        domainClass: "kernel-consult",
        gateKey: null,
      }),
    ).toBe(true);
    expect(
      isAgentInternalKernelConsult({
        buildId: "FB-1",
        taskRunId: null,
        routeContext: "mcp:principle_decide",
        domainClass: "kernel-consult",
        gateKey: null,
      }),
    ).toBe(false);
    expect(
      isAgentInternalKernelConsult({
        buildId: null,
        taskRunId: null,
        routeContext: "/coworker-decisions/decisions",
        domainClass: "plan-readiness",
        gateKey: null,
      }),
    ).toBe(false);
  });

  it("maps an escalated high-risk decision", () => {
    const item = aiDecisionToAttentionItem(base);
    expect(item.id).toBe("ai-decision:DI-1");
    expect(item.decisionClass.scorability).toBe("unscorable"); // residue — never a verdict
    expect(item.riskClass).toBe("high-risk");
    expect(item.triage.residueReason).toBe("high-risk-gate");
    expect(item.triage.blastRadius).toBe("build FB-3");
    expect(item.deepLink).toBe("/platform/ai/decisions/DI-1");
    expect(item.actions[0]).toMatchObject({
      label: "Review evidence",
      href: "/platform/ai/decisions/DI-1",
    });
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
    const item = pausedAiToAttentionItem({
      ...base,
      a2aMetadata: {
        riskClass: "high-risk",
        proactivity: {
          resolvedLevel: "assertive",
          policyId: "proactivity:customer-communication:assertive",
          evidenceRefs: [{ kind: "agent", id: "marketing-coworker" }],
        },
      },
    });
    expect(item.riskClass).toBe("high-risk");
    expect(item.triage.residueReason).toBe("input-required");
    expect(item.triage.irreversible).toBe(true);
    expect(item.context).toContain("4,000 recipients");
    expect(item.audience.assigneePrincipalId).toBe("principal-7");
    expect(item.proactivity).toEqual({
      level: "assertive",
      actorId: "marketing-coworker",
      policyId: "proactivity:customer-communication:assertive",
    });
  });

  // Thirty-four of these rendered the identical body — "A coworker paused and
  // needs your input to continue" — with no way to tell them apart, while every
  // run named itself in the database (BI-79E207B9).
  it("says which run this is when the run left no summary", () => {
    const first = pausedAiToAttentionItem({
      ...base,
      taskRunId: "TR-A",
      title: "spec-approval for BI-7D2C4F02",
      progressPayload: null,
    });
    const second = pausedAiToAttentionItem({
      ...base,
      taskRunId: "TR-B",
      title: "Record the research gate for BI-2DB7254B",
      progressPayload: null,
    });

    expect(first.context).toContain("spec-approval for BI-7D2C4F02");
    expect(second.context).toContain("Record the research gate for BI-2DB7254B");
    expect(first.context).not.toEqual(second.context);
  });

  it("names the run on a credential block too", () => {
    const item = pausedAiToAttentionItem({
      ...base,
      status: "auth-required",
      title: "Summon AGT-WS-PORTFOLIO",
      progressPayload: null,
    });
    expect(item.context).toContain("Summon AGT-WS-PORTFOLIO");
    expect(item.context).toContain("credential");
  });

  it("still prefers the run's own summary when it wrote one", () => {
    expect(pausedAiToAttentionItem(base).context).toBe("Ready to send to 4,000 recipients.");
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
      parameters: {},
      proposedAt: new Date("2026-06-23T07:00:00.000Z"),
      agentId: "coo",
    };
    const item = agentProposalToAttentionItem(row);
    expect(item.id).toBe("agent-proposal:AP-1");
    expect(item.title).toBe("Approve: Create invoice");
    expect(item.triage.residueReason).toBe("policy-approval");
    expect(item.decisionClass.scorability).toBe("unscorable");
    // BI-AB12B3D3: attributed by ROLE, never a persona name.
    expect(item.author?.roleLabel).toBe("COO");
  });

  it("projects an activity-harness proposal with routing-specific context", () => {
    const item = agentProposalToAttentionItem({
      proposalId: "AP-ROUTE",
      actionType: "activity_harness_confidence_override",
      agentId: "platform-engineer",
      parameters: {
        kind: "activity-harness-confidence-override",
        activityClass: "code-edit",
        harnessRecipeKey: "glm.mixed.code-edit.provisional",
        providerId: "zai-coding",
        modelId: "glm-5.2",
        confidence: "trusted",
      },
      proposedAt: new Date("2026-06-23T07:00:00.000Z"),
    });

    expect(item.title).toBe("Approve: Tune activity routing confidence");
    expect(item.context).toBe(
      "Set code-edit / glm.mixed.code-edit.provisional on zai-coding/glm-5.2 to trusted.",
    );
    expect(item.deepLink).toBe("/platform/ai/operations-map");
  });

  it("routes a leave recommendation to the human-owned time-off decision surface", () => {
    const item = agentProposalToAttentionItem({
      proposalId: "AP-LEAVE",
      actionType: "leave.decide",
      agentId: "time-off-advisor",
      parameters: {
        requestId: "LR-1",
        recommendation: "escalate",
        rationale: "Coverage would fall below the recorded cushion.",
        guardReasons: ["Coverage needs human review."],
      },
      proposedAt: new Date("2026-08-12T07:00:00.000Z"),
    });

    expect(item.title).toBe("Review time-off recommendation");
    expect(item.context).toBe("Coverage would fall below the recorded cushion.");
    expect(item.deepLink).toBe("/employee?view=timeoff");
    expect(item.actions).toContainEqual({
      kind: "open-in-context",
      label: "Review time off",
      href: "/employee?view=timeoff",
    });
  });

  it("projects a proactivity change proposal with why-now context and a bounded review action", () => {
    const item = agentProposalToAttentionItem({
      proposalId: "AP-PROACTIVE",
      actionType: "propose_proactivity_change",
      agentId: "coo",
      parameters: {
        kind: "proactivity-change",
        agentId: "dispatcher",
        activityFamily: "field-dispatch-appointment",
        currentLevel: "balanced",
        proposedLevel: "assertive",
        scope: "activity-family",
        rationale: "Late customer appointments should be warned earlier.",
        evidenceRefs: [{ kind: "dispatch-event", id: "running-late" }],
        spendImpact: "may increase monitoring and notification spend within existing authority",
        authorityImpact: "does not grant new tools, permissions, or approval bypasses",
      },
      proposedAt: new Date("2026-06-23T07:00:00.000Z"),
    });

    expect(item.title).toBe("Review proactivity: Balanced -> Assertive");
    expect(item.context).toBe("Why now: Late customer appointments should be warned earlier.");
    expect(item.triage.blastRadius).toBe("field-dispatch-appointment");
    expect(item.actions).toContainEqual({ kind: "open-in-context", label: "Review proactivity change", href: "/platform/ai" });
    expect(item.actions).toContainEqual({ kind: "snooze", label: "Snooze" });
    expect(item.context).not.toMatch(/AP-|queue|diagnostic/i);
    expect(item.proactivity).toEqual({
      level: "balanced",
      actorId: "dispatcher",
      policyId: "proactivity:field-dispatch-appointment:balanced",
    });
  });
});

describe("scheduledTaskToAttentionItem", () => {
  const base: ScheduledTaskAttentionRow = {
    taskId: "customer-follow-up-daily",
    title: "Customer follow-up review",
    agentId: "customer-success",
    routeContext: "/customer",
    ownerUserId: "user-1",
    lastStatus: "error",
    lastError: "Provider timeout after 30 seconds",
    lastRunAt: new Date("2026-06-30T18:30:00.000Z"),
    nextRunAt: new Date("2026-07-01T18:30:00.000Z"),
    taskRunId: "TR-SCHEDULED-1",
  };

  it("projects failed proactive scheduled work as a plain-language attention item", () => {
    const item = scheduledTaskToAttentionItem({
      row: base,
      proactivity: {
        resolvedLevel: "assertive",
        policyId: "proactivity:scheduled-task:assertive",
        attentionWindowMinutes: 15,
        followUpCadenceMinutes: [15, 30],
        maxAttempts: 3,
        spendClass: "elevated",
        channelPolicy: "preferred-channel",
        escalationTarget: "attention-surface",
        actionBoundary: "propose",
        explanation: "This scheduled customer follow-up should be reviewed quickly.",
        evidenceRefs: [{ kind: "activity-family", id: "scheduled-task" }],
      },
    });

    expect(item).not.toBeNull();
    if (!item) throw new Error("Expected scheduled task attention item");
    expect(item.id).toBe("scheduled-task:customer-follow-up-daily");
    expect(item.source).toBe("scheduled-task");
    expect(item.title).toBe("Scheduled work needs review");
    expect(item.context).toBe("Customer follow-up review did not finish. This scheduled customer follow-up should be reviewed quickly.");
    expect(item.triage.residueReason).toBe("input-required");
    expect(item.triage.blastRadius).toBe("Customer follow-up review");
    expect(item.actions).toEqual([
      { kind: "open-in-context", label: "Review scheduled work", href: "/platform/schedule" },
      { kind: "snooze", label: "Snooze" },
    ]);
    expect(item.proactivity).toEqual({
      level: "assertive",
      actorId: "customer-success",
      policyId: "proactivity:scheduled-task:assertive",
    });
    expect(item.context).not.toMatch(/TR-|customer-follow-up-daily|Provider timeout|queue|diagnostic/i);
  });

  it("routes the audience by the plan's escalationTarget (BI-754C9E82)", () => {
    const planFor = (escalationTarget: "attention-surface" | "owner" | "platform-operator" | "dispatcher") => ({
      resolvedLevel: "assertive" as const,
      policyId: "proactivity:scheduled-task:assertive",
      attentionWindowMinutes: 15,
      followUpCadenceMinutes: [15, 30],
      maxAttempts: 3,
      spendClass: "elevated" as const,
      channelPolicy: "preferred-channel" as const,
      escalationTarget,
      actionBoundary: "propose" as const,
      explanation: "Escalation routing check.",
      evidenceRefs: [],
    });

    // Personal targets carry the owner as assignee.
    for (const target of ["attention-surface", "owner"] as const) {
      const item = scheduledTaskToAttentionItem({ row: base, proactivity: planFor(target) });
      expect(item?.audience).toEqual({ operator: true, assigneePrincipalId: "user-1" });
    }
    // Operator-level targets drop the personal assignee but never hide the item.
    for (const target of ["platform-operator", "dispatcher"] as const) {
      const item = scheduledTaskToAttentionItem({ row: base, proactivity: planFor(target) });
      expect(item?.audience).toEqual({ operator: true });
    }
  });

  it("does not project quiet failed scheduled work into attention", () => {
    expect(
      scheduledTaskToAttentionItem({
        row: base,
        proactivity: {
          resolvedLevel: "quiet",
          policyId: "proactivity:scheduled-task:quiet",
          attentionWindowMinutes: 120,
          followUpCadenceMinutes: [],
          maxAttempts: 1,
          spendClass: "minimal",
          channelPolicy: "in-app-only",
          escalationTarget: "attention-surface",
          actionBoundary: "advise",
          explanation: "Keep this scheduled work quiet unless asked.",
          evidenceRefs: [{ kind: "activity-family", id: "scheduled-task" }],
        },
      }),
    ).toBeNull();
  });

  it("loads the latest TaskRun proactivity metadata before projecting scheduled failures", async () => {
    const db = {
      scheduledAgentTask: {
        findMany: async () => [base],
      },
      taskRun: {
        findMany: async () => [
          {
            taskRunId: "TR-SCHEDULED-1",
            a2aMetadata: {
              proactivity: {
                resolvedLevel: "quiet",
                policyId: "proactivity:scheduled-task:quiet",
                attentionWindowMinutes: 120,
                followUpCadenceMinutes: [],
                maxAttempts: 1,
                spendClass: "minimal",
                channelPolicy: "in-app-only",
                escalationTarget: "attention-surface",
                actionBoundary: "advise",
                explanation: "The user asked this scheduled work to stay quiet unless requested.",
                evidenceRefs: [{ kind: "user-fact", id: "fact-quiet-scheduled" }],
              },
            },
          },
        ],
      },
    };

    await expect(loadScheduledTaskItems(db as never)).resolves.toEqual([]);
  });
});

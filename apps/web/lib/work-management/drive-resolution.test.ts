import { describe, expect, it } from "vitest";

import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import type { WorkShapeDefinitionContract } from "./work-shapes";
import { resolveDrivePlan, workroomDriveTaskId } from "./drive-resolution";

function participant(
  principalRef: string,
  roles: WorkroomParticipantRole[],
  extras: Partial<WorkroomParticipantView> = {},
): WorkroomParticipantView {
  return {
    principalRef,
    displayName: principalRef,
    kind: extras.kind ?? "person",
    roles,
    workState: "unknown",
    presence: "unknown",
    currentWorkSummary: null,
    enteredReason: null,
    sponsorPrincipalRef: null,
    authoritySummary: "",
    sourceRefs: [],
    assignmentSource: extras.assignmentSource ?? "explicit",
    coordinatorSource: extras.coordinatorSource ?? (roles.includes("coordinator") ? "explicit" : "none"),
    ...extras,
  };
}

const definition: WorkShapeDefinitionContract = {
  key: "obligation-assurance-watch",
  version: "1.0.0",
  triggers: ["cadence"],
  stages: [
    {
      key: "scan",
      title: "Scan",
      accountablePrincipalRef: "agent:watcher",
      advance: { kind: "status-change", condition: "scanned" },
      evidence: ["findings"],
    },
    {
      key: "review",
      title: "Review",
      accountablePrincipalRef: "person:owner",
      advance: { kind: "governed-decision", condition: "accepted", decisionScope: "wwmd" },
      evidence: ["decision"],
    },
  ],
  stopConditions: [
    { kind: "success", condition: "findings dispositioned" },
    { kind: "failure", condition: "scan failed" },
    { kind: "budget", condition: "findings-per-run exhausted" },
  ],
  grants: ["tool:read"],
  measures: [{ key: "findings-raised", description: "Findings raised this run" }],
  budgets: [{ kind: "findings-per-run", limit: 200, unit: "findings" }],
  reviewPoint: { everyDays: 7, description: "Weekly review" },
};

const executableRoster = [
  participant("PRN-COORD", ["coordinator"], { kind: "agent", coordinatorSource: "explicit" }),
  participant("PRN-OWNER", ["accountable"]),
  participant("PRN-REVIEWER", ["reviewer"]),
];

function baseInput(
  extras: Partial<Parameters<typeof resolveDrivePlan>[0]> = {},
): Parameters<typeof resolveDrivePlan>[0] {
  return {
    roomId: "WC-TEST",
    definition,
    collaborationShape: "approval-sign-off",
    postureLevel: "balanced",
    participants: executableRoster,
    currentStageKey: null,
    receipts: [],
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    substrateReachable: true,
    substrateEmpty: false,
    coordinatorHasProcessCoordinationAuthority: true,
    now: new Date("2026-09-01T00:00:00.000Z"),
    ...extras,
  };
}

describe("resolveDrivePlan (BI-FCD639D9)", () => {
  it("dispatches an agent stage when one explicit Process Overseer is present", () => {
    const plan = resolveDrivePlan(baseInput());
    expect(plan.action).toBe("dispatch_agent");
    expect(plan.agentId).toBe("watcher");
    expect(plan.stageKey).toBe("scan");
    expect(plan.taskId).toBe(workroomDriveTaskId("WC-TEST", "obligation-assurance-watch"));
    expect(plan.conformance?.disposition).toBe("continue");
    expect(plan.cycle?.trigger).toContain("obligation-assurance-watch@1.0.0");
  });

  it("keeps the task identity stable across reconcile", () => {
    expect(workroomDriveTaskId("WC-TEST", "obligation-assurance-watch")).toBe(
      workroomDriveTaskId("WC-TEST", "obligation-assurance-watch"),
    );
  });

  it("refuses dispatch with no coordinator", () => {
    const plan = resolveDrivePlan(baseInput({
      participants: [participant("PRN-OWNER", ["accountable"])],
    }));
    expect(plan.action).not.toBe("dispatch_agent");
    expect(plan.taskId).toBeNull();
    expect(plan.deviations.map((d) => d.code)).toContain("missing_explicit_coordinator");
  });

  it("refuses dispatch when only a derived coordinator exists", () => {
    const plan = resolveDrivePlan(baseInput({
      participants: [
        participant("PRN-DERIVED", ["coordinator"], {
          assignmentSource: "legacy",
          coordinatorSource: "derived",
        }),
      ],
    }));
    expect(plan.action).not.toBe("dispatch_agent");
    expect(plan.deviations.map((d) => d.code)).toContain("derived_coordinator_only");
  });

  it("refuses dispatch when multiple coordinators are present", () => {
    const plan = resolveDrivePlan(baseInput({
      participants: [
        participant("PRN-A", ["coordinator"], { kind: "agent" }),
        participant("PRN-B", ["coordinator"], { kind: "person" }),
      ],
    }));
    expect(plan.action).toBe("escalate");
    expect(plan.deviations.map((d) => d.code)).toContain("multiple_coordinators");
  });

  it("pauses when a required participant is missing", () => {
    const plan = resolveDrivePlan(baseInput({ requiredRoles: ["approver"] }));
    expect(plan.action).toBe("pause");
    expect(plan.deviations.map((d) => d.code)).toContain("missing_required_participant");
    expect(plan.taskId).toBeNull();
  });

  it("pauses on an out-of-order stage", () => {
    const three: WorkShapeDefinitionContract = {
      ...definition,
      stages: [
        definition.stages[0],
        {
          key: "raise",
          title: "Raise",
          accountablePrincipalRef: "agent:watcher",
          advance: { kind: "status-change", condition: "raised" },
          evidence: ["assurance-finding"],
        },
        definition.stages[1],
      ],
    };
    const plan = resolveDrivePlan(baseInput({
      definition: three,
      currentStageKey: "scan",
      proposedStageKey: "review",
      receipts: [{ stageKey: "scan", kind: "findings" }],
    }));
    expect(plan.action).toBe("pause");
    expect(plan.deviations.map((d) => d.code)).toContain("out_of_order_stage");
    expect(plan.taskId).toBeNull();
  });

  it("pauses when the prerequisite receipt is missing for the next stage", () => {
    const twoAgent: WorkShapeDefinitionContract = {
      ...definition,
      stages: [
        definition.stages[0],
        {
          key: "raise",
          title: "Raise",
          accountablePrincipalRef: "agent:watcher",
          advance: { kind: "status-change", condition: "raised" },
          evidence: ["assurance-finding"],
        },
      ],
    };
    const plan = resolveDrivePlan(baseInput({
      definition: twoAgent,
      currentStageKey: "scan",
      receipts: [],
    }));
    expect(plan.action).toBe("dispatch_agent");
    const withoutReceiptForNext = resolveDrivePlan(baseInput({
      definition: twoAgent,
      currentStageKey: "scan",
      receipts: [{ stageKey: "scan", kind: "findings" }],
    }));
    expect(withoutReceiptForNext.action).toBe("dispatch_agent");
    const missing = resolveDrivePlan(baseInput({
      definition: twoAgent,
      currentStageKey: "raise",
      receipts: [],
    }));
    expect(missing.action).toBe("pause");
    expect(missing.deviations.map((d) => d.code)).toContain("missing_prerequisite_receipt");
  });

  it("stops on an exhausted budget and keeps the budget on the ledger", () => {
    const plan = resolveDrivePlan(baseInput({
      budgetUsage: [{ kind: "findings-per-run", used: 200 }],
    }));
    expect(plan.action).toBe("stop");
    expect(plan.deviations.map((d) => d.code)).toContain("budget_exhausted");
    expect(plan.ledger.join(" ")).toMatch(/findings-per-run/);
    expect(plan.ledger.join(" ")).not.toMatch(/buried/i);
  });

  it("pauses when a review point is due", () => {
    const plan = resolveDrivePlan(baseInput({ reviewDue: true }));
    expect(plan.action).toBe("pause");
    expect(plan.deviations.map((d) => d.code)).toContain("review_due");
  });

  it("stops when a declared stop condition is hit", () => {
    const plan = resolveDrivePlan(baseInput({ stopConditionHits: ["failure: scan failed"] }));
    expect(plan.action).toBe("stop");
    expect(plan.deviations.map((d) => d.code)).toContain("stop_condition_met");
  });

  it("turns a role: stage into attention and never dispatches it", () => {
    const roleFirst: WorkShapeDefinitionContract = {
      ...definition,
      stages: [
        {
          key: "decide",
          title: "Decide",
          accountablePrincipalRef: "role:compliance-owner",
          advance: { kind: "status-change", condition: "decided" },
          evidence: ["decision-record"],
        },
      ],
    };
    const plan = resolveDrivePlan(baseInput({ definition: roleFirst }));
    expect(plan.action).toBe("attention");
    expect(plan.reason).toBe("role_stage");
    expect(plan.taskId).toBeNull();
    expect(plan.agentId).toBeNull();
    expect(plan.attentionPrincipalRef).toBe("role:compliance-owner");
  });

  it("turns a person: stage into attention and never dispatches it", () => {
    const plan = resolveDrivePlan(baseInput({
      currentStageKey: "scan",
      receipts: [{ stageKey: "scan", kind: "findings" }],
    }));
    expect(plan.action).toBe("attention");
    expect(plan.reason).toBe("governed_decision");
    expect(plan.taskId).toBeNull();
    expect(plan.attentionPrincipalRef).toBe("person:owner");
  });

  it("never executes a governed-decision advance even when the principal is an agent", () => {
    const governedAgent: WorkShapeDefinitionContract = {
      ...definition,
      stages: [
        {
          key: "decide",
          title: "Decide",
          accountablePrincipalRef: "agent:watcher",
          advance: { kind: "governed-decision", condition: "sealed", decisionScope: "wwmd" },
          evidence: ["decision-record"],
        },
      ],
    };
    const plan = resolveDrivePlan(baseInput({
      definition: governedAgent,
      postureLevel: "assertive",
    }));
    expect(plan.action).toBe("attention");
    expect(plan.reason).toBe("governed_decision");
    expect(plan.taskId).toBeNull();
    expect(plan.agentId).toBeNull();
  });

  it("does not wake a quiet room", () => {
    const plan = resolveDrivePlan(baseInput({ postureLevel: "quiet" }));
    expect(plan.action).toBe("do_not_wake");
    expect(plan.reason).toBe("quiet");
    expect(plan.taskId).toBeNull();
    expect(plan.conformance).toBeNull();
  });

  it("stops and reports an unreachable substrate without raising work", () => {
    const plan = resolveDrivePlan(baseInput({ substrateReachable: false }));
    expect(plan.action).toBe("stop");
    expect(plan.reason).toBe("unreachable_substrate");
    expect(plan.taskId).toBeNull();
    expect(plan.ledger.join(" ")).toMatch(/raised nothing/i);
  });

  it("stops an empty read without fabricating findings", () => {
    const plan = resolveDrivePlan(baseInput({ substrateEmpty: true }));
    expect(plan.action).toBe("stop");
    expect(plan.reason).toBe("empty_read");
    expect(plan.taskId).toBeNull();
    expect(plan.ledger.join(" ")).toMatch(/raised nothing/i);
  });
});

import { describe, expect, it } from "vitest";

import { deriveRoomCoordinator } from "./room-coordinator";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import type { WorkShapeDefinitionContract } from "./work-shapes";
import {
  evaluateWorkroomLifecycleConformance,
  evaluateWorkroomShapeConformance,
  projectUnshapedWorkroomConformance,
} from "./workroom-shape-conformance";

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
    { key: "scan", title: "Scan", accountablePrincipalRef: "agent:watcher", advance: { kind: "status-change", condition: "scanned" }, evidence: ["findings"] },
    { key: "review", title: "Review", accountablePrincipalRef: "person:owner", advance: { kind: "governed-decision", condition: "accepted", decisionScope: "wwmd" }, evidence: ["decision"] },
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
  participant("PRN-COORD", ["coordinator"], { kind: "person", coordinatorSource: "explicit" }),
  participant("PRN-OWNER", ["accountable"]),
  participant("PRN-REVIEWER", ["reviewer"]),
];

describe("evaluateWorkroomShapeConformance (BI-3913EB49)", () => {
  it("continues when one explicit Process Overseer is present and the stage is in order", () => {
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: "craft-stewardship",
      participants: executableRoster,
      currentStageKey: "scan",
      proposedStageKey: "review",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [{ kind: "findings-per-run", used: 3 }],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
    });
    expect(result.disposition).toBe("continue");
    expect(result.processOverseerSource).toBe("explicit");
    expect(result.processOverseerPrincipalRef).toBe("PRN-COORD");
    expect(result.deviations).toEqual([]);
    expect(result.shapeKey).toBe("obligation-assurance-watch");
    expect(result.shapeVersion).toBe("1.0.0");
  });

  it("refuses executable rooms with no coordinator", () => {
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: [participant("PRN-OWNER", ["accountable"])],
      currentStageKey: null,
      proposedStageKey: "scan",
      receipts: [],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
    });
    expect(result.deviations.map((row) => row.code)).toContain("missing_explicit_coordinator");
    expect(result.processOverseerSource).toBe("none");
    expect(result.disposition).toBe("pause");
  });

  it("refuses a derived-only coordinator", () => {
    const derived = deriveRoomCoordinator([
      participant("PRN-OWNER", ["accountable"], { assignmentSource: "legacy", coordinatorSource: "none" }),
    ]);
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: derived,
      currentStageKey: null,
      proposedStageKey: "scan",
      receipts: [],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
    });
    expect(result.processOverseerSource).toBe("derived");
    expect(result.deviations.map((row) => row.code)).toEqual(["derived_coordinator_only"]);
    expect(result.disposition).toBe("pause");
  });

  it("escalates when more than one coordinator is named", () => {
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: [
        participant("PRN-A", ["coordinator"]),
        participant("PRN-B", ["coordinator"]),
      ],
      currentStageKey: null,
      proposedStageKey: "scan",
      receipts: [],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
    });
    expect(result.deviations.map((row) => row.code)).toEqual(["multiple_coordinators"]);
    expect(result.disposition).toBe("escalate");
  });

  it("escalates when the overseer lacks process-coordination authority", () => {
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: "scan",
      proposedStageKey: "review",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: false,
    });
    expect(result.deviations.map((row) => row.code)).toContain("coordinator_lacks_authority");
    expect(result.disposition).toBe("escalate");
  });

  it("records missing required participants, skipped stages, and missing receipts", () => {
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: null,
      proposedStageKey: "review",
      receipts: [],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      requiredRoles: ["approver"],
      coordinatorHasProcessCoordinationAuthority: true,
    });
    expect(result.deviations.map((row) => row.code)).toEqual(
      expect.arrayContaining([
        "missing_required_participant",
        "missing_prerequisite_receipt",
      ]),
    );
    expect(result.disposition).toBe("pause");
  });

  it("refuses a backward stage transition even when receipts exist", () => {
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: "review",
      proposedStageKey: "scan",
      receipts: [
        { stageKey: "scan", kind: "findings" },
        { stageKey: "review", kind: "decision" },
      ],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
    });
    expect(result.deviations.map((row) => row.code)).toContain("out_of_order_stage");
    expect(result.disposition).toBe("pause");
  });

  it("refuses a transition from an unknown non-null current stage", () => {
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: "unknown-stage",
      proposedStageKey: "scan",
      receipts: [],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
    });
    expect(result.deviations.map((row) => row.code)).toContain("out_of_order_stage");
    expect(result.disposition).toBe("pause");
  });

  it("allows an initial transition only to the first declared stage", () => {
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: null,
      proposedStageKey: "review",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
    });
    expect(result.deviations.map((row) => row.code)).toContain("out_of_order_stage");
    expect(result.disposition).toBe("pause");
  });

  it("allows same-stage replay only until that stage records a receipt", () => {
    const replay = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: "scan",
      proposedStageKey: "scan",
      receipts: [],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
    });
    expect(replay.deviations).toEqual([]);
    expect(replay.disposition).toBe("continue");

    const completed = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: "scan",
      proposedStageKey: "scan",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
    });
    expect(completed.deviations.map((row) => row.code)).toContain("out_of_order_stage");
    expect(completed.disposition).toBe("pause");
  });

  it("stops on exhausted budget or a hit stop condition", () => {
    const budget = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: "scan",
      proposedStageKey: "review",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [{ kind: "findings-per-run", used: 200 }],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
    });
    expect(budget.deviations.map((row) => row.code)).toContain("budget_exhausted");
    expect(budget.disposition).toBe("stop");

    const stopped = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: "scan",
      proposedStageKey: "review",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [],
      stopConditionHits: ["failure"],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
    });
    expect(stopped.deviations.map((row) => row.code)).toContain("stop_condition_met");
    expect(stopped.disposition).toBe("stop");
  });

  it("pauses when the review point is due and refuses authority widening", () => {
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: "scan",
      proposedStageKey: "review",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: true,
      proposedGrants: ["tool:read", "tool:write"],
      coordinatorHasProcessCoordinationAuthority: true,
    });
    expect(result.deviations.map((row) => row.code)).toEqual(
      expect.arrayContaining(["review_due", "authority_widening"]),
    );
    expect(result.disposition).toBe("escalate");
  });

  it("escalates coordinator overlap with an independent evaluator or approver", () => {
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: "scan",
      proposedStageKey: "review",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
      independentEvaluatorPrincipalRef: "PRN-COORD",
      independentApproverPrincipalRef: "PRN-COORD",
    });
    expect(result.deviations.map((row) => row.code)).toEqual(
      expect.arrayContaining(["coordinator_evaluator_overlap", "coordinator_approver_overlap"]),
    );
    expect(result.disposition).toBe("escalate");
  });

  it("refuses close while a deviation is unresolved", () => {
    const result = evaluateWorkroomShapeConformance({
      definition,
      collaborationShape: null,
      participants: executableRoster,
      currentStageKey: "review",
      proposedStageKey: null,
      receipts: [{ stageKey: "scan", kind: "findings" }, { stageKey: "review", kind: "decision" }],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
      closing: true,
      unresolvedDeviationCount: 1,
    });
    expect(result.deviations.map((row) => row.code)).toContain("unresolved_deviation_on_close");
    expect(result.disposition).toBe("stop");
  });

  it("is idempotent: the same observation yields one disposition", () => {
    const input = {
      definition,
      collaborationShape: "craft-stewardship" as const,
      participants: executableRoster,
      currentStageKey: "scan",
      proposedStageKey: "review",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [{ kind: "findings-per-run", used: 1 }],
      stopConditionHits: [] as string[],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
    };
    expect(evaluateWorkroomShapeConformance(input)).toEqual(evaluateWorkroomShapeConformance(input));
  });

  it("returns stable reconciliation metadata without including the check instant", () => {
    const common = {
      roomKey: "scheduled:ROOM-1",
      definition,
      collaborationShape: "craft-stewardship" as const,
      participants: executableRoster,
      currentStageKey: "scan",
      proposedStageKey: "review",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [{ kind: "findings-per-run", used: 1 }],
      stopConditionHits: [] as string[],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
    };
    const first = evaluateWorkroomShapeConformance({
      ...common,
      checkedAt: "2026-09-01T12:00:00.000Z",
    });
    const second = evaluateWorkroomShapeConformance({
      ...common,
      checkedAt: "2026-09-01T12:05:00.000Z",
    });

    expect(first.checkedAt).toBe("2026-09-01T12:00:00.000Z");
    expect(second.checkedAt).toBe("2026-09-01T12:05:00.000Z");
    expect(second.reconciliationKey).toBe(first.reconciliationKey);
    expect(first.interventionReason).toBeNull();
    expect(first.observed).toMatchObject({ participantCount: 3, receiptKinds: ["findings"] });
  });

  it("fails closed when an AI coordinator lacks current JSI or TAK eligibility", () => {
    const result = evaluateWorkroomShapeConformance({
      roomKey: "scheduled:ROOM-2",
      definition,
      collaborationShape: "craft-stewardship",
      participants: executableRoster.map((row) => row.principalRef === "PRN-COORD"
        ? { ...row, kind: "agent" as const }
        : row),
      currentStageKey: "scan",
      proposedStageKey: "review",
      receipts: [{ stageKey: "scan", kind: "findings" }],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
      coordinatorEligibility: {
        jsi: "stale",
        authorityBinding: "unknown",
      },
    });

    expect(result.deviations.map((row) => row.code)).toEqual([
      "coordinator_authority_binding_ineligible",
      "coordinator_jsi_ineligible",
    ]);
    expect(result.disposition).toBe("escalate");
    expect(result.interventionReason).toContain("authority binding");
  });

  it("completes only a conformant explicit close", () => {
    const result = evaluateWorkroomShapeConformance({
      roomKey: "scheduled:ROOM-3",
      definition,
      collaborationShape: "craft-stewardship",
      participants: executableRoster.map((row) => row.principalRef === "PRN-COORD"
        ? { ...row, kind: "person" as const }
        : row),
      currentStageKey: "review",
      proposedStageKey: null,
      receipts: [
        { stageKey: "scan", kind: "findings" },
        { stageKey: "review", kind: "decision" },
      ],
      budgetUsage: [],
      stopConditionHits: [],
      reviewDue: false,
      coordinatorHasProcessCoordinationAuthority: true,
      closing: true,
      unresolvedDeviationCount: 0,
    });

    expect(result.disposition).toBe("complete");
    expect(evaluateWorkroomLifecycleConformance({
      operation: "complete-cycle",
      hasDeclaredWorkShape: true,
      conformance: result,
    })).toMatchObject({ allowed: true, disposition: "complete" });
  });
});

describe("Workroom lifecycle conformance guard", () => {
  it("preserves unshaped legacy behavior and explains that conformance is not applicable", () => {
    const conformance = projectUnshapedWorkroomConformance({
      roomKey: "booking:BK-1",
      collaborationShape: null,
      participants: [],
      checkedAt: "2026-09-01T12:00:00.000Z",
    });
    expect(conformance.disposition).toBe("not-applicable");
    expect(evaluateWorkroomLifecycleConformance({
      operation: "open-cycle",
      hasDeclaredWorkShape: false,
      conformance,
    })).toMatchObject({ allowed: true, disposition: "not-applicable" });
  });

  it("refuses a shaped lifecycle operation when its projection is missing", () => {
    expect(evaluateWorkroomLifecycleConformance({
      operation: "open-cycle",
      hasDeclaredWorkShape: true,
      conformance: null,
    })).toMatchObject({
      allowed: false,
      disposition: "pause",
      deviationCodes: ["missing_conformance_result"],
      receipt: {
        kind: "work-room-conformance-receipt",
        operation: "open-cycle",
      },
    });
  });
});

import { describe, expect, it } from "vitest";
import { FLOW_TWIN, PARALLEL_FIXTURE } from "./__fixtures__/graph-shape-fixtures";
import { resolveDrivePlan, workroomDriveTaskId, type DriveResolutionInput } from "./drive-resolution";
import { readWorkShapeDefinitionContract, type WorkShapeDefinition } from "./work-shapes";

const NOW = new Date("2026-09-01T06:00:00.000Z");
function input(shape: WorkShapeDefinition): DriveResolutionInput {
  return {
    roomId: "WC-GRAPH", definition: readWorkShapeDefinitionContract(shape), collaborationShape: null,
    postureLevel: "balanced", participants: [{ principalRef: "PRN-COORD", displayName: "Coordinator", kind: "agent",
      roles: ["coordinator"], workState: "unknown", presence: "unknown", currentWorkSummary: null, enteredReason: null,
      sponsorPrincipalRef: null, authoritySummary: "", sourceRefs: [], assignmentSource: "explicit", coordinatorSource: "explicit" }],
    currentStageKey: null, receipts: [], budgetUsage: [], stopConditionHits: [], reviewDue: false,
    substrateReachable: true, substrateEmpty: false, coordinatorHasProcessCoordinationAuthority: true,
    coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" }, now: NOW,
  };
}

describe("graph tasks retain their own approval wait", () => {
  it.each([FLOW_TWIN, PARALLEL_FIXTURE])("parks every proposed token in $key across the calendar boundary", (shape) => {
    const base = input(shape);
    const started = resolveDrivePlan({ ...base, ...(shape === PARALLEL_FIXTURE ? {
      currentStageKey: "a", receipts: [{ stageKey: "a", kind: "stage-evidence-recorded" }],
    } : {}) });
    expect(started.action).toBe("dispatch_agent");
    const tokens = started.tokens!;
    const stageRunsByTask = Object.fromEntries(tokens.map((token) => [token.taskId ?? workroomDriveTaskId(base.roomId, shape.key), {
      stageKey: token.stageKey, dispatchedAt: NOW.toISOString(), lastRunAt: NOW.toISOString(),
      lastStatus: "proposed", lastError: null, approvalOutcome: "waiting" as const,
    }]));
    const next = resolveDrivePlan({ ...base, now: new Date("2026-09-02T06:00:00.000Z"), currentStageKey: started.stageKey,
      receipts: shape === PARALLEL_FIXTURE ? [{ stageKey: "a", kind: "stage-evidence-recorded" }] : [],
      workspaceState: { workroomDrive: { stageKey: started.stageKey, marking: started.marking } }, stageRunsByTask });
    expect(next.tokens?.length, JSON.stringify({ reason: next.reason, ledger: next.ledger })).toBe(tokens.length);
    for (const token of next.tokens ?? []) {
      expect(token.action).toBe("pause");
      expect(String(token.ledger)).toContain("already requested a decision");
    }
  });
});

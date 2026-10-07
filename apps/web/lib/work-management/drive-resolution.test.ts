import { describe, expect, it } from "vitest";

import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import { readWorkShapeDefinitionContract, type WorkShapeDefinition, type WorkShapeDefinitionContract } from "./work-shapes";
import {
  DEADLINE_FIXTURE,
  FLOW_TWIN,
  PARALLEL_FIXTURE,
  REFUSE_FIXTURE,
  REWORK_FIXTURE,
  SEQUENTIAL_TWIN,
  SUB_SHAPE_FIXTURE,
} from "./__fixtures__/graph-shape-fixtures";
import { resolveDrivePlan, workroomDriveTaskId } from "./drive-resolution";
import type { DriveMarking } from "./drive-marking";
import { DEFER_ON_REFUSE_ROUTE, REFUSE_BOUND_NO_BUDGET_STOP, REFUSE_TO_STOP, REWORK_1 } from "./__fixtures__/graph-shapes/rework";
import type { RecordedEvidence } from "./stage-evidence-receipts";

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
  title: "Test shape",
  description: "A shape used in tests.",
  triggers: ["cadence"],
  stages: [
    {
      key: "scan",
      title: "Scan",
      accountablePrincipalRef: "agent:watcher",
      advance: { kind: "status-change", condition: "scanned" },
      evidence: ["assurance-finding"],
    },
    {
      key: "review",
      title: "Review",
      accountablePrincipalRef: "person:owner",
      advance: { kind: "governed-decision", condition: "accepted", decisionScope: "wwmd" },
      evidence: ["decision-record"],
    },
  ],
  stopConditions: [
    { kind: "success", condition: "findings dispositioned", disposition: "proceed" },
    { kind: "failure", condition: "scan failed", disposition: "inconclusive" },
    { kind: "budget", condition: "findings-per-run exhausted", disposition: "awaiting-person" },
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
    coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
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

  const governedAgentShape: WorkShapeDefinitionContract = {
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

  it("does NOT execute a governed agent stage on posture level alone (assertive, no preauthorized boundary → attention)", () => {
    // Assertive level is not enough; only the explicit preauthorized BOUNDARY drives a governed stage.
    const plan = resolveDrivePlan(baseInput({ definition: governedAgentShape, postureLevel: "assertive" }));
    expect(plan.action).toBe("attention");
    expect(plan.reason).toBe("governed_decision");
    expect(plan.taskId).toBeNull();
    expect(plan.agentId).toBeNull();
  });

  it("EP-4614F35E: DISPATCHES a governed AGENT review stage at full proactivity (preauthorized boundary)", () => {
    const plan = resolveDrivePlan(baseInput({ definition: governedAgentShape, actionBoundary: "preauthorized" }));
    expect(plan.action).toBe("dispatch_agent");
    expect(plan.agentId).toBe("watcher");
    expect(plan.taskId).not.toBeNull();
  });

  it("EP-4614F35E: a governed ROLE stage still raises attention even at full proactivity (independence: humans review agent work)", () => {
    const governedRole: WorkShapeDefinitionContract = {
      ...definition,
      stages: [{ ...governedAgentShape.stages[0], accountablePrincipalRef: "role:acceptance-reviewer" }],
    };
    const plan = resolveDrivePlan(baseInput({ definition: governedRole, actionBoundary: "preauthorized" }));
    expect(plan.action).toBe("attention"); // NOT dispatched — a human reviews
    expect(plan.reason).toBe("governed_decision");
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

  it("dispatches an agent stage on the first tick when no prior drive snapshot exists", () => {
    const plan = resolveDrivePlan(baseInput({
      currentStageKey: "scan",
      receipts: [],
      priorDrive: null,
    }));
    expect(plan.action).toBe("dispatch_agent");
    expect(plan.stageKey).toBe("scan");
    expect(plan.taskId).not.toBeNull();
  });

  it("pauses instead of re-dispatching when the prior tick dispatched the same stage and no completing receipt arrived", () => {
    const plan = resolveDrivePlan(baseInput({
      currentStageKey: "scan",
      receipts: [],
      priorDrive: { action: "dispatch_agent", reason: "agent_stage", stageKey: "scan", cycleKey: null },
    }));
    expect(plan.action).toBe("pause");
    expect(plan.reason).toBe("executor_writeback_unavailable");
    expect(plan.stageKey).toBe("scan");
    expect(plan.taskId).toBeNull();
    expect(plan.agentId).toBeNull();
    expect(plan.ledger.join(" ")).toMatch(/writeback|receipt/i);
  });

  it("keeps the pause on later ticks until a completing receipt appears", () => {
    const plan = resolveDrivePlan(baseInput({
      currentStageKey: "scan",
      receipts: [{ stageKey: "scan", kind: "blocked" }],
      priorDrive: {
        action: "pause",
        reason: "executor_writeback_unavailable",
        stageKey: "scan", cycleKey: null,
      },
    }));
    expect(plan.action).toBe("pause");
    expect(plan.reason).toBe("executor_writeback_unavailable");
    expect(plan.taskId).toBeNull();
  });

  it("does not treat a blocked receipt as completing, so the stage does not advance", () => {
    const plan = resolveDrivePlan(baseInput({
      currentStageKey: "scan",
      receipts: [{ stageKey: "scan", kind: "blocked" }],
    }));
    expect(plan.stageKey).toBe("scan");
    expect(plan.action).toBe("pause");
    expect(plan.reason).toBe("executor_writeback_unavailable");
  });

  it("resumes dispatch of the next agent stage once a completing receipt lands", () => {
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
      receipts: [{ stageKey: "scan", kind: "findings" }],
      priorDrive: {
        action: "pause",
        reason: "executor_writeback_unavailable",
        stageKey: "scan", cycleKey: null,
      },
    }));
    expect(plan.action).toBe("dispatch_agent");
    expect(plan.stageKey).toBe("raise");
    expect(plan.reason).toBe("agent_stage");
  });
});

// ─── A cycle runs once (BI-D10BB58B) ─────────────────────────────────────────
//
// Live, 2026-10-02: WC-A69BCABB finished its cycle (stop/success) and the next
// tick restarted at stage 1. It looped seven times in one day, and each
// decide stage was satisfied again by the same cycle's decision record.
describe("resolveDrivePlan after a completed cycle (BI-D10BB58B)", () => {
  const NOW = new Date("2026-09-01T00:00:00.000Z");
  const cycleKey = `${definition.key}@${definition.version}:2026-09-01`;

  it("sleeps for the rest of a cycle that ended in success", () => {
    const plan = resolveDrivePlan(baseInput({
      now: NOW,
      priorDrive: { action: "stop", reason: "success", stageKey: null, cycleKey },
    }));
    expect(plan.action).toBe("do_not_wake");
    expect(plan.reason).toBe("cycle_complete");
    expect(plan.cycle?.cycleKey).toBe(cycleKey);
  });

  it("keeps sleeping on later ticks of the same cycle", () => {
    const plan = resolveDrivePlan(baseInput({
      now: NOW,
      priorDrive: { action: "do_not_wake", reason: "cycle_complete", stageKey: null, cycleKey },
    }));
    expect(plan.reason).toBe("cycle_complete");
  });

  it("starts the shape again in the next cycle", () => {
    const plan = resolveDrivePlan(baseInput({
      now: new Date("2026-09-02T00:00:00.000Z"),
      priorDrive: { action: "do_not_wake", reason: "cycle_complete", stageKey: null, cycleKey },
    }));
    expect(plan.action).toBe("dispatch_agent");
    expect(plan.stageKey).toBe("scan");
  });
});

// GPP Phase 3c PR-3c-1 (BI-8875C9DF): the structural branch and the graph
// path's fail-closed pauses. AC-3C-FAILCLOSED, runtime half.
describe("resolveDrivePlan: the Phase 3c graph path", () => {
  const graphInput = (definitionOverride: WorkShapeDefinitionContract, extras: Partial<Parameters<typeof resolveDrivePlan>[0]> = {}) =>
    baseInput({ definition: definitionOverride, roomId: "WC-GRAPH", collaborationShape: null, ...extras });
  const contract = (shape: WorkShapeDefinition) => readWorkShapeDefinitionContract(shape);

  it("a sequential plan never carries tokens or a marking", () => {
    const plan = resolveDrivePlan(baseInput());
    expect(Object.hasOwn(plan, "tokens")).toBe(false);
    expect(Object.hasOwn(plan, "marking")).toBe(false);
  });

  it("AC-3C-FAILCLOSED: no Phase 3c fixture pauses construct_not_executable now that every flag is on (BI-086DC167)", () => {
    // The kill switch (a flag set back to false pauses the room, naming the construct, keeping its stage and marking)
    // is proved with a test-only flag table in drive-marking-durable.test.ts and the runner suites
    // (workroom-drive-rework, -deadline and -children tests).
    for (const shape of [DEADLINE_FIXTURE, SUB_SHAPE_FIXTURE, PARALLEL_FIXTURE]) {
      const plan = resolveDrivePlan(graphInput(contract(shape), { currentStageKey: "a", receipts: [{ stageKey: "a", kind: "stage-evidence-recorded" }] }));
      expect(plan.reason, shape.key).not.toBe("construct_not_executable");
    }
  });

  it("PR-3c-2: with the parallel flag on, the split plans one dispatch per branch, each through the task id fixed on its token", () => {
    const plan = resolveDrivePlan(graphInput(contract(PARALLEL_FIXTURE), { currentStageKey: "a", receipts: [{ stageKey: "a", kind: "stage-evidence-recorded" }] }));
    expect(plan).toMatchObject({ action: "dispatch_agent", reason: "agent_stage", stageKey: "b", taskId: "workroom-WC-GRAPH-graph-fixture-parallel" });
    expect(plan.tokens?.map((token) => [token.stageKey, token.action, token.taskId])).toEqual([
      ["b", "dispatch_agent", "workroom-WC-GRAPH-graph-fixture-parallel"],
      ["c", "dispatch_agent", "workroom-WC-GRAPH-graph-fixture-parallel--c"],
    ]);
    const marking = plan.marking as DriveMarking;
    expect(marking.tokens.map((token) => [token.node, token.taskId, token.lastAction])).toEqual([
      ["stage:b", "workroom-WC-GRAPH-graph-fixture-parallel", "dispatch_agent"],
      ["stage:c", "workroom-WC-GRAPH-graph-fixture-parallel--c", "dispatch_agent"],
    ]);
  });

  it("a malformed stored marking pauses with marking_unreadable and carries it verbatim", () => {
    const raw = { format: "drive-marking/1", cycleKey: 3, tokens: "broken" };
    const plan = resolveDrivePlan(graphInput(contract(FLOW_TWIN), { currentStageKey: "b", workspaceState: { workroomDrive: { stageKey: "b", marking: raw } } }));
    expect(plan).toMatchObject({ action: "pause", reason: "marking_unreadable", stageKey: "b" });
    expect(plan.marking).toEqual({ raw });
    expect((plan.marking as { raw: unknown }).raw).toBe(raw);
  });

  it("a plain flow (no gated construct) runs: it dispatches the first stage and records the token's last tick", () => {
    const plan = resolveDrivePlan(graphInput(contract(FLOW_TWIN)));
    expect(plan).toMatchObject({ action: "dispatch_agent", reason: "agent_stage", stageKey: "a", agentId: "graph-worker" });
    expect(plan.taskId).toBe(workroomDriveTaskId("WC-GRAPH", FLOW_TWIN.key));
    expect(plan.tokens).toEqual([expect.objectContaining({ stageKey: "a", iteration: 0, action: "dispatch_agent", reason: "agent_stage" })]);
    expect(plan.marking).toMatchObject({
      format: "drive-marking/1",
      tokens: [{ node: "stage:a", lastAction: "dispatch_agent", lastReason: "agent_stage", lastCycleKey: plan.cycle?.cycleKey }],
    });
  });

  it("on its sequential twin, the plain flow plans the same stage and action for every receipt prefix", () => {
    const receipts: Array<{ stageKey: string; kind: string }> = [];
    let sequentialStage: string | null = null;
    let workspaceState: unknown = {};
    for (const next of ["a", "b"]) {
      const sequential = resolveDrivePlan(baseInput({ definition: contract(SEQUENTIAL_TWIN), currentStageKey: sequentialStage, receipts: [...receipts] }));
      const graph = resolveDrivePlan(graphInput(contract(FLOW_TWIN), { currentStageKey: sequentialStage, receipts: [...receipts], workspaceState }));
      expect([graph.action, graph.reason, graph.stageKey]).toEqual([sequential.action, sequential.reason, sequential.stageKey]);
      sequentialStage = sequential.stageKey;
      workspaceState = { workroomDrive: { stageKey: graph.stageKey, marking: graph.marking } };
      receipts.push({ stageKey: next, kind: "stage-evidence-recorded" });
    }
    const sequentialEnd = resolveDrivePlan(baseInput({ definition: contract(SEQUENTIAL_TWIN), currentStageKey: sequentialStage, receipts }));
    const graphEnd = resolveDrivePlan(graphInput(contract(FLOW_TWIN), { currentStageKey: sequentialStage, receipts, workspaceState }));
    expect([graphEnd.action, graphEnd.reason]).toEqual([sequentialEnd.action, sequentialEnd.reason]);
    expect(graphEnd).toMatchObject({ action: "stop", reason: "success", stageKey: null });
    expect((graphEnd.marking as { tokens: unknown[] }).tokens).toEqual([]);
  });

  it("the per-token latch pauses a token that was dispatched without writeback in this cycle", () => {
    const first = resolveDrivePlan(graphInput(contract(FLOW_TWIN)));
    const second = resolveDrivePlan(graphInput(contract(FLOW_TWIN), {
      currentStageKey: "a",
      workspaceState: { workroomDrive: { stageKey: "a", marking: first.marking } },
    }));
    expect(second).toMatchObject({ action: "pause", reason: "executor_writeback_unavailable", stageKey: "a" });
  });

  it("a conformance pause keeps the marking it read instead of advancing it", () => {
    const stored = resolveDrivePlan(graphInput(contract(FLOW_TWIN))).marking;
    const plan = resolveDrivePlan(graphInput(contract(FLOW_TWIN), {
      currentStageKey: "a",
      reviewDue: true,
      receipts: [{ stageKey: "a", kind: "stage-evidence-recorded" }],
      workspaceState: { workroomDrive: { stageKey: "a", marking: stored } },
    }));
    expect(plan).toMatchObject({ action: "pause", reason: "conformance_pause", stageKey: "a" });
    expect(plan.marking).toEqual(stored);
  });
});

// GPP Phase 3c PR-3c-3 (BI-8875C9DF), design §6.2: verdicts from recorded decisions, refuse routes, rework,
// `gate_refused` and `refused_to_stop`, through the planner. DI-0D9DFB0FC0EF: `defer` HOLDS the token on a stage that
// declares a refuse route; on every other stage it keeps advancing (founder decision 2026-10-02).
describe("resolveDrivePlan: refuse routes and rework (PR-3c-3)", () => {
  const NOW = new Date("2026-09-01T12:00:00.000Z");
  const minutes = (delta: number) => new Date(NOW.getTime() + delta * 60_000);
  const contract = (shape: WorkShapeDefinition) => readWorkShapeDefinitionContract(shape);
  const input = (shape: WorkShapeDefinition, extras: Partial<Parameters<typeof resolveDrivePlan>[0]> = {}) =>
    baseInput({ definition: contract(shape), roomId: "WC-RW", collaborationShape: null, now: NOW, ...extras });
  const cycleOf = (shape: WorkShapeDefinition) => resolveDrivePlan(input(shape)).cycle!.cycleKey;
  const stored = (shape: WorkShapeDefinition, over: Partial<DriveMarking>): DriveMarking => ({
    format: "drive-marking/1", cycleKey: cycleOf(shape), tokens: [], iterations: {}, reworkTaken: {}, deadlines: {}, children: {}, ...over,
  });
  const at = (shape: WorkShapeDefinition, stageKey: string, over: Partial<DriveMarking> = {}) => ({
    currentStageKey: stageKey,
    workspaceState: { workroomDrive: { stageKey, marking: stored(shape, { tokens: [{ node: `stage:${stageKey}`, enteredAt: minutes(-60).toISOString() }], ...over }) } },
  });
  const decision = (stageKey: string, choice: string, at: Date): RecordedEvidence =>
    ({ stageKey, kind: "decision-record", outcome: "completed", choice, recordedAt: at });
  const done = (stageKey: string, iteration?: number) => ({ stageKey, kind: "stage-evidence-recorded", ...(iteration ? { iteration } : {}) });

  it("defer HOLDS the token on a stage that declares a refuse route, until an accept moves it", () => {
    const deferred = resolveDrivePlan(input(REWORK_1, { ...at(REWORK_1, "b"), receipts: [done("a"), done("b")], recordedEvidence: [decision("b", "defer", minutes(-30))] }));
    expect(deferred).toMatchObject({ action: "attention", reason: "governed_decision", stageKey: "b", attentionPrincipalRef: "role:owner" });
    expect((deferred.marking as DriveMarking).tokens.map((token) => token.node)).toEqual(["stage:b"]);
    expect(deferred.rework).toBeUndefined();
    const accepted = resolveDrivePlan(input(REWORK_1, {
      ...at(REWORK_1, "b"),
      receipts: [done("a"), done("b")],
      recordedEvidence: [decision("b", "accept", minutes(-10)), decision("b", "defer", minutes(-30))],
    }));
    expect(accepted).toMatchObject({ action: "stop", reason: "success" });
  });

  it("defer keeps ADVANCING on a stage with no refuse route: the graph path's enforced gate without one, and the sequential drive", () => {
    const graph = resolveDrivePlan(input(DEFER_ON_REFUSE_ROUTE, { ...at(DEFER_ON_REFUSE_ROUTE, "approve"), receipts: [done("approve")], recordedEvidence: [decision("approve", "defer", minutes(-30))] }));
    expect(graph).toMatchObject({ action: "stop", reason: "success" });
    // The sequential drive (no graph construct): the recorded deferral is the completing receipt, and the room moves on.
    const sequential = resolveDrivePlan(baseInput({ currentStageKey: "review", receipts: [{ stageKey: "scan", kind: "stage-evidence-recorded" }, { stageKey: "review", kind: "stage-evidence-recorded" }] }));
    expect(sequential).toMatchObject({ action: "stop", reason: "success" });
  });

  it("Send back routes the token to the earlier stage: the edge is counted, the loop region starts a new iteration, the target is entered afresh", () => {
    const plan = resolveDrivePlan(input(REWORK_1, { ...at(REWORK_1, "b"), receipts: [done("a"), done("b")], recordedEvidence: [decision("b", "refuse", minutes(-5))] }));
    expect(plan).toMatchObject({ action: "dispatch_agent", reason: "agent_stage", stageKey: "a", taskId: workroomDriveTaskId("WC-RW", REWORK_1.key) });
    expect(plan.rework).toEqual({ fromStageKey: "b", toStageKey: "a", edgeId: "edge:b->a", clearedStageKeys: ["a", "b"] });
    const marking = plan.marking as DriveMarking;
    expect(marking).toMatchObject({ iterations: { a: 1, b: 1 }, reworkTaken: { "edge:b->a": 1 } });
    expect(marking.tokens).toEqual([expect.objectContaining({ node: "stage:a", enteredAt: NOW.toISOString(), lastAction: "dispatch_agent" })]);
    // The declared refuse route is a legal backward move for the Process Overseer.
    expect(plan.conformance?.deviations ?? []).toEqual([]);
    expect(plan.ledger.join("\n")).toContain("Stage b was sent back to a over edge:b->a");
  });

  it("a decision recorded before the token entered the stage is a previous pass's, and never routes it", () => {
    const plan = resolveDrivePlan(input(REWORK_1, { ...at(REWORK_1, "b"), receipts: [done("a"), done("b")], recordedEvidence: [decision("b", "refuse", minutes(-90))] }));
    expect(plan).toMatchObject({ action: "attention", reason: "governed_decision", stageKey: "b" });
    expect(plan.rework).toBeUndefined();
  });

  it("a refuse to a stop ends the cycle with refused_to_stop, which stays the answer until the next cycle restarts the shape", () => {
    const plan = resolveDrivePlan(input(REFUSE_TO_STOP, { ...at(REFUSE_TO_STOP, "decide"), receipts: [done("a"), done("decide")], recordedEvidence: [decision("decide", "refuse", minutes(-5))] }));
    expect(plan).toMatchObject({ action: "stop", reason: "refused_to_stop", stageKey: null });
    expect((plan.marking as DriveMarking).tokens).toEqual([]);
    const cycleKey = plan.cycle!.cycleKey;
    const after = { workspaceState: { workroomDrive: { stageKey: null, marking: plan.marking } }, priorDrive: { action: "stop", reason: "refused_to_stop", stageKey: null, cycleKey } };
    expect(resolveDrivePlan(input(REFUSE_TO_STOP, { ...after, now: minutes(15) }))).toMatchObject({ action: "stop", reason: "refused_to_stop" });
    const nextDay = resolveDrivePlan(input(REFUSE_TO_STOP, { ...after, now: new Date("2026-09-02T12:00:00.000Z") }));
    expect(nextDay).toMatchObject({ action: "dispatch_agent", stageKey: "a" });
  });

  it("past the bound with no budget stop, a refuse has no route: the token stays and gate_refused names who clears it", () => {
    const spent = { iterations: { a: 1, b: 1 }, reworkTaken: { "edge:b->a": 1 } };
    const plan = resolveDrivePlan(input(REFUSE_BOUND_NO_BUDGET_STOP, { ...at(REFUSE_BOUND_NO_BUDGET_STOP, "b", spent), receipts: [done("a", 1), done("b", 1)], recordedEvidence: [decision("b", "refuse", minutes(-5))] }));
    expect(plan).toMatchObject({ action: "attention", reason: "gate_refused", stageKey: "b", attentionPrincipalRef: "role:owner" });
    expect((plan.marking as DriveMarking).tokens.map((token) => token.node)).toEqual(["stage:b"]);
    // The gate's escalation role, when it declares one, is who clears it.
    const escalating: WorkShapeDefinition = {
      ...REFUSE_BOUND_NO_BUDGET_STOP,
      stages: REFUSE_BOUND_NO_BUDGET_STOP.stages.map((stage) => stage.key === "b" && stage.advance.kind === "governed-decision" && stage.advance.gate
        ? { ...stage, advance: { ...stage.advance, gate: { ...stage.advance.gate, escalation: { role: "role:quality-lead", whileWaiting: "hold" as const } } } }
        : stage),
    };
    const escalated = resolveDrivePlan(input(escalating, { ...at(escalating, "b", spent), receipts: [done("a", 1), done("b", 1)], recordedEvidence: [decision("b", "refuse", minutes(-5))] }));
    expect(escalated).toMatchObject({ action: "attention", reason: "gate_refused", attentionPrincipalRef: "role:quality-lead" });
  });

  it("a blocked receipt from the pass a stage was sent back from never latches the fresh pass", () => {
    const fresh = { iterations: { a: 1, b: 1 }, reworkTaken: { "edge:b->a": 1 } };
    const stale = resolveDrivePlan(input(REWORK_1, { ...at(REWORK_1, "a", fresh), receipts: [{ stageKey: "a", kind: "blocked" }] }));
    expect(stale).toMatchObject({ action: "dispatch_agent", stageKey: "a" });
    const current = resolveDrivePlan(input(REWORK_1, { ...at(REWORK_1, "a", fresh), receipts: [{ stageKey: "a", kind: "blocked", iteration: 1 }] }));
    expect(current).toMatchObject({ action: "pause", reason: "executor_writeback_unavailable", stageKey: "a" });
  });

  it("an agent-run gated stage that is complete but has no verdict waits on a person instead of being re-dispatched", () => {
    const agentGate: WorkShapeDefinition = {
      ...REWORK_1,
      stages: REWORK_1.stages.map((stage) => (stage.key === "b" ? { ...stage, accountablePrincipalRef: "agent:reviewer" } : stage)),
    };
    const plan = resolveDrivePlan(input(agentGate, { ...at(agentGate, "b"), actionBoundary: "preauthorized", receipts: [done("a"), done("b")] }));
    expect(plan).toMatchObject({ action: "attention", reason: "governed_decision", stageKey: "b", attentionPrincipalRef: "agent:reviewer", taskId: null });
  });
});

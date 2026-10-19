// Send back through the drive runner (GPP Phase 3c PR-3c-3, BI-8875C9DF).
// Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §6.2 ("Re-dispatch is fresh", "Permit revocation"); plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-3). Beside workroom-drive.test.ts, which stays under the module-size
// ceiling (scripts/check-module-size.mjs).
//
// The fixture is not registered (plan constraint 7), so the shape-claim
// resolver is overridden for its key only. The executable-construct table is
// a mutable copy so a case can switch the rework-edge flag off (the kill
// switch); it starts as the real table.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { REWORK_INSIDE_BRANCH } from "@/lib/work-management/__fixtures__/graph-shapes/rework";
import { workroomDriveBranchTaskId, workroomDriveTaskId } from "@/lib/work-management/drive-resolution";
import type { RecordedEvidence } from "@/lib/work-management/stage-evidence-receipts";
import { mergeWorkroomDriveSnapshot } from "@/lib/work-management/workroom-drive-snapshot-merge";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { buildWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import { runWorkroomDriveJob, type WorkroomDriveEffects, type WorkroomDriveRoom } from "./workroom-drive";

const flags = vi.hoisted(() => ({ table: {} as Record<string, boolean>, original: {} as Record<string, boolean> }));
vi.mock("@/lib/gpp/shape-language/executable-constructs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gpp/shape-language/executable-constructs")>();
  flags.original = { ...actual.CONSTRUCT_EXECUTABLE };
  flags.table = { ...actual.CONSTRUCT_EXECUTABLE };
  return { ...actual, CONSTRUCT_EXECUTABLE: flags.table };
});
vi.mock("@/lib/work-management/workroom-shape-claim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/work-management/workroom-shape-claim")>();
  const { REWORK_INSIDE_BRANCH: fixture } = await import("@/lib/work-management/__fixtures__/graph-shapes/rework");
  return {
    ...actual,
    resolveWorkShapeClaim: (scopeClaims: unknown) => {
      const ref = actual.readWorkShapeClaim(scopeClaims);
      return ref?.key === fixture.key && ref.version === fixture.version ? fixture : actual.resolveWorkShapeClaim(scopeClaims);
    },
  };
});

function coordinatorAssignment(workroomId: string) {
  return {
    workroomId,
    principalRef: "PRN-COORD",
    roles: ["coordinator" as const],
    assignmentSource: "explicit" as const,
    enteredReason: null,
    currentWorkSummary: null,
    displayName: "Overseer",
    kind: "agent" as const,
    sponsorPrincipalRef: null,
    sponsorDisplayName: null,
    authoritySummary: "Acts within process-coordination authority",
  };
}

function room(over: Partial<WorkroomDriveRoom> = {}): WorkroomDriveRoom {
  return {
    id: "row-1",
    capsuleId: "WC-TEST",
    scopeClaims: [],
    workspaceState: {},
    leaseExpiresAt: null,
    leaseHolderPrincipalId: "prn-row-coord",
    ownerUserId: "user-1",
    participants: [coordinatorAssignment("row-1")],
    currentStageKey: null,
    receipts: [],
    budgetUsage: [],
    stopConditionHits: [],
    reviewDue: false,
    substrateReachable: true,
    substrateEmpty: false,
    coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
    ...over,
  };
}

// Through the real runner with the production merge. REWORK_INSIDE_BRANCH is
// a → p → (b1 → b2, c) → j → d → success; b2 (role:owner) has an enforced gate
// that sends a refusal back to b1, at most once.
describe("Send back through the runner: rework clears the left stage's task, revokes its permits, re-dispatches fresh (PR-3c-3)", () => {
  const DAY = "2026-03-02";
  const T0 = new Date(`${DAY}T09:00:00.000Z`);
  const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
  const shape = REWORK_INSIDE_BRANCH;
  const CYCLE = `${shape.key}@${shape.version}:${DAY}`;
  const PRIMARY = workroomDriveTaskId("WC-RW", shape.key);
  const branch = (stageKey: string) => workroomDriveBranchTaskId("WC-RW", shape.key, stageKey);

  type Harness = {
    workspaceState: Record<string, unknown>;
    evidence: RecordedEvidence[];
    dispatchedAt: Map<string, Date>;
    upserts: string[];
    deactivated: string[];
    revoked: Array<{ workroomId: string; stageKeys: readonly string[] }>;
    lease: "acquired" | "held";
  };

  async function tick(h: Harness, now: Date) {
    const before = { upserts: h.upserts.length, deactivated: h.deactivated.length, revoked: h.revoked.length };
    const stored = readStoredWorkroomDriveState(h.workspaceState);
    const reworkRoom: WorkroomDriveRoom = {
      ...room({ id: "row-rw", capsuleId: "WC-RW", participants: [coordinatorAssignment("row-rw")] }),
      scopeClaims: [
        buildWorkShapeClaim({ key: shape.key, version: shape.version }),
        buildWorkroomPostureClaim({ proactivityLevel: "balanced" }, new Date("2026-03-01T00:00:00.000Z")),
      ],
      workspaceState: h.workspaceState,
      ...stored,
      recordedEvidence: [...h.evidence].reverse(),
      stageDispatchedAt: null,
      stageDispatchedAtByStage: new Map(h.dispatchedAt),
    };
    const fx: WorkroomDriveEffects = {
      persist: async (input) => {
        if (input.observationOnly) return;
        const written = mergeWorkroomDriveSnapshot(h.workspaceState, input.snapshot, { graphShape: input.graphShape });
        h.workspaceState = JSON.parse(JSON.stringify({ ...h.workspaceState, workroomDrive: written })) as Record<string, unknown>;
        for (const key of (input.snapshot.dispatchedStageKeys as string[] | undefined) ?? []) h.dispatchedAt.set(key, now);
      },
      acquireLease: async () => h.lease,
      upsertAgentTask: async (input) => { h.upserts.push(`${input.taskId}@${input.stage.stageKey}`); return true; },
      deactivateAgentTask: async (taskId) => { h.deactivated.push(taskId); },
      revokeStagePermits: async (input) => { h.revoked.push({ workroomId: input.workroomId, stageKeys: input.stageKeys }); return 0; },
    };
    const result = await runWorkroomDriveJob(now, { listRooms: async () => [reworkRoom], effects: fx, reconcileNesting: async () => 0, reconcileNotifications: async () => {} });
    return {
      plan: result.plans[0]!,
      upserts: h.upserts.slice(before.upserts),
      deactivated: h.deactivated.slice(before.deactivated),
      revoked: h.revoked.slice(before.revoked),
    };
  }
  const drive = (h: Harness) => h.workspaceState.workroomDrive as Record<string, unknown>;
  const marking = (h: Harness) => drive(h).marking as { tokens: Array<Record<string, unknown>>; iterations: Record<string, number>; reworkTaken: Record<string, number> };

  /** b2 waiting on its decision (its token carrying a branch task id, so the clear is visible), c arrived at the join. */
  function waitingAtB2(): Harness {
    const tokens = [
      { node: "node:j", from: "stage:c", enteredAt: at(-45).toISOString() },
      { node: "stage:b2", enteredAt: at(-30).toISOString(), taskId: branch("b2"), lastAction: "attention", lastReason: "governed_decision", lastCycleKey: CYCLE },
    ];
    return {
      workspaceState: { workroomDrive: {
        kind: "workroom-drive", version: 1, action: "attention", reason: "governed_decision", stageKey: "b2", lastCycleKey: CYCLE,
        receipts: ["a", "b1", "c"].map((stageKey) => ({ stageKey, kind: "stage-evidence-recorded" })),
        pendingAttention: { principalRef: "role:owner", stageKey: "b2", reason: "governed_decision" },
        pendingAttentions: [{ principalRef: "role:owner", stageKey: "b2", reason: "governed_decision" }],
        marking: { format: "drive-marking/1", cycleKey: CYCLE, tokens, iterations: {}, reworkTaken: {}, deadlines: {}, children: {} },
      } },
      // The attention row that asked for b2's decision bounds its evidence (loadStageDispatchTimesByStage).
      evidence: [],
      dispatchedAt: new Map([["b2", at(-30)]]),
      upserts: [],
      deactivated: [],
      revoked: [],
      lease: "acquired",
    };
  }
  const sendBack = (h: Harness, minutes: number) =>
    h.evidence.push({ stageKey: "b2", kind: "decision-record", outcome: "completed", choice: "refuse", recordedAt: at(minutes) });

  beforeEach(() => {
    Object.assign(flags.table, flags.original);
    expect(flags.table["rework-edge"]).toBe(true);
  });

  it("a recorded Send back routes the token to b1: the left task is deactivated, the left stages' permits are revoked, b1 is re-dispatched", async () => {
    const h = waitingAtB2();
    sendBack(h, 5);
    const result = await tick(h, at(15));
    expect(result.plan).toMatchObject({ action: "dispatch_agent", reason: "agent_stage" });
    expect(result.upserts).toEqual([`${PRIMARY}@b1`]);
    expect(result.deactivated).toEqual([branch("b2")]);
    expect(result.revoked).toEqual([{ workroomId: "WC-RW", stageKeys: ["b1", "b2"] }]);
    expect(marking(h).iterations).toEqual({ b1: 1, b2: 1 });
    expect(marking(h).reworkTaken).toEqual({ "edge:b2->b1": 1 });
    // The sibling's join arrival is kept; b1 is entered afresh.
    expect(marking(h).tokens).toEqual([
      { node: "node:j", from: "stage:c", enteredAt: at(-45).toISOString() },
      expect.objectContaining({ node: "stage:b1", enteredAt: at(15).toISOString(), taskId: PRIMARY, lastAction: "dispatch_agent" }),
    ]);
    // The refused pass's receipt is kept for audit, scoped to iteration 0 and to its run (BI-086DC167).
    expect(drive(h).receipts).toEqual(expect.arrayContaining([{ stageKey: "b2", kind: "stage-evidence-recorded", iteration: 0, runKey: CYCLE }]));
    expect(drive(h).pendingAttentions).toEqual([]);
  });

  it("the fresh pass is not completed by the refused pass's receipt; its own blocked receipt is scoped to it; its own evidence advances it", async () => {
    const h = waitingAtB2();
    sendBack(h, 5);
    await tick(h, at(15));
    // b1's iteration-0 receipt does not complete iteration 1; the dispatched pass that never wrote back latches.
    const latched = await tick(h, at(30));
    expect(latched.plan).toMatchObject({ action: "pause", reason: "executor_writeback_unavailable" });
    expect(latched.upserts).toEqual([]);
    expect(drive(h).receipts).toEqual(expect.arrayContaining([{ stageKey: "b1", kind: "blocked", iteration: 1, runKey: CYCLE }]));
    expect(marking(h).tokens.map((token) => token.node)).toEqual(["node:j", "stage:b1"]);
    // b1's new evidence, after its new dispatch, earns iteration 1 and moves the token to b2 again.
    h.evidence.push({ stageKey: "b1", kind: "assurance-run", outcome: "completed", recordedAt: at(35) });
    const advanced = await tick(h, at(45));
    expect(advanced.plan).toMatchObject({ action: "attention", reason: "governed_decision" });
    expect(marking(h).tokens.map((token) => token.node)).toEqual(["node:j", "stage:b2"]);
    expect(advanced.revoked).toEqual([]);
  });

  it("a lease held by another worker commits nothing, so no permit is revoked", async () => {
    const h = waitingAtB2();
    h.lease = "held";
    sendBack(h, 5);
    const result = await tick(h, at(15));
    expect(result.upserts).toEqual([]);
    expect(result.revoked).toEqual([]);
    expect(marking(h).iterations).toEqual({});
  });

  it("with the rework-edge flag off the room pauses construct_not_executable, keeps its marking and revokes nothing", async () => {
    flags.table["rework-edge"] = false;
    const h = waitingAtB2();
    sendBack(h, 5);
    const result = await tick(h, at(15));
    expect(result.plan).toMatchObject({ action: "pause", reason: "construct_not_executable" });
    expect(result.revoked).toEqual([]);
    expect(marking(h).tokens.map((token) => token.node)).toEqual(["node:j", "stage:b2"]);
  });
});

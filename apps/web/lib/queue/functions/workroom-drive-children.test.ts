// Sub-shape child rooms through the drive runner (GPP Phase 3c PR-3c-5, BI-8875C9DF).
// Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §9 (sub-shape); plan: docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-5, workroom-drive-children.test.ts).
//
// The live child effects (createSubShapeChildEffects) run over an in-memory
// database whose $transaction restores every table when its callback throws,
// so "in one transaction" is observable. The fixtures are not registered (plan
// constraint 7), so the shape-claim resolver is overridden for their keys, and
// the executable-construct table is a mutable copy with sub-shape switched on
// for these cases (the real flag stays off until BI-086DC167, graph markings
// reset at every cycle boundary), and left as it really is for the off case.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SUB_IN_REWORK, SUB_SEQ } from "@/lib/work-management/__fixtures__/graph-shapes/sub-shape";
import { resolveDrivePlan, workroomDriveTaskId } from "@/lib/work-management/drive-resolution";
import type { DriveMarking } from "@/lib/work-management/drive-marking";
import type { RecordedEvidence } from "@/lib/work-management/stage-evidence-receipts";
import { projectPersistedWorkroomRoster } from "@/lib/work-management/room-participant-assignment";
import { readWorkShapeDefinitionContract } from "@/lib/work-management/work-shapes";
import { mergeWorkroomDriveSnapshot } from "@/lib/work-management/workroom-drive-snapshot-merge";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { buildWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import { runWorkroomDriveJob, type WorkroomDriveEffects, type WorkroomDriveRoom } from "./workroom-drive";
import { SUB_SHAPE_DRIVE_ACTOR, createSubShapeChildEffects, withSubShapeChildren } from "./workroom-drive-children";

const flags = vi.hoisted(() => ({ table: {} as Record<string, boolean>, original: {} as Record<string, boolean> }));
vi.mock("@/lib/gpp/shape-language/executable-constructs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gpp/shape-language/executable-constructs")>();
  flags.original = { ...actual.CONSTRUCT_EXECUTABLE };
  flags.table = { ...actual.CONSTRUCT_EXECUTABLE };
  return { ...actual, CONSTRUCT_EXECUTABLE: flags.table };
});
vi.mock("@/lib/work-management/workroom-shape-claim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/work-management/workroom-shape-claim")>();
  const fixtures = await import("@/lib/work-management/__fixtures__/graph-shapes/sub-shape");
  const known = [fixtures.SUB_SEQ, fixtures.SUB_IN_REWORK];
  return {
    ...actual,
    resolveWorkShapeClaim: (scopeClaims: unknown) => {
      const ref = actual.readWorkShapeClaim(scopeClaims);
      return known.find((shape) => ref?.key === shape.key && ref.version === shape.version) ?? actual.resolveWorkShapeClaim(scopeClaims);
    },
  };
});
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: () => {} }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: () => {} }));

type Row = Record<string, any>;

/** An in-memory platform database: the tables the child effects touch, with a transaction that rolls back on throw. */
function memoryDb() {
  const state = { workrooms: [] as Row[], activities: [] as Row[], participants: [] as Row[], relations: [] as Row[] };
  const failNext = { relationDelete: false };
  let seq = 0;
  const match = (row: Row, where: Row) => Object.entries(where).every(([key, value]) =>
    value && typeof value === "object" && !Array.isArray(value) && "in" in value ? (value.in as unknown[]).includes(row[key]) : row[key] === value);
  const db: any = {
    state,
    failNext,
    workroom: {
      findUnique: async ({ where, select }: Row) => {
        const row = state.workrooms.find((candidate) => match(candidate, where));
        if (!row) return null;
        if (select?.participants) {
          return { ...row, participants: state.participants.filter((participant) => participant.workroomId === row.id && participant.lifecycle === "active") };
        }
        return { ...row };
      },
      findFirst: async ({ where }: Row) => state.workrooms.find((candidate) => match(candidate, where)) ?? null,
      findMany: async ({ where }: Row) => state.workrooms.filter((candidate) => match(candidate, where)).map((row) => ({ ...row })),
      create: async ({ data }: Row) => {
        const row = { id: `row-${++seq}`, ...data };
        state.workrooms.push(row);
        return { ...row };
      },
      update: async ({ where, data }: Row) => {
        const row = state.workrooms.find((candidate) => match(candidate, where));
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return { ...row };
      },
    },
    workroomActivity: { create: async ({ data }: Row) => { const row = { id: `act-${++seq}`, recordedAt: new Date(), ...data }; state.activities.push(row); return row; } },
    workroomParticipant: {
      findMany: async ({ where }: Row) => state.participants.filter((row) => row.workroomId === where.workroomId),
      create: async ({ data }: Row) => { state.participants.push({ id: `part-${++seq}`, ...data }); return data; },
      update: async ({ where, data }: Row) => Object.assign(state.participants.find((row) => row.id === where.id)!, data),
    },
    workroomRelation: {
      createMany: async ({ data }: Row) => {
        let count = 0;
        for (const entry of data as Row[]) {
          if (state.relations.some((row) => match(row, entry))) continue;
          state.relations.push({ ...entry });
          count += 1;
        }
        return { count };
      },
      deleteMany: async ({ where }: Row) => {
        if (failNext.relationDelete) { failNext.relationDelete = false; throw new Error("relation store unavailable"); }
        const before = state.relations.length;
        state.relations = state.relations.filter((row) => !match(row, where));
        return { count: before - state.relations.length };
      },
    },
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      const saved = JSON.parse(JSON.stringify(state));
      try {
        return await fn(db);
      } catch (error) {
        Object.assign(state, saved);
        throw error;
      }
    },
  };
  return db;
}

const DAY = "2026-03-02";
const T0 = new Date(`${DAY}T09:00:00.000Z`);
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const cycleOf = (shape: typeof SUB_SEQ, day = DAY) => `${shape.key}@${shape.version}:${day}`;

function coordinator(workroomId: string) {
  return {
    workroomId, principalRef: "PRN-COORD", roles: ["coordinator" as const], assignmentSource: "explicit" as const, enteredReason: null,
    currentWorkSummary: null, displayName: "Overseer", kind: "agent" as const, sponsorPrincipalRef: null, sponsorDisplayName: null,
    authoritySummary: "Acts within process-coordination authority",
  };
}

type Harness = { db: ReturnType<typeof memoryDb>; workspaceState: Record<string, unknown>; upserts: string[]; shape: typeof SUB_SEQ };

function parentWaitingAtB(shape: typeof SUB_SEQ = SUB_SEQ): Harness {
  const db = memoryDb();
  db.state.workrooms.push({ id: "row-parent", capsuleId: "WC-PARENT", status: "working", requestedByPrincipalId: "pr-owner", createdByPrincipalId: null, workspaceState: {} });
  db.state.participants.push({ id: "part-0", workroomId: "row-parent", principalId: "pr-overseer", roles: ["coordinator"], lifecycle: "active" });
  const cycle = cycleOf(shape);
  return {
    db,
    shape,
    upserts: [],
    workspaceState: { workroomDrive: {
      kind: "workroom-drive", version: 1, action: "dispatch_agent", reason: "agent_stage", stageKey: "b", lastCycleKey: cycle,
      receipts: [{ stageKey: "a", kind: "stage-evidence-recorded" }],
      marking: { format: "drive-marking/1", cycleKey: cycle, tokens: [{ node: "stage:b", enteredAt: at(-30).toISOString() }], iterations: {}, reworkTaken: {}, deadlines: {}, children: {} },
    } },
  };
}

/** The parent's recorded stage evidence, as loadRecordedEvidence reads it from the activity trail. */
function evidenceOf(h: Harness): RecordedEvidence[] {
  return h.db.state.activities
    .filter((row: Row) => row.workCapsuleId === "row-parent" && row.kind === "evidence-recorded")
    .map((row: Row) => ({ stageKey: row.payload.stageKey ?? null, kind: row.payload.kind ?? null, outcome: row.payload.outcome ?? null, recordedAt: row.recordedAt }));
}

async function tick(h: Harness, now: Date) {
  const stored = readStoredWorkroomDriveState(h.workspaceState);
  const parent: WorkroomDriveRoom = {
    id: "row-parent", capsuleId: "WC-PARENT", objective: "Parent objective",
    scopeClaims: [buildWorkShapeClaim({ key: h.shape.key, version: h.shape.version }), buildWorkroomPostureClaim({ proactivityLevel: "balanced" }, new Date("2026-03-01T00:00:00.000Z"))],
    workspaceState: h.workspaceState, leaseExpiresAt: null, leaseHolderPrincipalId: null, ownerUserId: "user-1",
    participants: [coordinator("row-parent")], ...stored, receipts: stored.receipts, budgetUsage: [], stopConditionHits: [], reviewDue: false,
    substrateReachable: true, substrateEmpty: false, coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
    recordedEvidence: evidenceOf(h), stageDispatchedAt: null, stageDispatchedAtByStage: new Map(),
  };
  const [room] = await withSubShapeChildren([parent], async () => h.db);
  const effects: WorkroomDriveEffects = {
    ...createSubShapeChildEffects(async () => h.db),
    persist: async (input) => {
      if (input.observationOnly) return;
      const written = mergeWorkroomDriveSnapshot(h.workspaceState, input.snapshot, { graphShape: input.graphShape });
      h.workspaceState = JSON.parse(JSON.stringify({ ...h.workspaceState, workroomDrive: written })) as Record<string, unknown>;
    },
    acquireLease: async () => "acquired",
    upsertAgentTask: async (input) => { h.upserts.push(`${input.taskId}@${input.stage.stageKey}`); return true; },
    deactivateAgentTask: async () => {},
  };
  const result = await runWorkroomDriveJob(now, { listRooms: async () => [room!], effects, reconcileNesting: async () => 0, reconcileNotifications: async () => {} });
  // The plan summary, with the snapshot the tick persisted (its stage, attention and ledger).
  const drive = h.workspaceState.workroomDrive as { stageKey: string | null; ledger: string[]; pendingAttention: { principalRef: string | null } | null };
  return { ...result.plans[0]!, stageKey: drive.stageKey, ledger: drive.ledger, attentionPrincipalRef: drive.pendingAttention?.principalRef ?? null };
}

const marking = (h: Harness) => (h.workspaceState.workroomDrive as { marking: DriveMarking }).marking;
const children = (h: Harness) => h.db.state.workrooms.filter((row: Row) => row.capsuleId !== "WC-PARENT");
const setChildDrive = (h: Harness, drive: Record<string, unknown>) => {
  for (const child of children(h)) child.workspaceState = { ...child.workspaceState, workroomDrive: drive };
};

describe("sub-shape child rooms through the runner (PR-3c-5)", () => {
  beforeEach(() => {
    Object.assign(flags.table, flags.original, { "sub-shape": true });
  });

  it("entering the stage creates exactly one contained child per cycle, stage and iteration, pinned to the declared version, owned like its parent", async () => {
    const h = parentWaitingAtB();
    const plan = await tick(h, at(0));
    expect(plan).toMatchObject({ action: "attention", reason: "awaiting_sub_shape", taskId: null });
    expect(h.upserts).toEqual([]);
    const [child] = children(h);
    expect(children(h)).toHaveLength(1);
    expect(child).toMatchObject({
      idempotencyKey: `sub-shape:WC-PARENT:${cycleOf(SUB_SEQ)}:b:0`,
      source: "scheduled-steward",
      status: "working",
      repositoryFullName: null,
      requestedByPrincipalId: "pr-overseer",
      createdByPrincipalId: null,
    });
    // Pinned to the declared key@version, and nothing else inherited: its only claim is the work-shape claim.
    expect((child!.scopeClaims as Row[]).filter((claim) => "workShape" in claim).map((claim) => claim.workShape)).toEqual(["graph-fixture@1.0.0"]);
    expect(h.db.state.participants.filter((row: Row) => row.workroomId === child!.id)).toEqual([
      expect.objectContaining({ principalId: "pr-overseer", roles: ["coordinator"], assignmentSource: "explicit" }),
    ]);
    expect(h.db.state.relations).toEqual([{ fromWorkroomId: "row-parent", toWorkroomId: child!.id, relation: "contains" }]);
    expect(h.db.state.activities.find((row: Row) => row.workCapsuleId === child!.id && row.kind === "created")?.recordedById).toBe(SUB_SHAPE_DRIVE_ACTOR.userId);
    expect(marking(h).children).toEqual({ [`${cycleOf(SUB_SEQ)}#b#0`]: { capsuleId: child!.capsuleId, ref: "graph-fixture@1.0.0" } });

    // Repeated ticks are idempotent: the same child, no second row, no second relation.
    for (const minutes of [15, 30]) expect(await tick(h, at(minutes))).toMatchObject({ reason: "awaiting_sub_shape" });
    expect(children(h)).toHaveLength(1);
    expect(h.db.state.relations).toHaveLength(1);
  });

  it("the child's success records child-completion on the parent, completes the child and removes the contains row in one transaction; the parent then advances", async () => {
    const h = parentWaitingAtB();
    await tick(h, at(0));
    const [child] = children(h);
    setChildDrive(h, { action: "stop", reason: "success" });
    expect(await tick(h, at(15))).toMatchObject({ action: "attention", reason: "awaiting_sub_shape" });
    const evidence = h.db.state.activities.filter((row: Row) => row.workCapsuleId === "row-parent" && row.kind === "evidence-recorded");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.payload).toMatchObject({
      kind: "child-completion", stageKey: "b", outcome: "completed",
      result: { childCapsuleId: child!.capsuleId, childShapeRef: "graph-fixture@1.0.0", disposition: "success", iteration: 0 },
    });
    expect(child!.status).toBe("complete");
    expect(h.db.state.relations).toEqual([]);
    expect(marking(h).children[`${cycleOf(SUB_SEQ)}#b#0`]?.state).toBe("completed");

    // The evidence earns b's receipt (after its token entered), and the step moves the token to c.
    const next = await tick(h, at(30));
    expect(next).toMatchObject({ action: "dispatch_agent", reason: "agent_stage", stageKey: "c" });
    expect(h.upserts).toEqual([`${workroomDriveTaskId("WC-PARENT", SUB_SEQ.key)}@c`]);
    // Never recorded twice.
    expect(h.db.state.activities.filter((row: Row) => row.workCapsuleId === "row-parent" && row.kind === "evidence-recorded")).toHaveLength(1);
  });

  it("a completion that fails part-way commits nothing (no evidence, child still working, relation kept) and is retried", async () => {
    const h = parentWaitingAtB();
    await tick(h, at(0));
    const [child] = children(h);
    setChildDrive(h, { action: "stop", reason: "success" });
    h.db.failNext.relationDelete = true;
    await tick(h, at(15));
    expect(h.db.state.activities.filter((row: Row) => row.workCapsuleId === "row-parent" && row.kind === "evidence-recorded")).toEqual([]);
    expect(h.db.state.workrooms.find((row: Row) => row.id === child!.id)?.status).toBe("working");
    expect(h.db.state.relations).toHaveLength(1);
    expect(marking(h).children[`${cycleOf(SUB_SEQ)}#b#0`]?.state).toBeUndefined();
    await tick(h, at(30));
    expect(h.db.state.workrooms.find((row: Row) => row.id === child!.id)?.status).toBe("complete");
    expect(h.db.state.relations).toEqual([]);
  });

  it("a child's failure or budget stop HOLDS the parent with sub_shape_stopped for its owner; the child is not completed and nothing is propagated", async () => {
    for (const reason of ["refused_to_stop", "conformance_stop"]) {
      const h = parentWaitingAtB();
      await tick(h, at(0));
      const [child] = children(h);
      setChildDrive(h, { action: "stop", reason });
      const plan = await tick(h, at(15));
      expect(plan, reason).toMatchObject({ action: "attention", reason: "sub_shape_stopped", stageKey: "b", attentionPrincipalRef: "agent:graph-worker" });
      expect(plan.ledger.join("\n")).toContain(`(${reason})`);
      expect(h.db.state.workrooms.find((row: Row) => row.id === child!.id)?.status).toBe("working");
      expect(h.db.state.relations).toHaveLength(1);
      expect(marking(h).tokens.map((token) => token.node)).toEqual(["stage:b"]);
      expect(h.db.state.activities.filter((row: Row) => row.workCapsuleId === "row-parent" && row.kind === "evidence-recorded")).toEqual([]);
    }
  });

  it("the next cycle abandons the previous cycle's live child, removing its contains row, and a new cycle gets a new child", async () => {
    const h = parentWaitingAtB();
    await tick(h, at(0));
    const [child] = children(h);
    await tick(h, new Date(T0.getTime() + 86_400_000));
    expect(h.db.state.workrooms.find((row: Row) => row.id === child!.id)?.status).toBe("abandoned");
    expect(h.db.state.activities.find((row: Row) => row.workCapsuleId === child!.id && row.kind === "status-override")?.summary).toContain("left the stage");
    expect(h.db.state.relations.filter((row: Row) => row.toWorkroomId === child!.id)).toEqual([]);
    expect(marking(h).cycleKey).toBe(cycleOf(SUB_SEQ, "2026-03-03"));
    expect(marking(h).children[`${cycleOf(SUB_SEQ)}#b#0`]?.state).toBe("abandoned");
    // The new cycle's pass through b gets its own child under its own key (the cycle key is in it), never the old one.
    const fresh = children(h).filter((row: Row) => row.id !== child!.id);
    expect(fresh.map((row: Row) => row.idempotencyKey)).toEqual([`sub-shape:WC-PARENT:${cycleOf(SUB_SEQ, "2026-03-03")}:b:0`]);
    expect(h.db.state.relations).toEqual([{ fromWorkroomId: "row-parent", toWorkroomId: fresh[0]!.id, relation: "contains" }]);
  });

  it("a rework across the stage abandons the stale child and creates the new pass's (planner)", () => {
    const definition = readWorkShapeDefinitionContract(SUB_IN_REWORK);
    const cycle = `${SUB_IN_REWORK.key}@${SUB_IN_REWORK.version}:${DAY}`;
    const plan = resolveDrivePlan({
      roomId: "WC-PARENT", definition, collaborationShape: null, postureLevel: "balanced", currentStageKey: "b",
      participants: projectPersistedWorkroomRoster({ assignments: [coordinator("row-parent")], presencePrincipalRefs: [] }),
      receipts: [{ stageKey: "a", kind: "stage-evidence-recorded", iteration: 1 }], budgetUsage: [], stopConditionHits: [], reviewDue: false,
      substrateReachable: true, substrateEmpty: false, now: at(0),
      coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
      workspaceState: { workroomDrive: { stageKey: "b", marking: {
        format: "drive-marking/1", cycleKey: cycle, tokens: [{ node: "stage:b", enteredAt: at(-5).toISOString() }],
        iterations: { a: 1, b: 1, decide: 1 }, reworkTaken: { "edge:decide->a": 1 }, deadlines: {},
        children: { [`${cycle}#b#0`]: { capsuleId: "WC-OLD", ref: "graph-fixture@1.0.0" } },
      } } },
      subShapeChildren: { "WC-OLD": { capsuleId: "WC-OLD", status: "working", action: "dispatch_agent", reason: "agent_stage" } },
    });
    expect(plan.subShapes?.abandon).toEqual([{ key: `${cycle}#b#0`, childCapsuleId: "WC-OLD", ref: "graph-fixture@1.0.0", reason: expect.stringContaining("left the stage") }]);
    expect(plan.subShapes?.ensure.map((entry) => [entry.key, entry.idempotencyKey])).toEqual([[`${cycle}#b#1`, `sub-shape:WC-PARENT:${cycle}:b:1`]]);
  });

  it("under the real flags (sub-shape off, BI-086DC167) the room pauses construct_not_executable and creates no child", async () => {
    Object.assign(flags.table, flags.original);
    expect(flags.table["sub-shape"]).toBe(false);
    const h = parentWaitingAtB();
    expect(await tick(h, at(0))).toMatchObject({ action: "pause", reason: "construct_not_executable" });
    expect(children(h)).toEqual([]);
  });
});

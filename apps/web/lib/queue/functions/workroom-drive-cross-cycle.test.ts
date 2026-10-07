// A graph instance survives a cycle boundary (BI-086DC167). FAILING BY DESIGN
// until the fix lands: these tests reproduce the defect on the tree they were
// committed to.
//
// Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §4.2 ("A marking belongs to one cycle"), §8 (stage deadline), §9 (sub-shape).
//
// The defect: readStoredDriveMarking (drive-marking.ts:244-245) discards a
// stored marking whenever its cycleKey differs from the tick's, and the tick's
// cycle key is `<key>@<version>:<UTC date>` for every shape
// (projectWorkShapeCycleBoundary, work-shapes.ts:510, reached from
// projectDriveCycle, drive-plan-stage.ts:113-121, which the runner calls with
// no override). So at UTC midnight every graph room restarts from the shape's
// start, whatever was in flight: token clocks, rework counters, deadlines and
// children are lost.
//
// Each case drives the real runner (runWorkroomDriveJob) through the same
// persist merge the transaction uses. The executable-construct table is a
// mutable copy with stage-deadline and sub-shape switched on (their real flags
// stay off until this item is fixed); parallel-split-join and rework-edge are
// already on. The fixtures are not registered (plan constraint 7), so the
// shape-claim resolver is overridden for their keys only.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEADLINE_FIXTURE } from "@/lib/work-management/__fixtures__/graph-shape-fixtures";
import { SPLIT_2 } from "@/lib/work-management/__fixtures__/graph-shapes/parallel";
import { REWORK_1 } from "@/lib/work-management/__fixtures__/graph-shapes/rework";
import { SUB_SEQ } from "@/lib/work-management/__fixtures__/graph-shapes/sub-shape";
import type { DriveMarking } from "@/lib/work-management/drive-marking";
import { workroomDriveTaskId } from "@/lib/work-management/drive-resolution";
import type { RecordedEvidence } from "@/lib/work-management/stage-evidence-receipts";
import type { WorkShapeDefinition } from "@/lib/work-management/work-shapes";
import { mergeWorkroomDriveSnapshot } from "@/lib/work-management/workroom-drive-snapshot-merge";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";
import { buildWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

import { runWorkroomDriveJob, type WorkroomDriveEffects, type WorkroomDriveRoom } from "./workroom-drive";
import { createSubShapeChildEffects, withSubShapeChildren } from "./workroom-drive-children";
import type { DeadlineNoticeInput } from "./workroom-drive-deadlines";

const flags = vi.hoisted(() => ({ table: {} as Record<string, boolean>, original: {} as Record<string, boolean> }));
vi.mock("@/lib/gpp/shape-language/executable-constructs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gpp/shape-language/executable-constructs")>();
  flags.original = { ...actual.CONSTRUCT_EXECUTABLE };
  flags.table = { ...actual.CONSTRUCT_EXECUTABLE };
  return { ...actual, CONSTRUCT_EXECUTABLE: flags.table };
});
vi.mock("@/lib/work-management/workroom-shape-claim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/work-management/workroom-shape-claim")>();
  const { DEADLINE_FIXTURE: deadline } = await import("@/lib/work-management/__fixtures__/graph-shape-fixtures");
  const { SPLIT_2: split } = await import("@/lib/work-management/__fixtures__/graph-shapes/parallel");
  const { REWORK_1: rework } = await import("@/lib/work-management/__fixtures__/graph-shapes/rework");
  const { SUB_SEQ: sub } = await import("@/lib/work-management/__fixtures__/graph-shapes/sub-shape");
  const known = [deadline, split, rework, sub];
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

/** The tables the child effects touch, in memory, with a transaction that rolls back on throw (as workroom-drive-children.test.ts). */
function memoryDb() {
  const state = { workrooms: [] as Row[], activities: [] as Row[], participants: [] as Row[], relations: [] as Row[] };
  let seq = 0;
  const match = (row: Row, where: Row) => Object.entries(where).every(([key, value]) =>
    value && typeof value === "object" && !Array.isArray(value) && "in" in value ? (value.in as unknown[]).includes(row[key]) : row[key] === value);
  const db: any = {
    state,
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

const HOUR_MS = 3_600_000;
const DAY = "2026-03-02";
const T0 = new Date(`${DAY}T09:00:00.000Z`);
const at = (ms: number) => new Date(T0.getTime() + ms);
const cycleOf = (shape: WorkShapeDefinition, day = DAY) => `${shape.key}@${shape.version}:${day}`;
const done = (stageKey: string, iteration?: number) => ({ stageKey, kind: "stage-evidence-recorded", ...(iteration !== undefined ? { iteration } : {}) });

type Harness = {
  shape: WorkShapeDefinition;
  db: ReturnType<typeof memoryDb>;
  workspaceState: Record<string, unknown>;
  activities: Array<{ kind: string; summary: string; payload: Record<string, unknown> }>;
  notices: DeadlineNoticeInput[];
  upserts: string[];
};

/** A graph room mid-instance: the given marking, with the given receipts, last ticked inside DAY. */
function room(shape: WorkShapeDefinition, marking: Omit<DriveMarking, "format" | "cycleKey">, receipts: Array<{ stageKey: string; kind: string; iteration?: number }>, stageKey: string): Harness {
  const db = memoryDb();
  db.state.workrooms.push({ id: "row-x", capsuleId: "WC-X", status: "working", requestedByPrincipalId: "pr-owner", createdByPrincipalId: null, workspaceState: {} });
  db.state.participants.push({ id: "part-0", workroomId: "row-x", principalId: "pr-overseer", roles: ["coordinator"], lifecycle: "active" });
  return {
    shape,
    db,
    activities: [],
    notices: [],
    upserts: [],
    workspaceState: { workroomDrive: {
      kind: "workroom-drive", version: 1, action: "dispatch_agent", reason: "agent_stage", stageKey, lastCycleKey: cycleOf(shape),
      lastRunAt: T0.toISOString(), receipts,
      marking: { format: "drive-marking/1", cycleKey: cycleOf(shape), ...marking },
    } },
  };
}

function coordinator() {
  return {
    workroomId: "row-x", principalRef: "PRN-COORD", roles: ["coordinator" as const], assignmentSource: "explicit" as const, enteredReason: null,
    currentWorkSummary: null, displayName: "Overseer", kind: "agent" as const, sponsorPrincipalRef: null, sponsorDisplayName: null,
    authoritySummary: "Acts within process-coordination authority",
  };
}

function evidenceOf(h: Harness): RecordedEvidence[] {
  return h.db.state.activities
    .filter((row: Row) => row.workCapsuleId === "row-x" && row.kind === "evidence-recorded")
    .map((row: Row) => ({ stageKey: row.payload.stageKey ?? null, kind: row.payload.kind ?? null, outcome: row.payload.outcome ?? null, recordedAt: row.recordedAt }));
}

async function tick(h: Harness, now: Date) {
  const stored = readStoredWorkroomDriveState(h.workspaceState);
  const parent: WorkroomDriveRoom = {
    id: "row-x", capsuleId: "WC-X", objective: "Objective",
    scopeClaims: [buildWorkShapeClaim({ key: h.shape.key, version: h.shape.version }), buildWorkroomPostureClaim({ proactivityLevel: "balanced" }, new Date("2026-03-01T00:00:00.000Z"))],
    workspaceState: h.workspaceState, leaseExpiresAt: null, leaseHolderPrincipalId: null, ownerUserId: "user-1",
    participants: [coordinator()], ...stored, receipts: stored.receipts, budgetUsage: [], stopConditionHits: [], reviewDue: false,
    substrateReachable: true, substrateEmpty: false, coordinatorEligibility: { jsi: "eligible", authorityBinding: "eligible" },
    recordedEvidence: evidenceOf(h), stageDispatchedAt: null, stageDispatchedAtByStage: new Map(),
  };
  const [loaded] = await withSubShapeChildren([parent], async () => h.db);
  const effects: WorkroomDriveEffects = {
    ...createSubShapeChildEffects(async () => h.db),
    persist: async (input) => {
      if (!input.quiet) h.activities.push({ kind: input.activityKind, summary: input.summary, payload: input.payload });
      if (input.observationOnly) return;
      const written = mergeWorkroomDriveSnapshot(h.workspaceState, input.snapshot, { graphShape: input.graphShape });
      h.workspaceState = JSON.parse(JSON.stringify({ ...h.workspaceState, workroomDrive: written })) as Record<string, unknown>;
    },
    acquireLease: async () => "acquired",
    upsertAgentTask: async (input) => { h.upserts.push(`${input.taskId}@${input.stage.stageKey}`); return true; },
    deactivateAgentTask: async () => {},
    notifyDeadline: async (input) => { h.notices.push(input); return true; },
  };
  const result = await runWorkroomDriveJob(now, { listRooms: async () => [loaded!], effects, reconcileNesting: async () => 0, reconcileNotifications: async () => {} });
  return result.plans[0]!;
}

const marking = (h: Harness) => (h.workspaceState.workroomDrive as { marking: DriveMarking }).marking;
/** What an in-flight instance is made of; the cycle key is left out on purpose (the fix chooses how it is carried). */
const instance = (h: Harness) => {
  const { tokens, iterations, reworkTaken, children } = marking(h);
  return { tokens: tokens.map((token) => ({ node: token.node, enteredAt: token.enteredAt })), iterations, reworkTaken, children };
};

describe("BI-086DC167: a graph instance in flight at a cycle boundary is not discarded", () => {
  beforeEach(() => {
    Object.assign(flags.table, flags.original, { "stage-deadline": true, "sub-shape": true });
  });

  describe("AC-GRAPH-CROSS-CYCLE", () => {
    it("a parallel instance with both branches in flight keeps its tokens and their entry times across UTC midnight", async () => {
      const entered = `${DAY}T20:00:00.000Z`;
      const h = room(SPLIT_2, {
        tokens: [{ node: "stage:b", enteredAt: entered }, { node: "stage:c", enteredAt: entered }],
        iterations: {}, reworkTaken: {}, deadlines: {}, children: {},
      }, [done("a")], "b");
      await tick(h, new Date(`${DAY}T23:45:00.000Z`));
      const before = instance(h);
      expect(before.tokens).toEqual([{ node: "stage:b", enteredAt: entered }, { node: "stage:c", enteredAt: entered }]);

      for (const time of ["2026-03-03T00:00:00.000Z", "2026-03-03T00:15:00.000Z", "2026-03-03T09:00:00.000Z"]) {
        await tick(h, new Date(time));
        expect(instance(h), time).toEqual(before);
      }
    });

    it("a rework instance keeps its iterations and rework counters across UTC midnight, so its bound is not reset", async () => {
      const entered = `${DAY}T22:00:00.000Z`;
      const h = room(REWORK_1, {
        tokens: [{ node: "stage:a", enteredAt: entered }],
        iterations: { a: 1, b: 1 }, reworkTaken: { "edge:b->a": 1 }, deadlines: {}, children: {},
      }, [done("a"), done("b")], "a");
      await tick(h, new Date(`${DAY}T23:45:00.000Z`));
      const before = instance(h);
      expect(before).toEqual({ tokens: [{ node: "stage:a", enteredAt: entered }], iterations: { a: 1, b: 1 }, reworkTaken: { "edge:b->a": 1 }, children: {} });

      for (const time of ["2026-03-03T00:00:00.000Z", "2026-03-03T00:15:00.000Z"]) {
        await tick(h, new Date(time));
        expect(instance(h), time).toEqual(before);
      }
    });
  });

  describe("AC-DEADLINE-MULTIDAY", () => {
    it("a 48-hour stage deadline fires once, at 48 hours, and is notified once", async () => {
      // DEADLINE_FIXTURE: a → b, b's deadline afterDays 2 ("Two days."). b entered at T0 and was dispatched (it latches).
      const h = room(DEADLINE_FIXTURE, {
        tokens: [{ node: "stage:b", enteredAt: T0.toISOString(), taskId: workroomDriveTaskId("WC-X", DEADLINE_FIXTURE.key), lastAction: "dispatch_agent", lastReason: "agent_stage", lastCycleKey: cycleOf(DEADLINE_FIXTURE) }],
        iterations: {}, reworkTaken: {}, deadlines: {}, children: {},
      }, [done("a")], "b");

      const raisedAtHour: number[] = [];
      for (let hour = 1; hour <= 50; hour += 1) {
        const before = h.activities.length;
        await tick(h, at(hour * HOUR_MS));
        if (h.activities.slice(before).some((activity) => activity.kind === "workroom-drive-deadline")) raisedAtHour.push(hour);
      }

      expect(raisedAtHour).toEqual([48]);
      const deadlines = Object.values(marking(h).deadlines);
      expect(deadlines).toEqual([{ raisedAt: at(48 * HOUR_MS).toISOString(), notifiedAt: at(49 * HOUR_MS).toISOString() }]);
      expect(h.notices.map((call) => [call.notice.stageKey, call.now.toISOString()])).toEqual([["b", at(49 * HOUR_MS).toISOString()]]);
    });
  });

  describe("AC-CHILD-SURVIVES-BOUNDARY", () => {
    it("a sub-shape child running across UTC midnight is not abandoned, no second child is created, and its success still advances the parent", async () => {
      const h = room(SUB_SEQ, {
        tokens: [{ node: "stage:b", enteredAt: at(-30 * 60_000).toISOString() }],
        iterations: {}, reworkTaken: {}, deadlines: {}, children: {},
      }, [done("a")], "b");
      const children = () => h.db.state.workrooms.filter((row: Row) => row.capsuleId !== "WC-X");

      expect(await tick(h, at(0))).toMatchObject({ action: "attention", reason: "awaiting_sub_shape" });
      expect(children()).toHaveLength(1);
      const [child] = children();
      const before = instance(h);

      for (const time of ["2026-03-03T00:00:00.000Z", "2026-03-03T00:15:00.000Z", "2026-03-03T09:00:00.000Z"]) {
        expect(await tick(h, new Date(time)), time).toMatchObject({ action: "attention", reason: "awaiting_sub_shape" });
        expect(h.db.state.workrooms.find((row: Row) => row.id === child!.id)?.status, time).toBe("working");
        expect(h.db.state.relations, time).toEqual([{ fromWorkroomId: "row-x", toWorkroomId: child!.id, relation: "contains" }]);
        expect(children(), time).toHaveLength(1);
        expect(instance(h), time).toEqual(before);
      }

      // The child finishes on the second day: its completion is recorded and the parent moves on to c.
      child!.workspaceState = { workroomDrive: { action: "stop", reason: "success" } };
      await tick(h, new Date("2026-03-03T09:15:00.000Z"));
      expect(h.db.state.workrooms.find((row: Row) => row.id === child!.id)?.status).toBe("complete");
      expect(await tick(h, new Date("2026-03-03T09:30:00.000Z"))).toMatchObject({ action: "dispatch_agent", reason: "agent_stage" });
      expect(h.upserts.at(-1)).toBe(`${workroomDriveTaskId("WC-X", SUB_SEQ.key)}@c`);
    });
  });
});

// Governed work-shape rebind (BI-CB5C0DCE, OBJ-GATE: AC-GATE-1, AC-GATE-2).

import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "dependency-advisory-watch";

vi.mock("./work-shape-prior-versions", async () => {
  const { STANDING_SHAPES } = await import("./standing-operations-shapes");
  const current = Object.values(STANDING_SHAPES).find((shape) => shape.key === "dependency-advisory-watch")!;
  const [first, ...rest] = current.stages;
  return {
    WORK_SHAPE_PRIOR_VERSIONS: [
      // 0.8.0 reached one more tool than current: moving up narrows.
      { ...current, version: "0.8.0", stages: [{ ...first!, tools: [...(first!.tools ?? []), "retired_tool"] }, ...rest] },
      // 0.9.0 held no grants: moving up widens.
      { ...current, version: "0.9.0", grants: [] },
    ],
  };
});

const accountability = vi.hoisted(() => ({ value: { state: "resolved", principalId: "PRN-OWNER" } as Record<string, unknown> }));
vi.mock("./room-workforce.server", () => ({
  loadRoomAccountabilityBatch: async (_db: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, { accountability: accountability.value, accountableDisplayName: "Owner Person" }])),
}));
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn() }));

import { getWorkShape } from "./work-shapes";
import { rebindWorkroomShapeForUser, type ShapeRebindDb } from "./workroom-shape-rebind.server";

const current = getWorkShape(KEY)!;

function makeDb(room: Record<string, unknown> | null, options: { casMiss?: boolean; callerPrincipal?: string } = {}) {
  const activities: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    workroom: {
      findUnique: vi.fn(async () => room),
      findFirst: vi.fn(async () => room),
      findMany: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        if (options.casMiss) throw Object.assign(new Error("No record"), { code: "P2025" });
        updates.push(args as Record<string, unknown>);
        return { ...room, ...args.data };
      }),
    },
    workroomActivity: { create: vi.fn(async (args: { data: Record<string, unknown> }) => { activities.push(args.data); return { id: `ACT-${activities.length}` }; }) },
    principal: { findFirst: vi.fn(async () => ({ id: options.callerPrincipal ?? "PRN-OWNER" })) },
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return { db: db as unknown as ShapeRebindDb, activities, updates };
}

function room(pinned: string, workspaceState: unknown = {}) {
  return {
    id: "row-1",
    capsuleId: "WC-ROOM",
    scopeClaims: [{ workShape: pinned, recordedAt: "2026-09-01T00:00:00.000Z" }],
    workspaceState,
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    archivedAt: null,
  };
}

const base = { roomRowId: "row-1", userId: "user-1", callerHasManagePlatform: false, toVersion: current.version };

beforeEach(() => { accountability.value = { state: "resolved", principalId: "PRN-OWNER" }; });

describe("rebind refusals (AC-GATE-1)", () => {
  it("refuses a caller who is neither the owner nor a platform manager", async () => {
    const { db } = makeDb(room(`${KEY}@0.8.0`), { callerPrincipal: "PRN-SOMEONE" });
    const result = await rebindWorkroomShapeForUser(db, base);
    expect(result).toMatchObject({ ok: false, code: "not_authorized" });
  });

  it("lets a platform manager rebind a room they do not own", async () => {
    const { db } = makeDb(room(`${KEY}@0.8.0`), { callerPrincipal: "PRN-SOMEONE" });
    const result = await rebindWorkroomShapeForUser(db, { ...base, callerHasManagePlatform: true, dryRun: true });
    expect(result.ok).toBe(true);
  });

  it("refuses a target that is not the current version", async () => {
    const { db } = makeDb(room(`${KEY}@0.8.0`));
    expect(await rebindWorkroomShapeForUser(db, { ...base, toVersion: "0.9.0" })).toMatchObject({ code: "target_not_current" });
  });

  it("refuses a move to the version the room already runs, or below it", async () => {
    const { db } = makeDb(room(`${KEY}@${current.version}`));
    expect(await rebindWorkroomShapeForUser(db, base)).toMatchObject({ code: "not_an_upgrade" });
  });

  it("refuses a change of shape key", async () => {
    const { db } = makeDb(room(`${KEY}@0.8.0`));
    expect(await rebindWorkroomShapeForUser(db, { ...base, toKey: "payables-watch" })).toMatchObject({ code: "key_change" });
  });

  it("refuses while a dispatched stage has no completing receipt", async () => {
    const stageKey = current.stages[0]!.key;
    const { db, updates } = makeDb(room(`${KEY}@0.8.0`, { workroomDrive: { action: "dispatch_agent", stageKey, receipts: [] } }));
    expect(await rebindWorkroomShapeForUser(db, base)).toMatchObject({ code: "stage_in_flight" });
    expect(updates).toHaveLength(0);
  });

  it("refuses a widening without a rationale, and accepts a narrowing without one", async () => {
    expect(current.grants.length).toBeGreaterThan(0);
    const widening = makeDb(room(`${KEY}@0.9.0`));
    expect(await rebindWorkroomShapeForUser(widening.db, base)).toMatchObject({ code: "rationale_required" });
    const narrowing = makeDb(room(`${KEY}@0.8.0`));
    expect(await rebindWorkroomShapeForUser(narrowing.db, base)).toMatchObject({ ok: true, data: { applied: true } });
  });

  it("refuses a room that does not exist", async () => {
    const { db } = makeDb(null);
    expect(await rebindWorkroomShapeForUser(db, base)).toMatchObject({ code: "room_not_found" });
  });
});

describe("a successful rebind (AC-GATE-2)", () => {
  it("dryRun returns the diff and writes nothing", async () => {
    const { db, updates, activities } = makeDb(room(`${KEY}@0.9.0`));
    const result = await rebindWorkroomShapeForUser(db, { ...base, dryRun: true });
    expect(result).toMatchObject({ ok: true, data: { applied: false } });
    if (result.ok) expect(result.data.diff.classification).toBe("widening");
    expect(updates).toHaveLength(0);
    expect(activities).toHaveLength(0);
  });

  it("writes the claim behind compare-and-set, the decision evidence, and the activity", async () => {
    const { db, updates, activities } = makeDb(room(`${KEY}@0.9.0`));
    const result = await rebindWorkroomShapeForUser(db, { ...base, rationale: "The new read tools are needed." });
    expect(result).toMatchObject({ ok: true, data: { applied: true, fromRef: `${KEY}@0.9.0`, toRef: `${KEY}@${current.version}` } });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.where).toMatchObject({ capsuleId: "WC-ROOM", updatedAt: new Date("2026-10-01T00:00:00Z") });
    const claims = (updates[0]!.data as { scopeClaims: Array<Record<string, unknown>> }).scopeClaims;
    expect(claims.filter((claim) => "workShape" in claim).map((claim) => claim.workShape)).toEqual([`${KEY}@${current.version}`]);
    const [evidence, rebound] = activities;
    expect(evidence).toMatchObject({ kind: "evidence-recorded" });
    const payload = evidence!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ kind: "decision-record", result: { decision: "workshape-rebind", classification: "widening", rationale: "The new read tools are needed." } });
    expect(payload.stageKey).toBeUndefined();
    expect(rebound).toMatchObject({ kind: "workshape-rebound" });
  });

  it("reports a conflict when a concurrent scope change wins", async () => {
    const { db, activities } = makeDb(room(`${KEY}@0.8.0`), { casMiss: true });
    expect(await rebindWorkroomShapeForUser(db, base)).toMatchObject({ ok: false, code: "rebind_conflict" });
    expect(activities).toHaveLength(0);
  });
});

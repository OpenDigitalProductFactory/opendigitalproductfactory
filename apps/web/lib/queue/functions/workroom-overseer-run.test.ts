// BI-8E1486FA — the overseer duty's cycle, writers and drive wiring.

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  releaseWorkCapsuleScope: vi.fn(async () => ({})),
  updateWorkCapsuleStatus: vi.fn(async () => ({})),
}));
vi.mock("@/lib/work-capsules/work-capsule-store", () => store);
vi.mock("@/lib/work-capsules/activity-events", () => ({ publishRecordedWorkCapsuleActivity: vi.fn() }));

import { buildWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { EMPTY_OVERSEER_STATE, WORKROOM_OVERSEER_ACTIVITY_KIND, type OverseerRoom } from "@/lib/work-management/workroom-overseer-duty";
import { runWorkroomDriveJob, type WorkroomDriveEffects, type WorkroomDriveRoom } from "./workroom-drive";
import { createOverseerEffects, overseerAssigneeOf, runDriveOverseer, runOverseerDuty, toOverseerRoom, type OverseerEffects } from "./workroom-overseer-run";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const DAYS_AGO = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function overseerRoom(over: Partial<OverseerRoom> = {}): OverseerRoom {
  return {
    id: "row-1", capsuleId: "WC-ROOM1", status: "ready", idempotencyKey: null, shapeKey: "delivery-medium",
    itemKey: "BI-ITEM1", itemStatus: "in-progress", itemEffortSize: "medium", leaseExpiresAt: null, merged: null,
    openPullRequest: false, pullRequestNumber: null, authoredHead: true, hold: null, driveAction: null, driveReason: null,
    assigneePrincipalRef: "PRN-OVERSEER", overseer: EMPTY_OVERSEER_STATE, inScan: true, ...over,
  };
}

/** An in-memory estate the effects write back to, so a second cycle reads the first one's writes. */
function estate(rooms: OverseerRoom[]) {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const trail: Array<{ roomId: string; rule: string; summary: string }> = [];
  const effects: OverseerEffects = {
    close: vi.fn(async (action) => {
      byId.set(action.room.id, { ...action.room, status: "archived" });
      trail.push({ roomId: action.room.id, rule: action.rule, summary: action.summary });
      return true;
    }),
    record: vi.fn(async (action) => {
      byId.set(action.room.id, { ...action.room, overseer: action.next });
      trail.push({ roomId: action.room.id, rule: action.rule, summary: action.summary });
      return true;
    }),
  };
  return { byId, trail, effects, loadRooms: async () => [...byId.values()] };
}

describe("runOverseerDuty", () => {
  it("acts once per room, names the rule on the trail, and does nothing on the second cycle", async () => {
    const world = estate([
      overseerRoom({ id: "done", capsuleId: "WC-DONE", itemKey: "BI-DONE", itemStatus: "done", merged: true, pullRequestNumber: 6532 }),
      overseerRoom({ id: "stale", capsuleId: "WC-STALE", itemKey: "BI-STALE", merged: false, leaseExpiresAt: DAYS_AGO(6) }),
      overseerRoom({ id: "quiet", capsuleId: "WC-QUIET", itemKey: "BI-QUIET" }),
    ]);
    const first = await runOverseerDuty({ now: NOW, dryRun: false, loadRooms: world.loadRooms, effects: world.effects, log: () => {} });
    expect(first.fired).toMatchObject({ R1: 1, R3: 1 });
    expect(first.closedRoomIds).toEqual(["done"]);
    expect(world.trail.map((row) => [row.roomId, row.rule])).toEqual([["done", "R1"], ["stale", "R3"]]);
    expect(world.trail.every((row) => row.summary.startsWith(`Overseer ${row.rule}`))).toBe(true);

    const second = await runOverseerDuty({ now: NOW, dryRun: false, loadRooms: world.loadRooms, effects: world.effects, log: () => {} });
    expect(second.fired).toEqual({ R1: 0, R2: 0, R3: 0, R4: 0, R5: 0 });
    expect(second.cleared).toBe(0);
    expect(world.trail).toHaveLength(2);
  });

  it("raises one attention item per room however many cycles see it", async () => {
    const world = estate([overseerRoom({ merged: false, leaseExpiresAt: DAYS_AGO(6) })]);
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await runOverseerDuty({ now: NOW, dryRun: false, loadRooms: world.loadRooms, effects: world.effects, log: () => {} });
    }
    expect(world.effects.record).toHaveBeenCalledTimes(1);
    expect(world.byId.get("row-1")?.overseer.attention?.rule).toBe("R3");
  });

  it("logs the summary and writes nothing on a dry run", async () => {
    const world = estate([overseerRoom({ itemStatus: "done" })]);
    const log = vi.fn();
    const summary = await runOverseerDuty({ now: NOW, dryRun: true, loadRooms: world.loadRooms, effects: world.effects, log });
    expect(summary.fired.R1).toBe(1);
    expect(world.effects.close).not.toHaveBeenCalled();
    expect(summary.closedRoomIds).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[workroom-overseer] dry-run considered=1 R1=1"));
  });

  it("counts a refused or failing writer and goes on to the next room", async () => {
    const world = estate([overseerRoom({ itemStatus: "done" }), overseerRoom({ id: "b", capsuleId: "WC-B", itemKey: "BI-B", itemStatus: "retired" })]);
    world.effects.close = vi.fn().mockRejectedValueOnce(new Error("cas lost")).mockResolvedValueOnce(true);
    const summary = await runOverseerDuty({ now: NOW, dryRun: false, loadRooms: world.loadRooms, effects: world.effects, log: () => {} });
    expect(summary.refused).toBe(1);
    expect(summary.closedRoomIds).toEqual(["b"]);
  });
});

describe("reading a room", () => {
  const row = {
    id: "row-1", capsuleId: "WC-ROOM1", title: "t", status: "ready", source: "external-adoption", executorKind: "claude-desktop",
    idempotencyKey: null, scopeClaims: [buildWorkShapeClaim({ key: "delivery-medium", version: "1.0.0" })],
    workspaceState: { workroomDrive: { action: "attention", reason: "role_stage", conformance: { processOverseerPrincipalRef: "PRN-PO" },
      hold: { key: "attention|role_stage|design-note", since: "2026-10-20T00:00:00.000Z", ticks: 9 } } },
    backlogItemId: "row-item", leaseExpiresAt: null, lastSyncedAt: null, updatedAt: NOW, repositoryFullName: "o/r", headBranch: "feat/x",
    headSha: "a".repeat(40), baseSha: "a".repeat(40), pullRequestNumber: null, pullRequestUrl: null, worktreePath: null, featureBuildId: null,
    participants: [{ roles: ["accountable"], principal: { principalId: "PRN-ACC" } }],
  };

  it("maps the item, merge state, hold and overseer", () => {
    const room = toOverseerRoom(row, { id: "row-item", itemId: "BI-ITEM1", status: "done", effortSize: null },
      { deliveredSignal: { merged: true }, pullRequestObservation: null }, true);
    expect(room).toMatchObject({ itemKey: "BI-ITEM1", itemStatus: "done", itemEffortSize: null, merged: true, openPullRequest: false,
      shapeKey: "delivery-medium", driveAction: "attention", assigneePrincipalRef: "PRN-PO", inScan: true });
    expect(room.hold?.ticks).toBe(9);
    // A head equal to the claim-time base is not an authored head (BI-A7797C2C).
    expect(room.authoredHead).toBe(false);
  });

  it("reads an open PR observation as an open pull request", () => {
    const observedAt = NOW;
    expect(toOverseerRoom(row, null, { deliveredSignal: null, pullRequestObservation: { state: "open", observedAt } }, true).openPullRequest).toBe(true);
  });

  it("reads unknown merge state as unknown, never as unmerged", () => {
    expect(toOverseerRoom(row, null, { deliveredSignal: null, pullRequestObservation: null }, true).merged).toBeNull();
  });

  it("falls back from the recorded Process Overseer to the coordinator, then the accountable participant", () => {
    expect(overseerAssigneeOf({ workspaceState: {}, participants: row.participants })).toBe("PRN-ACC");
    expect(overseerAssigneeOf({ workspaceState: {}, participants: [
      { roles: ["accountable"], principal: { principalId: "PRN-ACC" } }, { roles: ["coordinator"], principal: { principalId: "PRN-CO" } },
    ] })).toBe("PRN-CO");
    expect(overseerAssigneeOf({ workspaceState: {}, participants: [] })).toBeNull();
  });
});

describe("the governed writers", () => {
  beforeEach(() => {
    store.releaseWorkCapsuleScope.mockClear();
    store.updateWorkCapsuleStatus.mockClear();
  });

  function fakeDb(current: Record<string, unknown>) {
    const activity: Array<Record<string, unknown>> = [];
    const db = {
      workroom: {
        findUnique: vi.fn(async () => current),
        updateMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(),
      },
      workroomActivity: { create: vi.fn(async (args: { data: Record<string, unknown> }) => { activity.push(args.data); return { id: `act-${activity.length}` }; }) },
      backlogItem: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    } as Record<string, unknown> & { workroom: { updateMany: ReturnType<typeof vi.fn> } };
    (db as Record<string, unknown>).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
    return { db, activity };
  }

  it("closes through scope release and the delivered close-out, then writes the rule's trail row", async () => {
    const claim = { kind: "path", value: "apps/web/x.ts", intent: "edit", recordedAt: NOW.toISOString(), recordedByPrincipalId: "PRN-1" };
    const { db, activity } = fakeDb({ id: "row-1", status: "ready", scopeClaims: [claim] });
    const effects = createOverseerEffects(async () => db as never);
    const ok = await effects.close({ kind: "close", rule: "R1", room: overseerRoom(), summary: "Overseer R1: done.", facts: {} }, NOW);
    expect(ok).toBe(true);
    expect(store.releaseWorkCapsuleScope).toHaveBeenCalledWith(expect.objectContaining({ capsuleId: "WC-ROOM1", claims: [{ kind: "path", value: "apps/web/x.ts" }] }));
    expect(store.updateWorkCapsuleStatus).toHaveBeenCalledWith(expect.objectContaining({ capsuleId: "WC-ROOM1", status: "archived", reason: "Overseer R1: done." }));
    expect(activity[0]).toMatchObject({ kind: WORKROOM_OVERSEER_ACTIVITY_KIND, payload: { rule: "R1", action: "close" } });
  });

  it("does not close a room another writer already closed", async () => {
    const { db } = fakeDb({ id: "row-1", status: "archived", scopeClaims: [] });
    const ok = await createOverseerEffects(async () => db as never)
      .close({ kind: "close", rule: "R2", room: overseerRoom(), summary: "s", facts: {} }, NOW);
    expect(ok).toBe(false);
    expect(store.updateWorkCapsuleStatus).not.toHaveBeenCalled();
  });

  it("records overseer state by compare-and-set, keeping the rest of the workspace", async () => {
    const { db, activity } = fakeDb({ status: "ready", updatedAt: NOW, workspaceState: { workroomDrive: { action: "pause" } } });
    const next = { ...EMPTY_OVERSEER_STATE, needsResume: { since: NOW.toISOString(), leaseExpiredAt: NOW.toISOString() } };
    const ok = await createOverseerEffects(async () => db as never)
      .record({ kind: "route", rule: "R3", room: overseerRoom(), summary: "Overseer R3: s", next, facts: {} }, NOW);
    expect(ok).toBe(true);
    expect(db.workroom.updateMany).toHaveBeenCalledWith({ where: { id: "row-1", updatedAt: NOW },
      data: { workspaceState: { workroomDrive: { action: "pause" }, workroomOverseer: next } } });
    expect(activity[0]).toMatchObject({ kind: WORKROOM_OVERSEER_ACTIVITY_KIND, payload: { rule: "R3", action: "route" } });
  });

  it("refuses when the stored overseer state changed since the cycle read it", async () => {
    const stored = { ...EMPTY_OVERSEER_STATE, needsResume: { since: "x", leaseExpiredAt: "y" } };
    const { db } = fakeDb({ status: "ready", updatedAt: NOW, workspaceState: { workroomOverseer: stored } });
    const ok = await createOverseerEffects(async () => db as never)
      .record({ kind: "route", rule: "R3", room: overseerRoom(), summary: "s", next: EMPTY_OVERSEER_STATE, facts: {} }, NOW);
    expect(ok).toBe(false);
    expect(db.workroom.updateMany).not.toHaveBeenCalled();
  });
});

describe("the drive cycle runs the duty first", () => {
  const SHAPE = "obligation-assurance-watch";
  function driveRoom(id: string): WorkroomDriveRoom {
    return {
      id, capsuleId: `WC-${id}`, scopeClaims: [buildWorkShapeClaim({ key: SHAPE, version: "1.0.0" })], workspaceState: {},
      leaseExpiresAt: null, leaseHolderPrincipalId: null, ownerUserId: "user-1", participants: [], currentStageKey: null,
      receipts: [], budgetUsage: [], stopConditionHits: [], reviewDue: false, substrateReachable: true, substrateEmpty: false,
    };
  }
  const effects = () => ({
    persist: vi.fn<WorkroomDriveEffects["persist"]>(async () => {}),
    acquireLease: vi.fn<WorkroomDriveEffects["acquireLease"]>(async () => "acquired"),
    upsertAgentTask: vi.fn<WorkroomDriveEffects["upsertAgentTask"]>(async () => true),
    deactivateAgentTask: vi.fn<WorkroomDriveEffects["deactivateAgentTask"]>(async () => {}),
  });

  it("does not drive a room the overseer closed, and reports the summary", async () => {
    const fx = effects();
    const overseer = vi.fn(async (ids: readonly string[]) => ({
      dryRun: false, considered: ids.length, fired: { R1: 1, R2: 0, R3: 0, R4: 0, R5: 0 }, cleared: 0, refused: 0, closedRoomIds: ["closed"],
    }));
    const result = await runWorkroomDriveJob(NOW, { listRooms: async () => [driveRoom("closed"), driveRoom("open")], effects: fx, overseer });
    expect(overseer).toHaveBeenCalledWith(["closed", "open"], NOW);
    expect(result.scanned).toBe(1);
    expect(fx.persist.mock.calls.map(([call]) => call.roomId)).not.toContain("closed");
    expect(result.overseer?.fired.R1).toBe(1);
  });

  it("skips the duty for caller-supplied rooms unless one is given, and survives a failing duty", async () => {
    const result = await runWorkroomDriveJob(NOW, { listRooms: async () => [driveRoom("a")], effects: effects() });
    expect(result.overseer).toBeNull();
    await expect(runDriveOverseer([{ id: "a" }], NOW, async () => { throw new Error("db down"); })).resolves.toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  STAGE_BACKFILL_ACTOR,
  STAGE_BACKFILL_ROOM_PAGE,
  STAGE_BACKFILL_STAGING_ACTOR,
  backfillWorkroomStageTelemetry,
  replayDriveLog,
  type StageBackfillDeps,
} from "./workroom-stage-backfill";

const SHAPE = "delivery-small@1.0.0";
const t = (day: number, hour = 0) => new Date(Date.UTC(2026, 8, day, hour));
const tick = (day: number, hour: number, action: string, reason: string, stageKey: string | null) => ({
  recordedAt: t(day, hour),
  payload: { action, reason, stageKey, lastCycleKey: null },
});

describe("replayDriveLog", () => {
  it("replays each room's trail oldest-first through the live planner", () => {
    const out = replayDriveLog(
      [
        {
          capsuleId: "WC-1",
          scopeClaims: [{ workShape: SHAPE }],
          rows: [
            tick(23, 2, "pause", "conformance_pause", "repair"),
            tick(23, 1, "dispatch_agent", "agent_stage", "repair"),
            tick(25, 9, "dispatch_agent", "agent_stage", "repair"),
          ],
        },
      ],
      t(30),
    );
    expect(out.map((r) => [r.transition, r.laneKey])).toEqual([
      ["enqueued", null],
      ["started", null],
      ["held", "conformance_pause"],
      ["released", null],
      ["started", null],
    ]);
  });

  it("reproduces the 23 September pile from the drive rows as written: held at the first stage, missing coordinator", () => {
    // The live rows: the rooms never entered a stage, and the drive wrote the
    // deviation into its ledger, not into conformance.deviations.
    const paused = (hour: number) => ({
      recordedAt: t(23, hour),
      payload: {
        action: "pause",
        reason: "conformance_pause",
        stageKey: null,
        lastCycleKey: null,
        ledger: ["missing_explicit_coordinator: An executable room requires exactly one explicit Process Overseer."],
      },
    });
    const rooms = Array.from({ length: 200 }, (_, i) => ({
      capsuleId: `WC-${i}`,
      scopeClaims: [{ workShape: SHAPE }],
      rows: [paused(5), paused(6), paused(7)],
    }));
    const out = replayDriveLog(rooms, t(30));
    const held = out.filter((r) => r.transition === "held");
    expect(held).toHaveLength(200);
    expect(new Set(held.map((r) => r.laneKey))).toEqual(new Set(["conformance_pause:missing_explicit_coordinator"]));
    expect(new Set(held.map((r) => r.queueKey))).toEqual(new Set([`wr:${SHAPE}:reproduce`]));
    expect(out).toHaveLength(400);
  });

  it("skips rooms with no declared shape and rows at or after the cut-off", () => {
    expect(replayDriveLog([{ capsuleId: "WC-x", scopeClaims: [], rows: [tick(23, 0, "dispatch_agent", "agent_stage", "a")] }], t(30))).toEqual([]);
    expect(replayDriveLog([{ capsuleId: "WC-y", scopeClaims: [{ workShape: SHAPE }], rows: [tick(23, 0, "dispatch_agent", "agent_stage", "a")] }], t(23))).toEqual([]);
  });
});

describe("backfillWorkroomStageTelemetry", () => {
  const deps = (overrides: Partial<StageBackfillDeps> = {}) => {
    const inserted: unknown[] = [];
    const days: string[] = [];
    const d: StageBackfillDeps = {
      alreadyBackfilled: async () => false,
      clearSuperseded: async () => [],
      firstLiveEventAt: async () => t(26),
      listDriveLogRooms: async () => ["WC-1"],
      loadDriveLog: async (ids) => ids.includes("WC-1") ? [
        {
          capsuleId: "WC-1",
          scopeClaims: [{ workShape: SHAPE }],
          rows: [tick(23, 1, "dispatch_agent", "agent_stage", "repair"), tick(24, 1, "stop", "success", null), tick(27, 1, "dispatch_agent", "agent_stage", "x")],
        },
      ] : [],
      insert: async (rows) => {
        inserted.push(...rows);
        return rows.length;
      },
      commit: async () => {},
      aggregateDay: async (at) => {
        days.push(at.toISOString().slice(0, 10));
      },
      now: () => t(30),
      ...overrides,
    };
    return { d, inserted, days };
  };

  it("does nothing once a backfill exists", async () => {
    const { d, inserted } = deps({ alreadyBackfilled: async () => true });
    expect(await backfillWorkroomStageTelemetry(d)).toEqual({ ran: false, reason: "already-backfilled" });
    expect(inserted).toEqual([]);
  });

  it("tags every row, stops before the first live event, and re-aggregates each touched day", async () => {
    const { d, inserted, days } = deps();
    const result = await backfillWorkroomStageTelemetry(d);
    expect(result).toMatchObject({ ran: true, transitions: 3, days: 2, until: t(26).toISOString() });
    // Written under the staging actor; commit renames them to the final one.
    expect(inserted.every((row) => (row as { actorId: string }).actorId === STAGE_BACKFILL_STAGING_ACTOR)).toBe(true);
    expect(days).toEqual(["2026-09-23", "2026-09-24"]);
  });

  it("a new replay version clears the rows an earlier one wrote and re-aggregates the days they covered", async () => {
    const order: string[] = [];
    const { d, days } = deps({
      clearSuperseded: async () => {
        order.push("clear");
        return ["2026-09-20"];
      },
      insert: async (rows) => {
        order.push("insert");
        return rows.length;
      },
    });
    await backfillWorkroomStageTelemetry(d);
    expect(order).toEqual(["clear", "insert"]);
    expect(days).toEqual(["2026-09-20", "2026-09-23", "2026-09-24"]);
    expect(STAGE_BACKFILL_ACTOR).toBe("backfill:drive-log:v2");
  });

  it("replays a page of rooms at a time and inserts each page before reading the next", async () => {
    const rooms = Array.from({ length: STAGE_BACKFILL_ROOM_PAGE * 2 + 3 }, (_, i) => `WC-${i}`);
    const order: string[] = [];
    const { d } = deps({
      listDriveLogRooms: async () => rooms,
      loadDriveLog: async (ids) => {
        order.push(`load:${ids.length}`);
        return ids.map((id) => ({ capsuleId: id, scopeClaims: [{ workShape: SHAPE }], rows: [tick(23, 1, "dispatch_agent", "agent_stage", "repair")] }));
      },
      insert: async (rows) => {
        order.push(`insert:${rows.length}`);
        return rows.length;
      },
      commit: async () => {
        order.push("commit");
      },
    });
    const result = await backfillWorkroomStageTelemetry(d);
    expect(order).toEqual([
      `load:${STAGE_BACKFILL_ROOM_PAGE}`, `insert:${STAGE_BACKFILL_ROOM_PAGE * 2}`,
      `load:${STAGE_BACKFILL_ROOM_PAGE}`, `insert:${STAGE_BACKFILL_ROOM_PAGE * 2}`,
      "load:3", "insert:6",
      "commit",
    ]);
    expect(result).toMatchObject({ ran: true, transitions: rooms.length * 2 });
  });

  it("a run that dies part-way never commits, so it is not mistaken for a finished replay", async () => {
    let committed = false;
    let pages = 0;
    const { d } = deps({
      listDriveLogRooms: async () => Array.from({ length: STAGE_BACKFILL_ROOM_PAGE + 1 }, (_, i) => `WC-${i}`),
      loadDriveLog: async (ids) => ids.map((id) => ({ capsuleId: id, scopeClaims: [{ workShape: SHAPE }], rows: [tick(23, 1, "dispatch_agent", "agent_stage", "repair")] })),
      insert: async (rows) => {
        pages += 1;
        if (pages === 2) throw new Error("heap");
        return rows.length;
      },
      commit: async () => {
        committed = true;
      },
    });
    await expect(backfillWorkroomStageTelemetry(d)).rejects.toThrow("heap");
    expect(committed).toBe(false);
    expect(STAGE_BACKFILL_STAGING_ACTOR.startsWith(STAGE_BACKFILL_ACTOR)).toBe(true);
  });
});

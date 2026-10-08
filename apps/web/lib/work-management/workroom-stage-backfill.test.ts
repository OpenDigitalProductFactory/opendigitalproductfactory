import { describe, expect, it } from "vitest";

import {
  STAGE_BACKFILL_ACTOR,
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

  it("reproduces the 23 September pile: rooms held at one stage with the missing-coordinator cause", () => {
    const rooms = Array.from({ length: 200 }, (_, i) => ({
      capsuleId: `WC-${i}`,
      scopeClaims: [{ workShape: SHAPE }],
      rows: [tick(23, 0, "attention", "role_stage", "reproduce"), tick(23, 1, "pause", "conformance_pause", null)],
    }));
    // Each room switches hold cause at the same stage: released, then held again with the new cause.
    const held = replayDriveLog(rooms, t(30)).filter((r) => r.transition === "held" && r.laneKey === "conformance_pause");
    expect(held).toHaveLength(200);
    expect(new Set(held.map((r) => r.queueKey))).toEqual(new Set([`wr:${SHAPE}:reproduce`]));
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
      firstLiveEventAt: async () => t(26),
      loadDriveLog: async () => [
        {
          capsuleId: "WC-1",
          scopeClaims: [{ workShape: SHAPE }],
          rows: [tick(23, 1, "dispatch_agent", "agent_stage", "repair"), tick(24, 1, "stop", "success", null), tick(27, 1, "dispatch_agent", "agent_stage", "x")],
        },
      ],
      insert: async (rows) => {
        inserted.push(...rows);
        return rows.length;
      },
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
    expect(inserted.every((row) => (row as { actorId: string }).actorId === STAGE_BACKFILL_ACTOR)).toBe(true);
    expect(days).toEqual(["2026-09-23", "2026-09-24"]);
  });
});

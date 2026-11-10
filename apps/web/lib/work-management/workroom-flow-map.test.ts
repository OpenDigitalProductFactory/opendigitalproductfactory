import { describe, expect, it } from "vitest";

import type { QueueTelemetryRow } from "@/lib/queue/queue-metrics-rollup";

import { getWorkShape } from "./work-shapes";
import { formatDuration } from "@/lib/datetime";

import { MIN_BASELINE_EXITS, buildWorkroomFlowMap } from "./workroom-flow-map";
import { workroomStageQueueKey } from "./workroom-stage-telemetry";

const definition = getWorkShape("dependency-advisory-watch")!;
const shapeRef = `${definition.key}@${definition.version}`;
const now = new Date(Date.UTC(2026, 9, 7, 12));
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const row = (stage: string, transition: string, hoursAgo: number, extra: Partial<QueueTelemetryRow> = {}): QueueTelemetryRow => ({
  queueKey: workroomStageQueueKey(shapeRef, stage),
  itemKind: "workroom-stage",
  itemId: "WC-1:2026-10-07",
  transition,
  outcome: transition === "finished" ? "success" : null,
  occurredAt: ago(hoursAgo),
  ...extra,
});

describe("buildWorkroomFlowMap", () => {
  it("lays the shape out in derived lanes with its gate and ends", () => {
    const model = buildWorkroomFlowMap({ definition, current: null, roomRows: [], snapshots: [], now });
    expect(model.stages.map((s) => [s.key, s.lane, s.governed])).toEqual([
      ["sweep", "AI", false],
      ["raise", "AI", false],
      ["decide", "Person", true],
    ]);
    expect(model.ends).toEqual({ success: true, failure: true, budget: true });
    expect(model.signature).toContain("◇ Person decide");
    expect(model.stages.every((s) => s.state === "ahead")).toBe(true);
  });

  it("places the room: earlier steps done, the current one in its state with the cause", () => {
    const model = buildWorkroomFlowMap({
      definition,
      current: { action: "pause", reason: "conformance_pause", stageKey: "raise", cycleKey: "2026-10-07" },
      roomRows: [],
      snapshots: [],
      now,
    });
    expect(model.stages.map((s) => s.state)).toEqual(["done", "blocked", "ahead"]);
    expect(model.stages[1]!.holdCause).toBe("conformance_pause");
  });

  it("shows this room's time on each step and flags a step well over its typical time", () => {
    const model = buildWorkroomFlowMap({
      definition,
      current: { action: "attention", reason: "role_stage", stageKey: "decide", cycleKey: "2026-10-07" },
      roomRows: [
        row("sweep", "enqueued", 10), row("sweep", "started", 10), row("sweep", "finished", 9),
        row("decide", "enqueued", 6), row("decide", "held", 6, { laneKey: "awaiting-person" }),
      ],
      snapshots: [
        { queueKey: workroomStageQueueKey(shapeRef, "decide"), cycleP50Ms: 2 * 3_600_000, throughput: 6 },
        { queueKey: workroomStageQueueKey(shapeRef, "sweep"), cycleP50Ms: 3_600_000, throughput: 2 },
      ],
      now,
    });
    const [sweep, , decide] = model.stages;
    expect(sweep!.room).toMatchObject({ dwellMs: 3_600_000, open: false });
    expect(sweep!.typical).toBeNull(); // 2 runs: not enough history
    expect(decide!.room).toMatchObject({ dwellMs: 6 * 3_600_000, open: true });
    expect(decide!.typical).toEqual({ dwellMs: 2 * 3_600_000, exits: 6 });
    expect(decide!.slow).toBe(true);
    expect(decide!.state).toBe("awaiting-person");
  });

  it("weights the typical time by how many runs each day saw", () => {
    const key = workroomStageQueueKey(shapeRef, "sweep");
    const model = buildWorkroomFlowMap({
      definition,
      current: null,
      roomRows: [],
      snapshots: [
        { queueKey: key, cycleP50Ms: 1000, throughput: MIN_BASELINE_EXITS - 1 },
        { queueKey: key, cycleP50Ms: 6000, throughput: 1 },
      ],
      now,
    });
    expect(model.stages[0]!.typical).toEqual({ dwellMs: 2000, exits: MIN_BASELINE_EXITS });
  });

  it("marks a stopped room finished and every step done", () => {
    const model = buildWorkroomFlowMap({ definition, current: { action: "stop", reason: "success", stageKey: null, cycleKey: null }, roomRows: [], snapshots: [], now });
    expect(model.finished).toBe(true);
    expect(model.stages.every((s) => s.state === "done")).toBe(true);
  });

  it("refuses to draw a flow-graph shape as a line", () => {
    const model = buildWorkroomFlowMap({
      definition: { ...definition, flow: { nodes: [], edges: [] } },
      current: null, roomRows: [], snapshots: [], now,
    });
    expect(model.graphFlow).toBe(true);
  });
});

describe("formatDuration", () => {
  it.each([[30_000, "<1m"], [45 * 60_000, "45m"], [130 * 60_000, "2h 10m"], [3 * 3_600_000, "3h"], [76 * 3_600_000, "3d 4h"], [48 * 3_600_000, "2d"]])(
    "%i ms → %s",
    (ms, text) => expect(formatDuration(ms)).toBe(text),
  );
});

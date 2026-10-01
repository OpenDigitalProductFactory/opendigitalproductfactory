// BI-43C3E914 — the Workroom stage record on taskConfig, and its isolation
// from the `trigger` record that shares the same JSON column.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readScheduledWorkTrigger, withScheduledWorkTrigger } from "./scheduled-work-trigger";
import {
  WORKROOM_STAGE_TASK_CONFIG_KEY,
  readWorkroomStageTaskConfig,
  withWorkroomStageTaskConfig,
  workroomStageToolsFromTaskConfig,
} from "./workroom-stage-task-config";

const STAGE = {
  shapeKey: "dependency-advisory-watch",
  shapeVersion: "1.0.0",
  stageKey: "sweep",
  tools: ["read_codebase_manifest", "list_patch_posture"],
};

describe("workroom stage taskConfig record", () => {
  it("round-trips through the reader", () => {
    expect(readWorkroomStageTaskConfig(withWorkroomStageTaskConfig(null, STAGE))).toEqual(STAGE);
    expect(workroomStageToolsFromTaskConfig(withWorkroomStageTaskConfig({}, STAGE))).toEqual(STAGE.tools);
  });

  it("preserves every other taskConfig key, including a trigger", () => {
    const withTrigger = withScheduledWorkTrigger({ version: 2 }, { kind: "time" }, new Date("2026-09-01T00:00:00.000Z"));
    const next = withWorkroomStageTaskConfig(withTrigger, STAGE);
    expect(next.version).toBe(2);
    expect(readScheduledWorkTrigger(next)?.kind).toBe("time");
    expect(readWorkroomStageTaskConfig(next)).toEqual(STAGE);
  });

  it("is not misread as a trigger, and a trigger is not misread as a stage", () => {
    // The two records share taskConfig. Each reader must see only its own key.
    expect(readScheduledWorkTrigger(withWorkroomStageTaskConfig({}, STAGE))).toBeNull();
    expect(readWorkroomStageTaskConfig(withScheduledWorkTrigger({}, { kind: "detected-need" }))).toBeNull();
    // A stage record carrying a `kind` field still does not become a trigger.
    expect(readScheduledWorkTrigger({ [WORKROOM_STAGE_TASK_CONFIG_KEY]: { ...STAGE, kind: "time" } })).toBeNull();
  });

  it("reads absent or malformed records as no stage, never throwing", () => {
    expect(readWorkroomStageTaskConfig(null)).toBeNull();
    expect(readWorkroomStageTaskConfig("nonsense")).toBeNull();
    expect(readWorkroomStageTaskConfig([STAGE])).toBeNull();
    expect(readWorkroomStageTaskConfig({ workroomStage: [] })).toBeNull();
    expect(readWorkroomStageTaskConfig({ workroomStage: { stageKey: "sweep" } })).toBeNull();
    expect(workroomStageToolsFromTaskConfig({ trigger: { kind: "time" } })).toEqual([]);
  });

  it("keeps only non-empty, unique tool names", () => {
    expect(readWorkroomStageTaskConfig({
      workroomStage: { shapeKey: "s", stageKey: "x", tools: ["a", "", 3, "a", " b "] },
    })?.tools).toEqual(["a", "b"]);
    expect(readWorkroomStageTaskConfig({ workroomStage: { shapeKey: "s", stageKey: "x" } })?.tools).toEqual([]);
  });
});

describe("scheduler wiring", () => {
  // The read must reach the pin, not only be imported (the BI-76B35820 class).
  const scheduler = readFileSync(join(__dirname, "../actions/agent-task-scheduler.ts"), "utf8");

  it("passes the stage's declared tools into scheduledToolsNeedingPin", () => {
    expect(scheduler).toMatch(
      /scheduledToolsNeedingPin\(\{[\s\S]*?taskConfig:\s*task\.taskConfig/,
    );
  });
});

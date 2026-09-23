import { describe, expect, it } from "vitest";

import { readScheduledWorkTrigger, withScheduledWorkTrigger } from "@/lib/scheduling/scheduled-work-trigger";
import {
  WORKROOM_STAGE_TASK_CONFIG_KEY,
  nextWorkroomStageTaskConfig,
  readWorkroomStageEffort,
} from "./workroom-stage-effort";

const stage = { shapeKey: "dependency-advisory-watch", stageKey: "sweep", effort: "low" as const };

describe("workroomStage on ScheduledAgentTask.taskConfig (Phase G)", () => {
  it("writes the stage effort under its own key, preserving every other key", () => {
    const existing = withScheduledWorkTrigger({ topic: "x" }, { kind: "time" }, new Date("2026-09-01T00:00:00Z"));
    const next = nextWorkroomStageTaskConfig(existing, stage);
    expect(next).toEqual({ ...existing, [WORKROOM_STAGE_TASK_CONFIG_KEY]: stage });
    expect(readWorkroomStageEffort(next)).toBe("low");
  });

  it("does not write taskConfig at all when the stage declares no effort and none is recorded", () => {
    expect(nextWorkroomStageTaskConfig(null, null)).toBeUndefined();
    expect(nextWorkroomStageTaskConfig(undefined, null)).toBeUndefined();
    expect(nextWorkroomStageTaskConfig({ trigger: { kind: "time" } }, null)).toBeUndefined();
  });

  it("clears a stale record when the task moves to an undeclared stage, keeping other keys", () => {
    const stale = { trigger: { kind: "time" }, [WORKROOM_STAGE_TASK_CONFIG_KEY]: stage };
    expect(nextWorkroomStageTaskConfig(stale, null)).toEqual({ trigger: { kind: "time" } });
  });

  it("does not rewrite an identical record", () => {
    expect(nextWorkroomStageTaskConfig({ [WORKROOM_STAGE_TASK_CONFIG_KEY]: stage }, stage)).toBeUndefined();
  });

  it("reads null for absent, malformed, or out-of-vocabulary records — never throws", () => {
    for (const config of [null, undefined, 7, "x", [], {}, { workroomStage: null },
      { workroomStage: { effort: "extreme" } }, { workroomStage: "low" }]) {
      expect(readWorkroomStageEffort(config)).toBeNull();
    }
    expect(readWorkroomStageEffort({ workroomStage: { effort: "high" } })).toBe("high");
  });

  it("cannot be misparsed as a scheduled-work trigger", () => {
    // resolveScheduledTickPlan reads taskConfig through readScheduledWorkTrigger;
    // a stage record alone must keep today's "no trigger recorded" behaviour.
    const onlyStage = nextWorkroomStageTaskConfig(null, stage);
    expect(readScheduledWorkTrigger(onlyStage)).toBeNull();
    // Even a stage record shaped like a trigger (kind + workroomId) is not read as one.
    expect(readScheduledWorkTrigger({ workroomStage: { kind: "time", workroomId: "WC-1" } })).toBeNull();
    // And a real trigger alongside it still reads unchanged.
    const both = nextWorkroomStageTaskConfig({ trigger: { kind: "detected-need", workroomId: "WC-1" } }, stage);
    expect(readScheduledWorkTrigger(both)).toMatchObject({ kind: "detected-need", workroomId: "WC-1" });
  });
});

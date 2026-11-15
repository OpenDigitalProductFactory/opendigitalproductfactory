import { describe, expect, it } from "vitest";

import { WORKROOM_STAGE_TASK_CONFIG_KEY, withWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import { readWorkroomStageEffort } from "./workroom-stage-effort";

const stage = { shapeKey: "payables-watch", shapeVersion: "1.1.0", stageKey: "read", tools: ["list_bills"] };

describe("readWorkroomStageEffort (Phase G)", () => {
  it("reads the effort the drive wrote beside the stage's tools, keeping other keys", () => {
    const config = withWorkroomStageTaskConfig({ trigger: { kind: "time" } }, { ...stage, effort: "low" });
    expect(readWorkroomStageEffort(config)).toBe("low");
    expect((config as Record<string, unknown>).trigger).toEqual({ kind: "time" });
  });

  it("is null for an undeclared stage, a task with no stage record, or junk", () => {
    expect(readWorkroomStageEffort(withWorkroomStageTaskConfig(null, stage))).toBeNull();
    expect(readWorkroomStageEffort(null)).toBeNull();
    expect(readWorkroomStageEffort({ [WORKROOM_STAGE_TASK_CONFIG_KEY]: { ...stage, effort: "extreme" } })).toBeNull();
  });

  it("drops a stale effort when a later stage declares none", () => {
    const earlier = withWorkroomStageTaskConfig(null, { ...stage, effort: "medium" });
    expect(readWorkroomStageEffort(withWorkroomStageTaskConfig(earlier, { ...stage, stageKey: "report" }))).toBeNull();
  });
});

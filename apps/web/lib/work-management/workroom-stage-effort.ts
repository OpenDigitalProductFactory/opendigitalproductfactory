// apps/web/lib/work-management/workroom-stage-effort.ts
//
// Phase G (proactivity & capacity allocation §6.1) — the effort tier a dispatched
// Workroom stage declared, read from the scheduled run's task config.
//
// One record, one home: the drive writes the stage's effort into the same
// `taskConfig.workroomStage` record that carries its declared tools
// (scheduling/workroom-stage-task-config.ts, BI-43C3E914). This is only the
// effort reader over it. Pure — no I/O.

import type { EffortLevel } from "@/lib/tak/effort-warrant";
import { readWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";

/** The recorded stage effort, or null when none is recorded or it is unusable. Never throws. */
export function readWorkroomStageEffort(taskConfig: unknown): EffortLevel | null {
  return readWorkroomStageTaskConfig(taskConfig)?.effort ?? null;
}

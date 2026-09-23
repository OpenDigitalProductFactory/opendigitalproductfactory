// apps/web/lib/work-management/workroom-stage-effort.ts
//
// Phase G (proactivity & capacity allocation §6.1) — the effort tier a dispatched
// Workroom stage declared, carried from the drive to the scheduled run.
//
// MIGRATION-FREE. It rides `ScheduledAgentTask.taskConfig` under its own
// `workroomStage` key — the same discipline the scheduled-work trigger uses
// under `trigger` (scheduling/scheduled-work-trigger.ts). The two keys never
// overlap: the trigger reader only reads `trigger`, so a stage record cannot be
// misparsed as a trigger. A task with no stage record behaves exactly as before.
//
// Pure — no I/O.

import type { EffortLevel } from "@/lib/tak/effort-warrant";

export const WORKROOM_STAGE_TASK_CONFIG_KEY = "workroomStage";

const EFFORT_LEVELS: readonly EffortLevel[] = ["minimal", "low", "medium", "high"];

export type WorkroomStageEffortRecord = {
  shapeKey: string;
  stageKey: string;
  /** Already resolved through `resolveStageEffort` — governed stages are high. */
  effort: EffortLevel;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The recorded stage effort, or null when none is recorded or it is unusable. Never throws. */
export function readWorkroomStageEffort(taskConfig: unknown): EffortLevel | null {
  const raw = asRecord(asRecord(taskConfig)?.[WORKROOM_STAGE_TASK_CONFIG_KEY]);
  const effort = raw?.effort;
  return typeof effort === "string" && (EFFORT_LEVELS as readonly string[]).includes(effort)
    ? (effort as EffortLevel)
    : null;
}

/**
 * The taskConfig to write for a dispatch, or `undefined` meaning "do not touch
 * taskConfig". An undeclared stage on a task that never carried a record is a
 * no-op (today's behaviour, bit-for-bit). The drive reuses one task per room and
 * shape across stages, so a record left by an earlier declared stage is removed
 * rather than inherited by an undeclared one. Every other key is preserved.
 */
export function nextWorkroomStageTaskConfig(
  existing: unknown,
  stage: WorkroomStageEffortRecord | null,
): Record<string, unknown> | undefined {
  const base = asRecord(existing) ?? {};
  const current = asRecord(base[WORKROOM_STAGE_TASK_CONFIG_KEY]);
  if (!stage) {
    if (!(WORKROOM_STAGE_TASK_CONFIG_KEY in base)) return undefined;
    const { [WORKROOM_STAGE_TASK_CONFIG_KEY]: _dropped, ...rest } = base;
    return rest;
  }
  if (
    current?.shapeKey === stage.shapeKey
    && current?.stageKey === stage.stageKey
    && current?.effort === stage.effort
  ) {
    return undefined;
  }
  return {
    ...base,
    [WORKROOM_STAGE_TASK_CONFIG_KEY]: {
      shapeKey: stage.shapeKey,
      stageKey: stage.stageKey,
      effort: stage.effort,
    },
  };
}

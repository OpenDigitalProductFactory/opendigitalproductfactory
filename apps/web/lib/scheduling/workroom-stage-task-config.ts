/**
 * The Workroom stage a scheduled job is running, carried on `taskConfig`
 * (BI-43C3E914).
 *
 * The standing Workroom drive dispatches each agent stage as a
 * ScheduledAgentTask. Before this record, the only thing the scheduled run
 * learned about the stage was its prompt, so the run pinned only the tools the
 * prompt happened to name (record_workroom_evidence) and ranked everything else
 * by prompt relevance. The stage had no way to say which tools it needs.
 *
 * GPP (docs/architecture/gated-permissions-process.md, draft 0.1): this is the
 * hand-off of a stage's capability set (binding element 5) from the work shape
 * to the run. It never grants anything; the scheduler pins these names inside
 * the attachment budget and the agent ∩ user grant filter still decides reach.
 *
 * MIGRATION-FREE, same discipline as `trigger` (scheduled-work-trigger.ts): the
 * record rides the existing `taskConfig` JSON column under its own
 * `workroomStage` key, so it cannot be read as a trigger and a trigger cannot be
 * read as it. A task without the key behaves exactly as before.
 */

import type { EffortLevel } from "@/lib/tak/effort-warrant";

export const WORKROOM_STAGE_TASK_CONFIG_KEY = "workroomStage";

const EFFORT_LEVELS: readonly EffortLevel[] = ["minimal", "low", "medium", "high"];

export interface WorkroomStageTaskConfig {
  shapeKey: string;
  shapeVersion: string;
  stageKey: string;
  /** The stage's declared tools (WorkShapeStage.tools). Empty when undeclared. */
  tools: string[];
  /** Phase G: the stage's resolved effort tier (resolveStageEffort). Absent when it declares none. */
  effort?: EffortLevel;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Read the stage record out of a task's `taskConfig`, or null when none was
 * recorded or it is unusable. Never throws: a malformed config must not stop a
 * scheduled job from running.
 */
export function readWorkroomStageTaskConfig(taskConfig: unknown): WorkroomStageTaskConfig | null {
  const raw = asRecord(asRecord(taskConfig)?.[WORKROOM_STAGE_TASK_CONFIG_KEY]);
  if (!raw) return null;
  const shapeKey = nonEmptyString(raw.shapeKey);
  const stageKey = nonEmptyString(raw.stageKey);
  if (!shapeKey || !stageKey) return null;
  const tools = Array.isArray(raw.tools)
    ? [...new Set(raw.tools.map(nonEmptyString).filter((name): name is string => name !== null))]
    : [];
  const effort = typeof raw.effort === "string" && (EFFORT_LEVELS as readonly string[]).includes(raw.effort)
    ? raw.effort as EffortLevel : undefined;
  return { shapeKey, shapeVersion: nonEmptyString(raw.shapeVersion) ?? "", stageKey, tools, ...(effort ? { effort } : {}) };
}

/** The stage's declared tools from a task's config, or []. */
export function workroomStageToolsFromTaskConfig(taskConfig: unknown): string[] {
  return readWorkroomStageTaskConfig(taskConfig)?.tools ?? [];
}

/** Merge the stage record into an existing taskConfig, preserving every other key. */
export function withWorkroomStageTaskConfig(
  taskConfig: unknown,
  stage: WorkroomStageTaskConfig,
): Record<string, unknown> {
  const existing = asRecord(taskConfig) ?? {};
  return {
    ...existing,
    [WORKROOM_STAGE_TASK_CONFIG_KEY]: {
      shapeKey: stage.shapeKey,
      shapeVersion: stage.shapeVersion,
      stageKey: stage.stageKey,
      tools: [...new Set(stage.tools)],
      ...(stage.effort ? { effort: stage.effort } : {}),
    },
  };
}

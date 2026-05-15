// SkillUsageEvent writer for the governed Hermes-style skill telemetry surface.
//
// The runtime only writes events; the aggregator in skill-metrics.ts derives
// SkillMetric rows from them (event sourcing). Failures are caught and
// logged — telemetry must never break the user-facing coworker response path.

import { randomUUID } from "crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

import {
  SKILL_USAGE_PHASES,
  type SkillUsagePhase,
} from "./types";

export type RecordSkillUsageEventsInput = {
  phase: SkillUsagePhase;
  /** Skill business ids. Deduplicated before write. */
  skillIds: string[];
  agentId: string;
  userId?: string | null;
  threadId?: string | null;
  taskRunId?: string | null;
  routeContext?: string | null;
  toolExecutionId?: string | null;
  /** "coworker" | "build" | "scheduled" — defaults to "coworker". */
  source?: string;
  /** Free-form per-event metadata; persisted on each row. */
  metadata?: Record<string, unknown>;
};

function makeEventId(): string {
  return `SUE-${randomUUID().slice(0, 8).toUpperCase()}`;
}

/**
 * Persist one SkillUsageEvent row per supplied skill id. Returns the number
 * of events written; returns 0 (no-op) for empty/invalid input. Catches DB
 * failures and logs them with the [skill-usage] prefix so a transient DB
 * outage cannot stall a coworker response.
 */
export async function recordSkillUsageEvents(
  input: RecordSkillUsageEventsInput,
): Promise<number> {
  if (!SKILL_USAGE_PHASES.includes(input.phase)) {
    console.warn(`[skill-usage] rejected unknown phase: ${input.phase}`);
    return 0;
  }
  if (!input.agentId) {
    console.warn("[skill-usage] rejected event without agentId");
    return 0;
  }

  const uniqueSkillIds = Array.from(
    new Set(input.skillIds.filter((id) => typeof id === "string" && id.length > 0)),
  );
  if (uniqueSkillIds.length === 0) return 0;

  const metadata = input.metadata ?? {};
  const data = uniqueSkillIds.map((skillId) => ({
    eventId: makeEventId(),
    skillId,
    agentId: input.agentId,
    userId: input.userId ?? null,
    threadId: input.threadId ?? null,
    taskRunId: input.taskRunId ?? null,
    toolExecutionId: input.toolExecutionId ?? null,
    routeContext: input.routeContext ?? null,
    phase: input.phase,
    source: input.source ?? "coworker",
    metadata: metadata as Prisma.InputJsonValue,
  }));

  try {
    const result = await prisma.skillUsageEvent.createMany({ data });
    return result.count;
  } catch (err) {
    console.warn(
      "[skill-usage] failed to persist skill usage events:",
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

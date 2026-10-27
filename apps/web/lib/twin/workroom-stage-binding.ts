/**
 * Bind Workroom stage queues into an archetype's value-stream twin
 * (BI-B32D8C16, EP-B70E718D F7c; spec §6).
 *
 * A work-shape stage carries an IT4IT 3.0.1 stage reference
 * (work-management/workroom-stage-it4it.ts). An archetype carries its IT4IT
 * binding as 2.x stream names. A stage joins the archetype's twin when its
 * 3.0.1 stream is one the archetype's binding covers, and it lands on the
 * archetype's Deliver stage (or its primary stage when it has no Deliver),
 * where delivery work sits in the operational value stream.
 *
 * Pure. Added after deriveTwinValueStreamBinding rather than inside it: that
 * package has no access to work shapes, and its stages partition the twin
 * profile's own queues.
 */
import {
  deriveOperationalValueStream,
  type ArchetypeDefinition,
  type It4ItStage,
  type OperationalValueStreamStageKey,
  type TwinValueStreamBinding,
} from "@dpf/storefront-templates";

import { getWorkShape } from "@/lib/work-management/work-shapes";
import { WORK_SHAPE_STAGE_IT4IT } from "@/lib/work-management/workroom-stage-it4it";
import { loadWorkroomStageLiveCounts, WORKROOM_STAGE_QUEUE_PREFIX, workroomStageQueueKey } from "@/lib/work-management/workroom-stage-telemetry";

/** IT4IT 3.0.1 streams by the section number their stage references start with. */
const IT4IT_STREAM_BY_SECTION: Readonly<Record<string, string>> = {
  "5.1": "Evaluate",
  "5.2": "Explore",
  "5.3": "Integrate",
  "5.4": "Deploy",
  "5.5": "Release",
  "5.6": "Consume",
  "5.7": "Operate",
};

/**
 * The 3.0.1 streams each 2.x stream became (The Open Group IT4IT 3.0 transition).
 * Deploy-to-Operate is DPF's own stream name and spans Deploy and Operate.
 */
export const IT4IT_STREAMS_FOR_BINDING: Readonly<Record<It4ItStage, readonly string[]>> = {
  "strategy-to-portfolio": ["Evaluate", "Explore"],
  "requirement-to-deploy": ["Integrate", "Deploy"],
  "request-to-fulfill": ["Release", "Consume"],
  "detect-to-correct": ["Operate"],
  "deploy-to-operate": ["Deploy", "Operate"],
};

/** The IT4IT 3.0.1 stream a stage reference such as "5.3.4" belongs to, or null. */
export function it4itStreamOf(participationReference: string): string | null {
  return IT4IT_STREAM_BY_SECTION[participationReference.split(".").slice(0, 2).join(".")] ?? null;
}

/**
 * The binding with the Workroom stage queues the archetype covers added to its
 * delivery stage. `shapeRefs` are the shape versions whose queues to bind.
 */
export function bindWorkroomStageQueues(
  binding: TwinValueStreamBinding,
  it4itStageBinding: readonly It4ItStage[],
  shapeRefs: readonly string[],
): TwinValueStreamBinding {
  const streams = new Set(it4itStageBinding.flatMap((stage) => IT4IT_STREAMS_FOR_BINDING[stage] ?? []));
  const target: OperationalValueStreamStageKey = binding.stages.some((stage) => stage.stageKey === "deliver")
    ? "deliver"
    : binding.primaryStageKey;
  const added: string[] = [];
  for (const shapeRef of shapeRefs) {
    const stages = WORK_SHAPE_STAGE_IT4IT[shapeRef.split("@")[0]!] ?? {};
    for (const [stageKey, ref] of Object.entries(stages)) {
      const stream = it4itStreamOf(ref);
      if (stream && streams.has(stream)) added.push(workroomStageQueueKey(shapeRef, stageKey));
    }
  }
  if (added.length === 0) return binding;
  return {
    ...binding,
    stages: binding.stages.map((stage) =>
      stage.stageKey === target ? { ...stage, queueKeys: [...new Set([...stage.queueKeys, ...added])] } : stage),
    queueToStage: { ...binding.queueToStage, ...Object.fromEntries(added.map((key) => [key, target])) },
  };
}

/** The Workroom stage queues a binding carries, by twin stage. */
export function workroomQueuesByStage(binding: TwinValueStreamBinding): Map<OperationalValueStreamStageKey, string[]> {
  const out = new Map<OperationalValueStreamStageKey, string[]>();
  for (const stage of binding.stages) {
    const keys = stage.queueKeys.filter((key) => key.startsWith("wr:"));
    if (keys.length > 0) out.set(stage.stageKey, keys);
  }
  return out;
}

/** The current version of every shape with IT4IT stage references: the shapes a twin binds. */
export function boundDeliveryShapeRefs(): string[] {
  return Object.keys(WORK_SHAPE_STAGE_IT4IT).flatMap((key) => {
    const shape = getWorkShape(key);
    return shape ? [`${shape.key}@${shape.version}`] : [];
  });
}

/** The shape versions a binding carries Workroom stage queues for. */
export function boundShapeRefs(binding: TwinValueStreamBinding): Set<string> {
  return new Set([...workroomQueuesByStage(binding).values()].flat()
    .map((queueKey) => queueKey.slice(WORKROOM_STAGE_QUEUE_PREFIX.length, queueKey.lastIndexOf(":"))));
}

/** An archetype's twin binding with the current delivery shapes' stage queues its IT4IT binding covers. */
export function bindArchetypeWorkroomStages(archetype: ArchetypeDefinition, binding: TwinValueStreamBinding): TwinValueStreamBinding {
  return bindWorkroomStageQueues(binding, deriveOperationalValueStream(archetype).it4itStageBinding, boundDeliveryShapeRefs());
}

/** Count rooms at a binding's Workroom stage queues into each twin stage's demand. Fail-soft. */
export async function addWorkroomStageDemand(
  binding: TwinValueStreamBinding,
  demand: Record<string, { count: number; longestWaitMs?: number }>,
  loadCounts: () => Promise<Map<string, { wip: number }>> = loadWorkroomStageLiveCounts,
): Promise<void> {
  const byStage = workroomQueuesByStage(binding);
  if (byStage.size === 0) return;
  const counts = await loadCounts().catch(() => new Map<string, { wip: number }>());
  for (const [stage, keys] of byStage) {
    const rooms = keys.reduce((sum, key) => sum + (counts.get(key)?.wip ?? 0), 0);
    if (rooms === 0) continue;
    const current = demand[stage] ?? { count: 0, longestWaitMs: 0 };
    current.count += rooms;
    demand[stage] = current;
  }
}

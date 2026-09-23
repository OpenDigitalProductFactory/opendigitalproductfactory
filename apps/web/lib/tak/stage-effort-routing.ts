// apps/web/lib/tak/stage-effort-routing.ts
//
// Phase G (proactivity & capacity allocation §6.1) — effort tier per stage.
//
// A work-shape stage declares the reasoning it needs (work-shapes.ts
// `resolveStageEffort`; a governed decision is always `high`). The drive carries
// the resolved tier on the scheduled task (workroom-stage-effort.ts); this module
// is the ONE place that tier becomes routing:
//
//   minimal / low → budget class `minimize_cost`: the cheapest CAPABLE model.
//                   The coworker's own capability floor (minimumDimensions,
//                   tool-use, vision, context) is left exactly as configured, so
//                   a sweep never routes to a model its coworker was floored
//                   above.
//   medium        → no change: the coworker's configured routing is already the
//                   platform's default posture for judgment work.
//   high          → minimumDimensions raised to at least the frontier floor
//                   (per dimension, never lowering a stricter one). Budget class
//                   is not raised — the tier is a capability floor, not a cost
//                   target — but spend-aware routing never demotes it
//                   (inference/spend-aware-routing.ts).
//
// Why here and not in `modelRequirements`: resolveEffectiveAgentRouteConfig lets
// a coworker's AgentModelConfig row OVERRIDE modelRequirements' minimum tier and
// budget class, so a floor merged there is silently erased for any coworker
// with a DB model config. The loop applies this AFTER that resolution instead.
//
// Pure — no I/O.

import { TIER_MINIMUM_DIMENSIONS } from "@/lib/routing/quality-tiers";
import { deriveEffortWarrant, type EffortLevel, type EffortWarrant } from "./effort-warrant";
import { readWorkroomStageEffort } from "@/lib/work-management/workroom-stage-effort";

type RoutableConfig = {
  minimumDimensions?: Record<string, number>;
  budgetClass?: "minimize_cost" | "balanced" | "quality_first";
};

/** Apply a declared stage tier to an already-resolved route config. Undeclared → unchanged. */
export function applyDeclaredEffortRouting<T extends RoutableConfig>(
  config: T,
  declaredEffort: EffortLevel | null | undefined,
): T {
  if (declaredEffort === "minimal" || declaredEffort === "low") {
    return { ...config, budgetClass: "minimize_cost" };
  }
  if (declaredEffort === "high") {
    const floor: Record<string, number> = { ...(config.minimumDimensions ?? {}) };
    for (const [dimension, minimum] of Object.entries(TIER_MINIMUM_DIMENSIONS.frontier)) {
      floor[dimension] = Math.max(floor[dimension] ?? 0, minimum);
    }
    return { ...config, minimumDimensions: floor };
  }
  return config;
}

/**
 * The extra arguments a scheduled run passes to the loop for a Workroom stage
 * that declared a tier: the effort warrant derived from it. A task with no
 * stage record gets `{}` — today's call, unchanged.
 */
export function scheduledStageEffortArgs(
  taskConfig: unknown,
  turn: { toolNames: readonly string[]; messageChars: number },
): { effortWarrant?: EffortWarrant } {
  const declaredEffort = readWorkroomStageEffort(taskConfig);
  if (!declaredEffort) return {};
  return {
    effortWarrant: deriveEffortWarrant({
      declaredEffort,
      availableToolNames: turn.toolNames,
      messageChars: turn.messageChars,
    }),
  };
}

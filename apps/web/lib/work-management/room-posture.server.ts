import "server-only";

// EP-WORK-POSTURE Slice D (BI-4F468192) — the server half of the room's posture.
//
// Resolves the parts that need I/O and hands them to the pure builder:
//   • the business clock, from the EXISTING operating-hours substrate
//   • the archetype's operational value stream, from the EXISTING OVSM projection
//   • the inherited coworker posture, from the EXISTING proactivity resolver and
//     Golden Triangle persistence
//
// Nothing here decides anything. Every judgement lives in resolveWorkPosture,
// under the tighten-only invariant. This module only fetches.
//
// Fail-open throughout: a posture is an enhancement to a room view, and a
// settings read must never throw into a page render. Any failure returns null,
// which renders as "running on platform defaults" rather than a wrong posture.
import { prisma } from "@dpf/db";
import { ALL_ARCHETYPES, deriveOperationalValueStream } from "@dpf/storefront-templates";

import { resolveOperatingScheduleForSystem } from "@/lib/operating-hours-read";
import { resolveProactivityPlan } from "@/lib/proactivity/proactivity-resolver";
import type { ProactivityActivityFamily } from "@/lib/proactivity/proactivity-types";
import { getEffectivePostureForAgent } from "@/lib/golden-triangle/persistence";
import type { ArchetypeStreamInput } from "@/lib/work-posture";

import type { WorkroomPostureContext } from "./room-posture";

/**
 * Map the room's subject to a proactivity activity family. Only families the
 * resolver already knows are returned; an unmapped subject contributes nothing
 * rather than being forced into an approximate bucket.
 */
function activityFamilyForSource(sourceType: string): ProactivityActivityFamily | null {
  switch (sourceType) {
    case "build":
    case "build-studio":
      return "build-studio-custodian";
    case "scheduled-task":
      return "scheduled-task";
    case "todo":
      return "todo-follow-up";
    default:
      return null;
  }
}

/** The archetype's value stream, or null when the install has no active one. */
async function resolveStream(): Promise<ArchetypeStreamInput | null> {
  try {
    // StorefrontConfig.archetypeId is an FK to StorefrontArchetype.id (a cuid) —
    // NOT the archetype SLUG. The slug lives on StorefrontArchetype.archetypeId,
    // which is what ALL_ARCHETYPES is keyed by. Reading the config column
    // directly and matching it against the slug registry silently never matches,
    // so the whole archetype half of the posture would resolve to nothing while
    // every layer looked healthy. Verified against live data 2026-08-22: the
    // config held "cmq5kqdyb09lr5nr074qch160" for slug "software-platform".
    const storefront = await prisma.storefrontConfig.findFirst({
      select: { archetype: { select: { archetypeId: true } } },
      orderBy: { updatedAt: "desc" },
    });
    const archetypeSlug = storefront?.archetype?.archetypeId;
    if (!archetypeSlug) return null;

    const definition = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeSlug);
    if (!definition) return null;

    const ovs = deriveOperationalValueStream(definition);
    return {
      demandSignature: ovs.demandSignature,
      capacityUnit: ovs.capacityUnit,
      loadBearingStageKeys: ovs.loadBearingStageKeys,
      trustGates: ovs.trustGates,
      // The room's own stage is not yet bound to an OVSM stage; leaving this
      // null means the load-bearing bias simply does not fire, rather than
      // firing on a guess. Binding it is future work on the same seam.
      stageKey: null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the posture context for a room. Returns null when the inherited
 * posture cannot be established — a room with no known baseline has no posture,
 * which is an honest answer.
 */
export async function loadWorkroomPostureContext(ref: {
  sourceType: string;
  sourceId: string;
  assignedToAgentId: string | null;
  now: Date;
}): Promise<WorkroomPostureContext | null> {
  try {
    const activityFamily = activityFamilyForSource(ref.sourceType);
    const proactivityPlan = resolveProactivityPlan({
      activityFamily: activityFamily ?? "interactive-chat",
      agentId: ref.assignedToAgentId,
    });

    const [hours, stream, priority] = await Promise.all([
      resolveOperatingScheduleForSystem().catch(() => null),
      resolveStream(),
      getEffectivePostureForAgent(ref.assignedToAgentId, null).catch(() => null),
    ]);

    return {
      inherited: {
        proactivityPlan,
        priority: priority?.preference ?? null,
        source: priority?.source === "agent" ? "agent" : "platform",
      },
      operatingHours: hours
        ? {
            schedule: hours.schedule,
            // Only feed a timezone we actually know. The UTC placeholder would
            // silently evaluate a local schedule in the wrong zone, which is
            // worse than not damping at all.
            timezone: hours.timezoneKnown ? hours.timezone : null,
            lowTrafficWindows: hours.lowTrafficWindows,
          }
        : null,
      stream,
      activityFamily,
      hardPolicy: null,
    };
  } catch {
    return null;
  }
}

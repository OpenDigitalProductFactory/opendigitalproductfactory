// apps/web/lib/gear-interface/emit-ring-2-3.ts
//
// Reduction Gear Phase 1 — Ring 2→3 (Workflow → Archetype) emitter.
//
// Fires when a FeatureBuild's ship phase completes. Resolves archetypeContext
// from the active StorefrontConfig (single-org per install — there is exactly
// one StorefrontConfig at all times, with a NOT NULL archetypeId). Without
// archetype context the writer's invariant rejects the emit — spec §3.3
// requires it at Ring 2→3 and beyond.
//
// Non-blocking: every failure logs and swallows; the ship flow must never
// depend on this emit succeeding.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §4.2
// BI:   BI-861C4959

import { prisma } from "@dpf/db";
import { featureBuildShipToRing23Input } from "./source-adapters/feature-build-ship";
import { emitGearInterface } from "./writer";

/**
 * Resolve the active archetype id for this install. Returns null when no
 * StorefrontConfig exists yet (fresh install / setup not run) so the caller
 * can skip the Ring 2→3 emit honestly rather than emit with a fabricated
 * archetype.
 */
async function resolveArchetypeContext(): Promise<string | null> {
  const config = await prisma.storefrontConfig.findFirst({
    select: { archetypeId: true },
  });
  return config?.archetypeId ?? null;
}

/**
 * Public entry — called from `completeBuildPhaseRun(buildId, "ship")` AFTER
 * the source row settles and AFTER the Ring 1→2 emit. Idempotent via the
 * writer's deterministic key derivation.
 */
export async function emitRing23FromCompletedShip(buildId: string): Promise<void> {
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      buildId: true,
      title: true,
      phase: true,
      claimedByAgentId: true,
      codingProvider: true,
      acceptanceMet: true,
      uxVerificationStatus: true,
      abandonedAt: true,
      updatedAt: true,
    },
  });

  if (!build) return;
  if (build.phase !== "ship") return; // belt-and-braces — caller should already gate

  const archetypeContext = await resolveArchetypeContext();
  if (!archetypeContext) {
    console.warn(
      "[gear-interface] Ring 2→3 emit skipped: no StorefrontConfig.archetypeId resolved for this install",
      { buildId },
    );
    return;
  }

  // shipSucceeded heuristic: phase reached ship AND build was not abandoned.
  // If UX verification ran, prefer its verdict. Acceptance signal — when
  // present — is the strongest input.
  const shipSucceeded =
    build.abandonedAt == null &&
    build.uxVerificationStatus !== "failed";

  // Acceptance JSON shape from Phase 0 ring-1-2 emitter — same parse contract.
  let acceptanceMet: boolean | null = null;
  if (build.acceptanceMet && typeof build.acceptanceMet === "object") {
    const am = build.acceptanceMet as { met?: unknown; status?: unknown };
    if (am.met === true || am.status === "met") acceptanceMet = true;
    else if (am.met === false || am.status === "not-met") acceptanceMet = false;
  }

  const input = featureBuildShipToRing23Input({
    id: build.id,
    buildId: build.buildId,
    title: build.title,
    archetypeContext,
    claimedByAgentId: build.claimedByAgentId,
    codingProvider: build.codingProvider,
    shipSucceeded,
    acceptanceMet,
    completedAt: build.updatedAt,
  });

  await emitGearInterface(input);
}

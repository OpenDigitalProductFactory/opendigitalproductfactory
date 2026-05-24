// apps/web/scripts/seed-gear-interface-phase-1.ts
//
// Reduction Gear Phase 1 — verification seed.
//
// Writes enough successful Ring 1→2 transmissions for one triple to make the
// Calibrator's default threshold (hitl-required → hitl-fallback at score>=0.85
// + sampleSize>=10) achievable. Then runs the Governor consult and, when the
// Governor recommends elevation, emits a graduation GearInterface row.
//
// Also seeds a Ring 2→3 transmission with a resolved archetypeContext so the
// Cockpit's Ring 2→3 lane comes off NO DATA into real "outward" data.
//
// Run with:
//   DATABASE_URL=postgresql://... \
//     pnpm --filter web exec tsx scripts/seed-gear-interface-phase-1.ts
//
// Idempotent: stable shaftSourceIds upsert the same rows on re-runs.
//
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §12.2
// BI:   BI-861C4959

import {
  consult,
  emitGearInterface,
  emitGraduation,
  type CalibrationKey,
} from "../lib/gear-interface";
import { prisma } from "@dpf/db";

const PREFIX = "gear-phase1";
const AGENT = "demo-build-specialist";

async function main() {
  console.log("[gear-phase1] seeding 12 successful Ring 1→2 transmissions for one triple...");
  for (let i = 0; i < 12; i++) {
    await emitGearInterface({
      interfaceClass: "internal-adjacent",
      innerRing: 1,
      outerRing: 2,
      transmissionDirection: "outward",
      shaftSourceType: "phase-run",
      shaftSourceId: `${PREFIX}-trans-${i}`,
      sourceEventAt: new Date(Date.now() - (12 - i) * 60_000),
      actorType: "agent",
      actorId: AGENT,
      intent: "complete-phase-build",
      capabilityName: "build-phase-build",
      agentIdForTriple: AGENT,
      torqueTechnical: 1.0,
      torqueConfidence: 0.9,
      ratioConsumed: 6,
      outcomeType: "transmission",
      // One row marked human-graded — exercises the HITL training-signal weight.
      graderType: i === 5 ? "human" : "automated",
      graderId: i === 5 ? "operator-mark" : "build-phase-run.completeBuildPhaseRun",
      rationale: i === 5 ? "Manual gate approval — verified UX against acceptance criteria." : null,
    });
  }

  const triple: CalibrationKey = {
    agentIdForTriple: AGENT,
    capabilityName: "build-phase-build",
    archetypeContext: null,
    interfaceClass: "internal-adjacent",
    innerRing: 1,
    outerRing: 2,
    autonomyLevel: "hitl-required",
  };

  console.log("[gear-phase1] consulting Autonomy Governor against the triple...");
  const decision = await consult({ triple, action: "complete-phase-build" });
  console.log("  → trust:", {
    score: decision.trust.score,
    sampleSize: decision.trust.sampleSize,
    confidence: decision.trust.confidence,
    recentFailures: decision.trust.recentFailureCount,
    humanGraded: decision.trust.humanGradedCount,
  });
  console.log("  → verdict:", decision.verdict);
  console.log("  → recommendedTier:", decision.recommendedTier);
  console.log("  → graduationEligible:", decision.graduationEligible);
  console.log("  → rationale:", decision.rationale);

  if (decision.graduationEligible) {
    console.log("[gear-phase1] emitting graduation row...");
    const grad = await emitGraduation({
      triple,
      consult: decision,
      governorRef: `${PREFIX}-gov-elevation-1`,
    });
    console.log("  →", grad);
  } else {
    console.warn("[gear-phase1] Governor did NOT recommend graduation — verify thresholds vs seed counts");
  }

  console.log("[gear-phase1] emitting Ring 2→3 transmission with archetype context...");
  // Resolve archetype from the live install — same path the production Ring 2→3 emitter uses.
  const storefront = await prisma.storefrontConfig.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { archetype: { select: { archetypeId: true } } },
  });
  const archetypeContext = storefront?.archetype?.archetypeId ?? null;
  const ring23 = await emitGearInterface({
    interfaceClass: "internal-adjacent",
    innerRing: 2,
    outerRing: 3,
    transmissionDirection: "outward",
    shaftSourceType: "phase-run",
    shaftSourceId: `${PREFIX}-ship-1`,
    sourceEventAt: new Date(),
    actorType: "agent",
    actorId: AGENT,
    intent: "ship-feature-build",
    capabilityName: "feature-build-ship",
    archetypeContext,
    agentIdForTriple: AGENT,
    torqueTechnical: archetypeContext ? 1.0 : 0,
    torqueConfidence: archetypeContext ? 0.9 : 1,
    ratioConsumed: 5,
    outcomeType: archetypeContext ? "transmission" : "slip",
    slipDetected: !archetypeContext,
    slipReason: archetypeContext ? null : "archetype-unresolved",
    graderType: "automated",
    graderId: archetypeContext ? "feature-build-ship.completePhase" : "gear-interface.archetype-resolver",
    rationale: archetypeContext
      ? null
      : "Install is not onboarded to a resolvable vertical archetype; Ring 2→3 seed attribution cannot be safely written.",
    idempotencyKeySuffix: archetypeContext ? undefined : "archetype-unresolved",
  });
  console.log("  →", ring23);

  const total = await prisma.gearInterface.count();
  console.log(`[gear-phase1] done. Total GearInterface rows in DB: ${total}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[gear-phase1] failed:", err);
  process.exit(1);
});

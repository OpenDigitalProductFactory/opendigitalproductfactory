// apps/web/scripts/seed-gear-interface-demo.ts
//
// Reduction Gear Phase 0 — Cockpit demo seed.
//
// Writes ONE of each record type required by spec §5.5 for the UX verification
// gate (transmission, slip, HITL-graded, graduation/veto) using the production
// writer service. Idempotent: each record uses a stable shaftSourceId so
// re-running upserts the same 4 rows.
//
// Usage (from repo root, with local postgres):
//   DATABASE_URL=postgresql://dpf:PASS@localhost:5432/dpf \
//     pnpm --filter web exec tsx scripts/seed-gear-interface-demo.ts
//
// Development-time helper only — not wired to any scheduled path or seed flow.
// Spec: docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md §5.5
// BI:   BI-85CB31F0

import { emitGearInterface } from "../lib/gear-interface";
import { prisma } from "@dpf/db";

const SHAFT_ID_PREFIX = "gear-demo";
const DEMO_AGENT = "demo-build-specialist";
const DEMO_PHASE = "build";

async function main() {
  console.log("[gear-demo] emitting Ring 1→2 transmission...");
  const transmission = await emitGearInterface({
    interfaceClass: "internal-adjacent",
    innerRing: 1,
    outerRing: 2,
    transmissionDirection: "outward",
    shaftSourceType: "phase-run",
    shaftSourceId: `${SHAFT_ID_PREFIX}-transmission-1`,
    sourceEventAt: new Date("2026-05-24T15:00:00Z"),
    actorType: "agent",
    actorId: DEMO_AGENT,
    intent: `complete-phase-${DEMO_PHASE}`,
    capabilityName: `build-phase-${DEMO_PHASE}`,
    agentIdForTriple: DEMO_AGENT,
    torqueTechnical: 1.0,
    torqueConfidence: 0.9,
    ratioConsumed: 8,
    outcomeType: "transmission",
    costUsd: "0.142",
    inputTokens: 12000,
    outputTokens: 4500,
    durationMs: 30 * 60 * 1000,
    graderType: "automated",
    graderId: "build-phase-run.completeBuildPhaseRun",
  });
  console.log("  →", transmission);

  console.log("[gear-demo] emitting Ring 1→2 slip (rate-limit)...");
  const slip = await emitGearInterface({
    interfaceClass: "internal-adjacent",
    innerRing: 1,
    outerRing: 2,
    transmissionDirection: "outward",
    shaftSourceType: "phase-run",
    shaftSourceId: `${SHAFT_ID_PREFIX}-slip-1`,
    sourceEventAt: new Date("2026-05-24T15:30:00Z"),
    actorType: "agent",
    actorId: DEMO_AGENT,
    intent: `complete-phase-${DEMO_PHASE}`,
    capabilityName: `build-phase-${DEMO_PHASE}`,
    agentIdForTriple: DEMO_AGENT,
    torqueTechnical: 0.5,
    torqueConfidence: 0.85,
    ratioConsumed: 14,
    outcomeType: "slip",
    slipDetected: true,
    slipReason: "rate-limit",
    costUsd: "0.310",
    inputTokens: 22000,
    outputTokens: 6800,
    durationMs: 45 * 60 * 1000,
    graderType: "automated",
  });
  console.log("  →", slip);

  console.log("[gear-demo] emitting Ring 1→2 HITL-graded record...");
  const hitl = await emitGearInterface({
    interfaceClass: "internal-adjacent",
    innerRing: 1,
    outerRing: 2,
    transmissionDirection: "outward",
    shaftSourceType: "decision-interaction",
    shaftSourceId: `${SHAFT_ID_PREFIX}-hitl-1`,
    sourceEventAt: new Date("2026-05-24T16:00:00Z"),
    actorType: "human",
    actorId: "operator-mark",
    intent: "approve-phase-gate",
    capabilityName: `build-phase-${DEMO_PHASE}`,
    agentIdForTriple: DEMO_AGENT,
    torqueTechnical: 1.0,
    torqueConfidence: 1.0,
    ratioConsumed: 1,
    outcomeType: "transmission",
    graderType: "human",
    graderId: "operator-mark",
    rationale: "Manual gate approval — UX verification looked correct against acceptance criteria.",
  });
  console.log("  →", hitl);

  console.log("[gear-demo] emitting Ring 1→2 graduation event...");
  const graduation = await emitGearInterface({
    interfaceClass: "internal-adjacent",
    innerRing: 1,
    outerRing: 2,
    transmissionDirection: "outward",
    shaftSourceType: "decision-interaction",
    shaftSourceId: `${SHAFT_ID_PREFIX}-graduation-1`,
    sourceEventAt: new Date("2026-05-24T16:15:00Z"),
    actorType: "system",
    actorId: "autonomy-governor-stub",
    intent: "graduate-autonomy",
    capabilityName: `build-phase-${DEMO_PHASE}`,
    agentIdForTriple: DEMO_AGENT,
    torqueTechnical: 1.0,
    torqueConfidence: 0.95,
    ratioConsumed: 1,
    outcomeType: "graduation",
    graduationFromAutonomy: "hitl-required",
    graduationToAutonomy: "hitl-fallback",
    graduationSampleSize: 24,
    graduationGovernorRef: `${SHAFT_ID_PREFIX}-di-graduation-1`,
    graderType: "deliberation",
    rationale: "24 consecutive successful Ring 1→2 transmissions; graduating to hitl-fallback.",
  });
  console.log("  →", graduation);

  const totalRows = await prisma.gearInterface.count();
  console.log(`[gear-demo] done. Total GearInterface rows in DB: ${totalRows}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[gear-demo] failed:", err);
  process.exit(1);
});

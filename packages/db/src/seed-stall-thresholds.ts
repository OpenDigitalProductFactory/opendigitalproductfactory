/**
 * Seed BuildStudioStallThreshold rows for BI-4ab6be39 (stall detection + recovery).
 *
 * Six rows: one per Build Studio phase plus a "default" fallback for TaskRuns
 * without a buildId (coworker/skill/proactive sources). Defaults derived from
 * the spec §5.4 — operator-editable at runtime via Admin UI; this seed sets
 * initial values only.
 *
 * Idempotent via upsert; the create branch holds the default and the update
 * branch is empty so existing operator-edited values are NEVER overwritten by
 * a re-seed. The post-seed invariant guard fails the seed run if any expected
 * row is absent.
 */
import type { PrismaClient } from "../generated/client/client";

interface ThresholdSeed {
  scope: string;
  heartbeatTimeoutSeconds: number;
  totalPhaseTimeoutSeconds: number;
}

export const STALL_THRESHOLD_SEEDS: readonly ThresholdSeed[] = [
  { scope: "phase.ideate", heartbeatTimeoutSeconds: 90, totalPhaseTimeoutSeconds: 900 },
  { scope: "phase.plan", heartbeatTimeoutSeconds: 120, totalPhaseTimeoutSeconds: 1800 },
  { scope: "phase.build", heartbeatTimeoutSeconds: 180, totalPhaseTimeoutSeconds: 3600 },
  { scope: "phase.review", heartbeatTimeoutSeconds: 120, totalPhaseTimeoutSeconds: 1800 },
  { scope: "phase.ship", heartbeatTimeoutSeconds: 120, totalPhaseTimeoutSeconds: 1800 },
  { scope: "default", heartbeatTimeoutSeconds: 120, totalPhaseTimeoutSeconds: 1800 },
] as const;

const REQUIRED_SCOPES = STALL_THRESHOLD_SEEDS.map((s) => s.scope);

export async function seedStallThresholds(prisma: PrismaClient): Promise<void> {
  for (const seed of STALL_THRESHOLD_SEEDS) {
    await prisma.buildStudioStallThreshold.upsert({
      where: { scope: seed.scope },
      create: {
        scope: seed.scope,
        heartbeatTimeoutSeconds: seed.heartbeatTimeoutSeconds,
        totalPhaseTimeoutSeconds: seed.totalPhaseTimeoutSeconds,
      },
      // Empty update — never overwrite operator-edited values on re-seed.
      update: {},
    });
  }

  // Invariant guard — fail the seed run if any expected row is absent.
  const existing = await prisma.buildStudioStallThreshold.findMany({
    where: { scope: { in: REQUIRED_SCOPES } },
    select: { scope: true },
  });
  const presentScopes = new Set(existing.map((r) => r.scope));
  const missing = REQUIRED_SCOPES.filter((s) => !presentScopes.has(s));
  if (missing.length > 0) {
    throw new Error(
      `[seed-stall-thresholds] invariant failed — missing required scopes after upsert: ${missing.join(", ")}`,
    );
  }
}

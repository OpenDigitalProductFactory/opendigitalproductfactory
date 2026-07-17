// apps/web/lib/routing/local-tool-fidelity.ts
//
// EP-E431FC8A Phase 2 (BI-DF3092F4). Bridges the measured fidelity samples
// (stored in ModelProfile.customScores by the harness) to the per-turn tool cap.
// resolveLocalToolFidelityCeiling() reads the active local generation profiles
// and returns the largest MEASURED tool-selection ceiling; agent-coworker passes
// it to deriveCoworkerToolCap so a local model that has PROVEN it selects well
// from more tools is trusted with more — while an unmeasured model returns null
// and keeps the Phase-1 fail-safe cliff. Best-effort: never throws on the
// attachment hot path.

import { prisma, Prisma } from "@dpf/db";
import {
  deriveMeasuredToolCeiling,
  readToolFidelitySamples,
  TOOL_FIDELITY_SCORE_KEY,
  type ToolFidelitySample,
} from "./tool-fidelity-policy";

/**
 * Persist a measured fidelity curve into ModelProfile.customScores (no schema
 * change) so resolveLocalToolFidelityCeiling can lift the cap on the next turn.
 * Merges into the existing customScores blob, overwriting only the fidelity key.
 * Called by the operator-facing fidelity runner after measureToolFidelity.
 */
export async function persistToolFidelitySamples(
  providerId: string,
  modelId: string,
  samples: ToolFidelitySample[],
): Promise<void> {
  const profile = await prisma.modelProfile.findUnique({
    where: { providerId_modelId: { providerId, modelId } },
    select: { customScores: true },
  });
  const prior = (profile?.customScores && typeof profile.customScores === "object"
    ? (profile.customScores as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  await prisma.modelProfile.update({
    where: { providerId_modelId: { providerId, modelId } },
    data: {
      customScores: { ...prior, [TOOL_FIDELITY_SCORE_KEY]: samples } as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * The largest measured tool-selection ceiling across the active local generation
 * profiles, or `null` when none has qualifying fidelity evidence (→ fail-safe).
 * A DB hiccup or malformed samples resolve to `null`, never an exception.
 */
export async function resolveLocalToolFidelityCeiling(): Promise<number | null> {
  try {
    const profiles = await prisma.modelProfile.findMany({
      where: {
        providerId: { in: ["local", "ollama"] },
        modelStatus: { in: ["active", "degraded"] },
      },
      select: { customScores: true },
    });
    let best: number | null = null;
    for (const p of profiles) {
      const ceiling = deriveMeasuredToolCeiling(readToolFidelitySamples(p.customScores));
      if (ceiling !== null && (best === null || ceiling > best)) best = ceiling;
    }
    return best;
  } catch {
    return null;
  }
}

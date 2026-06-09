// apps/web/lib/routing/persist-engine-readiness.ts
//
// Build-Engine Provisioning (EP-2D477458) — slice B.
//
// Persists an EngineReadiness result to BuildEngineState. Deliberately SEPARATE
// from probeEngineReadiness so the probe hot path stays DB-free (architecture
// advisory): callers that want to record an outcome call this explicitly.
//
// Spec: docs/superpowers/specs/2026-06-06-build-engine-provisioning-design.md (Phase 1a, slice B)

import { prisma } from "@dpf/db";
import type { EngineReadiness } from "./capability-probes/probe-engine-readiness";

/**
 * Structural client shape — avoids coupling this module (and its test) to the
 * generated Prisma client surface, mirroring sync-engine-registry.ts.
 */
type PersistEngineStateClient = {
  buildEngineState: {
    upsert(args: {
      where: { engineId: string };
      create: { engineId: string; present: boolean; version: string | null; lastProbedAt: Date };
      update: { present: boolean; version: string | null; lastProbedAt: Date };
    }): Promise<unknown>;
  };
};

/**
 * Upsert the latest readiness for an engine into BuildEngineState. Never sets
 * the provisioning fields (lastProvisionedAt/recipeApplied/desired/provisionedBy)
 * — those belong to the provision action, not a readiness probe.
 */
export async function persistEngineReadiness(
  readiness: EngineReadiness,
  client: PersistEngineStateClient = prisma as unknown as PersistEngineStateClient,
): Promise<void> {
  const lastProbedAt = new Date(readiness.probedAt);
  await client.buildEngineState.upsert({
    where: { engineId: readiness.engineId },
    create: {
      engineId: readiness.engineId,
      present: readiness.present,
      version: readiness.version,
      lastProbedAt,
    },
    update: {
      present: readiness.present,
      version: readiness.version,
      lastProbedAt,
    },
  });
}

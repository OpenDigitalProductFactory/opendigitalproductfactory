// apps/web/lib/build/build-engine-reconcile.ts
//
// Build-Engine Provisioning (EP-2D477458) — Phase 3, the auto-replay reconciler.
//
// Sandboxes are recreated (recovery restart/reset, slot reuse), which wipes any
// engine that was provisioned ON DEMAND (i.e. not baked into the image). This
// reconciler re-installs exactly those: engines we previously provisioned
// successfully (desired=present AND lastProvisionedAt set) that a fresh probe
// now reports absent.
//
// Deliberately NARROW so it is cheap and safe to fire on every sandbox-ready:
//   - It never re-installs a baked engine that is merely missing (that is an
//     image problem, not a re-provision case) — those have no lastProvisionedAt.
//   - It never installs a never-provisioned engine.
//   - For a fresh sandbox with no prior on-demand provisioning it is a no-op
//     (a few cheap `--version` probes, no installs, no 137MB downloads).
//
// Spec: docs/superpowers/specs/2026-06-06-build-engine-provisioning-design.md (Phase 3, §4.4)

import { prisma } from "@dpf/db";

import {
  probeEngineReadiness,
  type EngineProbeConfig,
} from "@/lib/routing/capability-probes/probe-engine-readiness";
import { persistEngineReadiness } from "@/lib/routing/persist-engine-readiness";
import { provisionBuildEngine, type ProvisionOutcome } from "./build-engine-provision";

/** The persisted-state fields the reconcile decision depends on. */
export type ReconcileEngineState = {
  desired: string | null;
  lastProvisionedAt: Date | string | null;
};

/**
 * True when an engine should be auto-restored after a sandbox rebuild: it is
 * desired present AND we successfully provisioned it on demand before (so its
 * absence now means the rebuild wiped it). Pure — unit-tested.
 */
export function shouldReprovision(state: ReconcileEngineState | null | undefined): boolean {
  return state?.desired === "present" && state?.lastProvisionedAt != null;
}

export type ReconcileSummary = {
  checked: number;
  restored: Array<{ engineId: string; outcome: ProvisionOutcome["kind"] }>;
  skipped: number;
};

/**
 * Re-provision desired, previously-provisioned, now-absent engines into the
 * running sandbox. Best-effort and idempotent; safe to fire-and-forget on
 * sandbox-ready.
 */
export async function reconcileBuildEngines(opts: {
  actorUserId: string;
  offline?: boolean;
}): Promise<ReconcileSummary> {
  const engines = await prisma.buildEngine.findMany({
    select: {
      engineId: true,
      binary: true,
      verifyCommand: true,
      versionRegex: true,
      state: { select: { desired: true, lastProvisionedAt: true } },
    },
  });

  const restored: ReconcileSummary["restored"] = [];
  let skipped = 0;

  for (const engine of engines) {
    if (!shouldReprovision(engine.state)) {
      skipped++;
      continue;
    }

    const probeConfig: EngineProbeConfig = {
      engineId: engine.engineId,
      binary: engine.binary,
      verifyCommand: engine.verifyCommand,
      versionRegex: engine.versionRegex,
    };
    const probe = await probeEngineReadiness(probeConfig);
    await persistEngineReadiness(probe).catch(() => undefined);
    if (probe.present) {
      skipped++;
      continue; // still there — nothing to restore
    }

    const outcome = await provisionBuildEngine(engine.engineId, {
      offline: opts.offline,
      actorUserId: opts.actorUserId,
    });
    restored.push({ engineId: engine.engineId, outcome: outcome.kind });
  }

  return { checked: engines.length, restored, skipped };
}

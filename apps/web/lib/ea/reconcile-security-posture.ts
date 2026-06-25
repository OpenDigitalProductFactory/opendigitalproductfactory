// apps/web/lib/ea/reconcile-security-posture.ts
//
// Reconcile the Security Operations (SOC) SysML projection (Parity Engine,
// living-graph — EP-SOVEREIGN-SOC / EP-PARITY-ENGINE). Thin IO shell: the model
// is fully derived from the implementation (KERNEL_DETECTION_PACK + the AGT-SOC-*
// roster), so this re-derives and applies it every run — the projection cannot
// drift. Cross-layer `traces` to the security data-model nodes resolve once the
// Prisma->EA mirror has run.

import { prisma } from "@dpf/db";

import { buildSecurityPostureModel } from "./security-posture-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

export async function reconcileSecurityPosture(
  opts: { db?: typeof prisma } = {},
): Promise<SysmlSeedResult> {
  const result = await applySysmlModel(buildSecurityPostureModel(), { db: opts.db });
  console.info(
    `[security-posture] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed} crossLayerLinked=${result.crossLayerLinked ?? 0}`,
  );
  return result;
}

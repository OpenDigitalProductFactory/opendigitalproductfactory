// Runtime shell for the deterministic AI-routing architecture projection.
//
// Apply order matters: BPMN and ArchiMate elements must exist before the SysML
// model materializes its dedicated cross-notation relationships across all three
// viewpoints.

import { prisma } from "@dpf/db";
import { buildAiRoutingArchitectureModels } from "./ai-routing-architecture-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

export type AiRoutingArchitectureReconcileResult = SysmlSeedResult & {
  bpmn: SysmlSeedResult;
  archimate: SysmlSeedResult;
  sysml: SysmlSeedResult;
};

export function summarizeAiRoutingArchitectureResults(
  bpmn: SysmlSeedResult,
  archimate: SysmlSeedResult,
  sysml: SysmlSeedResult,
): AiRoutingArchitectureReconcileResult {
  const results = [bpmn, archimate, sysml];
  const status: SysmlSeedResult["status"] = results.some(
    (result) => result.status === "applied",
  )
    ? "applied"
    : results.every((result) => result.status === "skipped")
      ? "skipped"
      : "noop";
  return {
    status,
    created: results.reduce((total, result) => total + result.created, 0),
    updated: results.reduce((total, result) => total + result.updated, 0),
    removed: results.reduce((total, result) => total + result.removed, 0),
    crossLayerLinked: results.reduce(
      (total, result) => total + (result.crossLayerLinked ?? 0),
      0,
    ),
    crossLayerUnresolved: results.reduce(
      (total, result) => total + (result.crossLayerUnresolved ?? 0),
      0,
    ),
    bpmn,
    archimate,
    sysml,
  };
}

export async function reconcileAiRoutingArchitecture(
  opts: { db?: typeof prisma } = {},
): Promise<AiRoutingArchitectureReconcileResult> {
  const models = buildAiRoutingArchitectureModels();
  const db = opts.db ?? prisma;

  const bpmn = await applySysmlModel(models.bpmn, {
    db,
    notationSlug: "bpmn20",
  });
  const archimate = await applySysmlModel(models.archimate, {
    db,
    notationSlug: "archimate4",
  });
  const sysml = await applySysmlModel(models.sysml, {
    db,
    notationSlug: "sysml2",
  });
  const result = summarizeAiRoutingArchitectureResults(
    bpmn,
    archimate,
    sysml,
  );

  console.info(
    `[ai-routing-architecture] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed} crossLinked=${result.crossLayerLinked ?? 0} crossUnresolved=${result.crossLayerUnresolved ?? 0}`,
  );
  return result;
}

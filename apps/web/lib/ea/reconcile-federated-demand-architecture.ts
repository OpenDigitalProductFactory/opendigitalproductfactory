import { prisma } from "@dpf/db";

import { buildFederatedDemandArchitectureModel } from "./federated-demand-architecture-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

export async function reconcileFederatedDemandArchitecture(
  opts: { db?: typeof prisma } = {},
): Promise<SysmlSeedResult> {
  return applySysmlModel(buildFederatedDemandArchitectureModel(), { db: opts.db, notationSlug: "sysml2" });
}

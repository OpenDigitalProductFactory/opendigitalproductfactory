import { prisma } from "@dpf/db";
import { buildWorkPatternArchitectureModel, type WorkPatternArchitectureObservedPattern } from "./work-pattern-architecture-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

export async function reconcileWorkPatternArchitecture(
  opts: {
    db?: typeof prisma;
    observedPatterns?: WorkPatternArchitectureObservedPattern[];
  } = {},
): Promise<SysmlSeedResult> {
  const result = await applySysmlModel(
    buildWorkPatternArchitectureModel({ observedPatterns: opts.observedPatterns }),
    { db: opts.db, notationSlug: "sysml2" },
  );

  console.info("[work-pattern-architecture] reconcile", {
    status: result.status,
    created: result.created,
    updated: result.updated,
    removed: result.removed,
  });

  return result;
}

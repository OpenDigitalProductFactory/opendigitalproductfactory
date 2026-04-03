import {
  collectDockerDiscovery,
  collectHostDiscovery,
  collectKubernetesDiscovery,
  collectPrometheusDiscovery,
} from "./discovery-collectors";
import {
  normalizeDiscoveredFacts,
  type NormalizeDiscoveryOptions,
} from "./discovery-normalize";
import { persistBootstrapDiscoveryRun } from "./discovery-sync";
import { promoteInventoryEntities } from "./discovery-promotion";
import type { CollectorOutput, DiscoveryCollector } from "./discovery-types";

type BootstrapDiscoveryDb = Parameters<typeof persistBootstrapDiscoveryRun>[0];

type BootstrapExecutionOptions = NormalizeDiscoveryOptions & {
  collectors?: DiscoveryCollector[];
  normalize?: typeof normalizeDiscoveredFacts;
  persist?: typeof persistBootstrapDiscoveryRun;
  runKey?: string;
  sourceSlug?: string;
  trigger?: string;
};

export function mergeCollectorOutputs(outputs: CollectorOutput[]): CollectorOutput {
  return outputs.reduce<CollectorOutput>(
    (merged, output) => {
      merged.items.push(...output.items);
      merged.relationships.push(...output.relationships);
      merged.software?.push(...(output.software ?? []));
      merged.warnings?.push(...(output.warnings ?? []));
      return merged;
    },
    { items: [], relationships: [], software: [], warnings: [] },
  );
}

export async function runLocalDiscoveryCollectors(
  collectors: DiscoveryCollector[] = [
    collectHostDiscovery,
    collectDockerDiscovery,
    collectKubernetesDiscovery,
    collectPrometheusDiscovery,
  ],
): Promise<CollectorOutput> {
  const outputs = await Promise.all(
    collectors.map((collector) => collector({ sourceKind: "dpf_bootstrap" })),
  );
  return mergeCollectorOutputs(outputs);
}

export async function runBootstrapCollectors(
  collectors?: DiscoveryCollector[],
): Promise<CollectorOutput> {
  return runLocalDiscoveryCollectors(collectors);
}

export async function executeBootstrapDiscovery(
  db: BootstrapDiscoveryDb,
  options: BootstrapExecutionOptions = {},
) {
  const collected = await runBootstrapCollectors(options.collectors);
  const taxonomyNodes = options.taxonomyNodes
    ?? (typeof (db as { taxonomyNode?: { findMany?: unknown } }).taxonomyNode?.findMany === "function"
      ? await ((db as unknown) as {
          taxonomyNode: {
            findMany(args: {
              select: { nodeId: true; name: true };
            }): Promise<Array<{ nodeId: string; name: string }>>;
          };
        }).taxonomyNode.findMany({
          select: { nodeId: true, name: true },
        })
      : undefined);
  const normalized = (options.normalize ?? normalizeDiscoveredFacts)(collected, {
    ...(taxonomyNodes ? { taxonomyNodes } : {}),
    ...(options.softwareIdentities ? { softwareIdentities: options.softwareIdentities } : {}),
    ...(options.softwareRules ? { softwareRules: options.softwareRules } : {}),
  });

  const persistenceSummary = await (options.persist ?? persistBootstrapDiscoveryRun)(db, normalized, {
    runKey: options.runKey ?? `DISC-${Date.now()}`,
    sourceSlug: options.sourceSlug ?? "dpf_bootstrap",
    trigger: options.trigger ?? "bootstrap",
  });

  // Auto-promote high-confidence entities to DigitalProduct records
  try {
    const promotionSummary = await promoteInventoryEntities(db as never);
    if (promotionSummary.promoted > 0) {
      console.log(`[discovery] Auto-promoted ${promotionSummary.promoted} entities to DigitalProducts`);
    }
  } catch (err) {
    console.error("[discovery] Promotion pass failed (non-fatal):", err);
  }

  return persistenceSummary;
}

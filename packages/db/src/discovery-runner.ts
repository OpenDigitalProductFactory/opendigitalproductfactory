import {
  collectDockerDiscovery,
  collectHostDiscovery,
  collectKubernetesDiscovery,
} from "./discovery-collectors";
import { normalizeDiscoveredFacts } from "./discovery-normalize";
import { persistBootstrapDiscoveryRun } from "./discovery-sync";
import type { CollectorOutput, DiscoveryCollector } from "./discovery-types";

type BootstrapDiscoveryDb = Parameters<typeof persistBootstrapDiscoveryRun>[0];

type BootstrapExecutionOptions = {
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
      merged.warnings?.push(...(output.warnings ?? []));
      return merged;
    },
    { items: [], relationships: [], warnings: [] },
  );
}

export async function runLocalDiscoveryCollectors(
  collectors: DiscoveryCollector[] = [
    collectHostDiscovery,
    collectDockerDiscovery,
    collectKubernetesDiscovery,
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
  const normalized = (options.normalize ?? normalizeDiscoveredFacts)(collected);

  return (options.persist ?? persistBootstrapDiscoveryRun)(db, normalized, {
    runKey: options.runKey ?? `DISC-${Date.now()}`,
    sourceSlug: options.sourceSlug ?? "dpf_bootstrap",
    trigger: options.trigger ?? "bootstrap",
  });
}

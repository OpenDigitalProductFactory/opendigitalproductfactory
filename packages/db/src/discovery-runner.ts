import {
  collectDockerDiscovery,
  collectHostDiscovery,
  collectKubernetesDiscovery,
} from "./discovery-collectors";
import type { CollectorOutput, DiscoveryCollector } from "./discovery-types";

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

import os from "node:os";

import type { CollectorContext, CollectorOutput } from "../discovery-types";

type HostOsAdapter = {
  hostname: typeof os.hostname;
  platform: typeof os.platform;
  release: typeof os.release;
  arch: typeof os.arch;
  cpus: typeof os.cpus;
  totalmem: typeof os.totalmem;
  networkInterfaces: typeof os.networkInterfaces;
};

const defaultHostOsAdapter: HostOsAdapter = {
  hostname: os.hostname,
  platform: os.platform,
  release: os.release,
  arch: os.arch,
  cpus: os.cpus,
  totalmem: os.totalmem,
  networkInterfaces: os.networkInterfaces,
};

export async function collectHostDiscovery(
  ctx?: CollectorContext,
  osAdapter: HostOsAdapter = defaultHostOsAdapter,
): Promise<CollectorOutput> {
  const hostname = osAdapter.hostname();

  return {
    items: [
      {
        sourceKind: ctx?.sourceKind ?? "host",
        itemType: "host",
        name: hostname,
        externalRef: `host:${hostname}`,
        naturalKey: `hostname:${hostname}`,
        confidence: 1,
        attributes: {
          platform: osAdapter.platform(),
          release: osAdapter.release(),
          arch: osAdapter.arch(),
          cpuCount: osAdapter.cpus().length,
          totalMemoryBytes: osAdapter.totalmem(),
          networkInterfaces: osAdapter.networkInterfaces(),
        },
      },
    ],
    relationships: [],
  };
}

// Minimal Phase 0 host observation collector.
//
// Gathers a single "host" observation item describing the machine the
// Edge Node is running on, using only Node's built-in `os` module so
// the collector works inside the Alpine container without external
// binaries.
//
// Richer collectors (subnet sweep, ARP, Docker enumeration, installed
// software) will be plugged in later. For Phase 0 the goal is to
// demonstrate the end-to-end ingestion path: enroll → heartbeat →
// SUBMIT-A-DISCOVERY-RUN. One observation is enough for that.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Capabilities (Phase 0): discovery.network
// Roadmap: docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md A5

import * as os from "node:os";
import { createHash } from "node:crypto";

/**
 * An observation item suitable for POST /api/v1/edge/discovery-runs.
 * Mirrors the Zod schema on the Authority side (`ObservationItem`).
 */
export type ObservationItem = {
  observedKey: string;
  itemType: string;
  name: string;
  sourcePath?: string;
  confidence?: number;
  rawData: Record<string, unknown>;
};

/** Adapter for tests — overrides Node's `os` calls. */
export type HostInfoAdapter = {
  hostname: () => string;
  platform: () => NodeJS.Platform;
  release: () => string;
  arch: () => string;
  uptime: () => number;
  totalmem: () => number;
  cpus: () => Array<{ model: string; speed: number }>;
  networkInterfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
};

const DEFAULT_ADAPTER: HostInfoAdapter = {
  hostname: os.hostname,
  platform: os.platform,
  release: os.release,
  arch: os.arch,
  uptime: os.uptime,
  totalmem: os.totalmem,
  cpus: os.cpus,
  networkInterfaces: os.networkInterfaces,
};

/**
 * Stable, non-PII-leaking key for the host. Hashing the hostname keeps
 * the observed key stable across sweeps while avoiding leaking the raw
 * hostname into the lookup key (the raw hostname is still in
 * `name` + `rawData.hostname` for operator readability).
 */
function fingerprintHost(platform: string, hostname: string): string {
  const digest = createHash("sha256").update(`${platform}:${hostname}`).digest("hex");
  return digest.slice(0, 16);
}

function summarizeInterfaces(
  ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs || addrs.length === 0) continue;
    out.push({
      name,
      addresses: addrs.map((addr) => ({
        family: addr.family,
        address: addr.address,
        internal: addr.internal,
        cidr: addr.cidr ?? null,
      })),
    });
  }
  return out;
}

/**
 * Collect a single host observation. Synchronous on purpose — all
 * inputs come from `os`, which is sync. The async wrapper would only
 * add latency.
 *
 * @param adapter - test seam; defaults to Node's `os` module.
 */
export function collectHostInfo(
  adapter: HostInfoAdapter = DEFAULT_ADAPTER,
): { items: ObservationItem[]; relationships: never[] } {
  const platform = adapter.platform();
  const hostname = adapter.hostname();
  const fingerprint = fingerprintHost(platform, hostname);

  const item: ObservationItem = {
    observedKey: `host:${platform}:${fingerprint}`,
    itemType: "host",
    name: hostname,
    confidence: 1.0,
    rawData: {
      hostname,
      platform,
      release: adapter.release(),
      arch: adapter.arch(),
      uptimeSec: Math.floor(adapter.uptime()),
      totalmemBytes: adapter.totalmem(),
      cpuCount: adapter.cpus().length,
      networkInterfaces: summarizeInterfaces(adapter.networkInterfaces()),
    },
  };

  return { items: [item], relationships: [] };
}

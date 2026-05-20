// Metrics collection loop — runs independently of the discovery sweep.
//
// Every `metricsIntervalSec` (default 10 s from Authority heartbeat response):
//   1. Walks ifXTable via SNMP → per-interface counter snapshots.
//   2. Computes BPS deltas from previous snapshot (null on first tick).
//   3. Walks lldpRemTable → LLDP peer records.
//   4. POSTs EdgeMetricsPayload to /api/v1/edge/metrics.
//
// The loop runs only when the node's trustState is "trusted". It does not
// queue or retry failed POSTs — metrics are ephemeral; the next tick will
// produce a fresh payload.
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//   § Metrics loop, § SNMP ifTable walk, § LLDP collector

import type { EdgeMetricsPayload } from "@dpf/validators";

import type { AuthorityApiClient } from "./api-client.js";
import { InterfaceRateComputer } from "./collectors/interface-rate.js";
import {
  walkInterfaceMetrics,
  type SnmpInterfaceConfig,
} from "./collectors/snmp-interface-metrics.js";
import {
  collectLldpPeers,
} from "./collectors/lldp-collector.js";
import type { EdgeNodeConfig } from "./config.js";
import type { EdgeNodeState } from "./state.js";

const DEFAULT_METRICS_INTERVAL_SEC = 10;

export type MetricsRunnerOptions = {
  config: EdgeNodeConfig;
  api: AuthorityApiClient;
  state: EdgeNodeState;
  /** SNMP target — defaults to config.snmpTarget if set, else skips metrics. */
  snmpTarget?: string;
  /** Override for tests. */
  sleep?: (ms: number) => Promise<void>;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
  /** Stop after N ticks (test seam). */
  maxIterations?: number;
};

/**
 * Run the metrics loop.  Returns when `maxIterations` is reached.
 * In normal operation, never returns.
 */
export async function runMetricsLoop(opts: MetricsRunnerOptions): Promise<void> {
  const log = opts.log ?? defaultLog;
  const sleep = opts.sleep ?? defaultSleep;
  const { config, api, state } = opts;

  const snmpTarget = opts.snmpTarget ?? process.env["SNMP_TARGET"];
  if (!snmpTarget) {
    log("info", "metrics-loop: SNMP_TARGET not set — metrics collection disabled.");
    return;
  }

  const snmpConfig: SnmpInterfaceConfig = {
    target: snmpTarget,
    community: process.env["SNMP_COMMUNITY"] ?? "public",
  };

  const rateComputer = new InterfaceRateComputer();
  let iterations = 0;

  while (true) {
    if (opts.maxIterations !== undefined && iterations >= opts.maxIterations) return;
    iterations++;

    const intervalSec = state.metricsIntervalSec ?? DEFAULT_METRICS_INTERVAL_SEC;

    // Only collect when the node is trusted.
    if (state.trustState !== "trusted") {
      log("info", "metrics-loop: node not trusted — skipping tick.");
      await sleep(intervalSec * 1_000);
      continue;
    }

    try {
      // 1. SNMP ifXTable walk
      const snapshots = await walkInterfaceMetrics(snmpConfig).catch((err) => {
        log("warn", `metrics-loop: SNMP walk failed: ${(err as Error).message}`);
        return [];
      });

      // 2. BPS delta computation
      const rates = rateComputer.compute(snapshots);
      rateComputer.prune(new Set(snapshots.map((s) => s.ifIndex)));

      // 3. LLDP walk
      const lldpPeers = await collectLldpPeers(snmpConfig).catch((err) => {
        log("warn", `metrics-loop: LLDP walk failed: ${(err as Error).message}`);
        return [];
      });

      // 4. Build and POST payload
      const networkMetrics = snapshots.map((s, i) => ({
        ifIndex: s.ifIndex,
        ifDescr: s.ifDescr,
        ifAlias: s.ifAlias,
        ifHCInOctets: s.inOctets,
        ifHCOutOctets: s.outOctets,
        timestamp: s.timestamp,
        // Attach computed rates for convenience (optional enrichment).
        ...(rates[i] && rates[i]!.inBps !== null
          ? { inBps: rates[i]!.inBps!, outBps: rates[i]!.outBps! }
          : {}),
      }));

      if (networkMetrics.length === 0 && lldpPeers.length === 0) {
        log("info", "metrics-loop: no data this tick — skipping POST.");
      } else {
        const payload: EdgeMetricsPayload = {
          nodeId: state.nodeId,
          timestamp: new Date().toISOString(),
          metrics: networkMetrics.length > 0 ? { network: networkMetrics as never } : undefined,
          discovery:
            lldpPeers.length > 0
              ? {
                  lldp: lldpPeers.map((p) => ({
                    localPort: p.localPort,
                    chassisId: p.chassisId,
                    portId: p.portId,
                    systemName: p.systemName,
                    systemDescription: p.systemDescription,
                    portDescription: p.portDescription,
                    timestamp: p.timestamp,
                  })),
                }
              : undefined,
        };

        await api.postMetrics(state.nodeToken, payload).catch((err) => {
          log("warn", `metrics-loop: POST failed: ${(err as Error).message}`);
        });

        log(
          "info",
          `metrics-loop: tick complete — interfaces=${networkMetrics.length} lldpPeers=${lldpPeers.length}`,
        );
      }
    } catch (err) {
      log("error", `metrics-loop: unexpected error: ${(err as Error).message}`);
    }

    await sleep(intervalSec * 1_000);
  }
}

function defaultLog(level: "info" | "warn" | "error", msg: string): void {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console[level](`[${ts}] ${msg}`);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

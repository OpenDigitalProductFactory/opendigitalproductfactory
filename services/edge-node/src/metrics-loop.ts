// Metrics collection loop — runs independently of the discovery sweep.
//
// Every `metricsIntervalSec` (default 10 s from Authority heartbeat response):
//   1. Walks ifXTable via SNMP → per-interface counter snapshots.
//   2. Computes BPS deltas from previous snapshot (skips first-sample nils).
//   3. Builds MetricsEnvelope (§6.1 wire contract) with computed rxBps/txBps.
//   4. POSTs to /api/v1/edge/metrics with a UUID runKey for idempotency.
//
// The loop runs only when the node's trustState is "trusted". It does not
// queue or retry failed POSTs — metrics are ephemeral; the next tick will
// produce a fresh payload.
//
// LLDP peer discovery is NOT included in MetricsEnvelope per spec §6.1.
// It is submitted via the existing discovery-runs endpoint (see sweep.ts).
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//   §6.1 MetricsEnvelope, §6.2 Portal Ingestion

import { randomUUID } from "node:crypto";

import type { InterfaceMetric, MetricsEnvelope } from "@dpf/validators";

import type { AuthorityApiClient } from "./api-client.js";
import { InterfaceRateComputer } from "./collectors/interface-rate.js";
import {
  walkInterfaceMetrics,
  type SnmpInterfaceConfig,
} from "./collectors/snmp-interface-metrics.js";
import type { EdgeNodeConfig } from "./config.js";
import type { EdgeNodeState } from "./state.js";

const DEFAULT_METRICS_INTERVAL_SEC = 10;

export type MetricsRunnerOptions = {
  config: EdgeNodeConfig;
  api: AuthorityApiClient;
  state: EdgeNodeState;
  /** SNMP target override. Falls back to SNMP_TARGET env var. */
  snmpTarget?: string;
  /** Override for tests. */
  sleep?: (ms: number) => Promise<void>;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
  /** Stop after N ticks (test seam). */
  maxIterations?: number;
};

/**
 * Run the metrics loop. Returns when `maxIterations` is reached.
 * In normal operation, never returns.
 */
export async function runMetricsLoop(opts: MetricsRunnerOptions): Promise<void> {
  const log = opts.log ?? defaultLog;
  const sleep = opts.sleep ?? defaultSleep;
  const { api, state } = opts;

  const snmpTarget = opts.snmpTarget ?? process.env["SNMP_TARGET"];
  if (!snmpTarget) {
    log("info", "metrics-loop: SNMP_TARGET not set — metrics collection disabled.");
    return;
  }

  const snmpConfig: SnmpInterfaceConfig = {
    target: snmpTarget,
    community: process.env["SNMP_COMMUNITY"] ?? "public",
  };

  const deviceKey = `snmp:${snmpTarget}`;
  const rateComputer = new InterfaceRateComputer();
  let iterations = 0;

  while (true) {
    if (opts.maxIterations !== undefined && iterations >= opts.maxIterations) return;
    iterations++;

    const intervalSec = state.metricsIntervalSec ?? DEFAULT_METRICS_INTERVAL_SEC;

    // Only collect when the node is trusted — spec §6.2 requires edge:metrics scope
    // which is gated on trustState=trusted on the portal side, but we also gate
    // locally to avoid noisy rejected POSTs during the pending/quarantined phases.
    if (state.trustState !== "trusted") {
      log("info", "metrics-loop: node not trusted — skipping tick.");
      await sleep(intervalSec * 1_000);
      continue;
    }

    try {
      // 1. SNMP ifXTable walk → counter snapshots
      const snapshots = await walkInterfaceMetrics(snmpConfig).catch((err) => {
        log("warn", `metrics-loop: SNMP walk failed: ${(err as Error).message}`);
        return [];
      });

      // 2. BPS delta computation (nil on first sample — skip those rows)
      const rates = rateComputer.compute(snapshots);
      rateComputer.prune(new Set(snapshots.map((s) => s.ifIndex)));

      // 3. Build InterfaceMetric[] (spec §6.1 shape — computed rates, not raw counters)
      const interfaces: InterfaceMetric[] = [];
      for (let i = 0; i < snapshots.length; i++) {
        const snap = snapshots[i]!;
        const rate = rates[i]!;

        // Skip first-sample rows where BPS is not yet computable.
        if (rate.inBps === null || rate.outBps === null) continue;

        interfaces.push({
          deviceKey,
          ifIndex: snap.ifIndex,
          ifName: snap.ifAlias ?? snap.ifDescr,
          rxBps: rate.inBps,
          txBps: rate.outBps,
          // operStatus heuristic: if either direction has traffic, the port is "up".
          // We don't walk ifOperStatus separately — add if needed in Phase 2.
          operStatus: "unknown",
          rawData: { ifDescr: snap.ifDescr, ifAlias: snap.ifAlias },
        });
      }

      if (interfaces.length === 0) {
        log("info", "metrics-loop: no computable rates this tick — skipping POST.");
        await sleep(intervalSec * 1_000);
        continue;
      }

      // 4. Build MetricsEnvelope per spec §6.1
      const envelope: MetricsEnvelope = {
        runKey: randomUUID(),
        nodeId: state.nodeId,
        observedAt: new Date().toISOString(),
        metricsVersion: "1",
        interfaces,
      };

      await api.postMetrics(state.nodeToken, envelope).catch((err) => {
        log("warn", `metrics-loop: POST failed: ${(err as Error).message}`);
      });

      log(
        "info",
        `metrics-loop: tick complete — runKey=${envelope.runKey} interfaces=${interfaces.length}`,
      );
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

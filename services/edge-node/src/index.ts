// DPF Edge Node — entry point.
//
// Phase 0 lifecycle:
//   1. Load config from env (refuses to start if invalid).
//   2. Try to load existing state from disk.
//   3a. If state exists: skip enrollment, run heartbeat + sweep loops.
//   3b. If state missing: require DPF_BOOTSTRAP_TOKEN env, run enrollment,
//       persist state, then run heartbeat + sweep loops.
//
// Three loops run concurrently:
//   - Heartbeat loop: liveness + runtime-config refresh.
//   - Sweep loop: periodic discovery submission.
//   - Metrics loop: SNMP ifTable + LLDP peer collection (every 10 s,
//     gated on SNMP_TARGET env and trustState=trusted).
//
// If the heartbeat or sweep loop returns (e.g. node revoked), the
// process exits so the supervisor can restart it.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// Roadmap: docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md A3 + A5
// Metrics spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md

import { AuthorityApiClient } from "./api-client";
import { loadConfig } from "./config";
import { runEnrollment } from "./enroll";
import { runHeartbeatLoop } from "./heartbeat";
import { runMetricsLoop } from "./metrics-loop";
import { loadState } from "./state";
import { runSweepLoop } from "./sweep";

async function main(): Promise<void> {
  const config = loadConfig();

  log("info", `DPF Edge Node ${config.version} starting.`);
  log("info", `  authority=${config.authorityUrl}`);
  log("info", `  name=${config.edgeNodeName}`);
  log("info", `  platform=${config.platform} installMode=${config.installMode}`);
  log("info", `  stateDir=${config.stateDir}`);

  const api = new AuthorityApiClient({ authorityUrl: config.authorityUrl });

  let state = await loadState(config.stateDir);

  if (!state) {
    log("info", "No prior state found; running enrollment.");
    state = await runEnrollment({ config, api });
  } else {
    log(
      "info",
      `Resuming as nodeId=${state.nodeId} (trustState=${state.trustState}, enrolledAt=${state.enrolledAt}).`,
    );
  }

  const metricsIntervalSec = state.metricsIntervalSec ?? 10;
  log(
    "info",
    `Starting heartbeat (every ${state.heartbeatIntervalSec}s) + sweep (every ${state.sweepIntervalSec}s) + metrics (every ${metricsIntervalSec}s) loops.`,
  );

  // Race: if the heartbeat or sweep loop returns (revocation signal),
  // let the process exit. The metrics loop runs as a fire-and-forget
  // peer — it never causes the process to exit on failure.
  await Promise.race([
    runHeartbeatLoop({ config, api, state }),
    runSweepLoop({ config, api, state }),
    runMetricsLoop({ config, api, state }).catch((err) => {
      log("warn", `metrics-loop exited unexpectedly: ${(err as Error).message}`);
      // Don't propagate — heartbeat/sweep are the authoritative loops.
    }),
  ]);
}

function log(level: "info" | "warn" | "error", msg: string): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level}] ${msg}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

main().catch((err) => {
  console.error(`Edge Node fatal: ${(err as Error).stack ?? err}`);
  process.exit(1);
});

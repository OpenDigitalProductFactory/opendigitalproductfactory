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
//   - Federation scan loop: probe the segment for nearby DPF installs and
//     report them (every 90 s, trustState=trusted). Without it the Authority's
//     nearby-candidate list has no producer at all — BI-105966A1.
//
// If the heartbeat or sweep loop returns (e.g. node revoked), the
// process exits so the supervisor can restart it.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// Roadmap: docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md A3 + A5
// Metrics spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md

import { AuthorityApiClient, AuthorityHttpError } from "./api-client";
import { loadConfig } from "./config";
import { runEnrollment } from "./enroll";
import { runFederationScanLoop } from "./federation-scan";
import { runHeartbeatLoop } from "./heartbeat";
import { runMetricsLoop } from "./metrics-loop";
import { loadState } from "./state";
import { runSweepLoop } from "./sweep";

// When enrollment fails terminally (consumed bootstrap token / forbidden /
// not-found node), restart-on-failure produces an opaque crashloop —
// especially painful in the remote-deployment case where the operator
// can't SSH in to inspect logs in real time. Instead, switch the
// process to a long-running wait so the container stays "running" from
// Docker's view, and log a clear actionable line on a periodic cadence
// so whoever eventually checks logs sees the same message no matter
// when they look.
const WAIT_MODE_LOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function enrollmentRequiresOperatorIntervention(
  err: AuthorityHttpError,
): Promise<boolean> {
  // Per apps/web/app/api/v1/edge/enroll/route.ts the deterministic
  // operator-action errors are: token_already_consumed, token_expired,
  // token_revoked, token_unknown. All return 401/403 with a structured
  // error code.
  if (err.status !== 401 && err.status !== 403) return false;
  const code = err.errorCode ?? "";
  return [
    "token_already_consumed",
    "token_expired",
    "token_revoked",
    "token_unknown",
  ].includes(code);
}

async function enterWaitMode(reason: string): Promise<never> {
  // Container stays healthy from Docker's POV; periodic log keeps the
  // message visible whenever the operator decides to look. Never exits.
  // The signal handlers below let `docker stop` still terminate cleanly.
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log("info", `Received ${sig}, exiting wait mode.`);
      process.exit(0);
    });
  }
  // First print immediately, then every 5 minutes.
  while (true) {
    log("error", reason);
    log("error", "  Edge node is in wait-mode. No further enrollment attempts will be made until the container restarts with a fresh DPF_BOOTSTRAP_TOKEN.");
    log("error", "  Action: re-issue an auto-approve bootstrap token in the Authority's Admin > Platform Development > Edge Nodes, update DPF_BOOTSTRAP_TOKEN in this container's env, then restart the container.");
    await new Promise<void>((resolve) =>
      setTimeout(resolve, WAIT_MODE_LOG_INTERVAL_MS),
    );
  }
}

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
    try {
      state = await runEnrollment({ config, api });
    } catch (err) {
      if (err instanceof AuthorityHttpError && await enrollmentRequiresOperatorIntervention(err)) {
        // Switch to wait-mode forever (until container restart). Never
        // returns. Designed for remote-deployment operators who can't
        // SSH in to interpret a crashloop.
        await enterWaitMode(
          `Edge Node enrollment refused by Authority: ${err.errorCode ?? "unknown"} (${err.message}).`,
        );
      }
      throw err;
    }
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
  // let the process exit. The metrics and federation-scan loops run as
  // fire-and-forget peers — neither causes the process to exit on failure.
  await Promise.race([
    runHeartbeatLoop({ config, api, state }),
    runSweepLoop({ config, api, state }),
    runMetricsLoop({ config, api, state }).catch((err) => {
      log("warn", `metrics-loop exited unexpectedly: ${(err as Error).message}`);
      // Don't propagate — heartbeat/sweep are the authoritative loops.
    }),
    runFederationScanLoop({ config, api, state }).catch((err) => {
      log("warn", `federation-scan loop exited unexpectedly: ${(err as Error).message}`);
      // Don't propagate — discovery of nearby peers is optional and
      // eventually consistent; heartbeat/sweep stay authoritative.
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

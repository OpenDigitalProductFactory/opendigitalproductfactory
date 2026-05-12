// DPF Edge Node — entry point.
//
// Phase 0 lifecycle:
//   1. Load config from env (refuses to start if invalid).
//   2. Try to load existing state from disk.
//   3a. If state exists: skip enrollment, run heartbeat loop.
//   3b. If state missing: require DPF_BOOTSTRAP_TOKEN env, run enrollment,
//       persist state, then run heartbeat loop.
//
// Sweep + submission loop ships in A5.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// Roadmap: docs/superpowers/plans/2026-05-12-edge-node-phase0-roadmap.md A3

import { AuthorityApiClient } from "./api-client";
import { loadConfig } from "./config";
import { runEnrollment } from "./enroll";
import { runHeartbeatLoop } from "./heartbeat";
import { loadState } from "./state";

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

  await runHeartbeatLoop({ config, api, state });
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

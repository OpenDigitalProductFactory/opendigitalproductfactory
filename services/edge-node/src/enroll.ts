// First-run enrollment flow.
//
// Called by index.ts when no state file exists. Uses the bootstrap
// token from env to call POST /api/v1/edge/enroll, persists the
// returned node token + intervals to the state file, then yields
// control back to the heartbeat loop.

import type { AuthorityApiClient } from "./api-client";
import { collectHostNetworkSummary } from "./collectors/host-network";
import type { EdgeNodeConfig } from "./config";
import { saveState, type EdgeNodeState } from "./state";

const PHASE_0_CAPABILITIES = ["discovery.network"] as const;

export type EnrollRunnerOptions = {
  config: EdgeNodeConfig;
  api: AuthorityApiClient;
  /** stdout-style logger; defaults to console.log/error. */
  log?: (level: "info" | "warn" | "error", msg: string) => void;
};

export async function runEnrollment(
  opts: EnrollRunnerOptions,
): Promise<EdgeNodeState> {
  const log = opts.log ?? defaultLog;
  const { config, api } = opts;

  if (!config.bootstrapToken) {
    throw new Error(
      "DPF_BOOTSTRAP_TOKEN is required for first-run enrollment. " +
        "Issue one via the Authority's Admin > Platform Development > Edge Nodes page.",
    );
  }

  log(
    "info",
    `Enrolling Edge Node "${config.edgeNodeName}" against ${config.authorityUrl}`,
  );

  // Standardized host fingerprint per T2.4 — admin UI reads
  // metadata.host.{hostname,ipAddresses}. Operators identify the node
  // by its LAN address without SQL'ing the metadata blob.
  const host = collectHostNetworkSummary();

  const result = await api.enroll(config.bootstrapToken, {
    displayName: config.edgeNodeName,
    platform: config.platform,
    installMode: config.installMode,
    version: config.version,
    advertisedCapabilities: [...PHASE_0_CAPABILITIES],
    metadata: {
      // hostname kept at top-level for backward compat with anything
      // reading EdgeNode.metadata.hostname today; the canonical T2.4
      // shape is the `host` sub-object below.
      hostname: config.edgeNodeName,
      host: {
        hostname: host.hostname,
        ipAddresses: host.ipAddresses,
      },
    },
  });

  log(
    "info",
    `Enrolled as nodeId=${result.nodeId} (trustState=${result.trustState}). ` +
      `Heartbeat every ${result.heartbeatIntervalSec}s; sweep every ${result.sweepIntervalSec}s.`,
  );

  const state: EdgeNodeState = {
    nodeId: result.nodeId,
    nodeToken: result.nodeToken,
    enrolledAt: new Date().toISOString(),
    heartbeatIntervalSec: result.heartbeatIntervalSec,
    sweepIntervalSec: result.sweepIntervalSec,
    acceptedCapabilities: result.acceptedCapabilities,
    trustState: result.trustState,
  };

  await saveState(config.stateDir, state);
  log("info", `State persisted to ${config.stateDir}/state.json`);

  return state;
}

function defaultLog(level: "info" | "warn" | "error", msg: string): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level}] ${msg}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

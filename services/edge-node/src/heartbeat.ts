// Heartbeat loop. Runs forever; calls /api/v1/edge/heartbeat at the
// Authority-decided interval; updates state with intervals + accepted
// capabilities returned in the response so changes (operator
// approval, capability mode flips) take effect without restart.
//
// Sweep loop is a separate concern and lands in A5.

import { AuthorityHttpError, type AuthorityApiClient } from "./api-client";
import type { EdgeNodeConfig } from "./config";
import { clearState, saveState, type EdgeNodeState } from "./state";

export type HeartbeatRunnerOptions = {
  config: EdgeNodeConfig;
  api: AuthorityApiClient;
  state: EdgeNodeState;
  /** Override for tests. */
  sleep?: (ms: number) => Promise<void>;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
  /** Stop the loop after N successful heartbeats. Defaults to running forever. */
  maxIterations?: number;
};

/**
 * Run the heartbeat loop. Returns when maxIterations is reached or
 * when the Authority signals the node has been revoked. In normal
 * operation, this never returns.
 */
export async function runHeartbeatLoop(
  opts: HeartbeatRunnerOptions,
): Promise<void> {
  const log = opts.log ?? defaultLog;
  const sleep = opts.sleep ?? defaultSleep;
  const { config, api } = opts;
  let state = opts.state;

  let iterations = 0;
  while (true) {
    if (opts.maxIterations !== undefined && iterations >= opts.maxIterations) {
      return;
    }
    iterations += 1;

    try {
      const result = await api.heartbeat(state.nodeToken);
      const updated: EdgeNodeState = {
        ...state,
        heartbeatIntervalSec: result.heartbeatIntervalSec,
        sweepIntervalSec: result.sweepIntervalSec,
        // Propagate Authority-tuned metrics interval if provided; keep
        // existing value (or undefined → 10 s default) if absent.
        ...(result.metricsIntervalSec !== undefined
          ? { metricsIntervalSec: result.metricsIntervalSec }
          : {}),
        acceptedCapabilities: result.acceptedCapabilities,
        trustState: result.trustState,
      };

      // Persist iff something changed; saves write IO when nothing's
      // moved.
      if (
        updated.heartbeatIntervalSec !== state.heartbeatIntervalSec ||
        updated.sweepIntervalSec !== state.sweepIntervalSec ||
        updated.metricsIntervalSec !== state.metricsIntervalSec ||
        updated.trustState !== state.trustState ||
        JSON.stringify(updated.acceptedCapabilities) !==
          JSON.stringify(state.acceptedCapabilities)
      ) {
        await saveState(config.stateDir, updated);
        log("info", `Heartbeat: state changed (trustState=${updated.trustState}).`);
      }
      state = updated;

      // If Authority revoked us mid-loop, clear local state and
      // exit. Operator must re-enroll explicitly.
      if (state.trustState === "revoked") {
        log("error", "Authority revoked this Edge Node. Clearing state and exiting.");
        await clearState(config.stateDir);
        return;
      }
    } catch (err) {
      if (err instanceof AuthorityHttpError) {
        if (err.status === 401 && err.errorCode === "node_revoked") {
          log("error", "Authority returned node_revoked. Clearing state and exiting.");
          await clearState(config.stateDir);
          return;
        }
        log(
          "warn",
          `Heartbeat failed (HTTP ${err.status}, error=${err.errorCode ?? "unknown"}): ${err.message}. Retrying after backoff.`,
        );
      } else {
        log(
          "warn",
          `Heartbeat failed (network or other): ${(err as Error).message}. Retrying after backoff.`,
        );
      }
      // On error, wait one interval before retrying — same cadence as
      // success-path. Real backoff (exponential) is in A5's submission
      // loop where the bound matters more (queued sweeps, not pings).
    }

    await sleep(state.heartbeatIntervalSec * 1000);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultLog(level: "info" | "warn" | "error", msg: string): void {
  const ts = new Date().toISOString();
  const line = `${ts} [${level}] ${msg}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

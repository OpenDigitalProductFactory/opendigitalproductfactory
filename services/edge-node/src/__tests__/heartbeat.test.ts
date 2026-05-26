import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";

import type { AuthorityApiClient } from "../api-client";
import type { EdgeNodeConfig } from "../config";
import { runHeartbeatLoop } from "../heartbeat";
import type { EdgeNodeState } from "../state";

function makeConfig(stateDir: string): EdgeNodeConfig {
  return {
    authorityUrl: "http://test-authority",
    edgeNodeName: "test-edge",
    platform: "linux",
    installMode: "container-host",
    version: "0.1.0-test",
    stateDir,
    bootstrapToken: undefined,
  };
}

function makeState(overrides: Partial<EdgeNodeState> = {}): EdgeNodeState {
  return {
    nodeId: "edge_test",
    nodeToken: "dpfedge_TESTTOKEN",
    enrolledAt: "2026-05-12T00:00:00.000Z",
    heartbeatIntervalSec: 60,
    sweepIntervalSec: 300,
    acceptedCapabilities: ["discovery.network"],
    trustState: "pending",
    ...overrides,
  };
}

function makeApi(heartbeat: AuthorityApiClient["heartbeat"]): AuthorityApiClient {
  return {
    heartbeat,
    enroll: vi.fn(),
    submitDiscoveryRun: vi.fn(),
    fetchAdapters: vi.fn(),
  } as unknown as AuthorityApiClient;
}

describe("runHeartbeatLoop", () => {
  it("mutates the shared state object when Authority approves the node", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "dpf-edge-heartbeat-"));
    const state = makeState({ trustState: "pending" });
    const api = makeApi(
      vi.fn().mockResolvedValue({
        ok: true,
        heartbeatIntervalSec: 30,
        sweepIntervalSec: 45,
        metricsIntervalSec: 10,
        acceptedCapabilities: ["discovery.network", "metrics.network"],
        trustState: "trusted",
      }),
    );

    await runHeartbeatLoop({
      config: makeConfig(stateDir),
      api,
      state,
      sleep: async () => {},
      maxIterations: 1,
    });

    expect(state.trustState).toBe("trusted");
    expect(state.heartbeatIntervalSec).toBe(30);
    expect(state.sweepIntervalSec).toBe(45);
    expect(state.metricsIntervalSec).toBe(10);
    expect(state.acceptedCapabilities).toEqual([
      "discovery.network",
      "metrics.network",
    ]);
  });
});

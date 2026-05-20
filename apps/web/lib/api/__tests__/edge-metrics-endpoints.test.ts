// Tests for /api/v1/edge/metrics endpoint and the MetricsCache.
//
// Uses a real MetricsCache instance (no mocking) and mocks the edge-node
// auth middleware to isolate endpoint logic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock edge-node-token so tests don't need a real DB.
vi.mock("../../auth/edge-node-token.js", () => ({
  resolveEdgeNodeAuth: vi.fn(),
}));

import { resolveEdgeNodeAuth } from "../../auth/edge-node-token.js";
import { metricsCache } from "../../edge/metrics-cache.js";
import {
  POST as metricsPost,
  GET as metricsGet,
} from "../../../app/api/v1/edge/metrics/route.js";

const mockAuth = vi.mocked(resolveEdgeNodeAuth);

const VALID_AUTH = {
  ok: true as const,
  edgeNodeRowId: "row-001",
  nodeId: "edge-node-001",
  trustState: "trusted" as const,
};

function makePostRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/edge/metrics", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer dpfedge_test" },
    body: JSON.stringify(body),
  });
}

function validPayload(nodeId = "edge-node-001") {
  return {
    nodeId,
    timestamp: new Date().toISOString(),
    metrics: {
      network: [
        {
          ifIndex: 1,
          ifDescr: "eth0",
          ifHCInOctets: "123456789",
          ifHCOutOctets: "987654321",
          timestamp: new Date().toISOString(),
        },
      ],
    },
  };
}

describe("POST /api/v1/edge/metrics", () => {
  beforeEach(() => {
    metricsCache.clear();
    mockAuth.mockResolvedValue(VALID_AUTH);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 and stores metrics for a valid payload", async () => {
    const res = await metricsPost(makePostRequest(validPayload()) as never);
    expect(res.status).toBe(200);

    const json = await res.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.metricsCount).toBe(1);
    expect(metricsCache.get("edge-node-001")).toBeDefined();
  });

  it("returns 422 for a missing required field", async () => {
    const res = await metricsPost(
      makePostRequest({ nodeId: "x" /* missing timestamp */ }) as never,
    );
    expect(res.status).toBe(422);
  });

  it("returns 422 for non-decimal-string counter values", async () => {
    const bad = validPayload();
    (bad.metrics.network[0] as Record<string, unknown>)["ifHCInOctets"] = 12345; // number, not string
    const res = await metricsPost(makePostRequest(bad) as never);
    expect(res.status).toBe(422);
  });

  it("returns 401 when auth fails", async () => {
    mockAuth.mockResolvedValue({
      ok: false,
      error: "token_not_found",
      message: "token not found",
    });
    const res = await metricsPost(makePostRequest(validPayload()) as never);
    expect(res.status).toBe(401);
  });

  it("returns 403 when nodeId in payload does not match authenticated node", async () => {
    const res = await metricsPost(
      makePostRequest(validPayload("different-node")) as never,
    );
    expect(res.status).toBe(403);
  });
});

describe("MetricsCache TTL eviction", () => {
  beforeEach(() => metricsCache.clear());

  it("returns undefined for an entry older than 90 seconds", () => {
    const old = new Date(Date.now() - 91_000).toISOString();
    metricsCache.set("stale-node", {
      nodeId: "stale-node",
      timestamp: old,
      receivedAt: old,
    });
    expect(metricsCache.get("stale-node")).toBeUndefined();
  });

  it("returns the entry when it is within TTL", () => {
    const recent = new Date().toISOString();
    metricsCache.set("fresh-node", {
      nodeId: "fresh-node",
      timestamp: recent,
      receivedAt: recent,
    });
    expect(metricsCache.get("fresh-node")).toBeDefined();
  });
});

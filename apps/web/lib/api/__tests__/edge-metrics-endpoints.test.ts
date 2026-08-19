// Tests for /api/v1/edge/metrics endpoint and MetricsCache.
//
// The endpoint validates MetricsEnvelope (spec §6.1) shape, enforces:
//   - Body size cap (tested via content-length header)
//   - observedAt freshness (5-minute window)
//   - Per-node rate limit (5 s minimum)
//   - nodeId resolved from bearer token (not from payload body)
//   - metricsVersion: "1" required

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Mock edge-node-token so tests don't need a real DB.
vi.mock("../../auth/edge-node-token.js", () => ({
  resolveEdgeNodeAuth: vi.fn(),
}));

import { resolveEdgeNodeAuth } from "../../auth/edge-node-token.js";
import { metricsCache } from "../../edge-node/metrics-cache.js";
import { resetEdgeMetricsRateLimitForTesting } from "../../edge-node/metrics-rate-limit.js";
import { POST as metricsPost } from "../../../app/api/v1/edge/metrics/route.js";

const mockAuth = vi.mocked(resolveEdgeNodeAuth);

const VALID_AUTH = {
  ok: true as const,
  edgeNodeRowId: "row-001",
  nodeId: "edge-node-001",
  trustState: "trusted" as const,
  customerAccountId: null,
  customerSiteId: null,
  scopePolicy: null,
};

function validEnvelope(overrides?: Partial<{ observedAt: string; runKey: string }>) {
  return {
    runKey: overrides?.runKey ?? randomUUID(),
    observedAt: overrides?.observedAt ?? new Date().toISOString(),
    metricsVersion: "1" as const,
    interfaces: [
      {
        deviceKey: "snmp:192.168.1.1",
        ifIndex: 1,
        ifName: "GigabitEthernet0/1",
        rxBps: 1_000_000,
        txBps: 500_000,
        operStatus: "up" as const,
      },
    ],
  };
}

function makePostRequest(body: unknown, extraHeaders?: Record<string, string>): Request {
  const bodyStr = JSON.stringify(body);
  return new Request("http://localhost/api/v1/edge/metrics", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(bodyStr).length),
      authorization: "Bearer dpfedge_test",
      ...extraHeaders,
    },
    body: bodyStr,
  });
}

describe("POST /api/v1/edge/metrics", () => {
  beforeEach(() => {
    metricsCache.clear();
    resetEdgeMetricsRateLimitForTesting();
    mockAuth.mockResolvedValue(VALID_AUTH);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("returns 200 and stores envelope for a valid payload", async () => {
    const res = await metricsPost(makePostRequest(validEnvelope()) as never);
    expect(res.status).toBe(200);

    const json = await res.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.interfaceCount).toBe(1);
    expect(metricsCache.get("edge-node-001")).toBeDefined();
  });

  it("returns 422 when metricsVersion is absent or wrong", async () => {
    const bad = { ...validEnvelope(), metricsVersion: "2" };
    const res = await metricsPost(makePostRequest(bad) as never);
    expect(res.status).toBe(422);
  });

  it("returns 422 when runKey is not a UUID", async () => {
    const bad = { ...validEnvelope(), runKey: "not-a-uuid" };
    const res = await metricsPost(makePostRequest(bad) as never);
    expect(res.status).toBe(422);
  });

  it("returns 422 when observedAt is older than 5 minutes", async () => {
    const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const res = await metricsPost(
      makePostRequest(validEnvelope({ observedAt: stale })) as never,
    );
    expect(res.status).toBe(422);
  });

  it("returns 413 when content-length exceeds 64 KB", async () => {
    const res = await metricsPost(
      makePostRequest(validEnvelope(), {
        "content-length": String(65 * 1024),
      }) as never,
    );
    expect(res.status).toBe(413);
  });

  it("returns 401 when auth fails", async () => {
    mockAuth.mockResolvedValue({
      ok: false,
      error: "token_not_found",
      message: "token not found",
    });
    const res = await metricsPost(makePostRequest(validEnvelope()) as never);
    expect(res.status).toBe(401);
  });

  it("returns 429 on second request within 5 s", async () => {
    // First request: accepted.
    await metricsPost(makePostRequest(validEnvelope()) as never);
    // Second request within the rate-limit window: denied.
    vi.advanceTimersByTime(1_000); // only 1 s later
    const res = await metricsPost(makePostRequest(validEnvelope()) as never);
    expect(res.status).toBe(429);
  });

  it("allows a second request after the rate-limit window expires", async () => {
    await metricsPost(makePostRequest(validEnvelope()) as never);
    vi.advanceTimersByTime(6_000); // 6 s — past the 5 s window
    const res = await metricsPost(makePostRequest(validEnvelope()) as never);
    expect(res.status).toBe(200);
  });
});

describe("MetricsCache TTL eviction", () => {
  beforeEach(() => metricsCache.clear());

  it("returns undefined for an entry older than 90 seconds", () => {
    const old = new Date(Date.now() - 91_000).toISOString();
    // Bypass the public set() to inject a stale receivedAt
    (metricsCache as unknown as { cache: Map<string, unknown> })["cache"].set("stale-node", {
      runKey: randomUUID(),
      observedAt: old,
      metricsVersion: "1",
      interfaces: [],
      receivedAt: old,
      resolvedNodeId: "stale-node",
    });
    expect(metricsCache.get("stale-node")).toBeUndefined();
  });

  it("returns the entry when it is within TTL", () => {
    const recent = new Date().toISOString();
    metricsCache.set("fresh-node", {
      runKey: randomUUID(),
      observedAt: recent,
      metricsVersion: "1",
      interfaces: [],
    });
    expect(metricsCache.get("fresh-node")).toBeDefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockResolveAuth, mockRecordHeartbeat } = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
  mockRecordHeartbeat: vi.fn(),
}));

vi.mock("@/lib/auth/edge-node-token", () => ({
  resolveEdgeNodeAuth: mockResolveAuth,
}));
vi.mock("@/lib/edge-node/enrollment", () => ({
  recordHeartbeat: mockRecordHeartbeat,
}));

import { POST } from "./route";
import { setToolExecutionCreateOverride } from "@/lib/edge-node/audit";
import { _resetEdgeRateLimits, checkEdgeRateLimit } from "@/lib/edge-node/rate-limit";

const AUTHED = {
  ok: true as const,
  edgeNodeRowId: "edgenode_cuid_1",
  nodeId: "edge_abc",
  trustState: "trusted" as const,
};

const HEARTBEAT_OK = {
  heartbeatIntervalSec: 60,
  sweepIntervalSec: 300,
  acceptedCapabilities: ["discovery.network"] as const,
};

function makeReq(
  body: unknown = {},
  headers: Record<string, string> = {},
  raw = false,
): NextRequest {
  return new Request("http://test/api/v1/edge/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  }) as unknown as NextRequest;
}

const auditCalls: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.resetAllMocks();
  mockRecordHeartbeat.mockResolvedValue(HEARTBEAT_OK);
  auditCalls.length = 0;
  setToolExecutionCreateOverride(async (data) => {
    auditCalls.push(data);
    return { id: "audit_heartbeat_test" };
  });
  // Rate-limit state is process-global; reset between tests so a
  // burst from one test doesn't leak into the next.
  _resetEdgeRateLimits();
});

afterEach(() => {
  setToolExecutionCreateOverride(null);
  _resetEdgeRateLimits();
});

describe("POST /api/v1/edge/heartbeat — auth gate", () => {
  const cases = [
    { error: "missing_authorization" as const, expected: 401 },
    { error: "invalid_scheme" as const, expected: 401 },
    { error: "invalid_token_format" as const, expected: 401 },
    { error: "token_not_found" as const, expected: 401 },
    { error: "node_revoked" as const, expected: 401 },
    { error: "scope_disallowed" as const, expected: 403 },
  ];

  for (const { error, expected } of cases) {
    it(`maps auth error "${error}" to ${expected}`, async () => {
      mockResolveAuth.mockResolvedValue({
        ok: false,
        error,
        message: `mock: ${error}`,
      });
      const res = await POST(makeReq({}, { Authorization: "Bearer x" }));
      expect(res.status).toBe(expected);
      const body = await res.json();
      expect(body.error).toBe(error);
      expect(mockRecordHeartbeat).not.toHaveBeenCalled();
    });
  }

  it("passes the bearer header through to resolveEdgeNodeAuth with edge:heartbeat scope", async () => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    await POST(makeReq({}, { Authorization: "Bearer dpfedge_TOKEN" }));
    expect(mockResolveAuth).toHaveBeenCalledOnce();
    expect(mockResolveAuth.mock.calls[0]![0]).toBe("Bearer dpfedge_TOKEN");
    expect(mockResolveAuth.mock.calls[0]![1]).toBe("edge:heartbeat");
  });
});

describe("POST /api/v1/edge/heartbeat — body parsing", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("accepts an empty body (just a still-alive ping)", async () => {
    const res = await POST(makeReq("", { Authorization: "Bearer x" }, true));
    expect(res.status).toBe(200);
    expect(mockRecordHeartbeat).toHaveBeenCalledOnce();
  });

  it("accepts an empty JSON object body", async () => {
    const res = await POST(makeReq({}, { Authorization: "Bearer x" }));
    expect(res.status).toBe(200);
  });

  it("returns 400 invalid_json on malformed JSON", async () => {
    const res = await POST(
      makeReq("not json", { Authorization: "Bearer x" }, true),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_json");
  });

  it("returns 400 invalid_body on capabilityReports with bad enum values", async () => {
    const res = await POST(
      makeReq(
        { capabilityReports: [{ capability: "unknown.cap", status: "healthy" }] },
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
  });

  it("forwards valid capabilityReports to recordHeartbeat", async () => {
    await POST(
      makeReq(
        {
          capabilityReports: [
            { capability: "discovery.network", status: "healthy" },
          ],
        },
        { Authorization: "Bearer x" },
      ),
    );
    const call = mockRecordHeartbeat.mock.calls[0]![0];
    expect(call.edgeNodeId).toBe("edgenode_cuid_1");
    expect(call.capabilityReports).toEqual([
      { capability: "discovery.network", status: "healthy" },
    ]);
  });
});

describe("POST /api/v1/edge/heartbeat — happy path", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("returns 200 with intervals + capabilities + trustState", async () => {
    const res = await POST(makeReq({}, { Authorization: "Bearer x" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      heartbeatIntervalSec: 60,
      sweepIntervalSec: 300,
      acceptedCapabilities: ["discovery.network"],
      trustState: "trusted",
    });
  });

  it("preserves trustState=pending from the auth resolver", async () => {
    mockResolveAuth.mockResolvedValue({ ...AUTHED, trustState: "pending" });
    const res = await POST(makeReq({}, { Authorization: "Bearer x" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trustState).toBe("pending");
  });

  it("preserves trustState=quarantined (quarantined nodes still heartbeat)", async () => {
    mockResolveAuth.mockResolvedValue({ ...AUTHED, trustState: "quarantined" });
    const res = await POST(makeReq({}, { Authorization: "Bearer x" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trustState).toBe("quarantined");
  });
});

describe("POST /api/v1/edge/heartbeat — audit", () => {
  it("writes a failure audit row on auth failure with null edgeNodeId", async () => {
    mockResolveAuth.mockResolvedValue({
      ok: false,
      error: "token_not_found",
      message: "no such token",
    });
    await POST(makeReq({}, { Authorization: "Bearer x" }));
    expect(auditCalls).toHaveLength(1);
    const row = auditCalls[0]!;
    expect(row.toolName).toBe("edge.heartbeat");
    expect(row.success).toBe(false);
    const result = row.result as { error: string; status: number };
    expect(result.error).toBe("token_not_found");
    expect(result.status).toBe(401);
    const params = row.parameters as { edgeNodeId: string | null; summary: { scope: string } };
    expect(params.edgeNodeId).toBeNull();
    expect(params.summary.scope).toBe("edge:heartbeat");
  });

  it("writes a scope_disallowed audit at 403", async () => {
    mockResolveAuth.mockResolvedValue({
      ok: false,
      error: "scope_disallowed",
      message: "no scope",
    });
    await POST(makeReq({}, { Authorization: "Bearer x" }));
    const result = auditCalls[0]!.result as { error: string; status: number };
    expect(result.error).toBe("scope_disallowed");
    expect(result.status).toBe(403);
  });

  it("writes audit with resolved edgeNodeId on invalid_body", async () => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    await POST(
      makeReq(
        { capabilityReports: [{ capability: "unknown.cap", status: "healthy" }] },
        { Authorization: "Bearer x" },
      ),
    );
    const row = auditCalls[0]!;
    expect((row.result as { error: string }).error).toBe("invalid_body");
    const params = row.parameters as { edgeNodeId: string; nodeId: string };
    expect(params.edgeNodeId).toBe("edgenode_cuid_1");
    expect(params.nodeId).toBe("edge_abc");
  });

  it("writes a success audit row on 200 heartbeat with capabilityReportCount", async () => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    await POST(
      makeReq(
        {
          capabilityReports: [
            { capability: "discovery.network", status: "healthy" },
          ],
        },
        { Authorization: "Bearer x" },
      ),
    );
    const row = auditCalls[0]!;
    expect(row.success).toBe(true);
    expect((row.result as { status: number }).status).toBe(200);
    const summary = (row.parameters as { summary: { capabilityReportCount: number; trustState: string } }).summary;
    expect(summary.capabilityReportCount).toBe(1);
    expect(summary.trustState).toBe("trusted");
  });

  it("audits empty-body heartbeats with capabilityReportCount=0", async () => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    await POST(makeReq("", { Authorization: "Bearer x" }, true));
    const summary = (auditCalls[0]!.parameters as { summary: { capabilityReportCount: number } }).summary;
    expect(summary.capabilityReportCount).toBe(0);
  });

  it("never includes the bearer token plaintext in the audit row", async () => {
    const SECRET = "dpfedge_SUPERSECRETNODETOKEN67890";
    mockResolveAuth.mockResolvedValue(AUTHED);
    await POST(makeReq({}, { Authorization: `Bearer ${SECRET}` }));
    const serialized = JSON.stringify(auditCalls[0]);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("SUPERSECRETNODETOKEN");
  });
});

describe("POST /api/v1/edge/heartbeat — rate limit (12/min)", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("allows up to 12 heartbeats within a minute", async () => {
    for (let i = 0; i < 12; i++) {
      const res = await POST(makeReq({}, { Authorization: "Bearer x" }));
      expect(res.status).toBe(200);
    }
  });

  it("rejects the 13th heartbeat with 429 + Retry-After header", async () => {
    for (let i = 0; i < 12; i++) {
      await POST(makeReq({}, { Authorization: "Bearer x" }));
    }
    const res = await POST(makeReq({}, { Authorization: "Bearer x" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it("writes a rate_limited audit row at 429 with retryAfter + ceiling in the summary", async () => {
    for (let i = 0; i < 12; i++) {
      await POST(makeReq({}, { Authorization: "Bearer x" }));
    }
    auditCalls.length = 0; // discard the 12 success audits
    await POST(makeReq({}, { Authorization: "Bearer x" }));
    expect(auditCalls).toHaveLength(1);
    const row = auditCalls[0]!;
    expect((row.result as { status: number }).status).toBe(429);
    expect((row.result as { error: string }).error).toBe("rate_limited");
    const summary = (row.parameters as {
      summary: { retryAfter: number; ceiling: string };
    }).summary;
    expect(summary.retryAfter).toBeGreaterThan(0);
    expect(summary.ceiling).toBe("12/min");
  });

  it("rate limit fires AFTER auth — failed-auth requests don't consume slots", async () => {
    mockResolveAuth.mockResolvedValue({
      ok: false,
      error: "token_not_found",
      message: "no",
    });
    // 100 failed-auth requests — none should affect the rate-limit bucket.
    for (let i = 0; i < 100; i++) {
      await POST(makeReq({}, { Authorization: "Bearer x" }));
    }
    // Now flip auth back on; the node still has its full 12/min quota.
    mockResolveAuth.mockResolvedValue(AUTHED);
    for (let i = 0; i < 12; i++) {
      const res = await POST(makeReq({}, { Authorization: "Bearer x" }));
      expect(res.status).toBe(200);
    }
  });

  it("buckets are per-node — node A burning its quota doesn't block node B", async () => {
    for (let i = 0; i < 12; i++) {
      await POST(makeReq({}, { Authorization: "Bearer x" }));
    }
    expect((await POST(makeReq({}, { Authorization: "Bearer x" }))).status).toBe(429);
    // Different node from the auth resolver.
    mockResolveAuth.mockResolvedValue({
      ...AUTHED,
      edgeNodeRowId: "edgenode_cuid_2",
      nodeId: "edge_xyz",
    });
    const res = await POST(makeReq({}, { Authorization: "Bearer x" }));
    expect(res.status).toBe(200);
  });

  it("a passed bucket-check is observable via checkEdgeRateLimit in isolation", async () => {
    // Sanity: the route consumes from the same bucket the limiter
    // module exposes. Make 5 requests, then peek at the limiter:
    // remaining should be 7 (12 - 5).
    for (let i = 0; i < 5; i++) {
      await POST(makeReq({}, { Authorization: "Bearer x" }));
    }
    const peek = checkEdgeRateLimit("edge.heartbeat", AUTHED.edgeNodeRowId);
    // The peek itself consumes a slot, so the remaining is 12 - 5 - 1 = 6.
    expect(peek.allowed).toBe(true);
    expect(peek.remaining).toBe(6);
  });
});

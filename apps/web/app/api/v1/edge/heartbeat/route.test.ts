import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  vi.resetAllMocks();
  mockRecordHeartbeat.mockResolvedValue(HEARTBEAT_OK);
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

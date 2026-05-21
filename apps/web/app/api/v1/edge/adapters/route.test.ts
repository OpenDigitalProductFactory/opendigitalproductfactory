// Tests for GET /api/v1/edge/adapters.
//
// Covers: auth gate (401/403), rate-limit, decryption skip cases,
// and the happy path returning unifi adapters with apiKey decrypted.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockResolveAuth, mockFindMany } = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("@/lib/auth/edge-node-token", () => ({
  resolveEdgeNodeAuth: mockResolveAuth,
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    discoveryConnection: { findMany: mockFindMany },
  },
}));
vi.mock("@/lib/govern/credential-crypto", () => ({
  decryptSecret: (stored: string) => {
    if (stored === "enc:UNDECRYPTABLE") return null;
    return stored.replace(/^enc:/, "");
  },
}));

import { GET } from "./route";
import { setToolExecutionCreateOverride } from "@/lib/edge-node/audit";
import { _resetEdgeRateLimits } from "@/lib/edge-node/rate-limit";

const AUTHED = {
  ok: true as const,
  edgeNodeRowId: "edgenode_cuid_1",
  nodeId: "edge_abc",
  trustState: "trusted" as const,
};

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new Request("http://test/api/v1/edge/adapters", {
    method: "GET",
    headers,
  }) as unknown as NextRequest;
}

const auditCalls: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.resetAllMocks();
  auditCalls.length = 0;
  setToolExecutionCreateOverride(async (data) => {
    auditCalls.push(data);
    return { id: "audit_adapters_test" };
  });
  _resetEdgeRateLimits();
});

afterEach(() => {
  setToolExecutionCreateOverride(null);
  _resetEdgeRateLimits();
});

describe("GET /api/v1/edge/adapters — auth gate", () => {
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
      const res = await GET(makeReq({ Authorization: "Bearer x" }));
      expect(res.status).toBe(expected);
      const body = await res.json();
      expect(body.error).toBe(error);
      expect(mockFindMany).not.toHaveBeenCalled();
    });
  }

  it("passes the bearer header through with edge:adapters scope", async () => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    mockFindMany.mockResolvedValue([]);
    await GET(makeReq({ Authorization: "Bearer dpfedge_xyz" }));
    expect(mockResolveAuth).toHaveBeenCalledWith("Bearer dpfedge_xyz", "edge:adapters");
  });
});

describe("GET /api/v1/edge/adapters — happy path", () => {
  beforeEach(() => {
    mockResolveAuth.mockResolvedValue(AUTHED);
  });

  it("decrypts apiKey and shapes the response per the wire contract", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "c1",
        connectionKey: "unifi:192.168.0.1",
        name: "Cloud Gateway",
        collectorType: "unifi",
        endpointUrl: "https://192.168.0.1",
        encryptedApiKey: "enc:THE-SECRET-KEY",
        configuration: { site: "default", discoverClients: true, tlsInsecure: true },
      },
    ]);
    const res = await GET(makeReq({ Authorization: "Bearer dpfedge_xyz" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.adapters).toHaveLength(1);
    expect(body.adapters[0]).toEqual({
      id: "c1",
      connectionKey: "unifi:192.168.0.1",
      name: "Cloud Gateway",
      collectorType: "unifi",
      endpointUrl: "https://192.168.0.1",
      apiKey: "THE-SECRET-KEY",
      configuration: { site: "default", discoverClients: true, tlsInsecure: true },
    });
  });

  it("only returns unifi+active rows (query filter)", async () => {
    mockFindMany.mockResolvedValue([]);
    await GET(makeReq({ Authorization: "Bearer dpfedge_xyz" }));
    const call = mockFindMany.mock.calls[0][0];
    expect(call.where).toEqual({ collectorType: "unifi", status: "active" });
  });

  it("skips rows with missing or undecryptable keys (doesn't fail the whole request)", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "good", connectionKey: "unifi:1.1.1.1", name: "Good",
        collectorType: "unifi", endpointUrl: "https://1.1.1.1",
        encryptedApiKey: "enc:GOOD-KEY",
        configuration: {},
      },
      {
        id: "no-key", connectionKey: "unifi:2.2.2.2", name: "NoKey",
        collectorType: "unifi", endpointUrl: "https://2.2.2.2",
        encryptedApiKey: null,
        configuration: {},
      },
      {
        id: "broken", connectionKey: "unifi:3.3.3.3", name: "Broken",
        collectorType: "unifi", endpointUrl: "https://3.3.3.3",
        encryptedApiKey: "enc:UNDECRYPTABLE",
        configuration: {},
      },
    ]);
    const res = await GET(makeReq({ Authorization: "Bearer dpfedge_xyz" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.adapters.map((a: { id: string }) => a.id)).toEqual(["good"]);
    // Audit summary captures skip counts so operators can see why rows
    // were silently filtered. writeEdgeNodeAudit stashes the structured
    // summary inside `parameters.summary` (the row-level `summary` field
    // is the one-line short form).
    const params = auditCalls.at(-1)!.parameters as { summary: Record<string, number> };
    expect(params.summary).toMatchObject({
      adapterCount: 1,
      skippedNoKey: 1,
      skippedUndecryptable: 1,
    });
  });

  it("defaults configuration fields when columns are empty", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "minimal", connectionKey: "unifi:4.4.4.4", name: "Minimal",
        collectorType: "unifi", endpointUrl: "https://4.4.4.4",
        encryptedApiKey: "enc:K",
        configuration: null,
      },
    ]);
    const res = await GET(makeReq({ Authorization: "Bearer dpfedge_xyz" }));
    const body = await res.json();
    expect(body.adapters[0].configuration).toEqual({
      site: "default",
      discoverClients: true,
      tlsInsecure: false,
    });
  });
});

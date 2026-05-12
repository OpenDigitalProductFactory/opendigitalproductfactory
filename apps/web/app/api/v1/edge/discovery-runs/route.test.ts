import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockResolveAuth } = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
}));

vi.mock("@/lib/auth/edge-node-token", () => ({
  resolveEdgeNodeAuth: mockResolveAuth,
}));

import { POST } from "./route";

const AUTHED = {
  ok: true as const,
  edgeNodeRowId: "edgenode_cuid_1",
  nodeId: "edge_abc",
  trustState: "trusted" as const,
};

const VALID_BODY = {
  runKey: "run_a1b2c3",
  agentMode: "container-host",
  agentVersion: "0.1.0",
  observedAt: "2026-05-12T12:00:00Z",
  capabilities: ["discovery.network"],
  items: [
    {
      observedKey: "host:linux:abcdef",
      itemType: "host",
      name: "edge-test",
      rawData: { kernel: "6.5.0" },
    },
  ],
  relationships: [],
};

function makeReq(
  body: unknown,
  headers: Record<string, string> = {},
  raw = false,
): NextRequest {
  return new Request("http://test/api/v1/edge/discovery-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/v1/edge/discovery-runs — auth gate", () => {
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
      const res = await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
      expect(res.status).toBe(expected);
      const body = await res.json();
      expect(body.error).toBe(error);
    });
  }

  it("requires the discovery:submit scope (not edge:heartbeat)", async () => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(mockResolveAuth.mock.calls[0]![1]).toBe("discovery:submit");
  });
});

describe("POST /api/v1/edge/discovery-runs — body validation", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("returns 400 invalid_json for malformed JSON", async () => {
    const res = await POST(
      makeReq("not json", { Authorization: "Bearer x" }, true),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_json");
  });

  it("returns 400 invalid_body when runKey is missing", async () => {
    const { runKey: _, ...partial } = VALID_BODY;
    void _;
    const res = await POST(makeReq(partial, { Authorization: "Bearer x" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
  });

  it("returns 400 invalid_body when observedAt is not ISO-8601", async () => {
    const res = await POST(
      makeReq(
        { ...VALID_BODY, observedAt: "not a date" },
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 invalid_body when items array is missing", async () => {
    const { items: _, ...partial } = VALID_BODY;
    void _;
    const res = await POST(makeReq(partial, { Authorization: "Bearer x" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 invalid_body when capabilities array is empty", async () => {
    const res = await POST(
      makeReq(
        { ...VALID_BODY, capabilities: [] },
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 invalid_body when an item is missing required fields", async () => {
    const res = await POST(
      makeReq(
        {
          ...VALID_BODY,
          items: [{ observedKey: "x" }], // missing itemType, name, rawData
        },
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/edge/discovery-runs — happy path (A4 not yet wired)", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("returns 202 with persistencePending:true (stub state)", async () => {
    const res = await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(true);
    expect(body.persistencePending).toBe(true);
    expect(body.runKey).toBe("run_a1b2c3");
    expect(body.itemCount).toBe(1);
    expect(body.relationshipCount).toBe(0);
  });

  it("counts items + relationships from the parsed envelope", async () => {
    const res = await POST(
      makeReq(
        {
          ...VALID_BODY,
          items: [
            ...VALID_BODY.items,
            {
              observedKey: "host:linux:xyz",
              itemType: "host",
              name: "another",
              rawData: {},
            },
          ],
          relationships: [
            {
              fromObservedKey: "host:linux:abcdef",
              toObservedKey: "host:linux:xyz",
              relationshipType: "peers_with",
            },
          ],
        },
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.itemCount).toBe(2);
    expect(body.relationshipCount).toBe(1);
  });
});

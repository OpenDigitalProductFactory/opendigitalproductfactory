import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockResolveAuth, mockDiscoveryRunFindUnique } = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
  mockDiscoveryRunFindUnique: vi.fn(),
}));

vi.mock("@/lib/auth/edge-node-token", () => ({
  resolveEdgeNodeAuth: mockResolveAuth,
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    discoveryRun: {
      findUnique: mockDiscoveryRunFindUnique,
    },
  },
}));

import { POST } from "./route";
import { setToolExecutionCreateOverride } from "@/lib/edge-node/audit";
import { _resetEdgeRateLimits } from "@/lib/edge-node/rate-limit";

const AUTHED = {
  ok: true as const,
  edgeNodeRowId: "edgenode_cuid_1",
  nodeId: "edge_abc",
  trustState: "trusted" as const,
};

// observedAt must be within the route's freshness window (+/- 24h
// from server time). Compute relative to test-run wall time so the
// fixture doesn't go stale six months from now.
function freshObservedAt(): string {
  return new Date().toISOString();
}

function makeValidBody(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    runKey: "run_a1b2c3",
    agentMode: "container-host",
    agentVersion: "0.1.0",
    observedAt: freshObservedAt(),
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
    ...overrides,
  };
}

const VALID_BODY = makeValidBody();

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

const auditCalls: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.resetAllMocks();
  // Default: no prior run exists, so the idempotency lookup returns null
  // and the route falls through to the 202 stub branch. Tests that need
  // the idempotent-replay path override this per-test.
  mockDiscoveryRunFindUnique.mockResolvedValue(null);
  auditCalls.length = 0;
  setToolExecutionCreateOverride(async (data) => {
    auditCalls.push(data);
    return { id: "audit_discovery_test" };
  });
  // Rate-limit state is process-global; reset between tests so a burst
  // from one test doesn't leak into the next.
  _resetEdgeRateLimits();
});

afterEach(() => {
  setToolExecutionCreateOverride(null);
  _resetEdgeRateLimits();
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
    const existingItems = VALID_BODY.items as Array<Record<string, unknown>>;
    const res = await POST(
      makeReq(
        {
          ...VALID_BODY,
          items: [
            ...existingItems,
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

describe("POST /api/v1/edge/discovery-runs — freshness window", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("returns 400 stale_observation when observedAt is > 24h in the past", async () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const res = await POST(
      makeReq(
        makeValidBody({ observedAt: stale }),
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("stale_observation");
    // Freshness gate must fire BEFORE the idempotency lookup so stale
    // submissions never hit the DB.
    expect(mockDiscoveryRunFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 stale_observation when observedAt is > 24h in the future (clock skew)", async () => {
    const future = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
    const res = await POST(
      makeReq(
        makeValidBody({ observedAt: future }),
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("stale_observation");
  });

  it("accepts observedAt at the recent edge of the window", async () => {
    // 23h ago — comfortably inside the 24h window.
    const recent = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    const res = await POST(
      makeReq(
        makeValidBody({ observedAt: recent }),
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(202);
  });

  it("writes a stale_observation audit row at 400 (with skew + observedAt in summary)", async () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await POST(
      makeReq(
        makeValidBody({ observedAt: stale }),
        { Authorization: "Bearer x" },
      ),
    );
    const row = auditCalls[0]!;
    expect((row.result as { error: string }).error).toBe("stale_observation");
    expect((row.result as { status: number }).status).toBe(400);
    const summary = (row.parameters as {
      summary: { skewMs: number; observedAt: string };
    }).summary;
    expect(summary.skewMs).toBeGreaterThan(24 * 60 * 60 * 1000);
    expect(summary.observedAt).toBe(stale);
  });
});

describe("POST /api/v1/edge/discovery-runs — (edgeNodeId, runKey) idempotency", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("returns 200 idempotentReplay when the same (edgeNodeId, runKey) was already persisted", async () => {
    const priorStartedAt = new Date(Date.now() - 60_000);
    const priorCompletedAt = new Date(Date.now() - 30_000);
    mockDiscoveryRunFindUnique.mockResolvedValue({
      id: "run_db_1",
      status: "completed",
      itemCount: 5,
      relationshipCount: 2,
      startedAt: priorStartedAt,
      completedAt: priorCompletedAt,
    });

    const res = await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(true);
    expect(body.idempotentReplay).toBe(true);
    expect(body.runId).toBe("run_db_1");
    expect(body.runKey).toBe("run_a1b2c3");
    expect(body.status).toBe("completed");
    expect(body.itemCount).toBe(5);
    expect(body.relationshipCount).toBe(2);
    expect(body.startedAt).toBe(priorStartedAt.toISOString());
    expect(body.completedAt).toBe(priorCompletedAt.toISOString());
  });

  it("looks up by the composite (edgeNodeId, runKey) key — each node owns its runKey namespace", async () => {
    mockDiscoveryRunFindUnique.mockResolvedValue(null);
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(mockDiscoveryRunFindUnique).toHaveBeenCalledOnce();
    const args = mockDiscoveryRunFindUnique.mock.calls[0]![0];
    expect(args.where).toEqual({
      edgeNodeId_runKey: {
        edgeNodeId: "edgenode_cuid_1",
        runKey: "run_a1b2c3",
      },
    });
  });

  it("falls through to 202 stub when no prior run exists for (edgeNodeId, runKey)", async () => {
    mockDiscoveryRunFindUnique.mockResolvedValue(null);
    const res = await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.idempotentReplay).toBeUndefined();
    expect(body.persistencePending).toBe(true);
  });

  it("preserves null completedAt for an in-flight prior run", async () => {
    mockDiscoveryRunFindUnique.mockResolvedValue({
      id: "run_db_2",
      status: "running",
      itemCount: 0,
      relationshipCount: 0,
      startedAt: new Date(),
      completedAt: null,
    });
    const res = await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotentReplay).toBe(true);
    expect(body.completedAt).toBeNull();
    expect(body.status).toBe("running");
  });

  it("writes a success audit row on idempotency replay at 200 with idempotentReplay summary marker", async () => {
    mockDiscoveryRunFindUnique.mockResolvedValue({
      id: "run_db_1",
      status: "completed",
      itemCount: 5,
      relationshipCount: 2,
      startedAt: new Date(Date.now() - 60_000),
      completedAt: new Date(Date.now() - 30_000),
    });
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    const row = auditCalls[0]!;
    expect(row.success).toBe(true);
    expect((row.result as { status: number }).status).toBe(200);
    const summary = (row.parameters as {
      summary: {
        idempotentReplay: boolean;
        runKey: string;
        priorRunId: string;
        priorStatus: string;
      };
    }).summary;
    expect(summary.idempotentReplay).toBe(true);
    expect(summary.runKey).toBe("run_a1b2c3");
    expect(summary.priorRunId).toBe("run_db_1");
    expect(summary.priorStatus).toBe("completed");
  });
});

describe("POST /api/v1/edge/discovery-runs — audit", () => {
  it("writes a failure audit on auth failure with discovery:submit scope context", async () => {
    mockResolveAuth.mockResolvedValue({
      ok: false,
      error: "node_revoked",
      message: "revoked",
    });
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(auditCalls).toHaveLength(1);
    const row = auditCalls[0]!;
    expect(row.toolName).toBe("edge.discovery_runs.submit");
    expect((row.result as { error: string }).error).toBe("node_revoked");
    expect((row.parameters as { summary: { scope: string } }).summary.scope).toBe("discovery:submit");
  });

  it("writes scope_disallowed audit at 403", async () => {
    mockResolveAuth.mockResolvedValue({
      ok: false,
      error: "scope_disallowed",
      message: "no",
    });
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect((auditCalls[0]!.result as { status: number }).status).toBe(403);
  });

  it("writes invalid_body audit with resolved edgeNodeId", async () => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    await POST(
      makeReq(
        { runKey: "x" /* missing other required fields */ },
        { Authorization: "Bearer x" },
      ),
    );
    const row = auditCalls[0]!;
    expect((row.result as { error: string }).error).toBe("invalid_body");
    expect((row.parameters as { edgeNodeId: string }).edgeNodeId).toBe("edgenode_cuid_1");
  });

  it("writes a success audit row on 202 with envelope summary fields", async () => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    const row = auditCalls[0]!;
    expect(row.success).toBe(true);
    expect((row.result as { status: number }).status).toBe(202);
    const summary = (row.parameters as {
      summary: {
        runKey: string;
        agentMode: string;
        agentVersion: string;
        itemCount: number;
        relationshipCount: number;
        capabilityCount: number;
        persistencePending: boolean;
      };
    }).summary;
    expect(summary.runKey).toBe("run_a1b2c3");
    expect(summary.agentMode).toBe("container-host");
    expect(summary.agentVersion).toBe("0.1.0");
    expect(summary.itemCount).toBe(1);
    expect(summary.relationshipCount).toBe(0);
    expect(summary.capabilityCount).toBe(1);
    expect(summary.persistencePending).toBe(true);
  });

  it("audit summary tracks larger envelopes correctly", async () => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    const existingItems = VALID_BODY.items as Array<Record<string, unknown>>;
    const big = {
      ...VALID_BODY,
      items: [
        ...existingItems,
        { observedKey: "h2", itemType: "host", name: "h2", rawData: {} },
        { observedKey: "h3", itemType: "host", name: "h3", rawData: {} },
      ],
      relationships: [
        {
          fromObservedKey: "host:linux:abcdef",
          toObservedKey: "h2",
          relationshipType: "peers_with",
        },
      ],
    };
    await POST(makeReq(big, { Authorization: "Bearer x" }));
    const summary = (auditCalls[0]!.parameters as {
      summary: { itemCount: number; relationshipCount: number };
    }).summary;
    expect(summary.itemCount).toBe(3);
    expect(summary.relationshipCount).toBe(1);
  });

  it("never includes the bearer token plaintext in the audit row", async () => {
    const SECRET = "dpfedge_DISCOVERYSUBMITSECRET99999";
    mockResolveAuth.mockResolvedValue(AUTHED);
    await POST(makeReq(VALID_BODY, { Authorization: `Bearer ${SECRET}` }));
    const serialized = JSON.stringify(auditCalls[0]);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("DISCOVERYSUBMITSECRET");
  });
});

describe("POST /api/v1/edge/discovery-runs — rate limit (4/min)", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("allows up to 4 submissions within a minute", async () => {
    for (let i = 0; i < 4; i++) {
      const res = await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
      expect(res.status).toBe(202);
    }
  });

  it("rejects the 5th submission with 429 + Retry-After header", async () => {
    for (let i = 0; i < 4; i++) {
      await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    }
    const res = await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it("writes a rate_limited audit row at 429 with the 4/min+60/hour ceiling", async () => {
    for (let i = 0; i < 4; i++) {
      await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    }
    auditCalls.length = 0;
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    const row = auditCalls[0]!;
    expect((row.result as { status: number }).status).toBe(429);
    expect((row.result as { error: string }).error).toBe("rate_limited");
    const summary = (row.parameters as {
      summary: { retryAfter: number; ceiling: string };
    }).summary;
    expect(summary.ceiling).toBe("4/min+60/hour");
  });

  it("rate limit fires BEFORE body parsing — misbehaving nodes can't burn CPU on JSON parse retry storms", async () => {
    // Burn the bucket via 4 valid submissions, then send a malformed
    // body 100 times. The route should not parse them; the bucket
    // check should reject first.
    for (let i = 0; i < 4; i++) {
      await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    }
    // Send malformed JSON; would normally produce 400 invalid_json,
    // but the 429 should fire first.
    const res = await POST(
      makeReq("not json", { Authorization: "Bearer x" }, true),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
  });
});

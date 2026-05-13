import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockResolveAuth, mockDiscoveryRunFindUnique, mockPersistSubmittedDiscoveryRun } = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
  mockDiscoveryRunFindUnique: vi.fn(),
  mockPersistSubmittedDiscoveryRun: vi.fn(),
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
  persistSubmittedDiscoveryRun: mockPersistSubmittedDiscoveryRun,
}));

// Default persistence summary used when persistSubmittedDiscoveryRun isn't
// overridden per-test. Mirrors the DiscoveryPersistenceSummary type from
// @dpf/db's discovery-sync.ts.
const DEFAULT_PERSIST_SUMMARY = {
  runId: "run_db_new_1",
  createdEntities: 1,
  updatedEntities: 0,
  staleEntities: 0,
  createdRelationships: 0,
  updatedRelationships: 0,
  staleRelationships: 0,
  createdIssues: 0,
};

import { POST } from "./route";
import { setToolExecutionCreateOverride } from "@/lib/edge-node/audit";

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
  // and the route falls through to persist a new run. Tests that need
  // the idempotent-replay path override this per-test.
  mockDiscoveryRunFindUnique.mockResolvedValue(null);
  // Default: persistence succeeds with a synthetic summary. Tests that
  // need failure behavior override this per-test.
  mockPersistSubmittedDiscoveryRun.mockResolvedValue(DEFAULT_PERSIST_SUMMARY);
  auditCalls.length = 0;
  setToolExecutionCreateOverride(async (data) => {
    auditCalls.push(data);
    return { id: "audit_discovery_test" };
  });
});

afterEach(() => {
  setToolExecutionCreateOverride(null);
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

describe("POST /api/v1/edge/discovery-runs — happy path (persists)", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("returns 201 with the persistence summary on first-time submission", async () => {
    const res = await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(true);
    expect(body.runId).toBe("run_db_new_1");
    expect(body.runKey).toBe("run_a1b2c3");
    expect(body.itemCount).toBe(1);
    expect(body.relationshipCount).toBe(0);
    expect(body.persisted).toEqual({
      createdEntities: 1,
      updatedEntities: 0,
      staleEntities: 0,
      createdRelationships: 0,
      updatedRelationships: 0,
      staleRelationships: 0,
      createdIssues: 0,
    });
    // Old 202-stub field must NOT appear on the persisted response.
    expect(body.persistencePending).toBeUndefined();
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
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.itemCount).toBe(2);
    expect(body.relationshipCount).toBe(1);
  });

  it("calls persistSubmittedDiscoveryRun with the correctly-mapped CollectorOutput shape", async () => {
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(mockPersistSubmittedDiscoveryRun).toHaveBeenCalledOnce();
    const [, input] = mockPersistSubmittedDiscoveryRun.mock.calls[0]!;
    expect(input.edgeNodeId).toBe("edgenode_cuid_1");
    expect(input.nodeId).toBe("edge_abc");
    expect(input.runKey).toBe("run_a1b2c3");
    expect(input.submittedOutput.items).toEqual([
      {
        sourceKind: "edge_node",
        itemType: "host",
        name: "edge-test",
        externalRef: "host:linux:abcdef",
        attributes: { kernel: "6.5.0" },
      },
    ]);
    expect(input.submittedOutput.relationships).toEqual([]);
    expect(input.submittedOutput.warnings).toEqual([]);
  });

  it("maps wire `rawData` to attributes and `observedKey` to externalRef per item", async () => {
    await POST(
      makeReq(
        {
          ...VALID_BODY,
          items: [
            {
              observedKey: "container:abc123",
              itemType: "container",
              name: "nginx",
              sourcePath: "/var/run/docker.sock",
              confidence: 0.92,
              rawData: { image: "nginx:1.27", ports: ["80/tcp"] },
            },
          ],
        },
        { Authorization: "Bearer x" },
      ),
    );
    const [, input] = mockPersistSubmittedDiscoveryRun.mock.calls[0]!;
    expect(input.submittedOutput.items[0]).toEqual({
      sourceKind: "edge_node",
      itemType: "container",
      name: "nginx",
      externalRef: "container:abc123",
      sourcePath: "/var/run/docker.sock",
      confidence: 0.92,
      attributes: { image: "nginx:1.27", ports: ["80/tcp"] },
    });
  });

  it("maps relationships via fromObservedKey / toObservedKey → fromExternalRef / toExternalRef", async () => {
    await POST(
      makeReq(
        {
          ...VALID_BODY,
          relationships: [
            {
              fromObservedKey: "host:a",
              toObservedKey: "host:b",
              relationshipType: "peers_with",
              rawData: { latencyMs: 3 },
            },
          ],
        },
        { Authorization: "Bearer x" },
      ),
    );
    const [, input] = mockPersistSubmittedDiscoveryRun.mock.calls[0]!;
    expect(input.submittedOutput.relationships[0]).toEqual({
      sourceKind: "edge_node",
      relationshipType: "peers_with",
      fromExternalRef: "host:a",
      toExternalRef: "host:b",
      attributes: { latencyMs: 3 },
    });
  });

  it("forwards envelope `warnings` to the CollectorOutput", async () => {
    await POST(
      makeReq(
        { ...VALID_BODY, warnings: ["nmap output truncated"] },
        { Authorization: "Bearer x" },
      ),
    );
    const [, input] = mockPersistSubmittedDiscoveryRun.mock.calls[0]!;
    expect(input.submittedOutput.warnings).toEqual(["nmap output truncated"]);
  });

  it("returns 500 persistence_failed when persistSubmittedDiscoveryRun throws", async () => {
    mockPersistSubmittedDiscoveryRun.mockRejectedValue(
      new Error("Postgres connection refused"),
    );
    const res = await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("persistence_failed");
    // The audit row captures the underlying error; the client response
    // does not leak it.
    expect(JSON.stringify(body)).not.toContain("Postgres connection refused");
  });

  it("writes a persistence_failed audit row on 500 carrying the redacted error", async () => {
    mockPersistSubmittedDiscoveryRun.mockRejectedValue(
      new Error("Postgres connection refused"),
    );
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    const row = auditCalls[0]!;
    expect((row.result as { status: number }).status).toBe(500);
    expect((row.result as { error: string }).error).toBe("persistence_failed");
    const summary = row.parameters as { summary: { errorMessage: string } };
    expect(summary.summary.errorMessage).toBe("Postgres connection refused");
  });

  it("writes a 201 success audit row with persistence counters", async () => {
    mockPersistSubmittedDiscoveryRun.mockResolvedValue({
      ...DEFAULT_PERSIST_SUMMARY,
      runId: "run_db_42",
      createdEntities: 3,
      createdRelationships: 2,
    });
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    const row = auditCalls[0]!;
    expect(row.success).toBe(true);
    expect((row.result as { status: number }).status).toBe(201);
    const summary = (row.parameters as {
      summary: {
        runId: string;
        createdEntities: number;
        createdRelationships: number;
      };
    }).summary;
    expect(summary.runId).toBe("run_db_42");
    expect(summary.createdEntities).toBe(3);
    expect(summary.createdRelationships).toBe(2);
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
    // 201 now that persistence is wired (was 202 stub before this PR).
    expect(res.status).toBe(201);
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

  it("falls through to persist a new run when no prior exists for (edgeNodeId, runKey)", async () => {
    mockDiscoveryRunFindUnique.mockResolvedValue(null);
    const res = await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.idempotentReplay).toBeUndefined();
    expect(body.persisted).toBeDefined();
    expect(body.runId).toBe("run_db_new_1");
    // The pre-#513-merge stub field must not appear on persisted responses.
    expect(body.persistencePending).toBeUndefined();
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

  it("writes a success audit row on 201 with envelope summary fields", async () => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
    const row = auditCalls[0]!;
    expect(row.success).toBe(true);
    expect((row.result as { status: number }).status).toBe(201);
    const summary = (row.parameters as {
      summary: {
        runKey: string;
        runId: string;
        agentMode: string;
        agentVersion: string;
        itemCount: number;
        relationshipCount: number;
        capabilityCount: number;
        createdEntities: number;
      };
    }).summary;
    expect(summary.runKey).toBe("run_a1b2c3");
    expect(summary.runId).toBe("run_db_new_1");
    expect(summary.agentMode).toBe("container-host");
    expect(summary.agentVersion).toBe("0.1.0");
    expect(summary.itemCount).toBe(1);
    expect(summary.relationshipCount).toBe(0);
    expect(summary.capabilityCount).toBe(1);
    // Persistence counters now in the audit summary (was persistencePending:true before this PR).
    expect(summary.createdEntities).toBe(1);
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

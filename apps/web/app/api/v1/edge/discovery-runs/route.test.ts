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
  beforeEach(() => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    // Reset env between tests so per-test overrides don't bleed.
    delete process.env.DPF_EDGE_FRESHNESS_PAST_SEC;
    delete process.env.DPF_EDGE_FRESHNESS_FUTURE_SEC;
  });
  afterEach(() => {
    delete process.env.DPF_EDGE_FRESHNESS_PAST_SEC;
    delete process.env.DPF_EDGE_FRESHNESS_FUTURE_SEC;
  });

  it("returns 400 stale_observation when observedAt is > 24h in the past (default past bound)", async () => {
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
    expect(body.message).toMatch(/before server time/i);
    // Freshness gate must fire BEFORE the idempotency lookup so stale
    // submissions never hit the DB.
    expect(mockDiscoveryRunFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 stale_observation when observedAt is > 5min in the future (default future bound, NTP-tightened)", async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min ahead
    const res = await POST(
      makeReq(
        makeValidBody({ observedAt: future }),
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("stale_observation");
    // The error message should hint at NTP because forward-skew is
    // almost always a clock-sync problem on the Edge Node side.
    expect(body.message).toMatch(/ahead of server time|NTP/i);
  });

  it("accepts observedAt at the recent past edge of the default window (23h ago)", async () => {
    // 23h ago — comfortably inside the 24h past bound.
    const recent = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString();
    const res = await POST(
      makeReq(
        makeValidBody({ observedAt: recent }),
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(201);
  });

  it("accepts observedAt 1min in the future (inside default 5min forward bound)", async () => {
    const slightlyAhead = new Date(Date.now() + 60 * 1000).toISOString();
    const res = await POST(
      makeReq(
        makeValidBody({ observedAt: slightlyAhead }),
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(201);
  });

  it("honors DPF_EDGE_FRESHNESS_PAST_SEC to tighten the past window", async () => {
    process.env.DPF_EDGE_FRESHNESS_PAST_SEC = "3600"; // 1 hour
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const res = await POST(
      makeReq(
        makeValidBody({ observedAt: twoHoursAgo }),
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("stale_observation");
  });

  it("honors DPF_EDGE_FRESHNESS_FUTURE_SEC to widen the future window", async () => {
    process.env.DPF_EDGE_FRESHNESS_FUTURE_SEC = "3600"; // 1 hour
    const halfHourAhead = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const res = await POST(
      makeReq(
        makeValidBody({ observedAt: halfHourAhead }),
        { Authorization: "Bearer x" },
      ),
    );
    expect(res.status).toBe(201);
  });

  it("ignores invalid env values and falls back to defaults", async () => {
    // Garbage env values should not crash the route or accept all
    // requests — they should fall back to the safe defaults.
    process.env.DPF_EDGE_FRESHNESS_PAST_SEC = "not-a-number";
    process.env.DPF_EDGE_FRESHNESS_FUTURE_SEC = "-500";
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const res = await POST(
      makeReq(
        makeValidBody({ observedAt: stale }),
        { Authorization: "Bearer x" },
      ),
    );
    // Default past bound (24h) still applies; 25h ago is rejected.
    expect(res.status).toBe(400);
  });

  it("writes a stale_observation audit row with signed deltaMs + direction + window bounds", async () => {
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
      summary: {
        skewMs: number;
        deltaMs: number;
        direction: "past" | "future";
        observedAt: string;
        pastWindowSec: number;
        futureWindowSec: number;
      };
    }).summary;
    // skewMs preserved for backward compat with existing audit consumers.
    expect(summary.skewMs).toBeGreaterThan(24 * 60 * 60 * 1000);
    // Signed delta tells us direction unambiguously.
    expect(summary.deltaMs).toBeLessThan(0);
    expect(summary.direction).toBe("past");
    expect(summary.observedAt).toBe(stale);
    // Windows surfaced so operators reading audit rows can see what
    // bounds were in force at the time of rejection.
    expect(summary.pastWindowSec).toBe(24 * 60 * 60);
    expect(summary.futureWindowSec).toBe(5 * 60);
  });

  it("writes direction=future + signed deltaMs > 0 for forward-skew rejections", async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await POST(
      makeReq(
        makeValidBody({ observedAt: future }),
        { Authorization: "Bearer x" },
      ),
    );
    const row = auditCalls[0]!;
    const summary = (row.parameters as {
      summary: { deltaMs: number; direction: "past" | "future" };
    }).summary;
    expect(summary.deltaMs).toBeGreaterThan(0);
    expect(summary.direction).toBe("future");
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

describe("POST /api/v1/edge/discovery-runs — rate limit (4/min)", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("allows up to 4 submissions within a minute", async () => {
    for (let i = 0; i < 4; i++) {
      const res = await POST(makeReq(VALID_BODY, { Authorization: "Bearer x" }));
      expect(res.status).toBe(201);
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

describe("POST /api/v1/edge/discovery-runs — payload size caps", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("rejects 413 when Content-Length declares > 5 MB (early rejection, no buffering)", async () => {
    const req = new Request("http://test/api/v1/edge/discovery-runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer x",
        "Content-Length": String(6 * 1024 * 1024),
      },
      body: "{}",
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("payload_too_large");
  });

  it("writes a payload_too_large audit on Content-Length rejection (stage=content-length)", async () => {
    const req = new Request("http://test/api/v1/edge/discovery-runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer x",
        "Content-Length": String(10 * 1024 * 1024),
      },
      body: "{}",
    }) as unknown as NextRequest;
    await POST(req);
    const row = auditCalls[0]!;
    expect((row.result as { status: number }).status).toBe(413);
    expect((row.result as { error: string }).error).toBe("payload_too_large");
    const summary = (row.parameters as {
      summary: { declaredBytes: number; capBytes: number; stage: string };
    }).summary;
    expect(summary.declaredBytes).toBe(10 * 1024 * 1024);
    expect(summary.capBytes).toBe(5 * 1024 * 1024);
    expect(summary.stage).toBe("content-length");
  });

  it("rejects 413 when actual body bytes exceed 5 MB (buffered stage)", async () => {
    // Construct a body that's actually > 5 MB without declaring an
    // honest Content-Length. The "warnings" array can carry padding
    // because Zod allows arbitrary strings there.
    const padding = "x".repeat(1024); // 1 KB per entry
    const big = {
      ...VALID_BODY,
      // 6 MB of warnings: 6144 entries × 1 KB each + JSON framing.
      warnings: Array.from({ length: 6144 }, () => padding),
    };
    const res = await POST(makeReq(big, { Authorization: "Bearer x" }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("payload_too_large");
  });

  it("writes a payload_too_large audit on buffered rejection (stage=buffered)", async () => {
    const padding = "x".repeat(1024);
    const big = {
      ...VALID_BODY,
      warnings: Array.from({ length: 6144 }, () => padding),
    };
    await POST(makeReq(big, { Authorization: "Bearer x" }));
    const row = auditCalls[0]!;
    const summary = (row.parameters as {
      summary: { actualBytes: number; capBytes: number; stage: string };
    }).summary;
    expect(summary.actualBytes).toBeGreaterThan(5 * 1024 * 1024);
    expect(summary.capBytes).toBe(5 * 1024 * 1024);
    expect(summary.stage).toBe("buffered");
  });

  it("rejects 413 raw_data_too_large when a single item's rawData > 64 KB", async () => {
    const bigRawDataItem = {
      observedKey: "host:bloat",
      itemType: "host",
      name: "bloat",
      // 70 KB rawData blob.
      rawData: { blob: "y".repeat(70 * 1024) },
    };
    const body = {
      ...VALID_BODY,
      items: [...(VALID_BODY.items as unknown[]), bigRawDataItem],
    };
    const res = await POST(makeReq(body, { Authorization: "Bearer x" }));
    expect(res.status).toBe(413);
    const responseBody = await res.json();
    expect(responseBody.error).toBe("raw_data_too_large");
    expect(responseBody.itemIndex).toBe(1);
    expect(responseBody.itemObservedKey).toBe("host:bloat");
  });

  it("writes a raw_data_too_large audit with the offending item index", async () => {
    const bigRawDataItem = {
      observedKey: "host:bloat",
      itemType: "host",
      name: "bloat",
      rawData: { blob: "y".repeat(70 * 1024) },
    };
    const body = {
      ...VALID_BODY,
      items: [...(VALID_BODY.items as unknown[]), bigRawDataItem],
    };
    await POST(makeReq(body, { Authorization: "Bearer x" }));
    const row = auditCalls[0]!;
    expect((row.result as { status: number }).status).toBe(413);
    expect((row.result as { error: string }).error).toBe("raw_data_too_large");
    const summary = (row.parameters as {
      summary: {
        itemIndex: number;
        itemObservedKey: string;
        rawDataBytes: number;
        capBytes: number;
      };
    }).summary;
    expect(summary.itemIndex).toBe(1);
    expect(summary.itemObservedKey).toBe("host:bloat");
    expect(summary.rawDataBytes).toBeGreaterThan(64 * 1024);
    expect(summary.capBytes).toBe(64 * 1024);
  });

  it("accepts items with rawData just under the 64 KB cap", async () => {
    const okItem = {
      observedKey: "host:medium",
      itemType: "host",
      name: "medium",
      rawData: { blob: "y".repeat(50 * 1024) }, // 50 KB — under
    };
    const body = { ...VALID_BODY, items: [okItem] };
    const res = await POST(makeReq(body, { Authorization: "Bearer x" }));
    expect(res.status).toBe(201);
  });

  it("rawData cap fires BEFORE the idempotency lookup — oversized payloads never touch the DB", async () => {
    const bigRawDataItem = {
      observedKey: "host:bloat",
      itemType: "host",
      name: "bloat",
      rawData: { blob: "y".repeat(70 * 1024) },
    };
    const body = {
      ...VALID_BODY,
      items: [...(VALID_BODY.items as unknown[]), bigRawDataItem],
    };
    await POST(makeReq(body, { Authorization: "Bearer x" }));
    expect(mockDiscoveryRunFindUnique).not.toHaveBeenCalled();
  });
});

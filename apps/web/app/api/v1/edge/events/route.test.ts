import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockResolveAuth,
  mockEdgeEventFindUnique,
  mockEdgeEventCreate,
  mockEdgeEventUpdate,
  mockTransaction,
} = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
  mockEdgeEventFindUnique: vi.fn(),
  mockEdgeEventCreate: vi.fn(),
  mockEdgeEventUpdate: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@/lib/auth/edge-node-token", () => ({
  resolveEdgeNodeAuth: mockResolveAuth,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: mockTransaction,
    edgeEvent: {
      findUnique: mockEdgeEventFindUnique,
      create: mockEdgeEventCreate,
      update: mockEdgeEventUpdate,
    },
  },
}));

import { POST } from "./route";
import { _resetEdgeRateLimits } from "@/lib/edge-node/rate-limit";

const AUTHED = {
  ok: true as const,
  edgeNodeRowId: "edgenode_cuid_1",
  nodeId: "edge_abc",
  trustState: "trusted" as const,
};

function freshObservedAt(): string {
  return new Date().toISOString();
}

type EventOverrides = Partial<{
  dedupKey: string;
  source: string;
  component: string;
  eventGroup: string;
  eventClass: string;
  severity: "info" | "warn" | "error" | "critical";
  action: "trigger" | "acknowledge" | "resolve";
  summary: string;
  occurredAt: string;
  customDetails: Record<string, unknown>;
}>;

function makeValidEvent(overrides: EventOverrides = {}): Record<string, unknown> {
  return {
    dedupKey: "snmp.trap:10.0.0.5:ifaceDown:ifIndex=42",
    source: "snmp.trap",
    component: "10.0.0.5",
    eventGroup: "network",
    eventClass: "interface_down",
    severity: "error",
    action: "trigger",
    summary: "Interface ifIndex=42 link state down on 10.0.0.5",
    occurredAt: freshObservedAt(),
    customDetails: { ifIndex: 42 },
    ...overrides,
  };
}

function makeValidBody(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    runKey: "7c2d6f4a-3b1e-4d8a-9e1b-1234567890ab",
    nodeId: "edge_abc",
    observedAt: freshObservedAt(),
    eventsVersion: "1",
    events: [makeValidEvent()],
    ...overrides,
  };
}

function makeReq(
  body: unknown,
  headers: Record<string, string> = {},
  raw = false,
): NextRequest {
  const serialized = raw ? (body as string) : JSON.stringify(body);
  return new Request("http://test/api/v1/edge/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(serialized, "utf8")),
      ...headers,
    },
    body: serialized,
  }) as unknown as NextRequest;
}

// Capture all writes the route asks the mocked Prisma client to perform.
type CapturedCreate = { data: Record<string, unknown> };
type CapturedUpdate = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};
const creates: CapturedCreate[] = [];
const updates: CapturedUpdate[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  creates.length = 0;
  updates.length = 0;

  // Default: $transaction simply runs the callback with the same prisma-
  // shaped mock; tests that need rollback behavior override per-test.
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
    return cb({
      edgeEvent: {
        findUnique: mockEdgeEventFindUnique,
        create: mockEdgeEventCreate,
        update: mockEdgeEventUpdate,
      },
    });
  });

  mockEdgeEventFindUnique.mockResolvedValue(null);
  mockEdgeEventCreate.mockImplementation(async (args: CapturedCreate) => {
    creates.push(args);
    return { id: `edgeevent_${creates.length}` };
  });
  mockEdgeEventUpdate.mockImplementation(async (args: CapturedUpdate) => {
    updates.push(args);
    return { id: String(args.where.id ?? "edgeevent_updated") };
  });

  _resetEdgeRateLimits();
});

afterEach(() => {
  _resetEdgeRateLimits();
});

describe("POST /api/v1/edge/events — auth gate", () => {
  const cases = [
    { error: "missing_authorization" as const, expected: 401 },
    { error: "invalid_scheme" as const, expected: 401 },
    { error: "invalid_token_format" as const, expected: 401 },
    { error: "token_not_found" as const, expected: 401 },
    { error: "node_revoked" as const, expected: 401 },
    { error: "scope_disallowed" as const, expected: 403 },
  ];
  for (const { error, expected } of cases) {
    it(`returns ${expected} for ${error}`, async () => {
      mockResolveAuth.mockResolvedValue({ ok: false, error, message: error });
      const res = await POST(makeReq(makeValidBody()));
      expect(res.status).toBe(expected);
    });
  }
});

describe("POST /api/v1/edge/events — body size cap", () => {
  it("returns 413 when content-length exceeds 256KB", async () => {
    mockResolveAuth.mockResolvedValue(AUTHED);
    const big = "x".repeat(257 * 1024);
    const res = await POST(
      makeReq(makeValidBody(), { "Content-Length": String(big.length) }),
    );
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe("payload_too_large");
  });
});

describe("POST /api/v1/edge/events — envelope validation", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("returns 400 for malformed JSON", async () => {
    const res = await POST(makeReq("{not json", {}, true));
    expect(res.status).toBe(400);
  });

  it("returns 422 when eventsVersion is wrong", async () => {
    const res = await POST(makeReq(makeValidBody({ eventsVersion: "0" })));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("invalid_envelope");
  });

  it("returns 422 when events array is empty", async () => {
    const res = await POST(makeReq(makeValidBody({ events: [] })));
    expect(res.status).toBe(422);
  });

  it("returns 422 for unknown severity", async () => {
    const res = await POST(
      makeReq(makeValidBody({ events: [makeValidEvent({ severity: "fatal" as never })] })),
    );
    expect(res.status).toBe(422);
  });

  it("returns 422 for unknown action", async () => {
    const res = await POST(
      makeReq(makeValidBody({ events: [makeValidEvent({ action: "page" as never })] })),
    );
    expect(res.status).toBe(422);
  });

  it("returns 422 for stale observedAt", async () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const res = await POST(makeReq(makeValidBody({ observedAt: stale })));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("stale_payload");
  });

  it("returns 422 for future-skewed observedAt", async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const res = await POST(makeReq(makeValidBody({ observedAt: future })));
    expect(res.status).toBe(422);
  });
});

describe("POST /api/v1/edge/events — persistence", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("creates a row on first observation (trigger)", async () => {
    const res = await POST(makeReq(makeValidBody()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.created).toBe(1);
    expect(json.updated).toBe(0);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data).toMatchObject({
      edgeNodeId: "edgenode_cuid_1",
      dedupKey: "snmp.trap:10.0.0.5:ifaceDown:ifIndex=42",
      severity: "error",
      status: "triggered",
      action: "trigger",
      occurrenceCount: 1,
      resolvedAt: null,
    });
  });

  it("derives nodeId from auth, not from body", async () => {
    // Body claims a different nodeId — route must ignore it.
    const res = await POST(makeReq(makeValidBody({ nodeId: "attacker-spoof" })));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.nodeId).toBe("edge_abc");
  });

  it("bumps occurrenceCount on trigger replay against an open event", async () => {
    mockEdgeEventFindUnique.mockResolvedValue({
      id: "edgeevent_existing",
      status: "triggered",
      occurrenceCount: 4,
    });
    const res = await POST(makeReq(makeValidBody()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(1);
    expect(json.created).toBe(0);
    expect(updates[0]!.data).toMatchObject({
      occurrenceCount: 5,
      status: "triggered",
      action: "trigger",
    });
    // Trigger against an open row must NOT clear resolvedAt (it was null
    // already and we use `undefined` to leave it alone).
    expect(updates[0]!.data.resolvedAt).toBeUndefined();
  });

  it("re-opens a resolved event on a new trigger and clears resolvedAt", async () => {
    mockEdgeEventFindUnique.mockResolvedValue({
      id: "edgeevent_existing",
      status: "resolved",
      occurrenceCount: 2,
    });
    const res = await POST(makeReq(makeValidBody()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reopened).toBe(1);
    expect(updates[0]!.data).toMatchObject({
      status: "triggered",
      action: "trigger",
      occurrenceCount: 3,
      resolvedAt: null,
    });
  });

  it("acknowledges an existing event without bumping occurrenceCount", async () => {
    mockEdgeEventFindUnique.mockResolvedValue({
      id: "edgeevent_existing",
      status: "triggered",
      occurrenceCount: 7,
    });
    const ack = makeValidBody({
      events: [makeValidEvent({ action: "acknowledge" })],
    });
    const res = await POST(makeReq(ack));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.acknowledged).toBe(1);
    expect(updates[0]!.data).toMatchObject({
      status: "acknowledged",
      action: "acknowledge",
    });
    expect(updates[0]!.data).not.toHaveProperty("occurrenceCount");
  });

  it("resolves an existing event and sets resolvedAt", async () => {
    mockEdgeEventFindUnique.mockResolvedValue({
      id: "edgeevent_existing",
      status: "triggered",
      occurrenceCount: 3,
    });
    const resolve = makeValidBody({
      events: [makeValidEvent({ action: "resolve" })],
    });
    const res = await POST(makeReq(resolve));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.resolved).toBe(1);
    expect(updates[0]!.data).toMatchObject({
      status: "resolved",
      action: "resolve",
    });
    expect(updates[0]!.data.resolvedAt).toBeInstanceOf(Date);
  });

  it("returns 500 if the transaction rejects (route surfaces persist_failed)", async () => {
    mockTransaction.mockRejectedValue(new Error("DB connection lost"));
    const res = await POST(makeReq(makeValidBody()));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("persist_failed");
  });

  it("processes mixed actions in a batch", async () => {
    // First event is brand-new (findUnique returns null), second has an
    // existing row to resolve.
    mockEdgeEventFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "edgeevent_pre",
        status: "triggered",
        occurrenceCount: 1,
      });

    const body = makeValidBody({
      events: [
        makeValidEvent({ dedupKey: "k1", action: "trigger" }),
        makeValidEvent({ dedupKey: "k2", action: "resolve" }),
      ],
    });
    const res = await POST(makeReq(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.created).toBe(1);
    expect(json.resolved).toBe(1);
    expect(json.accepted).toBe(2);
  });
});

describe("POST /api/v1/edge/events — rate limit", () => {
  beforeEach(() => mockResolveAuth.mockResolvedValue(AUTHED));

  it("returns 429 after the per-minute ceiling is exhausted", async () => {
    // Per-minute ceiling is 30; fire 31 and assert the 31st gets throttled.
    for (let i = 0; i < 30; i++) {
      const res = await POST(makeReq(makeValidBody({ runKey: crypto.randomUUID() })));
      expect(res.status).toBe(200);
    }
    const overflow = await POST(makeReq(makeValidBody({ runKey: crypto.randomUUID() })));
    expect(overflow.status).toBe(429);
    const json = await overflow.json();
    expect(json.error).toBe("rate_limited");
    expect(json.retryAfterSec).toBeGreaterThan(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// Mock the orchestration layer. The route handler's contract is what
// we're testing — `enrollEdgeNode` itself has its own coverage in
// lib/edge-node/enrollment.test.ts (28 tests for the business logic).
const { mockEnrollEdgeNode } = vi.hoisted(() => ({
  mockEnrollEdgeNode: vi.fn(),
}));

vi.mock("@/lib/edge-node/enrollment", () => ({
  enrollEdgeNode: mockEnrollEdgeNode,
}));

import { POST } from "./route";
import { setToolExecutionCreateOverride } from "@/lib/edge-node/audit";

const VALID_BODY = {
  displayName: "Test Mac",
  platform: "darwin",
  installMode: "native",
  version: "0.1.0",
  advertisedCapabilities: ["discovery.network"],
};

function makeReq(
  body: unknown,
  headers: Record<string, string> = {},
  raw = false,
): NextRequest {
  return new Request("http://test/api/v1/edge/enroll", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  }) as unknown as NextRequest;
}

// Audit-row captures for tests that need to assert on the audit write.
// `setToolExecutionCreateOverride(null)` clears it back to the
// production prisma path, but each test starts with the override in
// place so audits don't fall through to a real DB call.
const auditCalls: Array<Record<string, unknown>> = [];

beforeEach(() => {
  vi.resetAllMocks();
  auditCalls.length = 0;
  setToolExecutionCreateOverride(async (data) => {
    auditCalls.push(data);
    return { id: "audit_enroll_test" };
  });
});

afterEach(() => {
  setToolExecutionCreateOverride(null);
});

describe("POST /api/v1/edge/enroll — auth header parsing", () => {
  it("returns 401 missing_authorization when no Authorization header", async () => {
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("missing_authorization");
    expect(mockEnrollEdgeNode).not.toHaveBeenCalled();
  });

  it("returns 401 invalid_scheme for non-Bearer schemes", async () => {
    const res = await POST(makeReq(VALID_BODY, { Authorization: "Basic abcd" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_scheme");
    expect(mockEnrollEdgeNode).not.toHaveBeenCalled();
  });

  it("extracts the bootstrap token from a well-formed Bearer header", async () => {
    mockEnrollEdgeNode.mockResolvedValue({
      ok: true,
      nodeId: "edge_abc",
      nodeToken: "dpfedge_NEW",
      trustState: "pending",
      heartbeatIntervalSec: 60,
      sweepIntervalSec: 300,
      acceptedCapabilities: ["discovery.network"],
    });
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer dpfboot_SECRET" }));
    expect(mockEnrollEdgeNode).toHaveBeenCalledOnce();
    expect(mockEnrollEdgeNode.mock.calls[0]![0].bootstrapToken).toBe("dpfboot_SECRET");
  });
});

describe("POST /api/v1/edge/enroll — body validation", () => {
  it("returns 400 invalid_json for malformed JSON", async () => {
    const res = await POST(
      makeReq("not json at all", { Authorization: "Bearer dpfboot_X" }, true),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_json");
  });

  it("returns 400 invalid_body for missing required fields", async () => {
    const res = await POST(
      makeReq({ platform: "darwin" }, { Authorization: "Bearer dpfboot_X" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
    expect(body.issues).toBeTruthy();
  });

  it("returns 400 invalid_body for unknown platform", async () => {
    const res = await POST(
      makeReq(
        { ...VALID_BODY, platform: "freebsd" },
        { Authorization: "Bearer dpfboot_X" },
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
  });

  it("returns 400 invalid_body when advertisedCapabilities is empty", async () => {
    const res = await POST(
      makeReq(
        { ...VALID_BODY, advertisedCapabilities: [] },
        { Authorization: "Bearer dpfboot_X" },
      ),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/edge/enroll — orchestrator-failure mapping", () => {
  // The enrollEdgeNode error → status mapping is part of the route's
  // wire contract; if it drifts, clients break.
  const cases = [
    { error: "invalid_token_format" as const, expected: 401 },
    { error: "token_not_found" as const, expected: 401 },
    { error: "token_expired" as const, expected: 401 },
    { error: "token_already_consumed" as const, expected: 401 },
    { error: "token_revoked" as const, expected: 401 },
    { error: "invalid_platform" as const, expected: 400 },
    { error: "invalid_install_mode" as const, expected: 400 },
    { error: "no_acceptable_capabilities" as const, expected: 400 },
  ];

  for (const { error, expected } of cases) {
    it(`maps "${error}" to ${expected}`, async () => {
      mockEnrollEdgeNode.mockResolvedValue({
        ok: false,
        error,
        message: `Test message for ${error}`,
      });
      const res = await POST(
        makeReq(VALID_BODY, { Authorization: "Bearer dpfboot_X" }),
      );
      expect(res.status).toBe(expected);
      const body = await res.json();
      expect(body.error).toBe(error);
      expect(body.message).toContain(error);
    });
  }
});

describe("POST /api/v1/edge/enroll — happy path", () => {
  it("returns 200 with nodeId + nodeToken + intervals + capabilities", async () => {
    mockEnrollEdgeNode.mockResolvedValue({
      ok: true,
      nodeId: "edge_abc123",
      nodeToken: "dpfedge_NEW_TOKEN",
      trustState: "trusted",
      heartbeatIntervalSec: 60,
      sweepIntervalSec: 300,
      acceptedCapabilities: ["discovery.network"],
    });
    const res = await POST(
      makeReq(VALID_BODY, { Authorization: "Bearer dpfboot_X" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      nodeId: "edge_abc123",
      nodeToken: "dpfedge_NEW_TOKEN",
      trustState: "trusted",
      heartbeatIntervalSec: 60,
      sweepIntervalSec: 300,
      acceptedCapabilities: ["discovery.network"],
    });
  });

  it("omits autoApprove from the enroll call so the token row is the source of truth", async () => {
    // Per spec § Approval policy + the installer-bundled-Edge-Node
    // work: auto-approval is decided by the BootstrapToken row's
    // persisted `autoApprove` flag (set true for installer-issued
    // local-host tokens, false for paste-provisioned tokens). The
    // route layer no longer hardcodes a value — it leaves the field
    // undefined so the enrollment helper reads it off the token.
    mockEnrollEdgeNode.mockResolvedValue({
      ok: true,
      nodeId: "edge_abc",
      nodeToken: "dpfedge_X",
      trustState: "pending",
      heartbeatIntervalSec: 60,
      sweepIntervalSec: 300,
      acceptedCapabilities: ["discovery.network"],
    });
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer dpfboot_X" }));
    const call = mockEnrollEdgeNode.mock.calls[0]![0];
    // The field must NOT be set — `undefined` lets the token row
    // drive. Setting it to false would force pending even when the
    // installer-issued the token, defeating the bundled install path.
    expect(call.autoApprove).toBeUndefined();
  });

  it("forwards optional hostFingerprint + metadata when present", async () => {
    mockEnrollEdgeNode.mockResolvedValue({
      ok: true,
      nodeId: "edge_abc",
      nodeToken: "dpfedge_X",
      trustState: "pending",
      heartbeatIntervalSec: 60,
      sweepIntervalSec: 300,
      acceptedCapabilities: ["discovery.network"],
    });
    await POST(
      makeReq(
        { ...VALID_BODY, hostFingerprint: "abc-fingerprint", metadata: { hostname: "host.local" } },
        { Authorization: "Bearer dpfboot_X" },
      ),
    );
    const call = mockEnrollEdgeNode.mock.calls[0]![0];
    expect(call.hostFingerprint).toBe("abc-fingerprint");
    expect(call.metadata).toEqual({ hostname: "host.local" });
  });

  it("omits hostFingerprint and metadata when not provided (clean undefined, not null)", async () => {
    mockEnrollEdgeNode.mockResolvedValue({
      ok: true,
      nodeId: "edge_abc",
      nodeToken: "dpfedge_X",
      trustState: "pending",
      heartbeatIntervalSec: 60,
      sweepIntervalSec: 300,
      acceptedCapabilities: ["discovery.network"],
    });
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer dpfboot_X" }));
    const call = mockEnrollEdgeNode.mock.calls[0]![0];
    expect("hostFingerprint" in call).toBe(false);
    expect("metadata" in call).toBe(false);
  });
});

describe("POST /api/v1/edge/enroll — audit", () => {
  it("writes a failure audit row on missing_authorization", async () => {
    await POST(makeReq(VALID_BODY));
    expect(auditCalls).toHaveLength(1);
    const row = auditCalls[0]!;
    expect(row.toolName).toBe("edge.enroll");
    expect(row.success).toBe(false);
    expect((row.result as { error: string }).error).toBe("missing_authorization");
    expect((row.result as { status: number }).status).toBe(401);
    expect(row.routeContext).toBe("/api/v1/edge/enroll");
  });

  it("writes a failure audit row on invalid_scheme", async () => {
    await POST(makeReq(VALID_BODY, { Authorization: "Basic xyz" }));
    expect(auditCalls).toHaveLength(1);
    expect((auditCalls[0]!.result as { error: string }).error).toBe("invalid_scheme");
  });

  it("writes a failure audit row on invalid_json", async () => {
    await POST(makeReq("not json", { Authorization: "Bearer dpfboot_X" }, true));
    expect(auditCalls).toHaveLength(1);
    expect((auditCalls[0]!.result as { error: string }).error).toBe("invalid_json");
  });

  it("writes a failure audit row on invalid_body", async () => {
    await POST(
      makeReq({ platform: "darwin" }, { Authorization: "Bearer dpfboot_X" }),
    );
    expect(auditCalls).toHaveLength(1);
    expect((auditCalls[0]!.result as { error: string }).error).toBe("invalid_body");
  });

  it("writes a failure audit row when enrollEdgeNode returns an error", async () => {
    mockEnrollEdgeNode.mockResolvedValue({
      ok: false,
      error: "token_not_found",
      message: "bootstrap token not found",
    });
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer dpfboot_X" }));
    expect(auditCalls).toHaveLength(1);
    const row = auditCalls[0]!;
    expect(row.success).toBe(false);
    expect((row.result as { error: string }).error).toBe("token_not_found");
    expect((row.parameters as { summary: { platform: string } }).summary.platform).toBe("darwin");
  });

  it("writes a success audit row on successful enroll", async () => {
    mockEnrollEdgeNode.mockResolvedValue({
      ok: true,
      edgeNodeId: "edge_db_1",
      nodeId: "edge_abc123",
      nodeToken: "dpfedge_X",
      trustState: "trusted",
      heartbeatIntervalSec: 60,
      sweepIntervalSec: 300,
      acceptedCapabilities: ["discovery.network"],
    });
    await POST(makeReq(VALID_BODY, { Authorization: "Bearer dpfboot_X" }));
    expect(auditCalls).toHaveLength(1);
    const row = auditCalls[0]!;
    expect(row.success).toBe(true);
    expect((row.result as { status: number }).status).toBe(200);
    const params = row.parameters as {
      edgeNodeId: string | null;
      nodeId: string | null;
      summary: { trustState: string; acceptedCapabilities: string[] };
    };
    expect(params.edgeNodeId).toBe("edge_db_1");
    expect(params.nodeId).toBe("edge_abc123");
    expect(params.summary.trustState).toBe("trusted");
    expect(params.summary.acceptedCapabilities).toEqual(["discovery.network"]);
  });

  it("never includes the bootstrap-token plaintext in the audit row", async () => {
    const SECRET = "dpfboot_SUPERSECRETTOKEN12345";
    mockEnrollEdgeNode.mockResolvedValue({
      ok: false,
      error: "token_not_found",
      message: "not found",
    });
    await POST(makeReq(VALID_BODY, { Authorization: `Bearer ${SECRET}` }));
    expect(auditCalls).toHaveLength(1);
    const serialized = JSON.stringify(auditCalls[0]);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("SUPERSECRETTOKEN");
  });
});

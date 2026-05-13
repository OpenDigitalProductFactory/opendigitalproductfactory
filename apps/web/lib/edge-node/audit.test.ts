import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EDGE_NODE_AUDIT_AGENT_UNKNOWN,
  EDGE_NODE_AUDIT_EXECUTION_MODE,
  EDGE_NODE_AUDIT_USER_ID,
  setToolExecutionCreateOverride,
  writeEdgeNodeAudit,
} from "./audit";

const createCalls: Array<Record<string, unknown>> = [];

beforeEach(() => {
  createCalls.length = 0;
  setToolExecutionCreateOverride(async (data) => {
    createCalls.push(data);
    return { id: "audit_1" };
  });
});

afterEach(() => {
  setToolExecutionCreateOverride(null);
});

const BASE_INPUT = {
  route: "edge.heartbeat" as const,
  routeContext: "/api/v1/edge/heartbeat",
  startedAt: Date.now() - 25, // 25ms ago, so durationMs is small but positive
  edgeNodeId: "edge_db_1",
  nodeId: "edge_abc123",
  principalId: "principal_1",
  status: 200,
  success: true,
};

describe("writeEdgeNodeAudit — happy path", () => {
  it("writes a ToolExecution row with the canonical Edge Node sentinel fields", async () => {
    await writeEdgeNodeAudit({ ...BASE_INPUT });
    expect(createCalls).toHaveLength(1);
    const row = createCalls[0]!;
    expect(row.threadId).toBe("");
    expect(row.userId).toBe(EDGE_NODE_AUDIT_USER_ID);
    expect(row.agentId).toBe("principal_1"); // post-auth: principalId
    expect(row.toolName).toBe("edge.heartbeat");
    expect(row.executionMode).toBe(EDGE_NODE_AUDIT_EXECUTION_MODE);
    expect(row.routeContext).toBe("/api/v1/edge/heartbeat");
    expect(row.success).toBe(true);
  });

  it("populates parameters with edgeNodeId / nodeId / principalId for queryability", async () => {
    await writeEdgeNodeAudit({
      ...BASE_INPUT,
      summary: { rotationCount: 1 },
    });
    const params = createCalls[0]!.parameters as Record<string, unknown>;
    expect(params).toEqual({
      edgeNodeId: "edge_db_1",
      nodeId: "edge_abc123",
      principalId: "principal_1",
      summary: { rotationCount: 1 },
    });
  });

  it("populates result with ok=true and status code (no error field for success)", async () => {
    await writeEdgeNodeAudit({ ...BASE_INPUT, status: 202 });
    const result = createCalls[0]!.result as Record<string, unknown>;
    expect(result).toEqual({ ok: true, status: 202 });
  });

  it("computes durationMs as a non-negative integer", async () => {
    const before = Date.now();
    await writeEdgeNodeAudit({ ...BASE_INPUT, startedAt: before - 100 });
    const duration = createCalls[0]!.durationMs as number;
    expect(duration).toBeGreaterThanOrEqual(100);
    expect(duration).toBeLessThan(60_000); // sanity bound
  });

  it("never emits negative durationMs even if the system clock skews backwards", async () => {
    await writeEdgeNodeAudit({ ...BASE_INPUT, startedAt: Date.now() + 10_000 });
    const duration = createCalls[0]!.durationMs as number;
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("composes a brief one-line summary string", async () => {
    await writeEdgeNodeAudit({ ...BASE_INPUT });
    expect(createCalls[0]!.summary).toBe(
      "edge.heartbeat status=200 node=edge_abc123",
    );
  });
});

describe("writeEdgeNodeAudit — failure path", () => {
  it("writes ok=false and the error reason code", async () => {
    await writeEdgeNodeAudit({
      ...BASE_INPUT,
      status: 401,
      success: false,
      error: "missing_authorization",
      edgeNodeId: null,
      nodeId: null,
      principalId: null,
    });
    const result = createCalls[0]!.result as Record<string, unknown>;
    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "missing_authorization",
    });
    expect(createCalls[0]!.success).toBe(false);
  });

  it("uses the unauthenticated agent sentinel when principalId is null", async () => {
    await writeEdgeNodeAudit({
      ...BASE_INPUT,
      status: 401,
      success: false,
      error: "token_not_found",
      principalId: null,
      edgeNodeId: null,
      nodeId: null,
    });
    expect(createCalls[0]!.agentId).toBe(EDGE_NODE_AUDIT_AGENT_UNKNOWN);
  });

  it("includes the error code in the one-line summary", async () => {
    await writeEdgeNodeAudit({
      ...BASE_INPUT,
      status: 403,
      success: false,
      error: "node_quarantined",
    });
    expect(createCalls[0]!.summary).toContain("error=node_quarantined");
    expect(createCalls[0]!.summary).toContain("status=403");
  });

  it("uses 'unauthed' in the summary when nodeId is null", async () => {
    await writeEdgeNodeAudit({
      ...BASE_INPUT,
      status: 401,
      success: false,
      error: "missing_authorization",
      nodeId: null,
    });
    expect(createCalls[0]!.summary).toContain("node=unauthed");
  });
});

describe("writeEdgeNodeAudit — never-throws contract", () => {
  it("swallows a thrown error from the underlying create call", async () => {
    setToolExecutionCreateOverride(async () => {
      throw new Error("database unreachable");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Must not throw — audit failures cannot mask request success/failure.
    await expect(
      writeEdgeNodeAudit({ ...BASE_INPUT }),
    ).resolves.toBeUndefined();

    // But the failure should be logged so an operator can investigate.
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0]);
    expect(logged).toContain("[edge-audit]");
    expect(logged).toContain("route=edge.heartbeat");

    consoleErrorSpy.mockRestore();
  });

  it("redacts: parameters never contains a bearer token plaintext", async () => {
    // The audit shape only carries identity FKs + a structured summary.
    // The caller is responsible for not passing the bearer in the
    // summary; this test asserts the contract by checking the parameters
    // shape for any "dpfedge_" prefix in any string field.
    await writeEdgeNodeAudit({
      ...BASE_INPUT,
      summary: { rotationCount: 1, attemptedScope: "edge:heartbeat" },
    });
    const serialized = JSON.stringify(createCalls[0]);
    expect(serialized).not.toContain("dpfedge_");
    expect(serialized).not.toContain("dpfboot_");
  });
});

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findTask: vi.fn(),
  findToken: vi.fn(),
  claim: vi.fn(),
  update: vi.fn(),
}));
const execution = vi.hoisted(() => ({ run: vi.fn() }));
const events = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: {
      findUnique: (...args: unknown[]) => db.findTask(...args),
      updateMany: (...args: unknown[]) => db.claim(...args),
      update: (...args: unknown[]) => db.update(...args),
    },
    mcpApiToken: { findFirst: (...args: unknown[]) => db.findToken(...args) },
  },
}));
vi.mock("./mcp-task-execution", () => ({
  executeRemoteTaskAttempt: (...args: unknown[]) => execution.run(...args),
}));
vi.mock("@/lib/tak/agent-event-bus", () => ({
  agentEventBus: { emit: (...args: unknown[]) => events.emit(...args) },
}));

import {
  executePersistedRemoteTask,
  reconstructPersistedRemoteTask,
} from "./mcp-task-background-worker";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";

const params = {
  agentId: "AGT-WS-REVIEW",
  routeContext: "/build/work/WC-48A3D214",
  title: "Review immutable design",
  objective: "Review BI-2014236E.",
  prompt: "Read the immutable design and record the governed result.",
  idempotencyKey: "review:BI-2014236E:013883a8",
  riskClass: "bounded-write" as const,
  threadId: null,
  authorityScope: ["tool:read_source_at_version"],
  collaborationKind: "handoff" as const,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-row-1",
    taskRunId: "TR-MCP-ASYNC",
    userId: "user-1",
    threadId: "thread-1",
    contextId: "thread-1",
    status: "submitted",
    updatedAt: new Date("2026-08-31T04:00:00.000Z"),
    routeContext: params.routeContext,
    title: params.title,
    objective: params.objective,
    currentAgentId: params.agentId,
    authorityScope: params.authorityScope,
    progressPayload: {
      dispatch: {
        schemaVersion: 1,
        kind: "external-mcp-task",
        state: "enqueued",
        eventId: "mcp-task-run:TR-MCP-ASYNC:execute:v1",
        attempt: 1,
        requestedAt: "2026-08-31T04:00:00.000Z",
      },
    },
    a2aMetadata: {
      idempotencyKey: params.idempotencyKey,
      requestDigest: remoteTaskRequestDigest(params),
      riskClass: params.riskClass,
      apiTokenId: "token-1",
      tokenSource: "pat",
      tokenCapability: "write",
      requestedAgentId: params.agentId,
      requestedThreadId: null,
      collaborationKind: params.collaborationKind,
      initiativeReviewBinding: null,
    },
    messages: [{ parts: [{ type: "message", text: params.prompt }] }],
    user: {
      id: "user-1",
      isSuperuser: false,
      groups: [{ platformRole: { roleId: "developer" } }],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findTask.mockResolvedValue(row());
  db.findToken.mockResolvedValue({ id: "token-1", capability: "write" });
  db.claim.mockResolvedValue({ count: 1 });
  db.update.mockResolvedValue({});
  execution.run.mockResolvedValue({
    kind: "result",
    result: { taskRunId: "TR-MCP-ASYNC", status: "completed" },
  });
});

describe("persisted remote TaskRun worker", () => {
  it("reconstructs the exact execution packet from server-owned persisted state", () => {
    const reconstructed = reconstructPersistedRemoteTask(row());

    expect(reconstructed).toMatchObject({
      ok: true,
      data: {
        run: { id: "task-row-1", taskRunId: "TR-MCP-ASYNC" },
        token: { tokenId: "token-1", userId: "user-1", capability: "write", source: "pat" },
        userContext: { userId: "user-1", platformRole: "developer", isSuperuser: false },
        parsed: params,
      },
    });
  });

  it("fails closed when persisted request bytes no longer match the immutable digest", () => {
    const reconstructed = reconstructPersistedRemoteTask(row({
      messages: [{ parts: [{ type: "message", text: "changed prompt" }] }],
    }));

    expect(reconstructed).toEqual({
      ok: false,
      code: "request_digest_mismatch",
      message: "Persisted remote task request does not match its immutable digest.",
    });
  });

  it("lets only one duplicate queue delivery claim and execute the TaskRun", async () => {
    db.claim.mockResolvedValue({ count: 0 });

    const result = await executePersistedRemoteTask({ taskRunId: "TR-MCP-ASYNC" });

    expect(result).toEqual({ status: "duplicate", taskRunId: "TR-MCP-ASYNC" });
    expect(execution.run).not.toHaveBeenCalled();
  });
});

// Keep Node's crypto import exercised so a future test fixture can compare the
// digest independently without adding a second ad-hoc hash implementation.
void createHash;

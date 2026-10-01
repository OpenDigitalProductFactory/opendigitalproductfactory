import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));

const { resolveOAuthConsent } = vi.hoisted(() => ({ resolveOAuthConsent: vi.fn() }));
vi.mock("@/lib/auth/oauth-identity-binding", () => ({ resolveOAuthConsent }));
vi.mock("@/lib/govern/current-user-context", () => ({
  currentUserContext: async (userId: string) => ({ userId, platformRole: "admin", isSuperuser: false }),
}));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({
  PLATFORM_TOOLS: [{ name: "create_backlog_item", sideEffect: true }],
}));
vi.mock("@/lib/tak/agent-grants", () => ({
  getToolGrantMapping: () => ({ create_backlog_item: ["backlog_write"] }),
  expandGrants: (grants: string[]) => grants,
}));

import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";

import { runApprovedExternalRequest } from "./approved-request-run";

const NOW = new Date("2026-09-23T16:00:00Z");
const PARAMS = { title: "Requested item", type: "portfolio", workType: "bug" };

function fixtures(over: {
  envelope?: Record<string, unknown> | null;
  pending?: Record<string, unknown> | null;
  token?: Record<string, unknown> | null;
} = {}) {
  const envelope = over.envelope === null ? null : {
    id: "env-1",
    status: "approved",
    taskRunId: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
    delegatingUserId: "user-1",
    coworkerAgentId: "AGT-EXT-CODEX",
    manifestActionId: "create_backlog_item",
    argsJson: {
      approvalBinding: {
        taskRunId: null, routeContext: null, chainId: null,
        inputFingerprint: fingerprintCoworkerInput(PARAMS),
      },
    },
    ...over.envelope,
  };
  const pending = over.pending === null ? null : {
    parameters: { ...PARAMS, _surface: "mcp" },
    apiTokenId: "tok-1",
    ...over.pending,
  };
  const token = over.token === null ? null : {
    id: "tok-1", userId: "user-1", agentId: "AGT-EXT-CODEX", kind: "oauth_access", revokedAt: null,
    scope: "write", capability: "write", scopes: ["backlog_write"], publicScopes: ["dpf.work"],
    authorityBindingId: "binding-1", oauthClientId: "client-row-1", resource: "http://127.0.0.1:3000/api/mcp/v1",
    ...over.token,
  };
  const findPending = vi.fn(async () => pending);
  const db = {
    coworkerActionEnvelope: { findUnique: vi.fn(async () => envelope) },
    toolExecution: { findFirst: findPending },
    mcpApiToken: { findUnique: vi.fn(async () => token) },
  };
  const execute = vi.fn(async () => ({ success: true, message: "Created BI-1." }));
  return { db, execute, findPending };
}

beforeEach(() => {
  resolveOAuthConsent.mockReset();
  resolveOAuthConsent.mockResolvedValue({ agentId: "AGT-EXT-CODEX", agentRecordId: "agent-row" });
});

describe("runApprovedExternalRequest (BI-12E5DD91)", () => {
  it("runs the exact approved call once, as the person and assistant, under the same consent", async () => {
    const { db, execute } = fixtures();

    const run = await runApprovedExternalRequest("env-1", { db: db as never, execute: execute as never, now: NOW });

    expect(run).toEqual({ status: "executed", message: "Created BI-1." });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "create_backlog_item",
      rawParams: PARAMS,
      userId: "user-1",
      source: "external-jsonrpc",
      context: expect.objectContaining({
        agentId: "AGT-EXT-CODEX",
        apiTokenId: "tok-1",
        authSource: "oauth",
        connectionDelegation: { authorityBindingId: "binding-1", agentId: "AGT-EXT-CODEX" },
      }),
    }));
  });

  it("reports a failed run as failed", async () => {
    const { db } = fixtures();
    const execute = vi.fn(async () => ({ success: false, error: "workroom_access_denied", message: "not admitted" }));
    const run = await runApprovedExternalRequest("env-1", { db: db as never, execute: execute as never, now: NOW });
    expect(run).toEqual({ status: "failed", message: "not admitted" });
  });

  it.each([
    ["not approved", { envelope: { status: "proposed" } }, "not-approved"],
    ["declined", { envelope: { status: "declined" } }, "not-approved"],
    ["expired", { envelope: { expiresAt: new Date(NOW.getTime() - 1) } }, "expired"],
    ["missing pending call", { pending: null }, "no-pending-call"],
    ["arguments changed", { pending: { parameters: { ...PARAMS, title: "Other" } } }, "arguments-not-provable"],
    ["revoked credential", { token: { revokedAt: new Date() } }, "credential-unavailable"],
    ["another person's credential", { token: { userId: "user-2" } }, "credential-unavailable"],
    ["another assistant's credential", { token: { agentId: "AGT-EXT-CLAUDE" } }, "credential-unavailable"],
    ["unbound OAuth connection", { token: { authorityBindingId: null } }, "consent-changed"],
    ["scope narrowed to read", { token: { scope: "read", capability: "read" } }, "scope-insufficient"],
    ["grant removed", { token: { scopes: ["registry_read"] } }, "scope-insufficient"],
  ] as const)("does not run when %s", async (_label, over, reason) => {
    const { db, execute } = fixtures(over as never);
    const run = await runApprovedExternalRequest("env-1", { db: db as never, execute: execute as never, now: NOW });
    expect(run).toMatchObject({ status: "not-run", reason });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not run when the consent no longer names the same assistant", async () => {
    resolveOAuthConsent.mockResolvedValue({ agentId: "AGT-EXT-GROK", agentRecordId: "x" });
    const { db, execute } = fixtures();
    const run = await runApprovedExternalRequest("env-1", { db: db as never, execute: execute as never, now: NOW });
    expect(run).toMatchObject({ status: "not-run", reason: "consent-changed" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("looks up only the delegating person's own parked call for this envelope", async () => {
    const { db, execute, findPending } = fixtures();
    await runApprovedExternalRequest("env-1", { db: db as never, execute: execute as never, now: NOW });
    expect(findPending).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        success: false,
        toolName: "create_backlog_item",
        userId: "user-1",
        apiTokenId: { not: null },
      }),
    }));
  });
});

describe("an approved request parked inside a task (BI-9FD11E5E)", () => {
  it("resumes the task instead of waiting for the client to replay it", async () => {
    const { db, execute } = fixtures({ envelope: { taskRunId: "TR-1" } });
    const resumeTask = vi.fn(async () => ({ status: "executed" as const, message: "Recorded." }));
    const run = await runApprovedExternalRequest("env-1", { db: db as never, execute: execute as never, now: NOW, resumeTask });
    expect(run).toEqual({ status: "executed", message: "Recorded." });
    expect(resumeTask).toHaveBeenCalledWith(expect.objectContaining({ taskRunId: "TR-1", delegatingUserId: "user-1" }), expect.anything());
    expect(execute).not.toHaveBeenCalled();
  });

  it("says why a task was not resumed, in the card's words", async () => {
    const { db, execute } = fixtures({ envelope: { taskRunId: "TR-1" } });
    const resumeTask = vi.fn(async () => ({ status: "not-run" as const, reason: "task-not-waiting" as const }));
    await expect(runApprovedExternalRequest("env-1", { db: db as never, execute: execute as never, now: NOW, resumeTask }))
      .resolves.toMatchObject({ status: "not-run", reason: "task-not-waiting", message: expect.stringContaining("no longer waiting") });
  });

  it("never resumes an expired approval", async () => {
    const { db, execute } = fixtures({ envelope: { taskRunId: "TR-1", expiresAt: new Date(NOW.getTime() - 1) } });
    const resumeTask = vi.fn();
    await expect(runApprovedExternalRequest("env-1", { db: db as never, execute: execute as never, now: NOW, resumeTask: resumeTask as never }))
      .resolves.toMatchObject({ status: "not-run", reason: "expired" });
    expect(resumeTask).not.toHaveBeenCalled();
  });
});

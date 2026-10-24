import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));
import { listPendingApprovalOutcomes, loadApprovalOutcomes, readApprovalOutcome, recordApprovalOutcome } from "./approval-outcome-store";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";

const now = new Date("2026-09-27T12:00:00Z");
it("reads the original provider test evidence after the approval replay window without running the action", async () => {
  const parameters = { operation: "test", providerId: "chatgpt", connectionId: "provider-default-chatgpt" };
  const inputFingerprint = fingerprintCoworkerInput(parameters);
  const envelope = { id: "approved-provider-test", status: "executed", createdAt: now, expiresAt: now,
    delegatingUserId: "u1", coworkerAgentId: "a1", threadId: "thread1", manifestActionId: "manage_provider_account",
    inputFingerprint, argsJson: { approvalBinding: { actingHumanUserId: "u1", actingAgentId: "a1",
      toolName: "manage_provider_account", inputFingerprint, taskRunId: null, chainId: null, routeContext: null } },
    toolExecutions: [],
  };
  const db = { coworkerActionEnvelope: { findFirst: vi.fn(async () => envelope) },
    toolExecution: { findMany: vi.fn(async () => [{ id: "actual-run", envelopeId: envelope.id, userId: "u1", agentId: "a1",
      threadId: "thread1", taskRunId: null, toolName: "manage_provider_account", executionMode: "external-mcp",
      createdAt: now, durationMs: 10, parameters, success: true, result: { success: true, message: "secret raw message" } }]) },
  };
  const result = await readApprovalOutcome(envelope.id, "u1", "a1", db as never, new Date("2026-10-21T00:00:00Z"));
  expect(result).toMatchObject({ state: "executed", actionEvidence: { state: "available", executionId: "actual-run",
    outcome: "succeeded", quotaReconciliation: "unproven", responsesVerification: "unproven" } });
  expect(JSON.stringify(result)).not.toContain("secret raw message");
});
const row = { id: "e1", delegatingUserId: "u1", coworkerAgentId: "a1", threadId: "thread1", taskRunId: null, status: "approved", createdAt: now, expiresAt: now, toolExecutions: [] as unknown[] };
function fixture() {
  const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => where.delegatingUserId === "u1" && (!where.coworkerAgentId || where.coworkerAgentId === "a1") ? row : null);
  const create = vi.fn(async ({ data }: { data: unknown }) => { row.toolExecutions = [data]; return data; });
  const findMany = vi.fn(async (_args: unknown): Promise<Array<Record<string, unknown>>> => [row]);
  return { coworkerActionEnvelope: { findFirst, findMany }, toolExecution: { create } };
}
describe("approval receipt owner and assistant isolation", () => {
  it("records not-run then reads the result in a new request without transient UI state", async () => {
    const db = fixture();
    await recordApprovalOutcome("e1", "u1", { status: "not-run", reason: "credential-unavailable", message: "private raw details" }, db as never);
    const result = await readApprovalOutcome("e1", "u1", "a1", db as never, now);
    expect(result?.state).toBe("not-run");
    expect(result?.nextAction).toContain("connection");
    expect(JSON.stringify(db.toolExecution.create.mock.calls)).not.toContain("private raw details");
    expect(db.toolExecution.create.mock.calls[0][0]).toMatchObject({ data: { toolName: "approval_outcome", envelopeId: "e1" } });
  });
  it.each([["u2", "a1"], ["u1", "a2"]])("denies %s/%s without revealing the request", async (user, agent) => {
    expect(await readApprovalOutcome("e1", user, agent, fixture() as never, now)).toBeNull();
  });
  it("does not query without the verified assistant identity", async () => {
    const db = fixture();
    expect(await readApprovalOutcome("e1", "u1", undefined, db as never, now)).toBeNull();
    expect(db.coworkerActionEnvelope.findFirst).not.toHaveBeenCalled();
  });
  it("keeps the owner predicate on history and old exact links", async () => {
    const db = fixture();
    await loadApprovalOutcomes("u1", undefined, db as never, now);
    expect(db.coworkerActionEnvelope.findMany.mock.calls[0][0]).toMatchObject({ where: { delegatingUserId: "u1", OR: expect.any(Array) }, take: 10 });
    await loadApprovalOutcomes("u1", "e1", db as never, now);
    expect(db.coworkerActionEnvelope.findMany.mock.calls[1][0]).toMatchObject({ where: { delegatingUserId: "u1", id: "e1" }, take: 1 });
  });
  it("cannot attach a receipt to another person's request", async () => {
    const db = fixture();
    await expect(recordApprovalOutcome("e1", "u2", { status: "executed", message: "Done" }, db as never)).rejects.toThrow();
    expect(db.toolExecution.create).not.toHaveBeenCalled();
  });
  // BI-7BCC87BB (AC-OVERRIDE): an admin decided on the owner's behalf. The
  // receipt still belongs to the owner's request; the admin is its actor.
  it("records an on-behalf outcome on the owner's request with the admin as the actor", async () => {
    const db = fixture();
    await recordApprovalOutcome("e1", "u1", { status: "executed", message: "Done" }, db as never, "admin-1");
    expect(db.toolExecution.create.mock.calls[0][0]).toMatchObject({ data: { userId: "admin-1", delegatingUserId: "u1", envelopeId: "e1" } });
  });
});

describe("caller-scoped pending approval discovery", () => {
  const binding = {
    writerToolName: "record_initiative_evidence", itemId: "BI-EXAMPLE", gate: "research",
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo",
      commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) },
  };
  const pending = {
    ...row, status: "proposed", expiresAt: new Date(now.getTime() + 60_000),
    taskRunId: "TR-1", manifestActionId: binding.writerToolName, toolExecutions: [],
    taskRun: { userId: "u1", a2aMetadata: { initiativeReviewBinding: { ...binding, secret: "private-binding-data" }, apiTokenId: "private-token" } },
    argsJson: { secret: "private-arguments" }, rationale: "private-rationale",
  };
  it("queries only this user and assistant's live requests and returns safe immutable locators", async () => {
    const db = fixture();
    db.coworkerActionEnvelope.findMany.mockResolvedValue([pending]);
    const result = await listPendingApprovalOutcomes("u1", "a1", db as never, now);
    expect(db.coworkerActionEnvelope.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { delegatingUserId: "u1", coworkerAgentId: "a1", status: "proposed",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
    }));
    expect(result).toMatchObject({ hasMore: false, approvals: [{
      envelopeId: "e1", state: "waiting", delegatingUserId: "u1", coworkerAgentId: "a1",
      expiresAtIso: pending.expiresAt.toISOString(), taskRunId: "TR-1", reviewBinding: binding,
      inboxHref: "/workspace/inbox?approval=e1#approval-result",
    }] });
    expect(JSON.stringify(result)).not.toContain("private-");
  });
  it.each([["", "a1"], ["u1", undefined]])("never queries without authenticated %s/%s", async (user, agent) => {
    const db = fixture();
    expect(await listPendingApprovalOutcomes(user, agent, db as never, now))
      .toMatchObject({ approvals: [], hasMore: false });
    expect(db.coworkerActionEnvelope.findMany).not.toHaveBeenCalled();
  });
  it("reports a bounded page without pretending extra requests do not exist", async () => {
    const db = fixture();
    db.coworkerActionEnvelope.findMany.mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({ ...pending, id: `e${i}` })));
    const result = await listPendingApprovalOutcomes("u1", "a1", db as never, now);
    expect(result.approvals).toHaveLength(20);
    expect(result.hasMore).toBe(true);
    expect(result.inboxHref).toBe("/workspace/inbox");
  });
  it.each([
    { userId: "u2", a2aMetadata: { initiativeReviewBinding: binding } },
    { userId: "u1", a2aMetadata: { initiativeReviewBinding: { ...binding, writerToolName: "record_initiative_architecture_review" } } },
    { userId: "u1", a2aMetadata: { initiativeReviewBinding: { secret: "private-malformed" } } },
  ])("does not expose a foreign, conflicting or malformed task binding", async (taskRun) => {
    const db = fixture();
    db.coworkerActionEnvelope.findMany.mockResolvedValue([{ ...pending, taskRun }]);
    const result = await listPendingApprovalOutcomes("u1", "a1", db as never, now);
    expect(result.approvals[0].reviewBinding).toBeNull();
    expect(JSON.stringify(result)).not.toContain("private-");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ agent: vi.fn(), token: vi.fn(), room: vi.fn(),
  human: vi.fn(), currentConsent: vi.fn(), access: vi.fn(), item: vi.fn(), recovery: vi.fn(),
  task: vi.fn(), authorityKey: vi.fn(), outcome: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {
  agent: { findUnique: mocks.agent }, mcpApiToken: { findUnique: mocks.token },
  workroom: { findFirst: mocks.room },
  taskRun: { findFirst: mocks.task },
} }));
vi.mock("@/lib/auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: mocks.authorityKey }));
vi.mock("@/lib/mcp-task-review-outcome", () => ({ loadTaskInitiativeReviewOutcome: mocks.outcome }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.human }));
vi.mock("@/lib/auth/oauth-tokens", () => ({ OAUTH_EXECUTION_AUTHORITY_SELECT: {}, isCurrentOAuthExecutionAuthority: mocks.currentConsent }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.access }));
vi.mock("./packs/backlog-pack-read-tools", () => ({ getBacklogItem: mocks.item }));
vi.mock("@/lib/backlog/initiative-readiness/terminal-recovery", () => ({ resolveTerminalInitiativeRecovery: mocks.recovery }));

import { authorizeCoworkerRequest } from "./independent-review-request";
import type { ToolExecutionContext } from "@/lib/mcp-tools";
import { remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";
import type { InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";

const binding: InitiativeReviewBinding = { writerToolName: "record_initiative_post_implementation_review", itemId: "BI-TEST", gate: "post-implementation-review",
  expectedCurrentBaselineId: null,
  workroomRef: { kind: "workroom-head", workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "fix/test", headSha: "a".repeat(40) },
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40), path: "src/test.ts", providerBlobId: "b".repeat(40) } };
const packet = { targetAgent: "AGT-REVIEWER", objective: "Review the exact repair", questionPacketSummary: "Independent repair review",
  requestKey: "review:immutable", tier: 2, enteredVia: "handoff",
  requiredToolNames: ["read_source_at_version", binding.writerToolName], initiativeReviewBinding: binding };
const context: ToolExecutionContext = { agentId: "AGT-AUTHOR", apiTokenId: "access-1", authSource: "oauth",
  tokenScope: "write", tokenGrantScopes: ["initiative_evidence_write"], userContext: { isSuperuser: true, platformRole: null } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [{ grantKey: "initiative_evidence_write" }] });
  mocks.token.mockResolvedValue({ userId: "human", agentId: "AGT-AUTHOR", authorityBindingId: "consent", oauthClient: { registrationKind: "dynamic" } });
  mocks.currentConsent.mockResolvedValue(true);
  mocks.human.mockResolvedValue({ isSuperuser: true, platformRole: null });
  mocks.room.mockResolvedValue({ id: "room-row" });
  mocks.access.mockResolvedValue({ decision: { level: "action" } });
  mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { completion: {
    verdict: "input-required", subject: { id: "BI-TEST" }, unmet: [], blockers: [],
  } } } } });
  mocks.recovery.mockResolvedValue({ reviewerRoutes: [{ independent: true, requestCoworker: packet }] });
  mocks.authorityKey.mockResolvedValue("oauth-family:consent-family");
  mocks.task.mockResolvedValue(null);
});

describe("consent-bound independent review request", () => {
  it("accepts only a regenerated packet after current human, consent, grants and exact room checks", async () => {
    expect(await authorizeCoworkerRequest(packet, "human", context)).toEqual({ bounded: true });
    expect(mocks.access).toHaveBeenCalledWith({ userId: "human", agentId: "AGT-AUTHOR", workroomId: "room-row", requested: "action" });
    expect(mocks.recovery).toHaveBeenCalledWith(expect.objectContaining({ currentAgentId: "AGT-AUTHOR", refusedWorkroomId: "WC-TEST" }));
  });
  it.each([
    ["arbitrary work", { objective: "deploy production" }],
    ["another reviewer", { targetAgent: "AGT-OTHER" }],
    ["self review", { targetAgent: "AGT-AUTHOR" }],
    ["changed key", { requestKey: "different" }],
    ["extra tool", { requiredToolNames: [...packet.requiredToolNames, "deploy"] }],
    ["portal override", { threadId: "another-thread" }],
    ["extra dispatch depth", { tier: 3 }],
    ["changed blob", { initiativeReviewBinding: { ...binding, artifactRef: { ...binding.artifactRef, providerBlobId: "c".repeat(40) } } }],
    ["sibling room", { initiativeReviewBinding: { ...binding, workroomRef: { ...binding.workroomRef, workroomId: "WC-SIBLING" } } }],
  ])("rejects %s", async (_label, change) => {
    expect((await authorizeCoworkerRequest({ ...packet, ...change }, "human", context)).refusal?.success).toBe(false);
  });
  it.each(["pat", "client_credentials", "read-only", "revoked-consent", "other-user", "other-agent", "missing-binding", "revoked-grant", "revoked-human", "unadmitted-room", "closed-gate"])("rejects %s", async (condition) => {
    const ctx = { ...context };
    if (condition === "pat") ctx.authSource = "pat";
    if (condition === "client_credentials") mocks.token.mockResolvedValue({ userId: "human", agentId: "AGT-AUTHOR", authorityBindingId: "consent", oauthClient: { registrationKind: "credentials" } });
    if (condition === "read-only") ctx.tokenScope = "read";
    if (condition === "revoked-consent") mocks.currentConsent.mockResolvedValue(false);
    if (condition === "other-user") mocks.token.mockResolvedValue({ userId: "different" });
    if (condition === "other-agent") mocks.token.mockResolvedValue({ userId: "human", agentId: "other" });
    if (condition === "missing-binding") mocks.token.mockResolvedValue({ userId: "human", agentId: "AGT-AUTHOR" });
    if (condition === "revoked-grant") mocks.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [] });
    if (condition === "revoked-human") mocks.human.mockResolvedValue({ isSuperuser: false, platformRole: null });
    if (condition === "unadmitted-room") mocks.access.mockResolvedValue({ decision: { level: "none" } });
    if (condition === "closed-gate") mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { completion: { verdict: "allowed" } } } } });
    expect((await authorizeCoworkerRequest(packet, "human", ctx)).refusal?.success).toBe(false);
  });
  // BI-817556D8: design-phase packets (plan-review, spec-approval,
  // architecture-review) are already issued through the completion recovery;
  // pin that an exact one is accepted and an altered or unissued one is not.
  it("accepts an exact design-phase packet issued by the implementation or plan decision", async () => {
    const planBinding = { ...binding, writerToolName: "record_initiative_design_review", gate: "plan-review" };
    const planPacket = { ...packet, requestKey: "plan-review:immutable", initiativeReviewBinding: planBinding,
      requiredToolNames: ["record_initiative_design_review", "read_source_at_version"] };
    const pending = { verdict: "input-required", subject: { id: "BI-TEST" }, unmet: [], blockers: [] };
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: {
      plan: { verdict: "allowed" }, implementation: pending, completion: pending } } } });
    mocks.recovery.mockImplementation(async ({ decision }) => ({ reviewerRoutes: decision === pending
      ? [{ independent: true, requestCoworker: planPacket }] : [] }));
    expect(await authorizeCoworkerRequest(planPacket, "human", context)).toEqual({ bounded: true });
    expect((await authorizeCoworkerRequest({ ...planPacket, objective: "altered" }, "human", context)).refusal?.success).toBe(false);
    mocks.recovery.mockResolvedValue({ reviewerRoutes: [] });
    expect((await authorizeCoworkerRequest(planPacket, "human", context)).refusal?.success).toBe(false);
  });
  it("tells a caller without an acting coworker which connection it needs", async () => {
    const refusal = (await authorizeCoworkerRequest(packet, "human", { ...context, agentId: undefined, authSource: "pat" })).refusal;
    expect(refusal?.message).toMatch(/OAuth/);
    expect(refusal?.message).toMatch(/coworker/);
  });
  it("does not permit author-owned evidence through the independent-review lane", async () => {
    expect((await authorizeCoworkerRequest({ ...packet, initiativeReviewBinding: { ...binding,
      writerToolName: "record_initiative_evidence", gate: "research" } }, "human", context)).refusal?.success).toBe(false);
  });
  it("preserves the general lane only when both token and current coworker have thread_write", async () => {
    mocks.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [{ grantKey: "thread_write" }] });
    expect(await authorizeCoworkerRequest({ objective: "general" }, "human", { ...context, tokenGrantScopes: ["thread_write"] })).toEqual({ bounded: false });
    expect((await authorizeCoworkerRequest({ objective: "general" }, "human", context)).refusal?.success).toBe(false);
  });
  it("retains the same packet across credential refresh and concurrent room requests", async () => {
    expect(await authorizeCoworkerRequest(packet, "human", { ...context, apiTokenId: "access-2", threadId: "portal-context" })).toEqual({ bounded: true });
    const other = { ...packet, requestKey: "other-room", initiativeReviewBinding: { ...binding, workroomRef: { ...binding.workroomRef, workroomId: "WC-SECOND" } } };
    mocks.recovery.mockResolvedValueOnce({ reviewerRoutes: [{ independent: true, requestCoworker: other }] });
    expect(await authorizeCoworkerRequest(other, "human", context)).toEqual({ bounded: true });
    expect(mocks.recovery).toHaveBeenLastCalledWith(expect.objectContaining({ refusedWorkroomId: "WC-SECOND" }));
  });
  it("replays a finished review after refresh only with the same persisted request and a real writer receipt", async () => {
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { completion: { verdict: "allowed" } } } } });
    mocks.task.mockResolvedValue({ a2aMetadata: { requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest({
      agentId: packet.targetAgent, routeContext: "/build", title: packet.questionPacketSummary,
      objective: packet.objective, prompt: packet.objective, idempotencyKey: packet.requestKey,
      riskClass: "bounded-write", collaborationKind: "handoff", initiativeReviewBinding: binding,
      authorityScope: ["initiative_evidence_write", "backlog-item:BI-TEST", ...packet.requiredToolNames.map((name) => `tool:${name}`)],
    }) } });
    mocks.outcome.mockResolvedValue({ kind: "receipt", summary: "Independent review recorded" });
    expect(await authorizeCoworkerRequest(packet, "human", { ...context, apiTokenId: "refreshed" })).toEqual({ bounded: true });
    mocks.outcome.mockResolvedValue(null);
    expect((await authorizeCoworkerRequest(packet, "human", context)).refusal?.success).toBe(false);
    mocks.outcome.mockResolvedValue({ kind: "receipt" });
    expect((await authorizeCoworkerRequest({ ...packet, objective: "altered" }, "human", context)).refusal?.success).toBe(false);
  });
});

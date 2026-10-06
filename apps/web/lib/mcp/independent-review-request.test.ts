import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ agent: vi.fn(), token: vi.fn(), room: vi.fn(),
  human: vi.fn(), currentConsent: vi.fn(), access: vi.fn(), item: vi.fn(), recovery: vi.fn(),
  task: vi.fn(), authorityKey: vi.fn(), outcome: vi.fn(), itemRow: vi.fn(), alias: vi.fn(), buildStudioRoutes: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {
  agent: { findUnique: mocks.agent }, mcpApiToken: { findUnique: mocks.token },
  workroom: { findFirst: mocks.room },
  taskRun: { findFirst: mocks.task },
  backlogItem: { findUnique: mocks.itemRow },
  principalAlias: { findFirst: mocks.alias },
} }));
vi.mock("@/lib/backlog/initiative-readiness/build-studio-owed-routes", () => ({
  BUILD_STUDIO_ASSISTANT_AGENT_ID: "AGT-WS-BUILD", buildStudioOwedRoutes: mocks.buildStudioRoutes }));
vi.mock("@/lib/auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: mocks.authorityKey }));
vi.mock("@/lib/mcp-task-review-outcome", () => ({ loadTaskInitiativeReviewOutcome: mocks.outcome }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.human }));
vi.mock("@/lib/auth/oauth-tokens", () => ({ OAUTH_EXECUTION_AUTHORITY_SELECT: {}, isCurrentOAuthExecutionAuthority: mocks.currentConsent }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.access }));
vi.mock("./packs/backlog-pack-read-tools", () => ({ getBacklogItem: mocks.item }));
vi.mock("@/lib/backlog/initiative-readiness/terminal-recovery", () => ({ resolveTerminalInitiativeRecovery: mocks.recovery }));

import { authorizeCoworkerRequest } from "./independent-review-request";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
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
  mocks.room.mockResolvedValue({ id: "room-row", backlogItemId: "BI-TEST", executorKind: "claude-desktop", requestedByPrincipalId: "prn-human" });
  mocks.itemRow.mockResolvedValue({ id: "cuid-item" });
  mocks.alias.mockResolvedValue({ principalId: "prn-human" });
  mocks.access.mockResolvedValue({ decision: { level: "action" } });
  mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { completion: {
    verdict: "input-required", subject: { id: "BI-TEST" }, unmet: [], blockers: [],
  } } } } });
  mocks.recovery.mockResolvedValue({ reviewerRoutes: [{ independent: true, requestCoworker: packet }] });
  mocks.authorityKey.mockResolvedValue("oauth-family:consent-family");
  mocks.task.mockResolvedValue(null);
});

describe("consent-bound independent review request", () => {
  it("source-only proof requires platform scope and exact issuance even with general delegation", async () => {
    const design = { ...packet, initiativeReviewBinding: { ...binding, writerToolName: "record_initiative_design_review", gate: "design-spec" },
      requiredToolNames: ["read_source_at_version", "record_initiative_design_review"] };
    const implementation = { target: "implementation", verdict: "input-required", subject: { id: "BI-TEST" }, blockers: [],
      unmet: [{ code: "CANONICAL_DESIGN_REQUIRED", accountableRole: "design-checklist-reviewer" }] };
    mocks.item.mockResolvedValue({ success: true, data: { scopeKind: "platform", readiness: { decisions: { implementation } } } });
    mocks.recovery.mockResolvedValue({ reviewerRoutes: [{ independent: true, requestCoworker: design }] });
    mocks.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [{ grantKey: "thread_write" }, { grantKey: "initiative_evidence_write" }] });
    const ctx = { ...context, tokenGrantScopes: ["thread_write", "initiative_evidence_write"] };
    expect(await authorizeCoworkerRequest(design, "human", ctx, { sourceOnly: true })).toEqual({ bounded: true });
    expect((await authorizeCoworkerRequest({ ...design, objective: "customer evidence" }, "human", ctx, { sourceOnly: true })).refusal).toBeDefined();
    mocks.item.mockResolvedValue({ success: true, data: { scopeKind: "organization", readiness: { decisions: { implementation } } } });
    expect((await authorizeCoworkerRequest(design, "human", ctx, { sourceOnly: true })).refusal).toBeDefined();
    expect((await authorizeCoworkerRequest(packet, "human", ctx, { sourceOnly: true })).refusal).toBeDefined();
  });
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
  // Pin exact equality for the implementation decision, independently of the
  // later completion obligations (BI-817556D8, BI-CF118B6D).
  it("accepts an exact design-phase packet issued by the implementation or plan decision", async () => {
    const planBinding = { ...binding, writerToolName: "record_initiative_design_review", gate: "plan-review" };
    const planPacket = { ...packet, requestKey: "plan-review:immutable", initiativeReviewBinding: planBinding,
      requiredToolNames: ["record_initiative_design_review", "read_source_at_version"] };
    const pending = { target: "implementation", verdict: "input-required", subject: { id: "BI-TEST" },
      unmet: [{ code: "PLAN_REVIEW_REQUIRED", accountableRole: "plan-reviewer" }], blockers: [] };
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: {
      plan: { verdict: "allowed" }, implementation: pending, completion: pending } } } });
    mocks.recovery.mockImplementation(async ({ decision }) => ({ reviewerRoutes: decision.target === "implementation"
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
  it.each([
    ["design-spec", "record_initiative_design_review", "CANONICAL_DESIGN_REQUIRED"],
    ["spec-approval", "record_initiative_design_review", "SPEC_APPROVAL_REQUIRED"],
    ["architecture-review", "record_initiative_architecture_review", "REVIEW_REQUIRED"],
    ["plan-review", "record_initiative_design_review", "PLAN_REVIEW_REQUIRED"],
  ])("routes %s without unrelated completion/research prerequisites swallowing its packet", async (gate, writerToolName, code) => {
    const reviewPacket = { ...packet, initiativeReviewBinding: { ...binding, gate, writerToolName },
      requiredToolNames: [writerToolName, "read_source_at_version"] };
    const implementation = { target: "implementation", verdict: "input-required", subject: { id: "BI-TEST" },
      blockers: [], unmet: [{ code, accountableRole: "design-checklist-reviewer" },
        { code: "RESEARCH_REQUIRED", accountableRole: "design-author" }] };
    const completion = { ...implementation, target: "completion", unmet: [...implementation.unmet,
      { code: "ACCEPTANCE_EVIDENCE_REQUIRED", accountableRole: "acceptance-reviewer" }] };
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { implementation, completion } } } });
    // Model the real recovery precedence: unresolved research blocks terminal
    // recovery before it ever reaches the independent design-review lanes.
    mocks.recovery.mockImplementation(async ({ decision }) => ({ reviewerRoutes:
      decision.unmet.some((entry: { code: string }) => entry.code === "RESEARCH_REQUIRED")
        ? [] : [{ independent: true, requestCoworker: reviewPacket }] }));
    expect(await authorizeCoworkerRequest(reviewPacket, "human", context)).toEqual({ bounded: true });
    expect(mocks.recovery).toHaveBeenCalledWith(expect.objectContaining({
      decision: expect.objectContaining({ target: "implementation", unmet: [{ code, accountableRole: "design-checklist-reviewer" }] }),
    }));
    expect((await authorizeCoworkerRequest({ ...reviewPacket, objective: "forged" }, "human", context)).refusal?.success).toBe(false);
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

describe("Build Studio rooms (BI-926A7E90)", () => {
  const revisionBinding: InitiativeReviewBinding = { writerToolName: "record_initiative_design_review", itemId: "BI-TEST", gate: "spec-approval",
    expectedCurrentBaselineId: null,
    workroomRef: { kind: "workroom-head", workroomId: "WC-BS", repositoryFullName: "org/repo", branchName: "build/FB-1", headSha: "sha256:design" },
    artifactRef: { kind: "feature-build-revision", repositoryFullName: "org/repo", revisionId: "rev_1", valueDigest: "sha256:design" } };
  const revisionPacket = { targetAgent: "AGT-REVIEWER", objective: "Review the design revision", questionPacketSummary: "spec-approval for BI-TEST",
    requestKey: "initiative-readiness:BI-TEST:spec-approval:sha256:design", tier: 2, enteredVia: "handoff",
    requiredToolNames: ["record_initiative_design_review", "read_build_artifact_revision"], initiativeReviewBinding: revisionBinding };
  const implementation = { target: "implementation", verdict: "input-required", subject: { id: "BI-TEST" }, blockers: [],
    unmet: [{ code: "SPEC_APPROVAL_REQUIRED", accountableRole: "design-checklist-reviewer" }] };

  beforeEach(() => {
    mocks.room.mockResolvedValue({ id: "room-bs", backlogItemId: "cuid-item", executorKind: "build-studio", requestedByPrincipalId: null, featureBuild: { createdById: "human" } });
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { implementation } } } });
    mocks.buildStudioRoutes.mockResolvedValue({ routed: true, routes: [{ workroomId: "WC-BS", requestCoworker: revisionPacket }] });
  });

  it("accepts the dispatcher's own packet on a connection of the person who requested the build, keyed by the item's row id", async () => {
    expect(await authorizeCoworkerRequest(revisionPacket, "human", context)).toEqual({ bounded: true });
    expect(mocks.buildStudioRoutes).toHaveBeenCalledWith({ itemId: "BI-TEST", capsuleId: "WC-BS", authorAgentId: "AGT-WS-BUILD" });
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.recovery).not.toHaveBeenCalled();
  });

  it("refuses a connection that is not the requesting person's, and a packet the resolver did not issue", async () => {
    mocks.room.mockResolvedValue({ id: "room-bs", backlogItemId: "cuid-item", executorKind: "build-studio", requestedByPrincipalId: "prn-human", featureBuild: { createdById: "someone-else" } });
    mocks.alias.mockResolvedValue({ principalId: "prn-other" });
    expect((await authorizeCoworkerRequest(revisionPacket, "human", context)).refusal?.message).toContain("person who requested this Build Studio build");
    mocks.alias.mockResolvedValue({ principalId: "prn-human" });
    mocks.buildStudioRoutes.mockResolvedValue({ routed: true, routes: [] });
    expect((await authorizeCoworkerRequest(revisionPacket, "human", context)).refusal?.message).toContain("changed or is no longer eligible");
  });
});

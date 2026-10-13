import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), token: vi.fn(), room: vi.fn(), human: vi.fn(),
  consent: vi.fn(), access: vi.fn(), item: vi.fn(), recovery: vi.fn(), task: vi.fn(), source: vi.fn(), outcome: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { agent: { findUnique: mocks.agent }, mcpApiToken: { findUnique: mocks.token },
  workroom: { findFirst: mocks.room }, taskRun: { findFirst: mocks.task } } }));
vi.mock("@/lib/backlog/initiative-readiness/build-studio-owed-routes", () => ({ BUILD_STUDIO_ASSISTANT_AGENT_ID: "build", buildStudioOwedRoutes: vi.fn() }));
vi.mock("@/lib/auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: async () => "authority" }));
vi.mock("@/lib/mcp-task-review-outcome", () => ({ loadTaskInitiativeReviewOutcome: mocks.outcome }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.human }));
vi.mock("@/lib/auth/oauth-tokens", () => ({ OAUTH_EXECUTION_AUTHORITY_SELECT: {}, isCurrentOAuthExecutionAuthority: mocks.consent }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.access }));
vi.mock("./packs/backlog-pack-read-tools", () => ({ getBacklogItem: mocks.item }));
vi.mock("@/lib/backlog/initiative-readiness/terminal-recovery", () => ({ resolveTerminalInitiativeRecovery: mocks.recovery }));
vi.mock("@/lib/backlog/initiative-readiness/artifact-resolver", () => ({ resolveInitiativeArtifact: mocks.source }));
import { authorizeCoworkerRequest } from "./independent-review-request";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
import { remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";
import type { InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";

const binding: InitiativeReviewBinding = { writerToolName: "record_initiative_design_review", itemId: "BI-DOC", gate: "spec-approval",
  workroomRef: { kind: "workroom-head", workroomId: "WC-DOC", repositoryFullName: "org/repo", branchName: "fix/scope", headSha: "a".repeat(40) },
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40),
    path: "docs/superpowers/specs/design.md", providerBlobId: "b".repeat(40) } };
const packet = { targetAgent: "AGT-REVIEWER", objective: "Review the immutable design", questionPacketSummary: "Scope review",
  requestKey: "review:document", tier: 2, enteredVia: "handoff",
  requiredToolNames: ["read_source_at_version", binding.writerToolName], initiativeReviewBinding: binding };
const context: ToolExecutionContext = { agentId: "AGT-AUTHOR", apiTokenId: "token", authSource: "oauth",
  tokenScope: "write", tokenGrantScopes: ["initiative_evidence_write"] };
const sourceText = (statement: string) => `**OBJ-1:** Keep source.\n\n| ID | Objectives | Criterion |\n| --- | --- | --- |\n| AC-1 | OBJ-1 | ${statement} |`;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [{ grantKey: "initiative_evidence_write" }] });
  mocks.token.mockResolvedValue({ userId: "human", agentId: "AGT-AUTHOR", authorityBindingId: "consent", oauthClient: { registrationKind: "dynamic" } });
  mocks.consent.mockResolvedValue(true);
  mocks.human.mockResolvedValue({ isSuperuser: true, platformRole: null });
  mocks.room.mockResolvedValue({ id: "room", backlogItemId: "BI-DOC", executorKind: "codex-desktop" });
  mocks.access.mockResolvedValue({ decision: { level: "action" } });
  mocks.item.mockResolvedValue({ success: true, data: { scopeKind: "platform", readiness: { decisions: { implementation: {
    verdict: "input-required", subject: { id: "BI-DOC" }, blockers: [], unmet: [{ code: "SPEC_APPROVAL_REQUIRED" }],
  } } } } });
  mocks.recovery.mockResolvedValue({ reviewerRoutes: [{ independent: true, requestCoworker: packet }] });
  mocks.task.mockResolvedValue(null);
  mocks.source.mockResolvedValue({ ok: true, artifact: { digest: "sha256:source", bytes: Buffer.from(sourceText("Keep A \\| B.")) } });
});

it("validates the exact scope after authorization and before admitting new paid review work", async () => {
  mocks.source.mockResolvedValueOnce({ ok: true, artifact: { digest: "sha256:source", bytes: Buffer.from(sourceText("Keep A | B.")) } });
  expect((await authorizeCoworkerRequest(packet, "human", context)).refusal)
    .toMatchObject({ success: false, error: "manifest-invalid", data: { gateStatus: "unrun" }, message: expect.stringContaining("line 5") });
  expect(await authorizeCoworkerRequest(packet, "human", context)).toEqual({ bounded: true });
});

it.each(["consent", "human", "access", "packet"])("does not read protected document bytes when %s authority fails", async failure => {
  if (failure === "consent") mocks.consent.mockResolvedValue(false);
  if (failure === "human") mocks.human.mockResolvedValue({ isSuperuser: false, platformRole: null });
  if (failure === "access") mocks.access.mockResolvedValue({ decision: { level: "none" } });
  const request = failure === "packet" ? { ...packet, objective: "forged" } : packet;
  expect((await authorizeCoworkerRequest(request, "human", context)).refusal).toBeDefined();
  expect(mocks.source).not.toHaveBeenCalled();
});

it("retries the same request after a provider outage without inventing a review verdict", async () => {
  mocks.source.mockRejectedValueOnce(new Error("DNS unavailable"));
  expect((await authorizeCoworkerRequest(packet, "human", context)).refusal)
    .toMatchObject({ error: "IMMUTABLE_SOURCE_UNAVAILABLE", data: { gateStatus: "unrun" } });
  expect(await authorizeCoworkerRequest(packet, "human", context)).toEqual({ bounded: true });
});

it("joins matching existing work without depending on provider availability", async () => {
  mocks.task.mockResolvedValue({ a2aMetadata: { requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest({
    agentId: packet.targetAgent, routeContext: "/build", title: packet.questionPacketSummary,
    objective: packet.objective, prompt: packet.objective, idempotencyKey: packet.requestKey,
    riskClass: "bounded-write", collaborationKind: "handoff", initiativeReviewBinding: binding,
    authorityScope: ["initiative_evidence_write", "backlog-item:BI-DOC", ...packet.requiredToolNames.map(name => `tool:${name}`)],
  }) } });
  mocks.source.mockRejectedValue(new Error("DNS unavailable"));
  expect(await authorizeCoworkerRequest(packet, "human", context)).toEqual({ bounded: true });
  expect(mocks.source).not.toHaveBeenCalled();
});

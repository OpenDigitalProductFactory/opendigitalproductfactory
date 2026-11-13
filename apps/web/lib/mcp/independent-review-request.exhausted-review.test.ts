vi.mock("@/lib/mcp-task-review-recovery", () => ({ issueOriginalReviewRecoveryTarget: async () => ({ kind: "none" }) }));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ agent: vi.fn(), token: vi.fn(), room: vi.fn(),
  human: vi.fn(), currentConsent: vi.fn(), access: vi.fn(), item: vi.fn(), recovery: vi.fn(),
  task: vi.fn(), authorityKey: vi.fn(), outcome: vi.fn(), itemRow: vi.fn(), alias: vi.fn(), buildStudioRoutes: vi.fn(),
  preflight: vi.fn() }));
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
// This suite isolates authorization and exact issuance. The companion document
// suite exercises the real parser and preflight after these checks succeed.
vi.mock("@/lib/mcp-task-review-document", () => ({ reviewDocumentPreflight: mocks.preflight }));

import { authorizeCoworkerRequest } from "./independent-review-request";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
import { deterministicExternalTaskRunId, remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";
import type { InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { resolveInitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { createExhaustedPlanReviewPredicate } from "@/lib/backlog/initiative-readiness/exhausted-plan-review";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";

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
  mocks.room.mockResolvedValue({ id: "room-row", backlogItemId: "BI-TEST", executorKind: "claude-desktop", requestedByPrincipalId: "prn-human",
    repositoryFullName: "org/repo", headBranch: "fix/test", baseSha: "c".repeat(40), headSha: "a".repeat(40) });
  mocks.itemRow.mockResolvedValue({ id: "cuid-item" });
  mocks.alias.mockResolvedValue({ principalId: "prn-human" });
  mocks.access.mockResolvedValue({ decision: { level: "action" } });
  mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { completion: {
    verdict: "input-required", subject: { id: "BI-TEST" }, unmet: [], blockers: [],
  } } } } });
  mocks.recovery.mockResolvedValue({ reviewerRoutes: [{ independent: true, requestCoworker: packet }] });
  mocks.authorityKey.mockResolvedValue("oauth-family:consent-family");
  mocks.task.mockResolvedValue(null);
  mocks.preflight.mockResolvedValue({ refusal: null, notice: null });
});

describe("owned exhausted independent review authorization", () => {
  it.each([
    ["PLAN_REVIEW_REQUIRED", "plan-reviewer", "initiative_design_review"],
    ["CANONICAL_DESIGN_REQUIRED", "design-checklist-reviewer", "initiative_design_review"],
    ["SPEC_APPROVAL_REQUIRED", "design-checklist-reviewer", "initiative_design_review"],
    ["REVIEW_REQUIRED", "architecture-reviewer", "initiative_architecture_review"],
  ] as const)("authorizes the issued alternate for %s using the same owned history", async (code, accountableRole, grant) => {
    const implementation: InitiativeReadinessDecision = {
      decisionId: "IRD-PLAN", policyVersion: "initiative-readiness.v3", subject: { kind: "backlog-item", id: "BI-TEST" },
      transitionObject: { kind: "work-capsule", id: "WC-TEST", expectedVersion: "claim.v1", targetState: "implementation" },
      profile: "fix", target: "implementation", verdict: "input-required", satisfied: [], blockers: [],
      unmet: [readinessRequirement({ code, state: "missing", accountableRole })],
      evaluatedAt: "2026-10-12T20:00:00Z",
    };
    const input = { decision: implementation, currentAgentId: "AGT-AUTHOR", expectedCurrentBaselineId: "BASE-1",
      dispatchContext: { workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "fix/test", headSha: "a".repeat(40) },
      canonicalArtifact: { resolved: true as const, path: "docs/superpowers/specs/recovery.md", providerBlobId: "c".repeat(40) },
      planArtifact: { resolved: true as const, path: "docs/superpowers/plans/recovery.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(["AGT-FIRST", "AGT-NEXT"].flatMap(agentId => [grant, "file_read"].map(grantKey => ({
        grantKey, agent: { agentId, displayName: agentId, status: "active", archived: false, lifecycleStage: "production" },
      })))) } },
    };
    const old = (await resolveInitiativeReviewerRecovery(input)).reviewerRoutes[0]!.requestCoworker;
    const scope = ["initiative_evidence_write", "backlog-item:BI-TEST", ...old.requiredToolNames!.map(name => `tool:${name}`)];
    const authority = { userId: "human", taskAuthorityKey: "oauth-family:consent-family" };
    const taskRunId = deterministicExternalTaskRunId(authority.taskAuthorityKey, old.requestKey);
    mocks.task.mockImplementation(async ({ where }) => where.taskRunId === taskRunId ? {
      taskRunId, userId: "human", currentAgentId: "AGT-FIRST", status: "input-required", authorityScope: scope,
      a2aMetadata: { taskAuthorityKey: authority.taskAuthorityKey, idempotencyKey: old.requestKey, requestedAgentId: "AGT-FIRST",
        requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest({ agentId: old.targetAgent, routeContext: "/build",
          title: old.questionPacketSummary, objective: old.objective, prompt: old.objective, idempotencyKey: old.requestKey,
          riskClass: "bounded-write", authorityScope: scope, collaborationKind: "handoff", initiativeReviewBinding: old.initiativeReviewBinding }) },
      progressPayload: { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer", writerToolName: old.initiativeReviewBinding!.writerToolName,
        resumeMode: "same-taskrun", dispatchContract: "required-tool-call", attempt: 3, observedAt: "2026-10-12T20:00:00Z" } },
    } : null);
    const issue = (taskAuthority: typeof authority) => resolveInitiativeReviewerRecovery({ ...input,
      isPlanReviewExhausted: createExhaustedPlanReviewPredicate(taskAuthority, { taskRun: { findFirst: mocks.task } }) });
    const alternate = (await issue(authority)).reviewerRoutes[0]!.requestCoworker;
    expect(alternate.targetAgent).toBe("AGT-NEXT");
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { implementation } } } });
    mocks.recovery.mockImplementation(({ taskAuthority }) => issue(taskAuthority));
    expect(await authorizeCoworkerRequest(alternate, "human", context)).toEqual({ bounded: true });
    expect((await authorizeCoworkerRequest(old, "human", context)).refusal).toBeDefined();
    expect((await authorizeCoworkerRequest({ ...alternate, requestKey: old.requestKey }, "human", context)).refusal).toBeDefined();
  });
});

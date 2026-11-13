import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ predecessors: vi.fn(), currentAuthority: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("./mcp-task-reassessment-lineage", () => ({ collectReviewCreationPredecessors: mocks.predecessors }));
vi.mock("./auth/oauth-tokens", () => ({ OAUTH_EXECUTION_AUTHORITY_SELECT: {}, isCurrentOAuthExecutionAuthority: mocks.currentAuthority }));
import { lockInitiativeReviewCreationSubject } from "./mcp-task-review-reassessment";
import { deterministicExternalTaskRunId, remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";

const binding = { itemId: "BI-FIXTURE", gate: "architecture-review", writerToolName: "record_initiative_architecture_review",
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "fixture/repository", commitSha: "a".repeat(40),
    path: "docs/design.md", providerBlobId: "b".repeat(40) },
  workroomRef: { kind: "workroom-head", workroomId: "WC-FIXTURE", repositoryFullName: "fixture/repository",
    branchName: "codex/fixture", headSha: "a".repeat(40) } };
const scope = ["file_read", "backlog-item:BI-FIXTURE", "tool:read_source_at_version", "tool:record_initiative_architecture_review"];
function request(agent: string, key: string) {
  const parsed = parseRemoteTaskSubmitParams({ agentId: agent, routeContext: "/build", title: "Review",
    objective: "Review this unchanged artifact.", prompt: "Review this unchanged artifact.",
    idempotencyKey: key, collaborationKind: "handoff", riskClass: "bounded-write", authorityScope: scope,
    initiativeReviewBinding: binding });
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
}
function fixture() {
  const family = "oauth-family:fixture", oldKey = "review-fixture-original", oldAgent = "reviewer-fixture-old";
  const old = request(oldAgent, oldKey);
  const parsed = request("reviewer-fixture-new", `${oldKey}:reviewer:${createHash("sha256").update("reviewer-fixture-new").digest("hex")}`);
  const predecessor = { id: "row-fixture", taskRunId: deterministicExternalTaskRunId(family, oldKey),
    userId: "human", currentAgentId: oldAgent, parentTaskRunId: null, status: "input-required",
    requestDigest: remoteTaskRequestDigest(old), binding: old.initiativeReviewBinding!, authorityScope: scope,
    a2aMetadata: { trigger: "external-mcp", tokenSource: "oauth", tokenCapability: "write", taskAuthorityKey: family,
      apiTokenId: "token-fixture", idempotencyKey: oldKey, requestedAgentId: oldAgent,
      requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest(old), initiativeReviewBinding: old.initiativeReviewBinding },
    progressPayload: { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer", resumeMode: "same-taskrun",
      writerToolName: binding.writerToolName, dispatchContract: "required-tool-call", attempt: 3, observedAt: "2026-10-26T02:00:00.000Z" } } as Record<string, unknown>,
    updatedAt: "2026-10-26T02:00:00.000Z" };
  let locked = false;
  const tx = { $queryRaw: vi.fn(async () => { locked = true; return [{ id: "subject-fixture" }]; }),
    mcpApiToken: { findUnique: vi.fn(async (_args: { where: { id: string } }) => ({ userId: "human", agentId: "AGT-EXT-CODEX",
      capability: "write", scopes: ["file_read"], oauthFamilyKey: "fixture", authorityBindingId: "binding-fixture", oauthClient: { registrationKind: "dcr" } })) } };
  mocks.predecessors.mockImplementation(async () => {
    expect(locked).toBe(true);
    return [predecessor];
  });
  const authority = { userId: "human", taskAuthorityKey: family, tokenId: "token-current-fixture", parsed };
  return { tx, predecessor, authority, binding: parsed.initiativeReviewBinding! };
}
beforeEach(() => { vi.resetAllMocks(); mocks.currentAuthority.mockResolvedValue(true); });

it("admits the existing proven same-family exhausted alternate at the locked creation boundary", async () => {
  const f = fixture(), before = JSON.stringify(f.predecessor);
  await expect(lockInitiativeReviewCreationSubject(f.tx as never, f.binding, f.authority)).resolves.toBeUndefined();
  expect(JSON.stringify(f.predecessor)).toBe(before);
  expect(mocks.currentAuthority).toHaveBeenCalledWith(expect.objectContaining({ userId: "human", oauthFamilyKey: "fixture" }), f.tx);
});

it.each([["AGT-WS-EA", "ea-architect"], ["ea-architect", "AGT-WS-EA"]])(
  "refuses a second allocation to the same canonical reviewer through %s -> %s", async (savedAgent, targetAgent) => {
    const f = fixture(), original = request(savedAgent, "review-fixture-original");
    f.predecessor.currentAgentId = savedAgent;
    Object.assign(f.predecessor.a2aMetadata, { requestedAgentId: savedAgent, requestDigest: remoteTaskRequestDigest(original) });
    f.authority.parsed = request(targetAgent, `review-fixture-original:reviewer:${createHash("sha256").update(targetAgent).digest("hex")}`);
    await expect(lockInitiativeReviewCreationSubject(f.tx as never, f.binding, f.authority))
      .rejects.toMatchObject({ code: "reassessment-original-recovery-required" });
  });

it.each(["no-current-authority", "different-family", "current-family-changed", "revoked-current-authority", "current-token-scopes-narrowed", "different-requesting-actor",
  "same-reviewer", "counterfeit-current-alias", "changed-request", "widened-tools", "uncertain", "approval", "capacity", "writer-rejected", "quarantined", "present-allocation"])(
  "retains the locked predecessor barrier for %s history", async condition => {
    const f = fixture();
    let authority: typeof f.authority | undefined = f.authority;
    if (condition === "no-current-authority") authority = undefined;
    if (condition === "different-family") f.authority.taskAuthorityKey = "oauth-family:other";
    if (condition === "current-family-changed") f.tx.mcpApiToken.findUnique.mockResolvedValue({ userId: "human", agentId: "AGT-EXT-CODEX",
      capability: "write", scopes: ["file_read"], oauthFamilyKey: "changed", authorityBindingId: "binding-fixture", oauthClient: { registrationKind: "dcr" } });
    if (condition === "revoked-current-authority") mocks.currentAuthority.mockResolvedValue(false);
    if (condition === "current-token-scopes-narrowed") f.tx.mcpApiToken.findUnique.mockResolvedValue({ userId: "human", agentId: "AGT-EXT-CODEX",
      capability: "write", scopes: [], oauthFamilyKey: "fixture", authorityBindingId: "binding-fixture", oauthClient: { registrationKind: "dcr" } });
    if (condition === "different-requesting-actor") f.tx.mcpApiToken.findUnique.mockImplementation(async ({ where }) => ({ userId: "human",
      agentId: where.id === "token-fixture" ? "different-requesting-coworker" : "AGT-EXT-CODEX", capability: "write", scopes: ["file_read"],
      oauthFamilyKey: "fixture", authorityBindingId: "binding-fixture", oauthClient: { registrationKind: "dcr" } }));
    if (condition === "same-reviewer") f.authority.parsed.agentId = f.predecessor.currentAgentId;
    if (condition === "counterfeit-current-alias") f.authority.parsed.idempotencyKey = "review-fixture-original:reviewer:" + "f".repeat(64);
    if (condition === "changed-request") f.authority.parsed.prompt += " Changed.";
    if (condition === "widened-tools") f.authority.parsed.authorityScope?.push("tool:write_platform_config");
    if (condition === "uncertain") f.predecessor.progressPayload.executionUncertainty = { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown" };
    if (condition === "approval") f.predecessor.progressPayload.approvalEnvelopeId = "approval-fixture";
    if (condition === "capacity") Object.assign(f.predecessor.progressPayload.terminalWriterWait as object, { capacityDeferred: true });
    if (condition === "writer-rejected") Object.assign(f.predecessor.progressPayload.terminalWriterWait as object, {
      writerRejection: { schemaVersion: 1, error: "fixture", message: "Fixture rejection.", observedAt: f.predecessor.updatedAt } });
    if (condition === "quarantined") f.predecessor.progressPayload.reassessmentQuarantine = { schemaVersion: 1 };
    if (condition === "present-allocation") f.predecessor.binding = { ...f.predecessor.binding,
      presentReassessment: { schemaVersion: 1, authorizationItemId: "BI-AUTH", baselineId: "baseline-fixture",
        policyDigest: "c".repeat(64), originalTaskRunId: "TR-original-fixture", originalRequestDigest: "d".repeat(64),
        predecessorTaskRunIds: ["TR-original-fixture"], authorityArtifact: f.binding.artifactRef as never } };
    const before = JSON.stringify(f.predecessor);
    await expect(lockInitiativeReviewCreationSubject(f.tx as never, f.binding, authority))
      .rejects.toMatchObject({ code: "reassessment-original-recovery-required" });
    expect(JSON.stringify(f.predecessor)).toBe(before);
  });

import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ oauth: vi.fn(async () => true), human: vi.fn(), access: vi.fn(), budget: vi.fn(), usage: vi.fn(), policy: vi.fn(), compatibility: vi.fn(), lineage: vi.fn() }));
vi.mock("./auth/oauth-tokens", () => ({ OAUTH_EXECUTION_AUTHORITY_SELECT: {}, isCurrentOAuthExecutionAuthority: mocks.oauth }));
vi.mock("./govern/current-user-context", () => ({ currentUserContext: mocks.human }));
vi.mock("./work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.access }));
vi.mock("./inference/budget-gate", () => ({ readReassessmentBudgetConfiguration: mocks.budget, checkReassessmentBudget: mocks.usage }));
vi.mock("./mcp-task-review-reassessment", () => ({ revalidateApprovedReassessmentPolicy: mocks.policy }));
vi.mock("./mcp-task-reassessment-contract", () => ({ assertCurrentReassessmentContract: mocks.compatibility }));
vi.mock("./mcp-task-reassessment-lineage", () => ({ collectReassessmentLineage: mocks.lineage }));
import { createPresentReassessmentAuthority } from "./mcp-task-reassessment-authority";

function fixture(persisted = false) {
  vi.clearAllMocks(); mocks.oauth.mockResolvedValue(true); mocks.human.mockResolvedValue({ userId: "human", isSuperuser: true });
  mocks.access.mockResolvedValue({ decision: { level: "action" } });
  const budget = { configurationDigest: "current-budget", agentId: "AGT-WS-REVIEW" };
  mocks.budget.mockResolvedValue(budget); mocks.usage.mockResolvedValue({ status: "ok" });
  const scopes = ["backlog_read", "initiative_evidence_write", "initiative_design_review", "file_read"];
  const token = { userId: "human", agentId: "author", authorityBindingId: "consent", capability: "write", scopes, oauthClient: { registrationKind: "interactive" } };
  const actor = { agentId: "author", status: "active", archived: false, lifecycleStage: "production", toolGrants: scopes.map(grantKey => ({ grantKey })),
    toolGrantRevocations: [] as Array<{ grantKey: string }> };
  const reviewer = { ...actor, agentId: "AGT-WS-REVIEW", toolGrantRevocations: [] as Array<{ grantKey: string }> };
  const authority = { decision: "allow", actionKey: "request_coworker", humanContextRef: "human", agentContextRef: "author", authorityBindingId: "consent", organizationId: null };
  const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40), path: "docs/spec.md", providerBlobId: "b".repeat(40) };
  const binding = { itemId: "BI-285EF102", gate: "design-spec", writerToolName: "record_initiative_design_review", artifactRef,
    presentReassessment: { schemaVersion: 1, authorizationItemId: "BI-7906C73E", baselineId: "baseline-fixture", policyDigest: "c".repeat(64),
      originalTaskRunId: "TR-original", originalRequestDigest: "1".repeat(64), predecessorTaskRunIds: ["TR-original"], authorityArtifact: artifactRef },
    workroomRef: { kind: "workroom-head", workroomId: "WC-PARENT", repositoryFullName: "owner/repo", branchName: "branch", headSha: "a".repeat(40) } };
  const room = { id: "room", backlogItemId: "BI-285EF102", repositoryFullName: "owner/repo", headBranch: "branch", headSha: "a".repeat(40), archivedAt: null };
  const requestAuthority = { authorityDecisionId: "allow-request", actingAgentId: "author", tokenGrantScopes: [...scopes] };
  const root = { taskRunId: "TR-present", userId: "human", agentId: "AGT-WS-REVIEW", requestDigest: "e".repeat(64), binding,
    budgetConfiguration: budget, compatibility: {} };
  const task = { taskRunId: root.taskRunId, userId: root.userId, currentAgentId: root.agentId,
    a2aMetadata: { trigger: "external-mcp", apiTokenId: "token", tokenSource: "oauth", tokenCapability: "write",
      requestDigest: root.requestDigest, initiativeReviewBinding: structuredClone(binding),
      presentReviewAuthority: structuredClone(requestAuthority) as unknown } };
  const writerDecision = { decisionId: "allow-writer", decision: "allow", actionKey: binding.writerToolName,
    organizationId: null, rationale: { taskRunId: "TR-original" }, policyVersion: "coworker-authority.v1" };
  const tx = { mcpApiToken: { findUnique: vi.fn(async () => token) }, agent: { findUnique: vi.fn(async ({ where }: { where: { agentId: string } }) => where.agentId === "author" ? actor : reviewer) },
    authorizationDecisionLog: { findUnique: vi.fn(async ({ where }: { where: { decisionId: string } }) => where.decisionId === requestAuthority.authorityDecisionId ? authority : writerDecision) },
    workroom: { findUnique: vi.fn(async () => room), findMany: vi.fn(async () => [{ id: "authority-room" }]) },
    backlogItem: { findUnique: vi.fn(async () => ({ id: "subject", organizationId: null })) },
    taskRun: { findUnique: vi.fn(async (): Promise<typeof task | null> => task) },
    coworkerActionEnvelope: { findMany: vi.fn(async (): Promise<Array<{ taskRunId: string | null }>> => []) },
    backlogItemActivity: { findMany: vi.fn(async (): Promise<Array<{ id: string; payload: Record<string, unknown> }>> => []) } };
  const proof = { subjectRowId: "subject", authorizationRowId: "authorization", authorizationItemId: "BI-7906C73E", policy: { subjectItemId: "BI-285EF102" } };
  const context = { parsed: { agentId: "AGT-WS-REVIEW", authorityScope: [...scopes, "backlog-item:BI-285EF102",
    "tool:read_source_at_version", "tool:record_initiative_design_review"], initiativeReviewBinding: binding }, proof,
    originals: [{ taskRunId: "TR-original", requestDigest: "1".repeat(64) }, { taskRunId: "TR-original-approval", requestDigest: "2".repeat(64) }],
    snapshot: { rows: [] as Array<{ binding: { presentReassessment?: unknown; writerToolName: string }; progressPayload: unknown }> },
    root: persisted ? root : undefined };
  const validate = createPresentReassessmentAuthority({ token: { tokenId: "token", userId: "human", source: "oauth", capability: "write" },
    requestAuthority, budgetConfiguration: budget, compatibility: {} } as never);
  return { tx, validate, context, authority, token, actor, reviewer, room, task, root, requestAuthority, writerDecision };
}

function freshLineageFixture() {
  const f = fixture(true);
  delete (f.context as { snapshot?: unknown }).snapshot;
  const own = { taskRunId: f.root.taskRunId, requestDigest: f.root.requestDigest, userId: f.root.userId,
    currentAgentId: f.root.agentId, binding: f.context.parsed.initiativeReviewBinding, progressPayload: null as unknown, status: "working" };
  const snapshot = { rows: [own], subjectRowId: "subject" };
  mocks.lineage.mockReset().mockResolvedValue(snapshot);
  return { ...f, own, snapshot };
}

function receiptFor(f: ReturnType<typeof fixture>) {
  return { id: "canonical-receipt", payload: { schemaVersion: 1, receiptId: "canonical-receipt", policyVersion: "initiative-readiness.v1",
    gate: f.context.parsed.initiativeReviewBinding.gate, decision: "pass", subject: { kind: "backlog-item", id: "BI-285EF102" },
    artifactRef: structuredClone(f.context.parsed.initiativeReviewBinding.artifactRef), artifactDigest: "artifact-digest",
    artifactAuthorRef: "principal:author|agent:author", reviewerPrincipalId: "reviewer-principal", reviewerAgentId: "AGT-WS-REVIEW",
    authorityDecisionId: "allow-writer", authoritySnapshot: { decision: "allow", effectiveHumanCapability: "manage_backlog",
      effectiveAgentGrant: "initiative_design_review", tokenScope: "write", organizationId: "platform", actionKey: "record_initiative_design_review",
      policyVersion: "coworker-authority.v1" }, reason: "Canonical assessment", findingRefs: [], resolvedFindingRefs: [] } };
}
function exhaustedProgress(kind: "wait" | "escalation" = "wait") {
  return kind === "wait"
    ? { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer", writerToolName: "record_initiative_design_review",
        resumeMode: "same-taskrun", attempt: 3, observedAt: "2026-10-22T12:00:00.000Z" } }
    : { terminalWriterEscalation: { schemaVersion: 1, code: "terminal_writer_retry_exhausted", writerToolName: "record_initiative_design_review",
        action: "select-different-reviewer-provider", attempt: 3, observedAt: "2026-10-22T12:00:00.000Z" } };
}
describe("normal current authority remains mandatory", () => {
  it("rechecks the real request allow decision and both actor/grant owners inside the provided transaction", async () => {
    const f = fixture(); await f.validate(f.tx as never, f.context as never);
    expect(mocks.oauth).toHaveBeenCalledWith(expect.anything(), f.tx);
    expect(mocks.budget).toHaveBeenCalledWith("AGT-WS-REVIEW", undefined, f.tx);
    expect(mocks.usage).toHaveBeenCalledWith(expect.anything(), f.tx);
    expect(mocks.policy).toHaveBeenCalledWith(f.tx, f.context.proof, "human");
  });
  it.each(["revoked", "wrong-human", "wrong-actor", "denied-decision", "different-consent", "missing-reviewer-grant", "missing-token-grant", "changed-room", "budget-change", "missing-room-access"])("refuses %s", async problem => {
    const f = fixture();
    if (problem === "revoked") mocks.oauth.mockResolvedValue(false);
    if (problem === "wrong-human") f.token.userId = "other";
    if (problem === "wrong-actor") f.authority.agentContextRef = "other";
    if (problem === "denied-decision") f.authority.decision = "deny";
    if (problem === "different-consent") f.authority.authorityBindingId = "other";
    if (problem === "missing-reviewer-grant") f.reviewer.toolGrants = [];
    if (problem === "missing-token-grant") f.token.scopes = [];
    if (problem === "changed-room") f.room.headSha = "c".repeat(40);
    if (problem === "budget-change") mocks.budget.mockResolvedValue({ configurationDigest: "changed" });
    if (problem === "missing-room-access") mocks.access.mockResolvedValue({ decision: { level: "none" } });
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toThrow(/reassessment-/);
  });
  it("uses the same transaction to bind a persisted root to its exact retained request authority", async () => {
    const f = fixture(true); await f.validate(f.tx as never, f.context as never);
    expect(f.tx.taskRun.findUnique).toHaveBeenCalledWith({ where: { taskRunId: f.root.taskRunId }, select: {
      taskRunId: true, userId: true, currentAgentId: true, a2aMetadata: true } });
    expect(mocks.policy).toHaveBeenCalledWith(f.tx, f.context.proof, "human");
  });
  it.each(["missing-task", "missing-authority", "decision", "actor", "scopes", "extra-authority-field", "wrong-user", "wrong-reviewer", "wrong-task", "wrong-digest", "wrong-binding", "wrong-token"])("refuses persisted root mismatch: %s", async problem => {
    const f = fixture(true), retained = f.task.a2aMetadata.presentReviewAuthority as Record<string, unknown>;
    if (problem === "missing-task") f.tx.taskRun.findUnique.mockResolvedValue(null);
    if (problem === "missing-authority") delete (f.task.a2aMetadata as Record<string, unknown>).presentReviewAuthority;
    if (problem === "decision") retained.authorityDecisionId = "different-allow";
    if (problem === "actor") retained.actingAgentId = "other-author";
    if (problem === "scopes") retained.tokenGrantScopes = [];
    if (problem === "extra-authority-field") retained.permissionGranted = true;
    if (problem === "wrong-user") f.task.userId = "different-human";
    if (problem === "wrong-reviewer") f.task.currentAgentId = "other-reviewer";
    if (problem === "wrong-task") f.task.taskRunId = "TR-other";
    if (problem === "wrong-digest") f.task.a2aMetadata.requestDigest = "f".repeat(64);
    if (problem === "wrong-binding") f.task.a2aMetadata.initiativeReviewBinding.gate = "spec-approval";
    if (problem === "wrong-token") f.task.a2aMetadata.apiTokenId = "other-token";
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-authority-unproven" });
    expect(mocks.policy).not.toHaveBeenCalled(); expect(mocks.budget).not.toHaveBeenCalled();
  });
  it("does not accept broader current consent in place of the captured request grants", async () => {
    const f = fixture(); f.requestAuthority.tokenGrantScopes.length = 0;
    // The callback must capture the original request facts, so later mutation
    // cannot narrow or broaden the authority it compares with persisted state.
    await expect(f.validate(f.tx as never, f.context as never)).resolves.toBeUndefined();
    const narrow = fixture(); narrow.task.a2aMetadata.presentReviewAuthority = { ...narrow.requestAuthority, tokenGrantScopes: [] };
    const validate = createPresentReassessmentAuthority({ token: { tokenId: "token", userId: "human", source: "oauth", capability: "write" },
      requestAuthority: { ...narrow.requestAuthority, tokenGrantScopes: ["backlog_read"] }, budgetConfiguration: narrow.root.budgetConfiguration, compatibility: {} } as never);
    await expect(validate(narrow.tx as never, narrow.context as never)).rejects.toMatchObject({ code: "reassessment-authority-unproven" });
  });
  it.each(["actor", "reviewer-writer", "reviewer-reader"])("honors the %s's persisted grant revocations in the same transaction", async owner => {
    const f = fixture();
    if (owner === "actor") f.actor.toolGrantRevocations.push({ grantKey: "initiative_evidence_write" });
    else f.reviewer.toolGrantRevocations.push({ grantKey: owner === "reviewer-writer" ? "initiative_design_review" : "file_read" });
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-authority-unproven" });
    expect(mocks.access).not.toHaveBeenCalled();
  });
  it.each(["request-evidence", "request-backlog", "credential-evidence", "credential-backlog"])("honors narrowing of the author's required grants: %s", async boundary => {
    const f = fixture(), key = boundary.endsWith("evidence") ? "initiative_evidence_write" : "backlog_read";
    const requestAuthority = { ...f.requestAuthority, tokenGrantScopes: [...f.requestAuthority.tokenGrantScopes] };
    if (boundary.startsWith("request")) requestAuthority.tokenGrantScopes = requestAuthority.tokenGrantScopes.filter(scope => scope !== key);
    else f.token.scopes = f.token.scopes.filter(scope => scope !== key);
    const validate = createPresentReassessmentAuthority({ token: { tokenId: "token", userId: "human", source: "oauth", capability: "write" },
      requestAuthority, budgetConfiguration: f.root.budgetConfiguration, compatibility: {} } as never);
    await expect(validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-authority-unproven" });
  });
  it("permits read-only policy-room content access without creating a stronger room grant", async () => {
    const f = fixture(); mocks.access.mockImplementation(async (input: { requested: string }) => ({ decision: { level: input.requested } }));
    await expect(f.validate(f.tx as never, f.context as never)).resolves.toBeUndefined();
    expect(mocks.access).toHaveBeenNthCalledWith(1, { userId: "human", agentId: "author", workroomId: "room", requested: "action" }, f.tx);
    expect(mocks.access).toHaveBeenNthCalledWith(2, { userId: "human", agentId: "author", workroomId: "authority-room", requested: "content" }, f.tx);
  });
  it("preserves normal author-only bounded delegation to a reviewer who owns both actual autonomous tools", async () => {
    const f = fixture(), authorScopes = ["backlog_read", "initiative_evidence_write"];
    f.actor.toolGrants = authorScopes.map(grantKey => ({ grantKey })); f.token.scopes = [...authorScopes];
    f.reviewer.toolGrants = [{ grantKey: "initiative_design_review" }, { grantKey: "file_read" }];
    f.context.parsed.authorityScope = [...authorScopes, "backlog-item:BI-285EF102", "tool:read_source_at_version", "tool:record_initiative_design_review"];
    const validate = createPresentReassessmentAuthority({ token: { tokenId: "token", userId: "human", source: "oauth", capability: "write" },
      requestAuthority: { ...f.requestAuthority, tokenGrantScopes: authorScopes }, budgetConfiguration: f.root.budgetConfiguration, compatibility: {} } as never);
    await expect(validate(f.tx as never, f.context as never)).resolves.toBeUndefined();
  });
  it("does not borrow a chat-only read baseline for an autonomous reviewer", async () => {
    const f = fixture(); f.reviewer.toolGrants = [{ grantKey: "initiative_design_review" }];
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-authority-unproven" });
  });
  it.each(["wrong-item", "extra-tool", "missing-writer", "missing-reader"])("refuses changed parsed delegation boundaries: %s", async problem => {
    const f = fixture();
    if (problem === "wrong-item") f.context.parsed.authorityScope = f.context.parsed.authorityScope.map(scope => scope === "backlog-item:BI-285EF102" ? "backlog-item:BI-OTHER" : scope);
    if (problem === "extra-tool") f.context.parsed.authorityScope.push("tool:update_backlog_item");
    if (problem === "missing-writer") f.context.parsed.authorityScope = f.context.parsed.authorityScope.filter(scope => scope !== "tool:record_initiative_design_review");
    if (problem === "missing-reader") f.context.parsed.authorityScope = f.context.parsed.authorityScope.filter(scope => scope !== "tool:read_source_at_version");
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-authority-unproven" });
  });
});

describe("canonical receipt and preserved limit precedence", () => {
  it("rereads accepted lineage in the same transaction when a Q/E or writer check has no locked snapshot", async () => {
    const f = freshLineageFixture(); await f.validate(f.tx as never, f.context as never);
    expect(f.tx.backlogItem.findUnique).toHaveBeenCalledWith({ where: { itemId: "BI-285EF102" }, select: { id: true, organizationId: true } });
    expect(mocks.lineage).toHaveBeenCalledWith(f.tx, { binding: f.context.parsed.initiativeReviewBinding, organizationId: null,
      originals: f.context.originals });
  });
  it("stops an original's exhaustion recorded after sealing even when the callback carries no snapshot", async () => {
    const f = freshLineageFixture();
    const binding = { ...f.own.binding }; delete (binding as { presentReassessment?: unknown }).presentReassessment;
    f.snapshot.rows.push({ ...f.own, taskRunId: "TR-original", binding, progressPayload: exhaustedProgress(), status: "input-required" });
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-recorded-limit-exhausted" });
    expect(mocks.budget).not.toHaveBeenCalled();
  });
  it("refuses unavailable lineage rather than inventing zero historical limits", async () => {
    const f = freshLineageFixture(); mocks.lineage.mockRejectedValue(new Error("Accepted lineage unavailable"));
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-lineage-unproven" });
    expect(mocks.budget).not.toHaveBeenCalled();
  });
  it("requires the current persisted root to remain in the accepted lineage", async () => {
    const f = freshLineageFixture(); f.snapshot.rows = [];
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-lineage-unproven" });
  });
  it.each(["same-requirement", "total"])("retains all-state allocation ceilings during execution: %s", async kind => {
    const f = freshLineageFixture();
    f.snapshot.rows.push({ ...f.own, taskRunId: "TR-already-failed", status: "failed" });
    if (kind === "total") f.snapshot.rows.push({ ...f.own, taskRunId: "TR-already-canceled", status: "canceled",
      binding: { ...f.own.binding, gate: "spec-approval" } });
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-allocation-limit-exhausted" });
  });
  it.each([false, true])("stops on a committed receipt without a ToolExecution acknowledgement (own root: %s)", async ownRoot => {
    const f = fixture(ownRoot), receipt = receiptFor(f); f.tx.backlogItemActivity.findMany.mockResolvedValue([receipt]);
    if (ownRoot) f.writerDecision.rationale.taskRunId = f.root.taskRunId;
    f.context.snapshot.rows.push({ binding: { writerToolName: "record_initiative_design_review" }, progressPayload: exhaustedProgress() });
    mocks.usage.mockRejectedValue(new Error("Daily gate must not hide an existing receipt"));
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-requirement-already-has-receipt", receiptId: receipt.id });
    expect(mocks.budget).not.toHaveBeenCalled(); expect(mocks.usage).not.toHaveBeenCalled();
    expect(f.tx.coworkerActionEnvelope.findMany).toHaveBeenCalledWith({ where: { authorityDecisionId: "allow-writer" }, select: { taskRunId: true } });
  });
  it.each(["malformed", "denied", "wrong-action", "wrong-organization", "wrong-policy", "no-task-link", "conflicting-task-links"])("refuses an unproven same-artifact receipt: %s", async problem => {
    const f = fixture(), receipt = receiptFor(f);
    if (problem === "malformed") receipt.payload.reason = "";
    if (problem === "denied") f.writerDecision.decision = "deny";
    if (problem === "wrong-action") f.writerDecision.actionKey = "record_initiative_evidence";
    if (problem === "wrong-organization") receipt.payload.authoritySnapshot.organizationId = "other-org";
    if (problem === "wrong-policy") receipt.payload.authoritySnapshot.policyVersion = "other-policy";
    if (problem === "no-task-link") f.writerDecision.rationale.taskRunId = "";
    if (problem === "conflicting-task-links") f.tx.coworkerActionEnvelope.findMany.mockResolvedValue([{ taskRunId: "TR-other" }]);
    f.tx.backlogItemActivity.findMany.mockResolvedValue([receipt]);
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-existing-effect-unproven" });
    expect(mocks.budget).not.toHaveBeenCalled();
  });
  it("does not mistake a receipt for another immutable artifact as this requirement's verdict", async () => {
    const f = fixture(), receipt = receiptFor(f); receipt.payload.artifactRef.providerBlobId = "f".repeat(40);
    f.tx.backlogItemActivity.findMany.mockResolvedValue([receipt]);
    await expect(f.validate(f.tx as never, f.context as never)).resolves.toBeUndefined();
    expect(mocks.usage).toHaveBeenCalledOnce(); expect(f.tx.coworkerActionEnvelope.findMany).not.toHaveBeenCalled();
  });
  it.each(["current-wait", "current-escalation", "preserved-wait", "preserved-escalation"])("preserves known exhausted limits from %s", async kind => {
    const f = fixture(), prior = exhaustedProgress(kind.endsWith("escalation") ? "escalation" : "wait");
    const progress = kind.startsWith("preserved") ? { executionUncertaintyResolution: { schemaVersion: 1,
      reviewReceiptId: "missing-acknowledgement", artifactRef: f.context.parsed.initiativeReviewBinding.artifactRef, prior } } : {
      ...prior, executionUncertainty: { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown" } };
    const before = structuredClone(progress);
    f.context.snapshot.rows.push({ binding: { writerToolName: "record_initiative_design_review" }, progressPayload: progress });
    await expect(f.validate(f.tx as never, f.context as never)).rejects.toMatchObject({ code: "reassessment-recorded-limit-exhausted" });
    expect(progress).toEqual(before);
  });
  it("does not reinterpret an actually rejected writer packet as omitted-writer exhaustion", async () => {
    const f = fixture(), progress = exhaustedProgress();
    const wait = { ...progress.terminalWriterWait, writerRejection: { schemaVersion: 1, error: "stale-artifact", message: "Refresh the immutable packet" } };
    f.context.snapshot.rows.push({ binding: { writerToolName: "record_initiative_design_review" }, progressPayload: { terminalWriterWait: wait } });
    await expect(f.validate(f.tx as never, f.context as never)).resolves.toBeUndefined();
  });
});

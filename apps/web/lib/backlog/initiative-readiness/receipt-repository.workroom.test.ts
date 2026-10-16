import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ artifact: vi.fn(), item: vi.fn(), decision: vi.fn(), room: vi.fn(),
  append: vi.fn(), transaction: vi.fn(), lock: vi.fn(), canonicalPlan: vi.fn() }));
vi.mock("./canonical-plan-source", async (importOriginal) => ({
  ...await importOriginal<typeof import("./canonical-plan-source")>(), loadCanonicalPlanSource: io.canonicalPlan,
}));
vi.mock("./artifact-resolver", () => ({ resolveInitiativeArtifact: io.artifact }));
vi.mock("./reviewer-identity", async (importOriginal) => ({
  ...await importOriginal<typeof import("./reviewer-identity")>(),
  resolveReviewerIdentity: async () => ({ principalId: "principal-reviewer", kind: "coworker" }),
}));
vi.mock("@dpf/db", () => ({ Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } }, prisma: {
  backlogItem: { findUnique: io.item }, authorizationDecisionLog: { findUnique: io.decision }, $transaction: io.transaction,
} }));
import { recordInitiativeGateReceipt } from "./receipt-repository";

const workroomRef = { kind: "workroom-head" as const, workroomId: "WC-DF238BD5",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory", branchName: "feat/provider-accounts-ux",
  headSha: "45eb029a53ffd593f08be48eb4a061488aaa735f" };
const artifactRef = { kind: "repo-blob-at-commit" as const, repositoryFullName: workroomRef.repositoryFullName,
  commitSha: "99986af2a1fb1ff8d041ca7d9080ea6d02a4f963", providerBlobId: "7bde23c62328af6562b3d7df163c90cf0edb4dae",
  path: "docs/superpowers/plans/2026-10-04-provider-multi-account.md" };
const args = { itemId: "BI-7AA4EB6B", allowedGates: ["plan-review"] as const,
  requiredCapability: "manage_backlog", requiredGrant: "initiative_design_review", actionKey: "record_initiative_design_review",
  gate: "plan-review" as const, decision: "pass" as const, artifactRef, workroomRef, reason: "Reviewed the immutable plan.",
  findings: [], resolvedFindingRefs: [], reviewerUserId: "user", reviewerAgentId: "AGT-WS-REVIEW",
  authorityDecisionId: "AUTH-1", tokenScope: "write", requiresIndependentReviewer: true, expectedCurrentBaselineId: "baseline-1" };
let room: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  io.item.mockResolvedValue({ id: "item-row", itemId: args.itemId, organizationId: null, featureBuilds: [] });
  io.decision.mockResolvedValue({ decisionId: "AUTH-1", decision: "allow", actionKey: args.actionKey,
    policyVersion: "PV-1", organizationId: null, rationale: {} });
  io.artifact.mockResolvedValue({ ok: true, artifact: { ref: artifactRef, digest: `sha256:${"a".repeat(64)}`,
    authorPrincipalId: "principal-author", authorAgentId: null, bytes: Buffer.from("canonical plan") } });
  io.canonicalPlan.mockResolvedValue({ itemId: args.itemId, baselineId: "baseline-1", scopeOwnerItemId: "BI-PARENT",
    artifactRef, digest: `sha256:${"a".repeat(64)}` });
  room = { capsuleId: workroomRef.workroomId, backlogItemId: args.itemId, repositoryFullName: workroomRef.repositoryFullName,
    headBranch: workroomRef.branchName, headSha: workroomRef.headSha, archivedAt: null, status: "ready",
    createdByPrincipalId: "principal-author" };
  io.room.mockImplementation(async () => room);
  io.transaction.mockImplementation(async (work) => work({ $queryRaw: io.lock,
    backlogItem: { findUnique: io.item }, workroom: { findUnique: io.room },
    backlogItemActivity: { findMany: async () => [], create: io.append } }));
});

describe("bound historical plan receipt publication", () => {
  it("locks and revalidates the current room while publishing the original immutable artifact identity", async () => {
    expect(await recordInitiativeGateReceipt(args)).toMatchObject({ ok: true });
    expect(io.artifact).toHaveBeenCalledWith(expect.objectContaining({ locator: artifactRef, workroomRef }));
    expect(io.room).toHaveBeenCalledWith(expect.objectContaining({ where: { capsuleId: workroomRef.workroomId } }));
    expect(io.lock).toHaveBeenCalledTimes(3);
    expect(io.canonicalPlan).toHaveBeenCalledTimes(2);
    expect(io.append.mock.calls[0]?.[0].data.payload.artifactRef).toEqual(artifactRef);
  });

  it.each(["missing", "baseline", "locator", "digest", "scope-owner"])("refuses changed canonical plan %s at publication", async (drift) => {
    const source = { itemId: args.itemId, baselineId: "baseline-1", scopeOwnerItemId: "BI-PARENT",
      artifactRef, digest: `sha256:${"a".repeat(64)}` };
    const changed = { ...source };
    if (drift === "baseline") changed.baselineId = "baseline-new";
    if (drift === "locator") changed.artifactRef = { ...artifactRef, commitSha: "d".repeat(40) };
    if (drift === "digest") changed.digest = `sha256:${"d".repeat(64)}`;
    if (drift === "scope-owner") changed.scopeOwnerItemId = "BI-FOREIGN";
    io.canonicalPlan.mockResolvedValueOnce(source).mockResolvedValueOnce(drift === "missing" ? null : changed);
    expect(await recordInitiativeGateReceipt(args)).toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
    expect(io.append).not.toHaveBeenCalled();
  });

  it("refuses a stale accepted baseline before source verification", async () => {
    expect(await recordInitiativeGateReceipt({ ...args, expectedCurrentBaselineId: "baseline-old" }))
      .toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
    expect(io.artifact).not.toHaveBeenCalled();
    expect(io.append).not.toHaveBeenCalled();
  });

  it.each(["missing", "head", "branch", "repository", "subject", "owner", "archived", "abandoned", "cancelled"])(
    "appends nothing after %s changes during provider verification", async (drift) => {
      if (drift === "missing") io.room.mockResolvedValue(null);
      if (drift === "head") room.headSha = "d".repeat(40);
      if (drift === "branch") room.headBranch = "feat/foreign";
      if (drift === "repository") room.repositoryFullName = "foreign/repo";
      if (drift === "subject") room.backlogItemId = "BI-FOREIGN";
      if (drift === "owner") room.createdByPrincipalId = "principal-foreign";
      if (drift === "archived") room.archivedAt = new Date();
      if (["abandoned", "cancelled"].includes(drift)) room.status = drift;
      expect(await recordInitiativeGateReceipt(args)).toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
      expect(io.append).not.toHaveBeenCalled();
    });

  it("retains the independent reviewer check for a current unchanged plan", async () => {
    room.createdByPrincipalId = "principal-reviewer";
    io.artifact.mockResolvedValue({ ok: true, artifact: { ref: artifactRef, digest: `sha256:${"a".repeat(64)}`,
      authorPrincipalId: "principal-reviewer", authorAgentId: "AGT-WS-REVIEW", bytes: Buffer.from("plan") } });
    expect(await recordInitiativeGateReceipt(args)).toMatchObject({ ok: false });
    expect(io.append).not.toHaveBeenCalled();
  });
});

describe("one terminal verdict for an authenticated bound review", () => {
  const boundReviewTask = { taskRunId: "TR-MCP-BOUND", requestDigest: "9".repeat(64) };
  const boundArgs = { ...args, boundReviewTask };
  type Activity = { id: string; backlogItemId: string; kind: string; gateKey?: string; payload: Record<string, unknown> };

  function publication() {
    const activities: Activity[] = [];
    const task = { id: "task-row", taskRunId: boundReviewTask.taskRunId, userId: args.reviewerUserId,
      currentAgentId: args.reviewerAgentId, status: "working", a2aMetadata: {
        trigger: "external-mcp", requestDigest: boundReviewTask.requestDigest,
        initiativeReviewBinding: { writerToolName: args.actionKey, itemId: args.itemId, gate: args.gate,
          artifactRef, workroomRef, expectedCurrentBaselineId: args.expectedCurrentBaselineId },
      } };
    io.decision.mockImplementation(async ({ where }: { where: { decisionId: string } }) => ({
      decisionId: where.decisionId, decision: "allow", actionKey: args.actionKey,
      policyVersion: "PV-1", organizationId: null, rationale: { taskRunId: task.taskRunId },
    }));
    const tx = { $queryRaw: io.lock, taskRun: { findUnique: vi.fn(async () => task) },
      backlogItem: { findUnique: io.item }, workroom: { findUnique: io.room },
      authorizationDecisionLog: { findUnique: io.decision },
      coworkerActionEnvelope: { findMany: vi.fn(async (): Promise<Array<{ taskRunId: string | null }>> => []) },
      backlogItemActivity: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => activities.find((row) => row.id === where.id) ?? null),
        findMany: vi.fn(async ({ where }: { where?: { kind?: string; gateKey?: string } }) => activities.filter((row) =>
          (!where?.kind || row.kind === where.kind) && (!where?.gateKey || row.gateKey === where.gateKey))),
        create: io.append.mockImplementation(async ({ data }: { data: Activity }) => {
          activities.push(structuredClone(data)); return data;
        }),
      } };
    // Queue transactions as the subject-row lock does; a serialization loser
    // is exercised separately, rather than pretending this fake is PostgreSQL.
    let prior: Promise<unknown> = Promise.resolve();
    io.transaction.mockImplementation((work) => {
      const next = prior.then(() => work(tx)); prior = next.catch(() => undefined); return next;
    });
    return { activities, task, tx };
  }

  it("returns one canonical winner for two racing calls with different allow decisions", async () => {
    const state = publication();
    const [first, second] = await Promise.all([
      recordInitiativeGateReceipt(boundArgs),
      recordInitiativeGateReceipt({ ...boundArgs, authorityDecisionId: "AUTH-2" }),
    ]);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Expected the qualified canonical result.");
    expect(second.receiptId).toBe(first.receiptId);
    expect(state.activities).toHaveLength(1);
    expect(io.append).toHaveBeenCalledOnce();
  });

  it("returns the original rejecting verdict instead of publishing a contradictory pass", async () => {
    const state = publication();
    const first = await recordInitiativeGateReceipt({ ...boundArgs, decision: "fail", findings: [
      { issue: "Rollback is missing.", severity: "important" },
    ] });
    if (!first.ok) throw new Error("Expected the independently recorded rejection.");
    const second = await recordInitiativeGateReceipt({ ...boundArgs, authorityDecisionId: "AUTH-2",
      resolvedFindingRefs: first.receipt.findingRefs as string[] });
    expect(second).toMatchObject({ ok: true, receiptId: first.receiptId, receipt: { decision: "fail" }, deduplicated: true });
    expect(state.activities).toHaveLength(1);
  });

  it.each(["cancellation", "request", "artifact", "actor"])("appends nothing after bound %s changes", async (drift) => {
    const state = publication();
    if (drift === "cancellation") state.task.status = "canceled";
    if (drift === "request") state.task.a2aMetadata.requestDigest = "8".repeat(64);
    if (drift === "artifact") state.task.a2aMetadata.initiativeReviewBinding.artifactRef = { ...artifactRef, providerBlobId: "d".repeat(40) };
    if (drift === "actor") state.task.currentAgentId = "AGT-OTHER";
    expect(await recordInitiativeGateReceipt(boundArgs)).toMatchObject({ ok: false });
    expect(io.append).not.toHaveBeenCalled();
  });

  it("refuses an allow decision bound to another task", async () => {
    publication();
    io.decision.mockResolvedValue({ decisionId: "AUTH-1", decision: "allow", actionKey: args.actionKey,
      policyVersion: "PV-1", organizationId: null, rationale: { taskRunId: "TR-FOREIGN" } });
    expect(await recordInitiativeGateReceipt(boundArgs)).toMatchObject({ ok: false, code: "AUTHORIZATION_DENIED" });
    expect(io.append).not.toHaveBeenCalled();
  });

  it("does not reuse a corrupted winner or replace it with another receipt", async () => {
    const state = publication();
    expect(await recordInitiativeGateReceipt(boundArgs)).toMatchObject({ ok: true });
    state.activities[0]!.payload.subject = { kind: "backlog-item", id: "BI-FOREIGN" };
    io.append.mockClear();
    expect(await recordInitiativeGateReceipt({ ...boundArgs, authorityDecisionId: "AUTH-2" })).toMatchObject({ ok: false });
    expect(io.append).not.toHaveBeenCalled();
  });

  it("reuses a verified legacy random-ID verdict without minting a replacement", async () => {
    const state = publication();
    const legacy = await recordInitiativeGateReceipt(args);
    if (!legacy.ok) throw new Error("Expected a legacy canonical receipt.");
    expect(await recordInitiativeGateReceipt({ ...boundArgs, authorityDecisionId: "AUTH-2" }))
      .toMatchObject({ ok: true, receiptId: legacy.receiptId, deduplicated: true });
    expect(state.activities).toHaveLength(1);
  });

  it("refuses conflicting historical verdicts instead of choosing the latest", async () => {
    const state = publication();
    expect(await recordInitiativeGateReceipt(args)).toMatchObject({ ok: true });
    const duplicate = structuredClone(state.activities[0]!);
    duplicate.id = "initiative-duplicate";
    duplicate.payload.receiptId = duplicate.id;
    state.activities.push(duplicate);
    io.append.mockClear();
    expect(await recordInitiativeGateReceipt(boundArgs)).toMatchObject({ ok: false });
    expect(io.append).not.toHaveBeenCalled();
  });

  it.each(["P2034", "P2002"])("reconciles the committed winner after %s without another append", async (code) => {
    const state = publication();
    const first = await recordInitiativeGateReceipt(boundArgs);
    if (!first.ok) throw new Error("Expected a canonical verdict.");
    io.transaction.mockRejectedValueOnce(Object.assign(new Error("Race loser."), { code }));
    expect(await recordInitiativeGateReceipt({ ...boundArgs, authorityDecisionId: "AUTH-2" }))
      .toMatchObject({ ok: true, receiptId: first.receiptId, deduplicated: true });
    expect(state.activities).toHaveLength(1);
  });

  it("does not retry a write when a serialization loser has no visible winner", async () => {
    const state = publication();
    io.transaction.mockRejectedValueOnce(Object.assign(new Error("Race loser."), { code: "P2034" }));
    expect(await recordInitiativeGateReceipt(boundArgs)).toMatchObject({ ok: false });
    expect(state.activities).toHaveLength(0);
    expect(io.append).not.toHaveBeenCalled();
  });

  it("accepts an exact durable envelope link but refuses conflicting task links", async () => {
    const state = publication();
    io.decision.mockResolvedValue({ decisionId: "AUTH-1", decision: "allow", actionKey: args.actionKey,
      policyVersion: "PV-1", organizationId: null, rationale: {} });
    state.tx.coworkerActionEnvelope.findMany.mockResolvedValue([{ taskRunId: boundReviewTask.taskRunId }]);
    expect(await recordInitiativeGateReceipt(boundArgs)).toMatchObject({ ok: true });
    state.tx.coworkerActionEnvelope.findMany.mockResolvedValue([
      { taskRunId: boundReviewTask.taskRunId }, { taskRunId: "TR-FOREIGN" },
    ]);
    io.append.mockClear();
    expect(await recordInitiativeGateReceipt(boundArgs)).toMatchObject({ ok: false, code: "AUTHORIZATION_DENIED" });
    expect(io.append).not.toHaveBeenCalled();
  });

  it("refuses a prior receipt whose authority snapshot no longer matches its durable allow decision", async () => {
    const state = publication();
    expect(await recordInitiativeGateReceipt(boundArgs)).toMatchObject({ ok: true });
    (state.activities[0]!.payload.authoritySnapshot as Record<string, unknown>).policyVersion = "forged-policy";
    io.append.mockClear();
    expect(await recordInitiativeGateReceipt(boundArgs)).toMatchObject({ ok: false });
    expect(io.append).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ artifact: vi.fn(), item: vi.fn(), decision: vi.fn(), room: vi.fn(),
  append: vi.fn(), transaction: vi.fn(), lock: vi.fn() }));
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
  authorityDecisionId: "AUTH-1", tokenScope: "write", requiresIndependentReviewer: true };
let room: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  io.item.mockResolvedValue({ id: "item-row", itemId: args.itemId, organizationId: null, featureBuilds: [] });
  io.decision.mockResolvedValue({ decisionId: "AUTH-1", decision: "allow", actionKey: args.actionKey,
    policyVersion: "PV-1", organizationId: null, rationale: {} });
  io.artifact.mockResolvedValue({ ok: true, artifact: { ref: artifactRef, digest: `sha256:${"a".repeat(64)}`,
    authorPrincipalId: "principal-author", authorAgentId: null, bytes: Buffer.from("canonical plan") } });
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
    expect(io.lock).toHaveBeenCalledTimes(2);
    expect(io.append.mock.calls[0]?.[0].data.payload.artifactRef).toEqual(artifactRef);
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

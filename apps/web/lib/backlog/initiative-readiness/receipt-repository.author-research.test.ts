import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorResearchPolicyBinding } from "@/lib/build/author-research-policy-binding";
import { fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";

const io = vi.hoisted(() => ({ artifact: vi.fn(), author: vi.fn(), item: vi.fn(), decision: vi.fn(),
  append: vi.fn(), judgment: vi.fn(), delegation: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/build/author-research-policy-binding", () => ({ resolveAuthorResearchPolicyBinding: io.author }));
vi.mock("./artifact-resolver", () => ({ resolveInitiativeArtifact: io.artifact }));
vi.mock("./reviewer-identity", () => ({ resolveReviewerIdentity: async () => ({ principalId: "principal-actor", kind: "coworker" }) }));
vi.mock("@dpf/db", () => ({ Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } }, prisma: {
  backlogItem: { findUnique: io.item }, authorizationDecisionLog: { findUnique: io.decision }, $transaction: io.transaction,
} }));
import { recordInitiativeGateReceipt } from "./receipt-repository";

const proof: AuthorResearchPolicyBinding = {
  itemId: "BI-AUTHOR", buildId: "FB-AUTHOR", revisionId: "revision-1", valueDigest: "sha256:value", contentDigest: "sha256:bytes",
  authorUserId: "user-author", authorPrincipalId: "principal-author", authorAgentId: null,
  workroomId: "WC-AUTHOR", reason: "Canonical research", authorityVersion: "2026-10-12T12:00:00Z", roomPolicyDigest: "sha256:room",
};
const params = { itemId: proof.itemId, gate: "research", decision: "pass",
  artifactRef: { kind: "feature-build-revision", revisionId: proof.revisionId }, reason: proof.reason, findings: [], resolvedFindingRefs: [] };
const args = { itemId: proof.itemId, allowedGates: ["research"] as const, requiredCapability: "manage_backlog", requiredGrant: "initiative_evidence_write",
  actionKey: "record_initiative_evidence", gate: "research" as const, decision: "pass" as const,
  artifactRef: { kind: "feature-build-revision" as const, revisionId: proof.revisionId }, reason: proof.reason,
  findings: [], resolvedFindingRefs: [], reviewerUserId: "user-author", reviewerAgentId: "AGT-WS-BUILD",
  authorityDecisionId: "AUTH-1", tokenScope: "write", requiresIndependentReviewer: false, authorizationParams: params };
let decision: Record<string, unknown>;
let tx: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  const item = { id: "item-row", itemId: proof.itemId, organizationId: null, featureBuilds: [] };
  io.item.mockResolvedValue(item);
  decision = { decisionId: "AUTH-1", decision: "allow", actionKey: args.actionKey, policyVersion: "PV-1", organizationId: null,
    humanContextRef: args.reviewerUserId, agentContextRef: args.reviewerAgentId, objectRef: `backlog-item:${proof.itemId}`,
    routeContext: "/build/work/WC-AUTHOR", delegationGrantId: null, rationale: {
      authorResearchBinding: proof, artifactFingerprint: fingerprintCoworkerInput(params, proof),
      expiresAt: new Date(Date.now() + 60_000).toISOString(), interactionId: "DI-AUTHOR",
    } };
  io.decision.mockImplementation(async () => decision);
  io.author.mockResolvedValue({ ...proof });
  io.artifact.mockResolvedValue({ ok: true, artifact: { ref: args.artifactRef, digest: proof.valueDigest,
    authorPrincipalId: proof.authorPrincipalId, authorAgentId: null, bytes: Buffer.from("canonical") } });
  io.judgment.mockResolvedValue({ profileVersion: { versionId: "PV-1" }, profile: { currentVersionId: "PV-1" } });
  tx = { $queryRaw: vi.fn(), backlogItem: { findUnique: io.item },
    backlogItemActivity: { findMany: vi.fn(async () => []), create: io.append },
    decisionInteraction: { findUnique: io.judgment }, delegationGrant: { findFirst: io.delegation } };
  io.transaction.mockImplementation(async (work: (client: unknown) => Promise<unknown>) => work(tx));
});

describe("author research publication transaction", () => {
  it("appends only the same canonical author fact revalidated inside the serialized subject transaction", async () => {
    expect(await recordInitiativeGateReceipt(args)).toMatchObject({ ok: true });
    expect(io.author).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-author", agentId: "AGT-WS-BUILD", params }), tx);
    expect(io.append).toHaveBeenCalledOnce();
    expect(io.append.mock.calls[0]?.[0].data.payload.artifactAuthorRef).toBe("principal:principal-author|agent:null");
  });

  it.each(["revoked", "changed-digest", "changed-room-policy", "expired-during-validation", "profile-changed", "delegation-revoked",
    "foreign-human", "foreign-agent", "foreign-subject", "missing-exact-input", "different-published-fact"])("publishes nothing after %s", async (kind) => {
    const call = { ...args };
    if (kind === "revoked") io.author.mockResolvedValue(null);
    if (kind === "changed-digest") io.author.mockResolvedValue({ ...proof, valueDigest: "sha256:changed" });
    if (kind === "changed-room-policy") io.author.mockResolvedValue({ ...proof, roomPolicyDigest: "sha256:changed" });
    if (kind === "expired-during-validation") io.author.mockImplementation(async () => {
      (decision.rationale as Record<string, unknown>).expiresAt = new Date(Date.now() - 1).toISOString();
      return proof;
    });
    if (kind === "profile-changed") io.judgment.mockResolvedValue({ profileVersion: { versionId: "PV-1" }, profile: { currentVersionId: "PV-2" } });
    if (kind === "delegation-revoked") { decision.delegationGrantId = "DG-1"; io.delegation.mockResolvedValue({ status: "revoked" }); }
    if (kind === "foreign-human") decision.humanContextRef = "other";
    if (kind === "foreign-agent") decision.agentContextRef = "other";
    if (kind === "foreign-subject") decision.objectRef = "backlog-item:other";
    if (kind === "missing-exact-input") delete (call as Partial<typeof call>).authorizationParams;
    if (kind === "different-published-fact") call.reason = "Different fact";
    expect(await recordInitiativeGateReceipt(call)).toMatchObject({ ok: false, code: "AUTHORIZATION_DENIED" });
    expect(io.append).not.toHaveBeenCalled();
  });
});

describe("which build revision a gate may bind (BI-6F2872FC)", () => {
  it("lets only a plan review resolve the build's plan revision", async () => {
    await recordInitiativeGateReceipt({ ...args, gate: "plan-review" as never });
    expect(io.artifact).toHaveBeenLastCalledWith(expect.objectContaining({ acceptBuildPlan: true }));
    await recordInitiativeGateReceipt(args);
    expect(io.artifact).toHaveBeenLastCalledWith(expect.objectContaining({ acceptBuildPlan: false }));
  });
});

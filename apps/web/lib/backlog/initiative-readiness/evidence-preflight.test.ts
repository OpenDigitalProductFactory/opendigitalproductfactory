import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ item: vi.fn(), reviewer: vi.fn(), artifact: vi.fn(), source: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { backlogItem: { findUnique: mocks.item } } }));
vi.mock("./reviewer-identity", () => ({ resolveReviewerIdentity: mocks.reviewer }));
vi.mock("./artifact-resolver", () => ({ resolveInitiativeArtifact: mocks.artifact }));
vi.mock("@/lib/mcp/workroom-repository-source", () => ({ prepareWorkroomRepositorySource: mocks.source }));
import { preflightEvidenceArtifact } from "./evidence-preflight";

const params = { itemId: "BI-OWN", gate: "research", decision: "pass", reason: "Verified the defect.",
  artifactRef: { kind: "document-version", versionId: "version-1" }, findings: [], resolvedFindingRefs: [] };
const context = { agentId: "AGT-OWN", tokenScope: "write" as const };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.item.mockResolvedValue({ itemId: "BI-OWN", organizationId: "org-1" });
  mocks.reviewer.mockResolvedValue({ principalId: "PRN-OWN", kind: "coworker" });
  mocks.artifact.mockResolvedValue({ ok: true, artifact: { digest: "verified" } });
});
it.each([true, false])("admits selected research only through the authenticated Workroom source: %s", async admitted => {
  const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/component",
    commitSha: "a".repeat(40), path: "package.json", providerBlobId: "b".repeat(40) };
  const sourceAdmission = { itemId: "BI-OWN", workroomId: "WC-OWN" };
  mocks.source.mockResolvedValue(admitted ? { sourceAdmission } : null);
  const result = await preflightEvidenceArtifact({ params: { ...params, artifactRef, workroomId: "WC-OWN" },
    userId: "user-1", context });
  expect(mocks.source).toHaveBeenCalledWith({ workroomId: "WC-OWN", userId: "user-1", agentId: "AGT-OWN",
    itemId: "BI-OWN", target: { repositoryFullName: artifactRef.repositoryFullName, commitSha: artifactRef.commitSha } });
  if (admitted) {
    expect(result).toBeNull();
    expect(mocks.artifact).toHaveBeenCalledWith(expect.objectContaining({ sourceAdmission }));
  } else {
    expect(result).toMatchObject({ success: false, error: "AUTHORIZATION_DENIED" });
    expect(mocks.artifact).not.toHaveBeenCalled();
  }
});
it.each(["ARTIFACT_AUTHOR_REQUIRED", "CANONICAL_DESIGN_REQUIRED", "CANONICAL_DESIGN_AMBIGUOUS"])(
  "never discloses canonical %s details before authority admits the caller", async code => {
  const restricted = "WC-RESTRICTED branch/private-repair 1234567890abcdef restricted@example.test";
  mocks.artifact.mockResolvedValue({ ok: false, code, error: restricted });
  const result = await preflightEvidenceArtifact({ params, userId: "user-1", context });
  expect(result).toMatchObject({ success: false, error: code });
  for (const token of restricted.split(" ")) expect(JSON.stringify(result)).not.toContain(token);
});
it.each(["ARTIFACT_AUTHOR_REQUIRED", "CANONICAL_DESIGN_REQUIRED", "CANONICAL_DESIGN_AMBIGUOUS"])(
  "returns the canonical %s refusal before consent can be requested", async code => {
    mocks.artifact.mockResolvedValue({ ok: false, code, error: "Repair the source provenance." });
    const result = await preflightEvidenceArtifact({ params, userId: "user-1", context });
    expect(result).toMatchObject({ success: false, error: code });
    expect(result?.message).not.toBe("Repair the source provenance.");
    expect(result?.message).toMatch(/source owner|source binding/i);
  });
it("uses authenticated reviewer and trusted room context without minting an authority decision", async () => {
  const workroomRef = { kind: "workroom-head" as const, workroomId: "WC-OWN", repositoryFullName: "owner/repo",
    branchName: "codex/own", headSha: "a".repeat(40) };
  expect(await preflightEvidenceArtifact({ params: { ...params, userId: "forged", agentId: "forged" },
    userId: "user-1", context, workroomRef })).toBeNull();
  expect(mocks.reviewer).toHaveBeenCalledWith(expect.anything(), { reviewerUserId: "user-1", reviewerAgentId: "AGT-OWN" });
  expect(mocks.artifact).toHaveBeenCalledWith({ locator: params.artifactRef, subject: { kind: "backlog-item", id: "BI-OWN" },
    organizationId: "org-1", workroomRef, allowHumanResearchAuthor: true });
});
it.each([{}, { agentId: "AGT-OWN" }])("cannot substitute consent for missing writer context: %j", async missing => {
  expect(await preflightEvidenceArtifact({ params, userId: "user-1", context: missing }))
    .toMatchObject({ success: false, error: "AUTHORIZATION_DENIED" });
  expect(mocks.item).not.toHaveBeenCalled();
});
it("does not reject the separate objective mapping writer as an artifact receipt", async () => {
  expect(await preflightEvidenceArtifact({ params: { operation: "objective-mapping" }, userId: "user-1" })).toBeNull();
  expect(mocks.item).not.toHaveBeenCalled();
});
it.each([
  { artifactRef: { kind: "document-version" } },
  { reason: "" },
  { findings: [{ issue: "Blocking finding", severity: "important" }] },
])("rejects malformed or contradictory input before source lookup: %j", async change => {
  expect(await preflightEvidenceArtifact({ params: { ...params, ...change }, userId: "user-1", context }))
    .toMatchObject({ success: false, error: "malformed-receipt" });
  expect(mocks.artifact).not.toHaveBeenCalled();
});
it("refuses an unresolvable reviewer identity before artifact lookup", async () => {
  mocks.reviewer.mockResolvedValue(null);
  expect(await preflightEvidenceArtifact({ params, userId: "user-1", context }))
    .toMatchObject({ success: false, error: "ARTIFACT_AUTHOR_REQUIRED" });
  expect(mocks.artifact).not.toHaveBeenCalled();
});
it("keeps a source outage inconclusive and never treats it as permission", async () => {
  mocks.artifact.mockRejectedValue(new Error("provider unavailable"));
  expect(await preflightEvidenceArtifact({ params, userId: "user-1", context }))
    .toMatchObject({ success: false, error: "authority_evidence_unavailable" });
});
it("rechecks the artifact on a later call instead of caching an earlier success", async () => {
  expect(await preflightEvidenceArtifact({ params, userId: "user-1", context })).toBeNull();
  mocks.artifact.mockResolvedValue({ ok: false, code: "ARTIFACT_AUTHOR_REQUIRED", error: "Provenance changed." });
  expect(await preflightEvidenceArtifact({ params, userId: "user-1", context }))
    .toMatchObject({ success: false, error: "ARTIFACT_AUTHOR_REQUIRED" });
  expect(mocks.artifact).toHaveBeenCalledTimes(2);
});

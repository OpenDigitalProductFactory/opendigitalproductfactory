import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readApprovedReassessmentPolicy, revalidateApprovedReassessmentPolicy } from "./mcp-task-review-reassessment";

const artifact = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "" };
const policy = { schemaVersion: 1, subjectItemId: "BI-285EF102", maxAssessments: 2,
  historicalConsumption: "retain-unknown", currentLimits: "normal-recorded", originalReplay: false,
  operatorEvidenceActivityIds: ["operator-1", "operator-2"], requirements: [
    { gate: "design-spec", originalRequestDigest: "a".repeat(64), maxAssessments: 1 },
    { gate: "spec-approval", originalRequestDigest: "b".repeat(64), maxAssessments: 1 }] };
const bytes = Buffer.from(`\`\`\`review-reassessment-policy-v1\n${JSON.stringify(policy)}\n\`\`\`\n`);
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
artifact.providerBlobId = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function fixture() {
  const baseline = { baselineId: "baseline-current", supersedesBaselineId: null, artifactRef: artifact,
    artifactDigest: digest, approvalReceiptId: "approval" };
  const receipt = { schemaVersion: 1, receiptId: "approval", decision: "pass", gate: "spec-approval", artifactRef: artifact, artifactDigest: digest,
    subject: { kind: "backlog-item", id: "BI-7906C73E" }, policyVersion: "initiative-v1", artifactAuthorRef: "principal:author|agent:author",
    reviewerPrincipalId: "reviewer", reviewerAgentId: "AGT-REVIEW", authorityDecisionId: "allow-review", reason: "Independently approved", findingRefs: [], resolvedFindingRefs: [],
    authoritySnapshot: { decision: "allow", effectiveHumanCapability: "manage_backlog", effectiveAgentGrant: "initiative_design_write", tokenScope: "write",
      organizationId: "platform", actionKey: "record_initiative_design_review", policyVersion: "authority-v1" } };
  const rows = [{ id: "baseline-row", kind: "initiative_scope_baseline", payload: baseline }];
  const evidence = [{ id: "operator-1", kind: "evidence", backlogItemId: "authorization", recordedById: "human" },
    { id: "operator-2", kind: "evidence", backlogItemId: "subject", recordedById: "human" }];
  const db = {
    backlogItem: { findUnique: vi.fn(async ({ where }: { where: { itemId: string } }) => ({ id: where.itemId === "BI-7906C73E" ? "authorization" : "subject", itemId: where.itemId, organizationId: null })) },
    backlogItemActivity: { findMany: vi.fn(async ({ where }: { where: { kind?: string } }) => where.kind === "initiative_scope_baseline" ? rows : evidence),
      findUnique: vi.fn(async () => ({ kind: "initiative_gate_receipt", backlogItemId: "authorization", payload: receipt })) },
    initiativeArtifactRetentionPin: { findUnique: vi.fn(async () => ({ sourceKind: "repository_blob_archive", artifactLocator: artifact, artifactDigest: digest,
      documentBlob: { id: "blob", sha256: digest.slice(7), sizeBytes: bytes.length, storageKey: "content-addressed" } })) },
  };
  const readBlob = vi.fn(async () => bytes);
  return { db, rows, baseline, receipt, evidence, readBlob };
}
const input = { authorizationItemId: "BI-7906C73E", subjectItemId: "BI-285EF102", userId: "human" };

describe("current retained independent policy source", () => {
  it("reads approved retained bytes and preserves the explicit two requirement policy", async () => {
    const f = fixture();
    const result = await readApprovedReassessmentPolicy(input, { database: f.db as never, readBlob: f.readBlob });
    expect(result.policy).toEqual(policy);
    expect(result).toMatchObject({ baselineId: "baseline-current", authorityArtifact: artifact, artifactDigest: digest });
    expect(f.readBlob).toHaveBeenCalledOnce();
    await revalidateApprovedReassessmentPolicy(f.db as never, result, "human");
    expect(f.readBlob).toHaveBeenCalledOnce();
    await expect(revalidateApprovedReassessmentPolicy(f.db as never, JSON.parse(JSON.stringify(result)), "human"))
      .rejects.toThrow("reassessment-policy-unproven");
  });
  it.each(["changed-bytes", "changed-blob", "missing-approval", "failed-approval", "missing-evidence", "wrong-owner", "ambiguous-baseline"])("refuses %s before giving a policy", async problem => {
    const f = fixture();
    if (problem === "changed-bytes") f.readBlob.mockResolvedValue(Buffer.from("changed"));
    if (problem === "changed-blob") f.baseline.artifactRef = { ...artifact, providerBlobId: "c".repeat(40) };
    if (problem === "missing-approval") f.db.backlogItemActivity.findUnique.mockResolvedValue(null as never);
    if (problem === "failed-approval") f.receipt.decision = "fail";
    if (problem === "missing-evidence") f.evidence.pop();
    if (problem === "wrong-owner") f.evidence[0]!.recordedById = "other";
    if (problem === "ambiguous-baseline") f.rows.push({ ...f.rows[0]!, id: "another", payload: { ...f.baseline, baselineId: "baseline-other" } });
    await expect(readApprovedReassessmentPolicy(input, { database: f.db as never, readBlob: f.readBlob }))
      .rejects.toThrow(/reassessment-policy-unproven/);
  });
});

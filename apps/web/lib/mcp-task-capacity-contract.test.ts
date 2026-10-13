import { describe, expect, it } from "vitest";
import { remoteTaskRequestDigest, reconcileReviewReplayScope } from "./mcp-task-capacity-contract";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit-params";

const original: RemoteTaskSubmitParams = {
  agentId: "AGT-WS-REVIEW", routeContext: "/build", title: "Review", objective: "Review design",
  prompt: "Review design", riskClass: "bounded-write", idempotencyKey: "review:stable",
  authorityScope: ["initiative_design_review", "file_read", "backlog-item:BI-TEST",
    "tool:record_initiative_design_review", "tool:read_source_at_version"],
  initiativeReviewBinding: {
    writerToolName: "record_initiative_design_review", itemId: "BI-TEST", gate: "spec-approval",
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo",
      commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) },
  },
};
const metadata = { requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest(original) };
const retry = () => ({ ...original, authorityScope: [...original.authorityScope!, "payables_read"] });

describe("saved review authority on replay", () => {
  it("retains the saved scope when unrelated grants are added", () => {
    const current = retry();
    expect(reconcileReviewReplayScope(metadata, original.authorityScope, current)).toEqual(original.authorityScope);
    expect(current.authorityScope).toContain("payables_read");
  });
  it("refuses a removed required grant", () => {
    const current = retry();
    current.authorityScope = current.authorityScope.filter(x => x !== "initiative_design_review");
    expect(reconcileReviewReplayScope(metadata, original.authorityScope, current)).toBeNull();
  });
  it("refuses changed artifact identity", () => {
    const current = retry();
    const artifact = original.initiativeReviewBinding!.artifactRef;
    if (artifact.kind !== "repo-blob-at-commit") throw new Error("Expected repository fixture");
    current.initiativeReviewBinding = { ...original.initiativeReviewBinding!, artifactRef: {
      ...artifact, commitSha: "c".repeat(40),
    } };
    expect(reconcileReviewReplayScope(metadata, original.authorityScope, current)).toBeNull();
  });
  it("refuses expanded exact tool authority", () => {
    const current = retry();
    current.authorityScope.push("tool:record_initiative_evidence");
    expect(reconcileReviewReplayScope(metadata, original.authorityScope, current)).toBeNull();
  });
  it("does not normalize unbound tasks or unverifiable historical packets", () => {
    expect(reconcileReviewReplayScope(metadata, original.authorityScope, { ...retry(), initiativeReviewBinding: undefined })).toBeNull();
    expect(reconcileReviewReplayScope({}, original.authorityScope, retry())).toBeNull();
    expect(reconcileReviewReplayScope(metadata, undefined, retry())).toBeNull();
  });
});

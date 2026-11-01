import { describe, expect, it } from "vitest";
import { assertEngagementPresentOriginal, currentEngagementPresentAssessment } from "./engagement-present-assessment";
import { issueEngagementPresentPolicy } from "./engagement-present-policy";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
const binding = { version: 1 as const, engagementId: "CE-1FE20783", offerId: "offer", serviceId: "svc-ux-design-critique",
  providerAgentId: "ux-design-critic", actorAgentId: "actor", userId: "owner", workroomId: "WC-9C02621A", stageKey: "accept",
  inputDigest: "a".repeat(64), artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo",
    commitSha: "b".repeat(40), path: "prototype.html", providerBlobId: "c".repeat(40) },
  visualEvidenceRef: { kind: "document-version" as const, repositoryFullName: "owner/repo", versionId: "version", valueDigest: "d".repeat(64) } };
const fence = { schemaVersion: 1 as const, reservation: null, dispatchClaim: "held", authorityDigest: null, requestDigest: "e".repeat(64) };
const policy = issueEngagementPresentPolicy({ binding, originalTaskRunId: "TR-MCP-original", originalRequestDigest: fence.requestDigest,
  originalFence: fence, issuedAt: "2026-10-26T20:00:00.000Z", budgetConfigurationDigest: "f".repeat(64),
  providerConfigurationDigest: "1".repeat(64), compositionDigest: "2".repeat(64), limits: { perTaskTokens: 20000, maxOutputTokens: 2048,
    timeoutMs: 180000, maxProviderStarts: 12, maxToolCalls: 40, maxSourceBytes: 250000, maxImageBytes: 4000000, maxImagePixels: 40000000 } });
const rows = () => ({ engagement: { status: "unavailable", metadata: { fulfillment: { taskRunId: "TR-MCP-original", binding }, result: null } },
  original: { taskRunId: "TR-MCP-original", userId: "owner", status: "input-required", progressPayload: { dispatch: { claimedAt: "held" } },
    a2aMetadata: { engagementBinding: binding, requestDigest: fence.requestDigest } } });
describe("present CE original lineage", () => {
  it("never treats a serialized relation or policy as a live request", () => { expect(currentEngagementPresentAssessment()).toBeNull(); });
  it("preserves a held original without changing its status, fence or binding", () => {
    const state = rows(), before = canonicalJson(state);
    expect(() => assertEngagementPresentOriginal(policy, state)).not.toThrow();
    expect(canonicalJson(state)).toBe(before);
  });
  it.each(["working", "submitted", "failed", "canceled"])("refuses an original in %s", status => {
    const state = rows(); state.original.status = status;
    expect(() => assertEngagementPresentOriginal(policy, state)).toThrow("engagement-present-original-changed");
  });
  it("does not accept a result, foreign owner, changed revision, missing original or another candidate", () => {
    for (const change of [
      (s: ReturnType<typeof rows>) => { s.engagement.metadata.result = {} as never; },
      (s: ReturnType<typeof rows>) => { s.original.userId = "other"; },
      (s: ReturnType<typeof rows>) => { s.original.a2aMetadata.requestDigest = "0".repeat(64); },
      (s: ReturnType<typeof rows>) => { s.original.a2aMetadata.engagementBinding = { ...binding, artifactRef: { ...binding.artifactRef, commitSha: "0".repeat(40) } }; },
      (s: ReturnType<typeof rows>) => { s.engagement.metadata.fulfillment.taskRunId = "TR-MCP-other"; },
    ]) { const state = rows(); change(state); expect(() => assertEngagementPresentOriginal(policy, state)).toThrow(); }
  });
});

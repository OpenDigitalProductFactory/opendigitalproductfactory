import { describe, expect, it } from "vitest";
import { issueEngagementPresentPolicy, parseEngagementPresentPolicy, engagementPresentPolicyDigest,
  presentAssessmentRequestKey } from "./engagement-present-policy";

const binding = {
  version: 1 as const, engagementId: "CE-1FE20783", offerId: "offer-ux-design-critique",
  serviceId: "svc-ux-design-critique", providerAgentId: "ux-design-critic", actorAgentId: "AGT-EXT-CODEX",
  userId: "user", workroomId: "WC-9C02621A", stageKey: "accept", inputDigest: "a".repeat(64),
  artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "owner/repo", commitSha: "b".repeat(40),
    path: "prototype.html", providerBlobId: "c".repeat(40) },
  roomHeadSha: "b".repeat(40), guidanceArtifacts: [],
  visualEvidenceRef: { kind: "document-version" as const, repositoryFullName: "owner/repo", versionId: "capture-version", valueDigest: "d".repeat(64) },
};
const source = () => ({
  binding, originalTaskRunId: "TR-MCP-original", originalRequestDigest: "e".repeat(64),
  originalFence: { schemaVersion: 1 as const, reservation: null, dispatchClaim: "original-dispatch", authorityDigest: null, requestDigest: "e".repeat(64) },
  issuedAt: "2026-10-26T20:00:00.000Z", budgetConfigurationDigest: "f".repeat(64),
  limits: { perTaskTokens: 20_000, maxOutputTokens: 2_048, timeoutMs: 180_000,
    maxProviderStarts: 12, maxToolCalls: 40, maxSourceBytes: 250_000, maxImageBytes: 4_000_000, maxImagePixels: 40_000_000 },
  providerConfigurationDigest: "1".repeat(64), compositionDigest: "2".repeat(64),
});

describe("server-issued present engagement assessment policy", () => {
  it("preserves the original immutable scope, fence and UNKNOWN history", () => {
    const policy = issueEngagementPresentPolicy(source());
    expect(policy.originalBinding).toEqual(binding);
    expect(policy.originalTaskRunId).toBe("TR-MCP-original");
    expect(policy.historicalConsumption).toBe("retain-unknown");
    expect(policy.originalReplay).toBe(false);
    expect(policy.maxCandidates).toBe(1);
    expect(policy.responseEncoding).toMatchObject({ kind: "non-executable-function", name: "return_ux_critique" });
    expect(policy.readers).toEqual(["read_source_at_version", "wiki_query", "search_ux_critique_corpus"]);
    expect(policy.sourceBasis.kind).toBe("rendered-ux-with-static-source-v1");
    expect(policy.sourceBasis.omittedCategories).toEqual(["stylesheet", "script-implementation"]);
    expect(parseEngagementPresentPolicy(JSON.parse(JSON.stringify(policy)))).toEqual(policy);
  });
  it("never accepts caller authority or an initiative policy as part of the CE policy", () => {
    const policy = issueEngagementPresentPolicy(source());
    expect(parseEngagementPresentPolicy({ ...policy, humanApproval: true })).toBeNull();
    expect(parseEngagementPresentPolicy({ ...policy, policyProjectionAllowed: true })).toBeNull();
    expect(parseEngagementPresentPolicy({ ...policy, initiativeReviewBinding: {} })).toBeNull();
    expect(parseEngagementPresentPolicy({ ...policy, maxCandidates: 2 })).toBeNull();
    expect(parseEngagementPresentPolicy({ ...policy, originalReplay: true })).toBeNull();
  });
  it("binds every evidence, configuration and bound byte into the policy digest", () => {
    const policy = issueEngagementPresentPolicy(source());
    const digest = engagementPresentPolicyDigest(policy);
    for (const changed of [
      { ...policy, originalRequestDigest: "0".repeat(64) },
      { ...policy, providerConfigurationDigest: "0".repeat(64) },
      { ...policy, limits: { ...policy.limits, maxOutputTokens: 1024 } },
      { ...policy, originalBinding: { ...binding, artifactRef: { ...binding.artifactRef, commitSha: "0".repeat(40) } } },
    ]) expect(engagementPresentPolicyDigest(changed)).not.toBe(digest);
  });
  it("uses one CE lifetime request key regardless of policy version, token family or source revision", () => {
    expect(presentAssessmentRequestKey(binding.engagementId)).toBe(presentAssessmentRequestKey("CE-1FE20783"));
    expect(presentAssessmentRequestKey("CE-724328D6")).not.toBe(presentAssessmentRequestKey(binding.engagementId));
  });
  it.each([0, -1, 1.5, Infinity, 8193])("refuses invalid output allowance %s", maxOutputTokens => {
    const input = source(); input.limits.maxOutputTokens = maxOutputTokens;
    expect(() => issueEngagementPresentPolicy(input)).toThrow();
  });
  it("does not substitute another engagement or unbound image/source basis", () => {
    expect(() => issueEngagementPresentPolicy({ ...source(), binding: { ...binding, serviceId: "other-service" } })).toThrow();
    expect(() => issueEngagementPresentPolicy({ ...source(), binding: { ...binding, visualEvidenceRef: undefined } })).toThrow();
    expect(() => issueEngagementPresentPolicy({ ...source(), originalFence: { ...source().originalFence, requestDigest: "0".repeat(64) } })).toThrow();
  });
});
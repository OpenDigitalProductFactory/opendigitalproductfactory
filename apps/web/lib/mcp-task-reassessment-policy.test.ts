import { describe, expect, it } from "vitest";
import { parseReassessmentPolicy, parsePresentReassessmentRelation, reassessmentPolicyDigest, type ReassessmentPolicy } from "./mcp-task-reassessment-policy";

const digest = "a".repeat(64);
const policy: ReassessmentPolicy = {
  schemaVersion: 1, subjectItemId: "BI-285EF102", maxAssessments: 2,
  historicalConsumption: "retain-unknown", currentLimits: "normal-recorded", originalReplay: false,
  operatorEvidenceActivityIds: ["evidence-1", "evidence-2"],
  requirements: [
    { gate: "design-spec", originalRequestDigest: digest, maxAssessments: 1 },
    { gate: "spec-approval", originalRequestDigest: "b".repeat(64), maxAssessments: 1 },
  ],
};
const document = (value: unknown) => `Scope\n\n\`\`\`review-reassessment-policy-v1\n${JSON.stringify(value)}\n\`\`\`\n`;
export const relation = {
  schemaVersion: 1, authorizationItemId: "BI-7906C73E", baselineId: "baseline-current",
  policyDigest: digest, originalTaskRunId: "TR-MCP-original", originalRequestDigest: digest,
  predecessorTaskRunIds: ["TR-MCP-original"],
  authorityArtifact: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "c".repeat(40),
    path: "docs/spec.md", providerBlobId: "d".repeat(40) },
};

describe("approved immutable reassessment policy", () => {
  it("accepts exactly one explicit bounded policy without supplying current limits", () => {
    expect(parseReassessmentPolicy(document(policy))).toEqual(policy);
    expect(reassessmentPolicyDigest(policy)).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    "", document(policy) + document(policy), document({ ...policy, maxAssessments: 3 }),
    document({ ...policy, originalReplay: true }), document({ ...policy, currentLimits: "waived" }),
    document({ ...policy, extra: "grant" }), document({ ...policy, operatorEvidenceActivityIds: [] }),
    document({ ...policy, requirements: [policy.requirements[0], policy.requirements[0]] }),
    document({ ...policy, requirements: [{ ...policy.requirements[0], maxAssessments: 2 }] }),
    document({ ...policy, historicalConsumption: "zero" }),
    document({ ...policy, subjectItemId: "BI-unrelated" }),
    document({ ...policy, requirements: [{ ...policy.requirements[0], originalRequestDigest: "unknown" }] }),
    "```review-reassessment-policy-v1\n{\n```",
    document(policy).replace('"schemaVersion":1', '"schemaVersion":0,"schemaVersion":1'),
    document(policy).replace('"maxAssessments":1', '"maxAssessments":0,"maxAssessments":1'),
    document(policy) + "\n```review-reassessment-policy-v1\n{",
  ])("refuses absent, ambiguous or expanded authority", (source) => {
    expect(parseReassessmentPolicy(source)).toBeNull();
  });
});

describe("server-issued present relation decoder", () => {
  it("retains the original and immutable approval identity", () => {
    expect(parsePresentReassessmentRelation(relation)).toEqual(relation);
  });
  it.each([
    { ...relation, originalRequestDigest: "unknown" },
    { ...relation, predecessorTaskRunIds: [] },
    { ...relation, predecessorTaskRunIds: ["TR-MCP-other"] },
    { ...relation, predecessorTaskRunIds: ["TR-MCP-original", "TR-MCP-original"] },
    { ...relation, authorityArtifact: { ...relation.authorityArtifact, commitSha: "main" } },
    { ...relation, authorityArtifact: { ...relation.authorityArtifact, path: "../secret" } },
    { ...relation, callerApproved: true },
  ])("refuses malformed or caller-expanded relation", (value) => {
    expect(parsePresentReassessmentRelation(value)).toBeNull();
  });
});

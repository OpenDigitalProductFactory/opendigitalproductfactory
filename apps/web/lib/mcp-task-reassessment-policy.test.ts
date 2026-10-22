import { describe, expect, it } from "vitest";
import { parseReassessmentPolicy, parsePresentReassessmentRelation, reassessmentPolicyDigest, type ReassessmentPolicy } from "./mcp-task-reassessment-policy";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { REMOTE_TASK_REQUEST_DIGEST_VERSION, remoteTaskRequestDigest, remoteTaskRequestMatches } from "./mcp-task-capacity-contract";

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
    expect(JSON.stringify(parsePresentReassessmentRelation(relation))).toBe(JSON.stringify(relation));
  });
  it("reconstructs the same accepted digest after persisted JSON object keys are reordered", () => {
    const issued = reviewRequest(relation);
    const persisted = reorderObjectKeys(JSON.parse(JSON.stringify(issued)));
    expect(JSON.stringify(persisted.initiativeReviewBinding!.presentReassessment)).not.toBe(JSON.stringify(relation));
    const decoded = parseRemoteTaskSubmitParams(persisted);
    if (typeof decoded === "string") throw new Error(decoded);
    expect(decoded).toEqual(issued);
    expect(remoteTaskRequestDigest(decoded)).toBe(remoteTaskRequestDigest(issued));
    expect(remoteTaskRequestMatches({ requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest(issued) }, decoded)).toBe(true);
    expect(JSON.stringify(decoded.initiativeReviewBinding!.presentReassessment)).toBe(JSON.stringify(relation));
  });
  it("keeps the pre-existing versioned and historical original review digests unchanged", () => {
    const original = reviewRequest();
    expect(REMOTE_TASK_REQUEST_DIGEST_VERSION).toBe(2);
    expect(remoteTaskRequestDigest(original)).toBe("8d59201d713548aa1590e315f6ec379844dd4a67842bc7128e410d84c04c2813");
    expect(remoteTaskRequestMatches({ requestDigestVersion: 1, requestedThreadId: null,
      requestDigest: "ac1686d87b59d970a824cf72ce8c17b231c43841c084982aab2a35fc9f4123e0" }, original)).toBe(true);
  });
  it.each([
    { ...relation, originalRequestDigest: "unknown" },
    { ...relation, predecessorTaskRunIds: [] },
    { ...relation, predecessorTaskRunIds: ["TR-MCP-other"] },
    { ...relation, predecessorTaskRunIds: ["TR-MCP-original", "TR-MCP-original"] },
    { ...relation, authorityArtifact: { ...relation.authorityArtifact, commitSha: "main" } },
    { ...relation, authorityArtifact: { ...relation.authorityArtifact, path: "../secret" } },
    { ...relation, authorityArtifact: { ...relation.authorityArtifact, callerApproved: true } },
    { ...relation, callerApproved: true },
  ])("refuses malformed or caller-expanded relation", (value) => {
    expect(parsePresentReassessmentRelation(value)).toBeNull();
  });
});

function reviewRequest(presentReassessment?: typeof relation) {
  const parsed = parseRemoteTaskSubmitParams({ agentId: "fixture-reviewer", routeContext: "/build", title: "Exact review",
    objective: "Review immutable artifact", prompt: "Read then review", idempotencyKey: "fixture-original", riskClass: "bounded-write",
    threadId: null, collaborationKind: "handoff", authorityScope: ["backlog-item:BI-285EF102", "tool:read_source_at_version", "tool:record_initiative_design_review"],
    initiativeReviewBinding: { writerToolName: "record_initiative_design_review", itemId: "BI-285EF102", gate: "design-spec", expectedCurrentBaselineId: null,
      ...(presentReassessment ? { presentReassessment } : {}), artifactRef: relation.authorityArtifact } });
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
}

// JSONB does not retain JavaScript insertion order. Deliberately reorder every
// object, including the nested artifact, without changing any authority value.
function reorderObjectKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reorderObjectKeys) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.length - right.length || left.localeCompare(right))
    .map(([key, entry]) => [key, reorderObjectKeys(entry)])) as T;
  return value;
}

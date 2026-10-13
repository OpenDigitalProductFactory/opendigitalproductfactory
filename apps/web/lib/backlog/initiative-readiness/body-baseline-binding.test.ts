import { describe, expect, it } from "vitest";
import { bodyCriteriaVersion } from "./body-baseline-version";
import { bodyBaselineInputsMatch } from "./body-baseline-binding";
import { parseInitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { createInitiativeReviewTerminalToolPolicy, normalizeTerminalToolArguments, resolveTerminalToolCall } from "@/lib/tak/terminal-tool-policy";

const body = "## Acceptance\n- Verify canonical grants.";
const artifactRef = { kind: "document-version" as const, repositoryFullName: "owner/repo", versionId: "version-1", valueDigest: "sha256:criteria" };
const binding = { writerToolName: "record_initiative_evidence", gate: "objective-mapping", itemId: "BI-CASE",
  expectedCurrentBaselineId: "baseline-1", eligibleEvidenceActivityIds: ["evidence-1"], artifactRef,
  workroomRef: { kind: "workroom-head" as const, workroomId: "WC-CASE", repositoryFullName: "owner/repo", branchName: "fix/case", headSha: "a".repeat(40) } };
const baseline = { origin: "item-body", baselineId: "baseline-1", subject: { kind: "backlog-item", id: "BI-CASE" },
  authoritySnapshot: { organizationId: "org-1" }, criteriaDigest: bodyCriteriaVersion(body)!.criteriaDigest,
  sourceIdentity: { repositoryFullName: "owner/repo", headSha: "a".repeat(40) }, artifactRef };
const input = { itemId: "BI-CASE", organizationId: "org-1", body, binding };

describe("body acceptance immutable binding", () => {
  it("binds the current criteria, organization and delivered source", () => {
    expect(bodyBaselineInputsMatch(baseline, input)).toBe(true);
    expect(parseInitiativeReviewBinding(binding)).toEqual(binding);
  });
  it.each([
    ["criteria", { body: "## Acceptance\n- Different acceptance." }],
    ["item", { itemId: "BI-OTHER" }],
    ["organization", { organizationId: "org-2" }],
    ["source", { binding: { ...binding, workroomRef: { ...binding.workroomRef, headSha: "b".repeat(40) } } }],
    ["version", { binding: { ...binding, artifactRef: { ...artifactRef, versionId: "version-2" } } }],
    ["digest", { binding: { ...binding, artifactRef: { ...artifactRef, valueDigest: "sha256:other" } } }],
    ["baseline", { binding: { ...binding, expectedCurrentBaselineId: "baseline-2" } }],
  ])("rejects changed %s", (_name, change) => {
    expect(bodyBaselineInputsMatch(baseline, { ...input, ...change })).toBe(false);
  });
  it("retains exact immutable traversal and refuses a provider-selected document", () => {
    const policy = createInitiativeReviewTerminalToolPolicy(binding.writerToolName,
      [binding.writerToolName, "read_source_at_version"], artifactRef)!;
    expect(policy.immutableReaderArguments).toEqual({ repositoryFullName: "owner/repo",
      path: "initiative-body-version/version-1", version: "version-1", expectedBlobId: "sha256:criteria" });
    expect(normalizeTerminalToolArguments(policy, "read_source_at_version", { version: "version-2" }).kind).toBe("refuse");
    expect(resolveTerminalToolCall(policy, [], binding.writerToolName)).toMatchObject({ kind: "refuse", result: { error: "terminal_writer_requires_evidence" } });
  });
});

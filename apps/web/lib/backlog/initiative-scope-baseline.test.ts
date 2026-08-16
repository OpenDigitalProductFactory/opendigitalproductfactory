import { describe, expect, it } from "vitest";

import {
  buildInitiativeBaselineAndPin,
  diffInitiativeScopeManifests,
  parseInitiativeScopeManifest,
  validateInitiativeBaselineChainHead,
  validateInitiativeSupersessionDispositions,
} from "./initiative-readiness";

const artifact = `# Canonical scope

1. **OBJ-ORDER-001:** Preserve the submitted order without mutating its source facts.
2. **OBJ-ORDER-002:** Deny completion when evidence is missing.

| Acceptance | Objectives | Requirement | Evidence |
|---|---|---|---|
| AC-ORDER-001 | OBJ-ORDER-001 | The order source remains immutable. | unit test |
| AC-ORDER-002 | OBJ-ORDER-001, OBJ-ORDER-002 | Missing evidence returns a stable denial. | integration test |
`;

describe("parseInitiativeScopeManifest", () => {
  it("derives the complete anchored manifest and statement digests from exact bytes", () => {
    const result = parseInitiativeScopeManifest(artifact);
    expect(result).toMatchObject({
      ok: true,
      objectives: [
        { objectiveId: "OBJ-ORDER-001", artifactAnchor: "line:3" },
        { objectiveId: "OBJ-ORDER-002", artifactAnchor: "line:4" },
      ],
      acceptance: [
        { acceptanceId: "AC-ORDER-001", objectiveIds: ["OBJ-ORDER-001"], artifactAnchor: "line:8" },
        { acceptanceId: "AC-ORDER-002", objectiveIds: ["OBJ-ORDER-001", "OBJ-ORDER-002"], artifactAnchor: "line:9" },
      ],
    });
    if (!result.ok) throw new Error("unreachable");
    expect(result.artifactDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.objectives[0]?.statementDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("treats acceptance-to-objective retargeting as a semantic change", () => {
    const previous = parseInitiativeScopeManifest(artifact);
    const next = parseInitiativeScopeManifest(artifact.replace(
      "AC-ORDER-001 | OBJ-ORDER-001 |",
      "AC-ORDER-001 | OBJ-ORDER-002 |",
    ));
    if (!previous.ok || !next.ok) throw new Error("fixtures must parse");
    expect(diffInitiativeScopeManifests(previous, next).removedOrChangedAcceptanceIds)
      .toContain("AC-ORDER-001");
  });

  it.each([
    ["duplicate objective", `${artifact}\n3. **OBJ-ORDER-001:** Duplicate.`],
    ["unknown objective link", artifact.replace("OBJ-ORDER-002 | Missing", "OBJ-UNKNOWN | Missing")],
    ["unlinked acceptance", artifact.replace("AC-ORDER-001 | OBJ-ORDER-001", "AC-ORDER-001 | ")],
    ["missing statement", artifact.replace("OBJ-ORDER-002:** Deny completion when evidence is missing.", "OBJ-ORDER-002:**   ")],
  ])("rejects %s", (_label, bytes) => {
    expect(parseInitiativeScopeManifest(bytes)).toMatchObject({ ok: false });
  });
});

describe("initiative baseline chain", () => {
  it("uses exact-head compare-and-swap and denies ambiguous forks", () => {
    expect(validateInitiativeBaselineChainHead([], null)).toEqual({ ok: true, currentBaselineId: null });
    expect(validateInitiativeBaselineChainHead([
      { baselineId: "base-1", supersedesBaselineId: null },
      { baselineId: "base-2", supersedesBaselineId: null },
    ], null)).toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
    expect(validateInitiativeBaselineChainHead([
      { baselineId: "base-1", supersedesBaselineId: null },
    ], "stale")).toMatchObject({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS" });
  });

  it("requires one durable reasoned independent disposition per changed statement", () => {
    expect(validateInitiativeSupersessionDispositions(
      ["OBJ-ORDER-001", "AC-ORDER-002"],
      [
        { statementId: "OBJ-ORDER-001", reason: "The objective is replaced by the independently approved successor." },
        { statementId: "AC-ORDER-002", reason: "The acceptance rule is no longer applicable after contract removal." },
      ],
    )).toHaveLength(2);
    expect(validateInitiativeSupersessionDispositions(
      ["OBJ-ORDER-001"],
      [{ statementId: "OBJ-ORDER-001", reason: "too short" }],
    )).toBeNull();
  });

  it("binds approval receipt and retention pin to the same exact artifact", () => {
    const manifest = parseInitiativeScopeManifest(artifact);
    if (!manifest.ok) throw new Error("fixture must parse");
    const result = buildInitiativeBaselineAndPin({
      baselineId: "base-1",
      baselineActivityId: "activity-baseline",
      subject: { kind: "backlog-item", id: "BI-1" },
      profile: "feature",
      artifactRole: "design-spec",
      artifactRef: { kind: "document-version", versionId: "version-1" },
      artifactDigest: manifest.artifactDigest,
      manifest,
      supersedesBaselineId: null,
      supersessionDispositions: [],
      approvalReceipt: {
        receiptId: "activity-approval",
        gate: "spec-approval",
        decision: "pass",
        subject: { kind: "backlog-item", id: "BI-1" },
        artifactRef: { kind: "document-version", versionId: "version-1" },
        artifactDigest: manifest.artifactDigest,
        authoritySnapshot: { decision: "allow", effectiveHumanCapability: "manage_backlog", effectiveAgentGrant: "initiative_design_review", tokenScope: "write", organizationId: "org-1", actionKey: "record_initiative_design_review", policyVersion: "v1" },
      },
      retainedArtifact: { sourceKind: "document-version", documentVersionId: "version-1", documentBlobId: "blob-1" },
    });
    expect(result).toMatchObject({
      ok: true,
      baseline: { approvalReceiptId: "activity-approval", artifactDigest: manifest.artifactDigest },
      pin: { baselineActivityId: "activity-baseline", documentVersionId: "version-1", documentBlobId: "blob-1" },
    });
  });
});

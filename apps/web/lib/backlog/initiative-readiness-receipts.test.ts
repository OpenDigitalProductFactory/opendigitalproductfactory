import { describe, expect, it } from "vitest";

import {
  buildStableInitiativeFindingId,
  validateInitiativeGateReceiptDraft,
  type InitiativeGateReceiptContext,
  type InitiativeGateReceiptDraft,
} from "./initiative-readiness";

const context: InitiativeGateReceiptContext = {
  receiptId: "activity-1",
  policyVersion: "initiative-readiness.v1",
  allowedGates: ["architecture-review"],
  subject: { kind: "backlog-item", id: "BI-1" },
  resolvedArtifact: {
    ref: { kind: "document-version", versionId: "doc-version-1" },
    digest: "sha256:current",
    authorPrincipalId: "principal-author",
    authorAgentId: "agent-author",
  },
  reviewerPrincipalId: "principal-reviewer",
  reviewerAgentId: "agent-reviewer",
  authorityDecisionId: "authority-1",
  authoritySnapshot: {
    decision: "allow",
    effectiveHumanCapability: "manage_ea_model",
    effectiveAgentGrant: "initiative_architecture_review",
    tokenScope: "write",
    organizationId: "org-1",
    actionKey: "record_initiative_architecture_review",
    policyVersion: "authorization.v1",
  },
  openFindingRefs: [],
  resolvedFindings: [],
};

const draft: InitiativeGateReceiptDraft = {
  gate: "architecture-review",
  decision: "pass",
  artifactRef: { kind: "document-version", versionId: "doc-version-1" },
  reason: "The design uses the canonical backlog activity and evidence boundaries.",
  findingRefs: [],
  resolvedFindingRefs: [],
};

describe("validateInitiativeGateReceiptDraft", () => {
  it("allows only the gate lane statically assigned to the thin reviewer tool", () => {
    expect(validateInitiativeGateReceiptDraft(draft, context)).toMatchObject({ ok: true });
    expect(validateInitiativeGateReceiptDraft(
      { ...draft, gate: "security-review" },
      context,
    )).toMatchObject({ ok: false, code: "gate-not-authorized" });
  });

  it.each([
    ["principal", { reviewerPrincipalId: "principal-author" }],
    ["agent", { reviewerAgentId: "agent-author" }],
    ["null principals", { reviewerPrincipalId: null, resolvedArtifact: { ...context.resolvedArtifact, authorPrincipalId: null } }],
    ["null agents", { reviewerAgentId: null, resolvedArtifact: { ...context.resolvedArtifact, authorAgentId: null } }],
  ] as const)("rejects non-independent %s identity even for an allowed authority", (_label, overrides) => {
    expect(validateInitiativeGateReceiptDraft(draft, { ...context, ...overrides }))
      .toMatchObject({ ok: false, code: "reviewer-not-independent" });
  });

  it("uses the server-resolved digest, author, subject, receipt id, and authority snapshot", () => {
    const result = validateInitiativeGateReceiptDraft(draft, context);
    expect(result).toMatchObject({
      ok: true,
      receipt: {
        receiptId: "activity-1",
        subject: context.subject,
        artifactDigest: "sha256:current",
        artifactAuthorRef: "principal:principal-author|agent:agent-author",
        authorityDecisionId: "authority-1",
        authoritySnapshot: context.authoritySnapshot,
      },
    });
  });

  it("rejects a caller locator that differs from the server-resolved immutable artifact", () => {
    expect(validateInitiativeGateReceiptDraft({
      ...draft,
      artifactRef: { kind: "document-version", versionId: "spoofed-version" },
    }, context)).toMatchObject({ ok: false, code: "artifact-mismatch" });
  });

  it("does not accept generic Build Studio review JSON as a governed receipt", () => {
    expect(validateInitiativeGateReceiptDraft({
      decision: "pass",
      summary: "looks good",
    } as unknown as InitiativeGateReceiptDraft, context)).toMatchObject({
      ok: false,
      code: "malformed-receipt",
    });
  });

  it("holds pass and not-applicable to the same authority, independence, artifact, and finding rules", () => {
    expect(validateInitiativeGateReceiptDraft({
      ...draft,
      decision: "not-applicable",
      reason: "This platform control changes no clinical workflow or care guidance.",
    }, { ...context, openFindingRefs: ["finding-1"] })).toMatchObject({
      ok: false,
      code: "blocking-findings-open",
    });
    expect(validateInitiativeGateReceiptDraft({
      ...draft,
      decision: "not-applicable",
      reason: "",
    }, context)).toMatchObject({ ok: false, code: "reason-required" });
  });

  it("requires resolution receipts to name only existing open findings", () => {
    expect(validateInitiativeGateReceiptDraft({
      ...draft,
      decision: "fail",
      findingRefs: ["finding-1"],
      resolvedFindingRefs: ["unknown-finding"],
    }, {
      ...context,
      openFindingRefs: ["finding-1"],
      resolvedFindings: [{ findingRef: "finding-1", severity: "important", issue: "A blocking issue remains." }],
    })).toMatchObject({
      ok: false,
      code: "finding-resolution-invalid",
    });
  });

  it("allows a passing receipt to close every named open finding append-only", () => {
    expect(validateInitiativeGateReceiptDraft({
      ...draft,
      resolvedFindingRefs: ["finding-1"],
    }, { ...context, openFindingRefs: ["finding-1"] })).toMatchObject({
      ok: true,
      receipt: { resolvedFindingRefs: ["finding-1"] },
    });
  });
});

describe("buildStableInitiativeFindingId", () => {
  it("normalizes issue text but remains bound to lane and artifact revision", () => {
    const first = buildStableInitiativeFindingId({
      artifactDigest: "sha256:one",
      gate: "architecture-review",
      issue: "  Duplicate   readiness store. ",
    });
    const normalized = buildStableInitiativeFindingId({
      artifactDigest: "sha256:one",
      gate: "architecture-review",
      issue: "duplicate readiness store.",
    });
    const newRevision = buildStableInitiativeFindingId({
      artifactDigest: "sha256:two",
      gate: "architecture-review",
      issue: "duplicate readiness store.",
    });

    expect(first).toBe(normalized);
    expect(first).toMatch(/^IF-/);
    expect(newRevision).not.toBe(first);
  });
});

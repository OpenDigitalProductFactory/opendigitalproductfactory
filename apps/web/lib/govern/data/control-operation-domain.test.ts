import { describe, expect, it } from "vitest";

import {
  DATA_CONTROL_OPERATION_STATUSES,
  DATA_CONTROL_STEP_STATUSES,
  canonicalOperationEnvelopeHash,
  deriveOperationStatus,
  isOperationTransitionAllowed,
  isStepTransitionAllowed,
  terminalEvidenceAllowed,
  type DataControlOperationEnvelope,
} from "./control-operation-domain";

const envelope: DataControlOperationEnvelope = {
  organizationId: "org-1",
  actorType: "user",
  actorRef: "user-1",
  actorAuthority: { roles: ["data-steward"] },
  actionKey: "data.subject.erase",
  purposeOfUse: "subject-request",
  inputHash: "a".repeat(64),
  assetRefs: ["data:agent-message", "data:agent-memory"],
  fieldRefs: [],
  classificationRefs: ["restricted"],
  policyVersions: { erasure: "v4" },
  holdRevisions: { legal: "none" },
  approvals: [{ approvalId: "APR-1" }],
  risk: { band: "high" },
  targets: [
    { targetKey: "postgres", targetType: "postgres", pepKey: "pep:postgres", compensable: false },
    { targetKey: "agent-memory", targetType: "qdrant", pepKey: "pep:qdrant", compensable: true },
  ],
};

describe("data control operation domain", () => {
  it("keeps the state registries closed and kebab-cased", () => {
    expect(DATA_CONTROL_OPERATION_STATUSES).toEqual([
      "planned",
      "authorized",
      "executing",
      "reconciled",
      "partially-complete",
      "compensating",
      "failed",
      "compensated",
    ]);
    expect(DATA_CONTROL_STEP_STATUSES).toEqual([
      "pending",
      "executing",
      "applied",
      "verified",
      "failed",
      "compensated",
    ]);
  });

  it("hashes a canonical envelope independent of object-key and set ordering", () => {
    const reordered: DataControlOperationEnvelope = {
      ...envelope,
      actorAuthority: { roles: ["data-steward"] },
      policyVersions: { erasure: "v4" },
      assetRefs: [...envelope.assetRefs].reverse(),
      targets: [...envelope.targets].reverse(),
    };

    expect(canonicalOperationEnvelopeHash(reordered)).toBe(
      canonicalOperationEnvelopeHash(envelope),
    );
  });

  it.each([
    ["planned", "authorized", true],
    ["authorized", "executing", true],
    ["executing", "reconciled", true],
    ["executing", "partially-complete", true],
    ["partially-complete", "executing", true],
    ["partially-complete", "compensating", true],
    ["compensating", "compensated", true],
    ["planned", "reconciled", false],
    ["reconciled", "executing", false],
    ["failed", "executing", false],
  ] as const)("operation transition %s -> %s allowed=%s", (from, to, allowed) => {
    expect(isOperationTransitionAllowed(from, to)).toBe(allowed);
  });

  it.each([
    ["pending", "executing", true],
    ["executing", "applied", true],
    ["applied", "verified", true],
    ["executing", "failed", true],
    ["applied", "failed", true],
    ["applied", "compensated", true],
    ["verified", "compensated", true],
    ["failed", "executing", true],
    ["pending", "verified", false],
    ["pending", "compensated", false],
  ] as const)("step transition %s -> %s allowed=%s", (from, to, allowed) => {
    expect(isStepTransitionAllowed(from, to)).toBe(allowed);
  });

  it("derives reconciliation only from verified targets, never applied receipts", () => {
    expect(deriveOperationStatus(["verified", "verified"])).toBe("reconciled");
    expect(deriveOperationStatus(["verified", "applied"])).toBe("executing");
    expect(deriveOperationStatus(["verified", "failed"])).toBe("partially-complete");
    expect(deriveOperationStatus(["failed", "failed"])).toBe("failed");
  });

  it("permits terminal evidence only after verified reconciliation or compensation", () => {
    expect(terminalEvidenceAllowed("reconciled", ["verified", "verified"])).toBe(true);
    expect(terminalEvidenceAllowed("reconciled", ["verified", "applied"])).toBe(false);
    expect(terminalEvidenceAllowed("compensated", ["compensated", "compensated"])).toBe(true);
    expect(terminalEvidenceAllowed("partially-complete", ["verified", "failed"])).toBe(false);
  });
});

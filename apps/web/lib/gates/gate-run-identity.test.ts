import { describe, expect, it } from "vitest";

import {
  deriveGateKey,
  deriveSemanticReviewGateIdentity,
  normalizeGateRunIdentity,
  projectLocalCiTerminalEvidence,
} from "./gate-run-identity";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

const localCiIdentity = () => ({
  repository: "OpenDigitalProductFactory/OpenDigitalProductFactory",
  integrationTreeSha: SHA_A,
  evidencePlanDigest: DIGEST_A,
  toolchainFingerprint: DIGEST_B,
  gateKind: "local-integration-ci" as const,
});

describe("immutable gate-run identity", () => {
  it("normalizes repository and hexadecimal components before deriving a stable key", () => {
    const normalized = normalizeGateRunIdentity({
      ...localCiIdentity(),
      repository: "  OpenDigitalProductFactory/OpenDigitalProductFactory  ",
      integrationTreeSha: SHA_A.toUpperCase(),
      evidencePlanDigest: DIGEST_A.toUpperCase(),
    });

    expect(normalized).toEqual({
      schemaVersion: 1,
      repository: "opendigitalproductfactory/opendigitalproductfactory",
      integrationTreeSha: SHA_A,
      evidencePlanDigest: DIGEST_A,
      toolchainFingerprint: DIGEST_B,
      gateKind: "local-integration-ci",
    });
    expect(deriveGateKey(normalized)).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveGateKey(normalized)).toBe(deriveGateKey(localCiIdentity()));
  });

  it.each([
    ["repository", { repository: "missing-owner" }],
    ["integration tree", { integrationTreeSha: "not-a-sha" }],
    ["evidence plan", { evidencePlanDigest: "short" }],
    ["toolchain", { toolchainFingerprint: "short" }],
    ["gate kind", { gateKind: "preview" }],
  ])("rejects an invalid %s component", (_label, override) => {
    expect(() => normalizeGateRunIdentity({
      ...localCiIdentity(),
      ...override,
    } as never)).toThrow(/gate run identity/i);
  });

  it("changes the key when any identity-bearing component changes", () => {
    const baseline = localCiIdentity();
    const baselineKey = deriveGateKey(baseline);
    const variants = [
      { ...baseline, repository: "other/repository" },
      { ...baseline, integrationTreeSha: SHA_B },
      { ...baseline, evidencePlanDigest: DIGEST_B },
      { ...baseline, toolchainFingerprint: DIGEST_A },
      { ...baseline, gateKind: "semantic-review" as const },
    ];

    for (const variant of variants) {
      expect(deriveGateKey(variant)).not.toBe(baselineKey);
    }
  });
});

describe("semantic-review gate identity", () => {
  const review = () => ({
    repository: "OpenDigitalProductFactory/opendigitalproductfactory",
    identity: {
      capsuleId: "WC-TEST",
      baseTreeHash: SHA_A,
      headTreeHash: SHA_B,
      diffDigest: DIGEST_A,
      policyVersion: "semantic-change-review-policy.v2",
      reviewerVersion: "change-reviewer.v1",
      specialistIds: ["AGT-902", "AGT-181"],
    },
    risk: "high",
    dispatchContractVersion: "routed-semantic-review.v1",
  });

  it("maps review policy and dispatch inputs onto the common gate identity", () => {
    const result = deriveSemanticReviewGateIdentity(review());

    expect(result.identity).toEqual(expect.objectContaining({
      repository: "opendigitalproductfactory/opendigitalproductfactory",
      integrationTreeSha: SHA_B,
      gateKind: "semantic-review",
    }));
    expect(result.gateKey).toBe(deriveGateKey(result.identity));
  });

  it("sorts and deduplicates specialists before hashing the review plan", () => {
    const baseline = deriveSemanticReviewGateIdentity(review());
    const reordered = deriveSemanticReviewGateIdentity({
      ...review(),
      identity: {
        ...review().identity,
        specialistIds: ["AGT-181", "AGT-902", "AGT-181"],
      },
    });

    expect(reordered.gateKey).toBe(baseline.gateKey);
  });

  it.each([
    ["capsule", { identity: { ...review().identity, capsuleId: "WC-OTHER" } }],
    ["base tree", { identity: { ...review().identity, baseTreeHash: SHA_B } }],
    ["diff", { identity: { ...review().identity, diffDigest: DIGEST_B } }],
    ["policy", { identity: { ...review().identity, policyVersion: "policy.v3" } }],
    ["reviewer", { identity: { ...review().identity, reviewerVersion: "reviewer.v2" } }],
    ["risk", { risk: "critical" }],
    ["dispatch contract", { dispatchContractVersion: "routed-semantic-review.v2" }],
  ])("changes the key when %s changes", (_label, override) => {
    const baseline = deriveSemanticReviewGateIdentity(review());
    const changed = deriveSemanticReviewGateIdentity({
      ...review(),
      ...override,
    } as never);

    expect(changed.gateKey).not.toBe(baseline.gateKey);
  });
});

describe("local-CI terminal evidence projection", () => {
  const gateKey = "d".repeat(64);
  const evidence = (expiresAt: string) => ({
    id: "EXT-GATE",
    operationType: "local_integration_ci",
    details: {
      gateKey,
      status: "passed",
      evidenceValidity: { expiresAt },
    },
  });

  it("reuses a fresh pass linked to the same immutable key", () => {
    expect(projectLocalCiTerminalEvidence({
      claimKey: `gate:${gateKey}`,
      evidence: evidence("2026-08-25T12:01:00.000Z"),
      now: new Date("2026-08-25T12:00:00.000Z"),
    })).toEqual({
      status: "reused",
      evidenceRecordId: "EXT-GATE",
      resultClass: "pass",
    });
  });

  it("fails closed for expired or mismatched evidence", () => {
    expect(projectLocalCiTerminalEvidence({
      claimKey: `gate:${gateKey}`,
      evidence: evidence("2026-08-25T11:59:59.000Z"),
      now: new Date("2026-08-25T12:00:00.000Z"),
    })).toEqual({ status: "blocked", reason: "expired-evidence" });
    expect(projectLocalCiTerminalEvidence({
      claimKey: `gate:${gateKey}`,
      evidence: { ...evidence("2026-08-25T12:01:00.000Z"), operationType: "other" },
      now: new Date("2026-08-25T12:00:00.000Z"),
    })).toEqual({ status: "blocked", reason: "mismatched-evidence" });
  });
});

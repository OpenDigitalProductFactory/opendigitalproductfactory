import { describe, expect, it } from "vitest";

import {
  decideAutomaticPairing,
  mayPairWithoutOperator,
  type CandidateTransport,
} from "./automatic-pairing-decision";
import type {
  EnrollmentProposal,
  OrganizationTrustAnchor,
  PeerEnrollmentEvidence,
} from "./organization-federation-enrollment";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const ROOT = "sha256:aa11bb22cc33";
const ORG = "ORG-1779558156034";

function decide(overrides: {
  transport?: Partial<CandidateTransport>;
  proposal?: Partial<EnrollmentProposal>;
  localTrust?: Partial<OrganizationTrustAnchor>;
  peer?: Partial<PeerEnrollmentEvidence>;
} = {}) {
  return decideAutomaticPairing({
    transport: { secure: true, chainValidated: true, ...overrides.transport },
    proposal: {
      relationshipPreset: "same-organization",
      role: "same-org-peer",
      ...overrides.proposal,
    },
    localTrust: { rootFingerprint: ROOT, organizationRef: ORG, ...overrides.localTrust },
    peer: {
      certificateVerified: true,
      presentedRootFingerprint: ROOT,
      organizationRef: ORG,
      joinPackageExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
      ...overrides.peer,
    },
    now: NOW,
  });
}

describe("decideAutomaticPairing — the case that removes the human", () => {
  it("auto-enrols a validated same-organization peer", () => {
    const decision = decide();
    expect(decision.mode).toBe("auto-enroll");
    expect(decision.reason).toBeUndefined();
    expect(mayPairWithoutOperator(decision)).toBe(true);
  });

  it("is pure — equal evidence gives an equal decision", () => {
    expect(decide()).toEqual(decide());
  });
});

describe("transport gates come first and are absolute", () => {
  it("blocks a peer advertised over plain HTTP", () => {
    const decision = decide({ transport: { secure: false } });
    expect(decision.mode).toBe("blocked");
    expect(decision.reason).toBe("insecure-transport");
    expect(mayPairWithoutOperator(decision)).toBe(false);
  });

  it("blocks insecure transport even when organization trust would otherwise pass", () => {
    // Transport is checked before trust: an unverifiable channel cannot carry a
    // verifiable identity, however good the paperwork looks.
    expect(decide({ transport: { secure: false, chainValidated: true } }).mode).toBe("blocked");
  });

  it("falls back to the pairing code when the chain has not been validated", () => {
    const decision = decide({ transport: { chainValidated: false } });
    expect(decision.mode).toBe("operator-confirmation");
    expect(decision.reason).toBe("transport-not-validated");
    expect(decision.explanation).toContain("confirm the pairing code");
  });

  it("treats HTTPS discovery alone as not yet validated", () => {
    // `tls-validation-required` from discovery is a to-do, not a result.
    expect(decide({ transport: { secure: true, chainValidated: false } }).mode).toBe(
      "operator-confirmation",
    );
  });
});

describe("everything unproven routes to the operator, never to auto-enrol", () => {
  it("keeps the pairing code for a cross-organization relationship", () => {
    const decision = decide({ proposal: { relationshipPreset: "service-provider" } });
    expect(decision.mode).toBe("operator-confirmation");
    expect(decision.reason).toBe("relationship-is-cross-organization");
  });

  it("keeps the pairing code when this install never joined an organization", () => {
    const decision = decide({ localTrust: { rootFingerprint: null } });
    expect(decision.mode).toBe("operator-confirmation");
    expect(decision.reason).toBe("organization-trust-not-configured");
  });

  it("keeps the pairing code when the peer certificate did not verify", () => {
    expect(decide({ peer: { certificateVerified: false } }).reason).toBe(
      "peer-certificate-not-verified",
    );
  });

  it("keeps the pairing code for a peer chaining to a different root", () => {
    expect(decide({ peer: { presentedRootFingerprint: "sha256:deadbeef" } }).reason).toBe(
      "root-fingerprint-mismatch",
    );
  });

  it("keeps the pairing code for a different organization", () => {
    expect(decide({ peer: { organizationRef: "ORG-OTHER" } }).reason).toBe(
      "organization-ref-mismatch",
    );
  });

  it("keeps the pairing code for an expired join package", () => {
    expect(decide({ peer: { joinPackageExpiresAt: new Date("2026-08-25T00:00:00.000Z") } }).reason)
      .toBe("join-package-expired");
  });

  it("keeps the pairing code for a role a same-organization link may not take", () => {
    expect(decide({ proposal: { role: "manages" } }).reason).toBe(
      "role-not-allowed-for-relationship",
    );
  });

  it("never auto-enrols when every piece of evidence is missing", () => {
    const decision = decideAutomaticPairing({
      transport: { secure: true, chainValidated: true },
      proposal: { relationshipPreset: "same-organization", role: "same-org-peer" },
      localTrust: { rootFingerprint: null, organizationRef: null },
      peer: {
        certificateVerified: false,
        presentedRootFingerprint: null,
        organizationRef: null,
        joinPackageExpiresAt: null,
      },
      now: NOW,
    });
    expect(mayPairWithoutOperator(decision)).toBe(false);
  });
});

describe("mayPairWithoutOperator", () => {
  it("does not treat operator-confirmation as a pass", () => {
    // The predicate exists so a caller cannot skip SAS by testing `!== blocked`.
    expect(mayPairWithoutOperator(decide({ transport: { chainValidated: false } }))).toBe(false);
  });

  it("does not treat blocked as a pass", () => {
    expect(mayPairWithoutOperator(decide({ transport: { secure: false } }))).toBe(false);
  });
});

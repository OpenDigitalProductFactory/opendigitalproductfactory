import { describe, expect, it } from "vitest";

import {
  evaluateOrganizationEnrollment,
  type EnrollmentProposal,
  type OrganizationTrustAnchor,
  type PeerEnrollmentEvidence,
} from "./organization-federation-enrollment";

const NOW = new Date("2026-08-23T00:00:00.000Z");
const ROOT = "sha256:aa11bb22cc33";
const ORG = "ORG-1779558156034";

function proposal(overrides: Partial<EnrollmentProposal> = {}): EnrollmentProposal {
  return { relationshipPreset: "same-organization", role: "same-org-peer", ...overrides };
}

function localTrust(overrides: Partial<OrganizationTrustAnchor> = {}): OrganizationTrustAnchor {
  return { rootFingerprint: ROOT, organizationRef: ORG, ...overrides };
}

function peer(overrides: Partial<PeerEnrollmentEvidence> = {}): PeerEnrollmentEvidence {
  return {
    certificateVerified: true,
    presentedRootFingerprint: ROOT,
    organizationRef: ORG,
    joinPackageExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
    ...overrides,
  };
}

function evaluate(args: {
  proposal?: Partial<EnrollmentProposal>;
  localTrust?: Partial<OrganizationTrustAnchor>;
  peer?: Partial<PeerEnrollmentEvidence>;
  now?: Date;
} = {}) {
  return evaluateOrganizationEnrollment({
    proposal: proposal(args.proposal),
    localTrust: localTrust(args.localTrust),
    peer: peer(args.peer),
    now: args.now ?? NOW,
  });
}

describe("evaluateOrganizationEnrollment — the case that removes the human", () => {
  it("auto-enrols two installs chaining to the same organization root", () => {
    const result = evaluate();
    expect(result.decision).toBe("auto-enroll");
    expect(result.reason).toBeUndefined();
    expect(result.explanation).toContain("same organization root");
  });

  it("is pure — equal evidence gives an equal decision", () => {
    expect(evaluate()).toEqual(evaluate());
  });
});

describe("evaluateOrganizationEnrollment — every refusal path", () => {
  it("keeps human approval for a cross-organization relationship", () => {
    for (const preset of ["service-provider", "channel", "community-peer"]) {
      const result = evaluate({ proposal: { relationshipPreset: preset } });
      expect(result.decision).toBe("manual-approval");
      expect(result.reason).toBe("relationship-is-cross-organization");
    }
  });

  it("refuses an unrecognised relationship preset rather than defaulting open", () => {
    const result = evaluate({ proposal: { relationshipPreset: "totally-made-up" } });
    expect(result.decision).toBe("manual-approval");
    expect(result.reason).toBe("relationship-is-cross-organization");
  });

  it("refuses a role that a same-organization link may not take", () => {
    const result = evaluate({ proposal: { role: "manages" } });
    expect(result.decision).toBe("manual-approval");
    expect(result.reason).toBe("role-not-allowed-for-relationship");
  });

  it("refuses when this install never joined an organization", () => {
    const result = evaluate({ localTrust: { rootFingerprint: null } });
    expect(result.decision).toBe("manual-approval");
    expect(result.reason).toBe("organization-trust-not-configured");
  });

  it("refuses when the peer certificate did not verify", () => {
    const result = evaluate({ peer: { certificateVerified: false } });
    expect(result.decision).toBe("manual-approval");
    expect(result.reason).toBe("peer-certificate-not-verified");
  });

  it("refuses a peer chaining to a different organization root", () => {
    const result = evaluate({ peer: { presentedRootFingerprint: "sha256:deadbeef" } });
    expect(result.decision).toBe("manual-approval");
    expect(result.reason).toBe("root-fingerprint-mismatch");
  });

  it("refuses a peer that presents no root fingerprint at all", () => {
    const result = evaluate({ peer: { presentedRootFingerprint: null } });
    expect(result.decision).toBe("manual-approval");
    expect(result.reason).toBe("root-fingerprint-mismatch");
  });

  it("refuses when the peer reports a different organization", () => {
    const result = evaluate({ peer: { organizationRef: "ORG-SOMEONE-ELSE" } });
    expect(result.decision).toBe("manual-approval");
    expect(result.reason).toBe("organization-ref-mismatch");
  });

  it("refuses when either side has no organization ref", () => {
    expect(evaluate({ localTrust: { organizationRef: null } }).reason).toBe(
      "organization-ref-mismatch",
    );
    expect(evaluate({ peer: { organizationRef: null } }).reason).toBe("organization-ref-mismatch");
  });

  it("refuses an expired join package", () => {
    const result = evaluate({
      peer: { joinPackageExpiresAt: new Date("2026-08-22T23:59:59.000Z") },
    });
    expect(result.decision).toBe("manual-approval");
    expect(result.reason).toBe("join-package-expired");
  });

  it("treats expiry exactly at now as expired", () => {
    expect(evaluate({ peer: { joinPackageExpiresAt: NOW } }).reason).toBe("join-package-expired");
  });

  it("allows a package with no recorded expiry to pass that check", () => {
    expect(evaluate({ peer: { joinPackageExpiresAt: null } }).decision).toBe("auto-enroll");
  });

  it("never auto-enrols on missing evidence — the whole point", () => {
    // Strip every piece of proof at once; the result must still be closed.
    const result = evaluateOrganizationEnrollment({
      proposal: proposal(),
      localTrust: { rootFingerprint: null, organizationRef: null },
      peer: {
        certificateVerified: false,
        presentedRootFingerprint: null,
        organizationRef: null,
        joinPackageExpiresAt: null,
      },
      now: NOW,
    });
    expect(result.decision).toBe("manual-approval");
  });
});

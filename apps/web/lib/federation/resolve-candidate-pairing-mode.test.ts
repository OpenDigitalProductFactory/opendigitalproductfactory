import { describe, expect, it, vi } from "vitest";

import {
  resolveCandidatePairingMode,
  type CandidateFacts,
  type ChainObservation,
} from "./resolve-candidate-pairing-mode";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const ROOT = "a".repeat(64);
const ORG = "ORG-1779558156034";

function candidate(overrides: Partial<CandidateFacts> = {}): CandidateFacts {
  return {
    endpoint: "https://peer.internal:3000/",
    secure: true,
    relationshipPreset: "same-organization",
    role: "same-org-peer",
    peerOrganizationRef: ORG,
    peerJoinPackageExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
    ...overrides,
  };
}

const matchingChain: ChainObservation = {
  observed: true,
  chain: [
    { fingerprint256: "b".repeat(64), selfSigned: false },
    { fingerprint256: ROOT, selfSigned: true },
  ],
};

function resolve(overrides: {
  candidate?: Partial<CandidateFacts>;
  anchor?: { rootFingerprint: string | null; organizationRef: string | null };
  observation?: ChainObservation;
} = {}) {
  return resolveCandidatePairingMode({
    candidate: candidate(overrides.candidate),
    trustAnchor: overrides.anchor ?? { rootFingerprint: ROOT, organizationRef: ORG },
    observeChain: async () => overrides.observation ?? matchingChain,
    now: NOW,
  });
}

describe("resolveCandidatePairingMode — the whole chain of evidence", () => {
  it("auto-enrols a peer whose chain terminates at the pinned root", async () => {
    const result = await resolve();
    expect(result.decision.mode).toBe("auto-enroll");
    expect(result.evidence).toMatchObject({
      chainObserved: true,
      certificateVerified: true,
      presentedRootFingerprint: ROOT,
      trustAnchorEstablished: true,
    });
  });

  it("records why a peer was refused, not just that it was", async () => {
    const result = await resolve({
      observation: {
        observed: true,
        chain: [{ fingerprint256: "c".repeat(64), selfSigned: true }],
      },
    });
    expect(result.decision.mode).toBe("operator-confirmation");
    expect(result.evidence.verificationFailure).toBe("root-fingerprint-mismatch");
    expect(result.evidence.presentedRootFingerprint).toBe("c".repeat(64));
  });
});

describe("it does not dial a peer it has already ruled out", () => {
  it("skips observation entirely for plain HTTP", async () => {
    const observeChain = vi.fn(async (): Promise<ChainObservation> => matchingChain);
    const result = await resolveCandidatePairingMode({
      candidate: candidate({ secure: false }),
      trustAnchor: { rootFingerprint: ROOT, organizationRef: ORG },
      observeChain,
      now: NOW,
    });
    // No point dialling a peer whose transport already disqualifies it.
    expect(observeChain).not.toHaveBeenCalled();
    expect(result.decision.mode).toBe("blocked");
    expect(result.evidence.chainObserved).toBe(false);
  });
});

describe("every gap routes to the operator with its reason recorded", () => {
  it("records an unreachable peer", async () => {
    const result = await resolve({ observation: { observed: false, reason: "timeout" } });
    expect(result.decision.mode).toBe("operator-confirmation");
    expect(result.evidence.chainFailureReason).toBe("timeout");
    expect(result.evidence.certificateVerified).toBe(false);
  });

  it("records a missing trust anchor", async () => {
    const result = await resolve({ anchor: { rootFingerprint: null, organizationRef: null } });
    expect(result.decision.mode).toBe("operator-confirmation");
    expect(result.evidence.trustAnchorEstablished).toBe(false);
  });

  it("refuses a peer from a different organization even with a valid chain", async () => {
    const result = await resolve({ candidate: { peerOrganizationRef: "ORG-OTHER" } });
    expect(result.decision.mode).toBe("operator-confirmation");
    expect(result.decision.reason).toBe("organization-ref-mismatch");
    // The chain really did verify — organization identity is a separate gate.
    expect(result.evidence.certificateVerified).toBe(true);
  });

  it("refuses a cross-organization relationship", async () => {
    const result = await resolve({ candidate: { relationshipPreset: "service-provider" } });
    expect(result.decision.reason).toBe("relationship-is-cross-organization");
  });

  it("refuses an expired peer join package", async () => {
    const result = await resolve({
      candidate: { peerJoinPackageExpiresAt: new Date("2026-08-25T00:00:00.000Z") },
    });
    expect(result.decision.reason).toBe("join-package-expired");
  });

  it("never auto-enrols when the chain was never observed", async () => {
    const result = await resolve({ observation: { observed: false, reason: "refused" } });
    expect(result.decision.mode).not.toBe("auto-enroll");
  });
});

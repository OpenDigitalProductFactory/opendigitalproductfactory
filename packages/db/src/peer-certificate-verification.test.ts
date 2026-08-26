import { describe, expect, it } from "vitest";

import {
  normalizeFingerprint,
  verifyPeerChainAgainstRoot,
  type ObservedCertificate,
} from "./peer-certificate-verification";

const NOW = new Date("2026-08-26T00:00:00.000Z");
const ROOT_HEX = "a".repeat(64);
const ROOT_COLONS = "AA:".repeat(31) + "AA";

function cert(overrides: Partial<ObservedCertificate> = {}): ObservedCertificate {
  return {
    fingerprint256: "b".repeat(64),
    selfSigned: false,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validTo: new Date("2027-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function root(overrides: Partial<ObservedCertificate> = {}): ObservedCertificate {
  return cert({ fingerprint256: ROOT_HEX, selfSigned: true, ...overrides });
}

function verify(
  chain: ObservedCertificate[],
  pinned: string | null = ROOT_HEX,
  now: Date = NOW,
) {
  return verifyPeerChainAgainstRoot({ chain, pinnedRootFingerprint: pinned, now });
}

describe("normalizeFingerprint", () => {
  it("collapses Node's colon-separated form to bare lowercase hex", () => {
    // Node reports AA:BB:…; a join package records 64 bare hex characters.
    // Comparing those directly would never match.
    expect(normalizeFingerprint(ROOT_COLONS)).toBe(ROOT_HEX);
  });

  it("accepts bare hex in any case", () => {
    expect(normalizeFingerprint("A".repeat(64))).toBe(ROOT_HEX);
  });

  it("rejects anything that is not exactly 64 hex characters", () => {
    expect(normalizeFingerprint("abc")).toBeNull();
    expect(normalizeFingerprint("g".repeat(64))).toBeNull();
    expect(normalizeFingerprint("a".repeat(63))).toBeNull();
    expect(normalizeFingerprint("a".repeat(65))).toBeNull();
    expect(normalizeFingerprint(null)).toBeNull();
    expect(normalizeFingerprint(undefined)).toBeNull();
  });
});

describe("verifyPeerChainAgainstRoot — the only path that verifies", () => {
  it("verifies a chain terminating at the pinned root", () => {
    const result = verify([cert(), root()]);
    expect(result).toEqual({ verified: true, presentedRootFingerprint: ROOT_HEX });
  });

  it("matches across representation forms", () => {
    // Peer presents colons, package pinned bare hex.
    expect(verify([cert(), root({ fingerprint256: ROOT_COLONS })]).verified).toBe(true);
  });

  it("verifies a root-only chain", () => {
    expect(verify([root()]).verified).toBe(true);
  });
});

describe("every other path refuses", () => {
  it("refuses when nothing is pinned", () => {
    const result = verify([cert(), root()], null);
    expect(result).toMatchObject({ verified: false, failure: "no-pinned-root" });
  });

  it("refuses a malformed pinned value rather than comparing loosely", () => {
    expect(verify([cert(), root()], "not-a-fingerprint")).toMatchObject({
      failure: "no-pinned-root",
    });
  });

  it("refuses an empty chain", () => {
    expect(verify([])).toMatchObject({ verified: false, failure: "empty-chain" });
  });

  it("refuses a chain with no self-signed root", () => {
    expect(verify([cert(), cert()])).toMatchObject({ failure: "chain-has-no-root" });
  });

  it("refuses a root that chains to a different organization", () => {
    const result = verify([cert(), root({ fingerprint256: "c".repeat(64) })]);
    expect(result).toMatchObject({
      verified: false,
      failure: "root-fingerprint-mismatch",
      presentedRootFingerprint: "c".repeat(64),
    });
  });

  it("refuses a root whose fingerprint is malformed", () => {
    expect(verify([root({ fingerprint256: "zz" })])).toMatchObject({
      failure: "root-fingerprint-mismatch",
      presentedRootFingerprint: null,
    });
  });

  it("refuses an expired certificate anywhere in the chain", () => {
    // An expired intermediate breaks the chain as surely as an expired leaf.
    const expired = cert({ validTo: new Date("2026-08-25T00:00:00.000Z") });
    expect(verify([expired, root()])).toMatchObject({ failure: "certificate-expired" });
    expect(verify([cert(), root({ validTo: new Date("2026-08-25T00:00:00.000Z") })])).toMatchObject({
      failure: "certificate-expired",
    });
  });

  it("refuses a certificate that is not yet valid", () => {
    const future = cert({ validFrom: new Date("2026-09-01T00:00:00.000Z") });
    expect(verify([future, root()])).toMatchObject({ failure: "certificate-not-yet-valid" });
  });

  it("checks validity before matching, so an expired pinned root still refuses", () => {
    const staleRoot = root({ validTo: new Date("2026-08-01T00:00:00.000Z") });
    expect(verify([staleRoot]).verified).toBe(false);
  });

  it("never yields verified:true without a positive fingerprint match", () => {
    const cases: Array<[ObservedCertificate[], string | null]> = [
      [[], ROOT_HEX],
      [[cert()], ROOT_HEX],
      [[root()], null],
      [[root({ fingerprint256: "d".repeat(64) })], ROOT_HEX],
    ];
    for (const [chain, pinned] of cases) {
      expect(verify(chain, pinned).verified).toBe(false);
    }
  });
});

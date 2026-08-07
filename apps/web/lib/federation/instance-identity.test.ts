import { describe, expect, it } from "vitest";

import {
  DEVICE_ID_RE,
  deriveDeviceId,
  generateInstanceSigningKeypair,
  isDeviceId,
  keypairMatches,
  shortDeviceId,
} from "./instance-identity";

describe("generateInstanceSigningKeypair", () => {
  it("produces a valid, self-consistent Ed25519 keypair", () => {
    const kp = generateInstanceSigningKeypair();
    expect(kp.signingPublicKey.length).toBeGreaterThan(0);
    expect(kp.signingPrivateKey.length).toBeGreaterThan(0);
    expect(kp.signingPublicKey).not.toBe(kp.signingPrivateKey);
    expect(keypairMatches(kp)).toBe(true);
  });

  it("generates a distinct keypair each call", () => {
    const a = generateInstanceSigningKeypair();
    const b = generateInstanceSigningKeypair();
    expect(a.signingPublicKey).not.toBe(b.signingPublicKey);
    expect(deriveDeviceId(a.signingPublicKey)).not.toBe(deriveDeviceId(b.signingPublicKey));
  });
});

describe("deriveDeviceId", () => {
  it("is deterministic for the same public key", () => {
    const kp = generateInstanceSigningKeypair();
    expect(deriveDeviceId(kp.signingPublicKey)).toBe(deriveDeviceId(kp.signingPublicKey));
  });

  it("returns a well-formed did_<64hex> device id", () => {
    const kp = generateInstanceSigningKeypair();
    const id = deriveDeviceId(kp.signingPublicKey);
    expect(DEVICE_ID_RE.test(id)).toBe(true);
    expect(isDeviceId(id)).toBe(true);
  });

  it("rejects an empty key", () => {
    expect(() => deriveDeviceId("")).toThrow();
  });

  it("rejects a non-Ed25519 key (a random buffer is not a valid SPKI key)", () => {
    expect(() => deriveDeviceId(Buffer.from("not a real spki key").toString("base64"))).toThrow();
  });
});

describe("isDeviceId", () => {
  it.each([
    ["did_" + "a".repeat(64), true],
    ["did_" + "A".repeat(64), false], // must be lowercase hex
    ["did_" + "a".repeat(63), false], // wrong length
    ["ab".repeat(32), false], // missing prefix
    ["", false],
    [42, false],
  ])("isDeviceId(%s) === %s", (value, expected) => {
    expect(isDeviceId(value)).toBe(expected);
  });
});

describe("shortDeviceId", () => {
  it("elides the middle of a valid device id for display", () => {
    const id = "did_" + "0123456789abcdef".repeat(4);
    expect(shortDeviceId(id)).toBe("did_0123…cdef");
  });

  it("returns the input unchanged when it is not a device id", () => {
    expect(shortDeviceId("nonsense")).toBe("nonsense");
  });
});

describe("keypairMatches", () => {
  it("is false when the private key is swapped for another keypair's", () => {
    const a = generateInstanceSigningKeypair();
    const b = generateInstanceSigningKeypair();
    expect(keypairMatches({ signingPublicKey: a.signingPublicKey, signingPrivateKey: b.signingPrivateKey })).toBe(false);
  });

  it("is false on a garbage private key rather than throwing", () => {
    const a = generateInstanceSigningKeypair();
    expect(keypairMatches({ signingPublicKey: a.signingPublicKey, signingPrivateKey: "garbage" })).toBe(false);
  });
});

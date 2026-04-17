import { describe, it, expect } from "vitest";
import { createCipheriv, randomBytes } from "crypto";
import { canDecrypt, isKeyRotated } from "./credential-health-check";

// ─── Helpers: produce real AES-GCM "enc:*" payloads for the tests ──────────

function makeKey(hex: string = "a".repeat(64)): Buffer {
  return Buffer.from(hex, "hex");
}

function encryptWith(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

describe("canDecrypt", () => {
  it("returns true for a value encrypted with the same key", () => {
    const key = makeKey();
    const encrypted = encryptWith("sk-test-123", key);
    expect(canDecrypt(encrypted, key)).toBe(true);
  });

  it("returns false for a value encrypted with a different key (key rotation)", () => {
    const oldKey = makeKey("a".repeat(64));
    const newKey = makeKey("b".repeat(64));
    const encrypted = encryptWith("sk-test-123", oldKey);
    expect(canDecrypt(encrypted, newKey)).toBe(false);
  });

  it("returns true for legacy plaintext (no enc: prefix)", () => {
    const key = makeKey();
    expect(canDecrypt("sk-plaintext-legacy", key)).toBe(true);
  });

  it("returns false for malformed enc: payload", () => {
    const key = makeKey();
    expect(canDecrypt("enc:not-enough-parts", key)).toBe(false);
  });
});

describe("isKeyRotated", () => {
  it("returns false when the row has no encrypted fields", () => {
    const key = makeKey();
    expect(
      isKeyRotated(
        { secretRef: null, clientSecret: null, cachedToken: null, refreshToken: null },
        key,
      ),
    ).toBe(false);
  });

  it("returns false when all encrypted fields decrypt with the current key", () => {
    const key = makeKey();
    expect(
      isKeyRotated(
        {
          secretRef: encryptWith("sk-1", key),
          clientSecret: null,
          cachedToken: encryptWith("token-a", key),
          refreshToken: null,
        },
        key,
      ),
    ).toBe(false);
  });

  it("returns true when every encrypted field was encrypted with a different key", () => {
    const oldKey = makeKey("a".repeat(64));
    const newKey = makeKey("b".repeat(64));
    expect(
      isKeyRotated(
        {
          secretRef: encryptWith("sk-1", oldKey),
          clientSecret: null,
          cachedToken: encryptWith("token-a", oldKey),
          refreshToken: null,
        },
        newKey,
      ),
    ).toBe(true);
  });

  it("returns false when at least one encrypted field still decrypts (partial recovery)", () => {
    // Mixed state: one field was re-encrypted with the new key after rotation,
    // another is leftover from the old key.  Not a full rotation — don't flag.
    const oldKey = makeKey("a".repeat(64));
    const newKey = makeKey("b".repeat(64));
    expect(
      isKeyRotated(
        {
          secretRef: encryptWith("sk-1", newKey), // decrypts
          clientSecret: null,
          cachedToken: encryptWith("token-old", oldKey), // doesn't decrypt
          refreshToken: null,
        },
        newKey,
      ),
    ).toBe(false);
  });

  it("ignores legacy plaintext fields when classifying", () => {
    const key = makeKey();
    // A row with only plaintext values has no "enc:" fields — not rotated.
    expect(
      isKeyRotated(
        {
          secretRef: "sk-plain",
          clientSecret: null,
          cachedToken: null,
          refreshToken: null,
        },
        key,
      ),
    ).toBe(false);
  });

  it("flags a row where every enc: field is malformed", () => {
    const key = makeKey();
    expect(
      isKeyRotated(
        {
          secretRef: "enc:malformed",
          clientSecret: null,
          cachedToken: "enc:also:bad",
          refreshToken: null,
        },
        key,
      ),
    ).toBe(true);
  });
});

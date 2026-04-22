import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encryptSecret, decryptSecret, encryptJson, decryptJson } from "./credential-crypto";

const TEST_KEY_HEX = "0".repeat(64);

describe("credential-crypto", () => {
  let originalKey: string | undefined;

  beforeAll(() => {
    originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY_HEX;
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
  });

  describe("encryptSecret/decryptSecret round-trip", () => {
    it("round-trips a simple string", () => {
      const plaintext = "hunter2";
      const encrypted = encryptSecret(plaintext);
      expect(encrypted.startsWith("enc:")).toBe(true);
      expect(decryptSecret(encrypted)).toBe(plaintext);
    });

    it("returns legacy plaintext unchanged on decrypt", () => {
      expect(decryptSecret("legacy-value-no-prefix")).toBe("legacy-value-no-prefix");
    });

    it("returns null on malformed enc: input", () => {
      expect(decryptSecret("enc:too:few")).toBeNull();
    });
  });

  describe("encryptJson/decryptJson", () => {
    it("round-trips a complex object", () => {
      const value = { a: "secret", b: 42, c: [1, 2, 3], d: { nested: true } };
      const encrypted = encryptJson(value);
      expect(encrypted.startsWith("enc:")).toBe(true);
      expect(decryptJson<typeof value>(encrypted)).toEqual(value);
    });

    it("round-trips an array at the root", () => {
      const value = ["a", "b", "c"];
      expect(decryptJson<string[]>(encryptJson(value))).toEqual(value);
    });

    it("round-trips null", () => {
      const encrypted = encryptJson(null);
      expect(decryptJson<null>(encrypted)).toBeNull();
      // But this is a valid null, not a decryption failure — distinguish by checking the encrypted form existed.
      expect(encrypted.startsWith("enc:")).toBe(true);
    });

    it("returns null when the underlying decryptSecret fails", () => {
      expect(decryptJson<unknown>("enc:bad:payload:here")).toBeNull();
    });

    it("returns null when the decrypted text is not valid JSON", () => {
      // Manually encrypt a non-JSON string, then try to decryptJson it.
      const notJson = encryptSecret("this is not json {{{");
      expect(decryptJson<unknown>(notJson)).toBeNull();
    });
  });
});

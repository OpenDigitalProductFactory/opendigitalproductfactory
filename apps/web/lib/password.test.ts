import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("hashPassword", () => {
  it("returns a bcrypt hash starting with $2", async () => {
    const hash = await hashPassword("testpassword");
    expect(hash.startsWith("$2")).toBe(true);
  });
  it("produces different hashes for same input (salted)", async () => {
    const hash1 = await hashPassword("same");
    const hash2 = await hashPassword("same");
    expect(hash1).not.toBe(hash2);
  });
});

describe("verifyPassword", () => {
  it("verifies a bcrypt hash", async () => {
    const hash = await hashPassword("mypassword");
    const result = await verifyPassword("mypassword", hash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(false);
  });
  it("rejects wrong password against bcrypt hash", async () => {
    const hash = await hashPassword("correct");
    const result = await verifyPassword("wrong", hash);
    expect(result.valid).toBe(false);
  });
  it("verifies a legacy SHA-256 hash and flags for rehash", async () => {
    const encoder = new TextEncoder();
    const data = encoder.encode("legacypass");
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
    const sha256Hash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const result = await verifyPassword("legacypass", sha256Hash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });
  it("rejects wrong password against SHA-256 hash", async () => {
    const sha256Hash = "a".repeat(64);
    const result = await verifyPassword("anything", sha256Hash);
    expect(result.valid).toBe(false);
  });
});

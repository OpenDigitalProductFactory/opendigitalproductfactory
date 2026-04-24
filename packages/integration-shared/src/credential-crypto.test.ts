import { afterEach, describe, expect, it, vi } from "vitest";

import { decryptJson, decryptSecret, encryptJson, encryptSecret } from "./credential-crypto";

describe("credential-crypto", () => {
  const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
    }
    vi.restoreAllMocks();
  });

  it("round-trips encrypted secrets with the shared envelope", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "1".repeat(64);

    const encrypted = encryptSecret("payroll-secret");

    expect(encrypted.startsWith("enc:")).toBe(true);
    expect(decryptSecret(encrypted)).toBe("payroll-secret");
  });

  it("round-trips encrypted JSON payloads", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = "2".repeat(64);

    const encrypted = encryptJson({
      accessToken: "token-123",
      expiresAt: "2026-04-24T12:00:00.000Z",
    });

    expect(decryptJson(encrypted)).toEqual({
      accessToken: "token-123",
      expiresAt: "2026-04-24T12:00:00.000Z",
    });
  });

  it("returns plaintext when no encryption key is configured", () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(encryptSecret("plaintext-fallback")).toBe("plaintext-fallback");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

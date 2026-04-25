import { describe, expect, it } from "vitest";
import { redactFingerprintEvidence } from "./discovery-fingerprint-redaction";

describe("redactFingerprintEvidence", () => {
  it("redacts private network and tenant identifiers", () => {
    const result = redactFingerprintEvidence({
      banner: "prod-acme-sql-01.internal.example.com 10.0.4.15 serial ABC123",
      mac: "aa:bb:cc:dd:ee:ff",
      model: "PostgreSQL 16",
    });

    expect(result.status).toBe("redacted");
    expect(JSON.stringify(result.normalizedEvidence)).not.toContain("acme");
    expect(JSON.stringify(result.normalizedEvidence)).not.toContain("10.0.4.15");
    expect(JSON.stringify(result.normalizedEvidence)).not.toContain("aa:bb:cc");
    expect(result.redactedFields).toEqual(expect.arrayContaining(["banner", "mac"]));
  });

  it("blocks secrets instead of trying to sanitize them", () => {
    const result = redactFingerprintEvidence({
      header: "Authorization: Bearer secret-token",
    });

    expect(result.status).toBe("blocked_sensitive");
    expect(result.blockedReasons).toContain("secret_like_token");
  });
});

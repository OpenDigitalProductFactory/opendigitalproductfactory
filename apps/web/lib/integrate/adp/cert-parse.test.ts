import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCertExpiry } from "./cert-parse";

const validPem = readFileSync(resolve(__dirname, "fixtures/valid-cert.pem"), "utf8");
const malformedPem = readFileSync(resolve(__dirname, "fixtures/malformed-cert.pem"), "utf8");

describe("parseCertExpiry", () => {
  it("extracts a future expiry date from a valid PEM (cert is openssl -days 365)", () => {
    const result = parseCertExpiry(validPem);
    expect(result).toBeInstanceOf(Date);
    const msUntilExpiry = result!.getTime() - Date.now();
    // Cert was generated with `-days 365` at fixture-gen time. Loose bounds so
    // the test doesn't go flaky as the fixture ages. Valid as long as the
    // fixture hasn't aged more than ~15 days past generation.
    const days = msUntilExpiry / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(350);
    expect(days).toBeLessThan(366);
  });

  it("returns null for a malformed PEM (fail-closed)", () => {
    expect(parseCertExpiry(malformedPem)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseCertExpiry("")).toBeNull();
  });

  it("returns null for plain garbage", () => {
    expect(parseCertExpiry("just some text, definitely not a certificate")).toBeNull();
  });

  it("returns null for a truncated PEM", () => {
    const truncated = validPem.slice(0, validPem.length / 2);
    expect(parseCertExpiry(truncated)).toBeNull();
  });
});

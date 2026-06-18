import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCertExpiry } from "./cert-parse";

const validPem = readFileSync(resolve(__dirname, "fixtures/valid-cert.pem"), "utf8");
const malformedPem = readFileSync(resolve(__dirname, "fixtures/malformed-cert.pem"), "utf8");

describe("parseCertExpiry", () => {
  it("extracts a far-future expiry date from a valid PEM (cert is openssl -days 36500)", () => {
    const result = parseCertExpiry(validPem);
    expect(result).toBeInstanceOf(Date);
    const days = (result!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    // The fixture is regenerated as a ~100-year (`-days 36500`) cert so this test
    // does NOT decay over time — the previous 365-day fixture drifted below its
    // lower bound as it aged and went flaky. We assert the expiry is far in the
    // future (proving the real notAfter was parsed, not now/epoch) with a wide
    // lower bound that tolerates decades of fixture aging before regeneration.
    expect(days).toBeGreaterThan(25000); // ~31 years of slack before this could fail
    expect(days).toBeLessThan(37000);
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

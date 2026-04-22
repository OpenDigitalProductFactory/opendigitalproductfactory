import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCertExpiry } from "./cert-parse";

const validPem = readFileSync(resolve(__dirname, "fixtures/valid-cert.pem"), "utf8");
const malformedPem = readFileSync(resolve(__dirname, "fixtures/malformed-cert.pem"), "utf8");

describe("parseCertExpiry", () => {
  it("extracts a future expiry date from a valid PEM", () => {
    const result = parseCertExpiry(validPem);
    expect(result).toBeInstanceOf(Date);
    const now = Date.now();
    const fiveMinutesInMs = 5 * 60 * 1000;
    const aYearAndADayInMs = (365 + 1) * 24 * 60 * 60 * 1000;
    const msUntilExpiry = result!.getTime() - now;
    expect(msUntilExpiry).toBeGreaterThan(365 * 24 * 60 * 60 * 1000 - fiveMinutesInMs);
    expect(msUntilExpiry).toBeLessThan(aYearAndADayInMs);
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

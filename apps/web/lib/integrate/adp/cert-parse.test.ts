import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCertExpiry } from "./cert-parse";

const validPem = readFileSync(resolve(__dirname, "fixtures/valid-cert.pem"), "utf8");
const malformedPem = readFileSync(resolve(__dirname, "fixtures/malformed-cert.pem"), "utf8");

describe("parseCertExpiry", () => {
  // Pinned so the "genuinely in the future" sanity check below keeps a fixed
  // reference point. The fixture cert expires 2027-05-24; against the real clock
  // that assertion is the last remaining wall-clock dependency in this test and
  // would fail permanently on that date. This is the third round of the same
  // fight — see the comment below on the >350 -> >340 day-count loosening — and
  // pinning ends it rather than moving the threshold again.
  beforeEach(() => vi.useFakeTimers().setSystemTime("2026-06-15T12:00:00.000Z"));
  afterEach(() => vi.useRealTimers());

  it("extracts a future expiry date from a valid PEM (cert is openssl -days 365)", () => {
    const result = parseCertExpiry(validPem);
    expect(result).toBeInstanceOf(Date);
    // Assert against the fixture's actual notAfter, not a days-from-now window.
    // The cert's expiry is fixed (`openssl x509 -enddate` on
    // fixtures/valid-cert.pem -> "May 24 15:24:15 2027 GMT"), but a relative
    // day-count bound shrinks every day and aged into flakiness — it was
    // loosened >350 -> >340 once and then failed again at 339.78. Comparing to
    // the fixed date is deterministic and still proves we parsed the real
    // expiry. If the fixture is regenerated, update this expected value.
    expect(result!.toISOString()).toBe("2027-05-24T15:24:15.000Z");
    // Sanity: the parsed expiry is genuinely in the future.
    expect(result!.getTime()).toBeGreaterThan(Date.now());
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

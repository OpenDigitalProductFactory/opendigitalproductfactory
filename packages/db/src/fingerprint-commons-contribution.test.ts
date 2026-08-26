import { describe, expect, it } from "vitest";

import {
  buildCommonsFingerprint,
  isContributableFingerprint,
  looksLikeIdentifier,
  assertNoIdentifiers,
} from "./fingerprint-commons-contribution";

describe("fingerprint commons contribution — privacy boundary (BI-57C27DE1)", () => {
  it("builds a scrubbed vendor->class fingerprint for a generalizable known", () => {
    const out = buildCommonsFingerprint({
      vendor: "Ubiquiti Inc",
      deviceClass: "access_point",
      rawEvidence: { mac: "60:22:32:bc:74:95", address: "192.168.0.21", hostname: "marks-ap" },
    });
    expect(out).toEqual({ vendor: "Ubiquiti Inc", deviceClass: "access_point" });
  });

  it("NEVER copies identifiers from rawEvidence into the contribution", () => {
    const out = buildCommonsFingerprint({
      vendor: "Nest Labs",
      deviceClass: "thermostat",
      rawEvidence: { mac: "18:b4:30:00:00:01", ip: "192.168.0.114", serial: "ABC123", owner: "Mark" },
    });
    expect(out).not.toBeNull();
    const keys = Object.keys(out!);
    expect(keys.sort()).toEqual(["deviceClass", "vendor"]);
    // no identifier value leaked
    expect(JSON.stringify(out)).not.toMatch(/192\.168|18:b4:30|ABC123|Mark/);
  });

  it("returns null for a proprietary / unidentified device (kept local)", () => {
    expect(buildCommonsFingerprint({ vendor: "Acme Custom Corp", deviceClass: "proprietary" })).toBeNull();
    expect(buildCommonsFingerprint({ vendor: "Whatever", deviceClass: "unknown" })).toBeNull();
    expect(buildCommonsFingerprint({ vendor: "X", deviceClass: "generic" })).toBeNull();
  });

  it("returns null when vendor or class is missing", () => {
    expect(buildCommonsFingerprint({ vendor: null, deviceClass: "ip_camera" })).toBeNull();
    expect(buildCommonsFingerprint({ vendor: "Reolink", deviceClass: null })).toBeNull();
    expect(buildCommonsFingerprint({ vendor: "  ", deviceClass: "ip_camera" })).toBeNull();
  });

  it("rejects a vendor that is actually an identifier (IP/MAC leaked into the vendor slot)", () => {
    expect(isContributableFingerprint({ vendor: "192.168.0.5", deviceClass: "ip_camera" })).toBe(false);
    expect(isContributableFingerprint({ vendor: "host 60:22:32:bc:74:95", deviceClass: "access_point" })).toBe(false);
    expect(buildCommonsFingerprint({ vendor: "10.0.0.1", deviceClass: "thermostat" })).toBeNull();
  });

  it("looksLikeIdentifier catches IPv4/IPv6/MAC", () => {
    expect(looksLikeIdentifier("192.168.0.1")).toBe(true);
    expect(looksLikeIdentifier("fe80::1ff:fe23:4567:890a")).toBe(true);
    expect(looksLikeIdentifier("60:22:32:bc:74:95")).toBe(true);
    expect(looksLikeIdentifier("Ubiquiti Inc")).toBe(false);
  });

  it("assertNoIdentifiers throws on identifier-shaped keys or values (defense in depth)", () => {
    expect(() => assertNoIdentifiers({ macAddress: "x" })).toThrow(/identifier/);
    expect(() => assertNoIdentifiers({ hostname: "y" })).toThrow(/identifier/);
    expect(() => assertNoIdentifiers({ vendor: "192.168.0.9" })).toThrow(/identifier/);
    expect(() => assertNoIdentifiers({ vendor: "Ubiquiti", deviceClass: "access_point" })).not.toThrow();
  });
});

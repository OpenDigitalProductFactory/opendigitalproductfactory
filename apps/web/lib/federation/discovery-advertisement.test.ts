import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { federationAdvertisementSchema } from "@dpf/validators";

import {
  FEDERATION_ROTATION_WINDOW_MS,
  buildFederationAdvertisement,
  federationAdvertisingEnabled,
  federationCapabilityDigest,
  rotatingDiscoveryId,
} from "./discovery-advertisement";

const SECRET = "a".repeat(64);
const AT = new Date("2026-08-28T12:00:00.000Z");

describe("rotatingDiscoveryId", () => {
  it("is stable inside a window and different across windows", () => {
    const early = rotatingDiscoveryId(SECRET, AT);
    const later = rotatingDiscoveryId(SECRET, new Date(AT.getTime() + 60_000));
    const next = rotatingDiscoveryId(SECRET, new Date(AT.getTime() + FEDERATION_ROTATION_WINDOW_MS));
    expect(later).toBe(early);
    expect(next).not.toBe(early);
  });

  it("differs per installation secret", () => {
    expect(rotatingDiscoveryId(SECRET, AT)).not.toBe(rotatingDiscoveryId("b".repeat(64), AT));
  });

  it("never leaks the secret", () => {
    expect(rotatingDiscoveryId(SECRET, AT)).not.toContain(SECRET.slice(0, 8));
  });
});

describe("federationCapabilityDigest", () => {
  it("is the first four bytes of the capability version digest", () => {
    // The Go advertiser publishes hex(sha256(capabilityVersion)[:4]); a peer
    // advertised by either side must describe one generation identically.
    const expected = createHash("sha256").update("dpf.demand/1").digest("hex").slice(0, 8);
    expect(federationCapabilityDigest()).toBe(expected);
  });
});

describe("buildFederationAdvertisement", () => {
  it("produces a descriptor the shared contract accepts", () => {
    const advertisement = buildFederationAdvertisement({
      projectionSecret: SECRET,
      estateName: "North Wind",
      now: AT,
    });
    expect(federationAdvertisementSchema.safeParse(advertisement).success).toBe(true);
    expect(advertisement.organization).toBe("North Wind");
    expect(advertisement.pair).toBe("/connect/pair");
  });

  it("omits the organization when the install has never been named", () => {
    const advertisement = buildFederationAdvertisement({
      projectionSecret: SECRET,
      estateName: null,
      now: AT,
    });
    expect(advertisement.organization).toBeUndefined();
    expect(federationAdvertisementSchema.safeParse(advertisement).success).toBe(true);
  });

  it("omits an estate name the identity contract would refuse", () => {
    const advertisement = buildFederationAdvertisement({
      projectionSecret: SECRET,
      estateName: "  ",
      now: AT,
    });
    expect(advertisement.organization).toBeUndefined();
  });
});

describe("federationAdvertisingEnabled", () => {
  it("advertises unless an operator turns it off", () => {
    expect(federationAdvertisingEnabled({})).toBe(true);
    expect(federationAdvertisingEnabled({ DPF_FEDERATION_ADVERTISE: "1" })).toBe(true);
    expect(federationAdvertisingEnabled({ DPF_FEDERATION_ADVERTISE: "0" })).toBe(false);
    expect(federationAdvertisingEnabled({ DPF_FEDERATION_ADVERTISE: "false" })).toBe(false);
    expect(federationAdvertisingEnabled({ DPF_FEDERATION_ADVERTISE: " OFF " })).toBe(false);
    expect(federationAdvertisingEnabled({ DPF_FEDERATION_ADVERTISE: "no" })).toBe(false);
  });
});

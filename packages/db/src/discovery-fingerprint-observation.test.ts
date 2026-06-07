import { describe, expect, it } from "vitest";
import { buildDeviceFingerprintObservation } from "./discovery-fingerprint-observation";

describe("buildDeviceFingerprintObservation", () => {
  it("builds an observation from an ARP item's OUI vendor + MAC + name", () => {
    const obs = buildDeviceFingerprintObservation({
      name: "Reolink 192.168.0.42",
      attributes: { vendor: "Reolink", vendorShort: "Reolink", vendorOui: "EC71DB", mac: "ec:71:db:11:22:33" },
    });
    expect(obs).not.toBeNull();
    expect(obs!.evidenceFamilies).toContain("mac_oui");
    const ev = obs!.normalizedEvidence as Record<string, unknown>;
    expect(ev.vendor).toBe("reolink"); // lower-cased for case-stable contains
    expect(ev.oui).toBe("EC71DB");
    expect(ev.mac).toBe("EC71DB112233");
    expect(ev.vendorRole).toBe("device");
  });

  it("flags a randomized MAC as not resolvable by OUI", () => {
    const obs = buildDeviceFingerprintObservation({
      name: "unknown-host",
      attributes: { mac: "06:ae:95:aa:bb:cc" },
    });
    expect(obs).not.toBeNull();
    const ev = obs!.normalizedEvidence as Record<string, unknown>;
    expect(ev.randomized).toBe(true);
    expect(ev.resolvableByOui).toBe(false);
  });

  it("derives the OUI from the MAC when no explicit oui attribute is present", () => {
    const obs = buildDeviceFingerprintObservation({
      attributes: { vendor: "Ubiquiti Inc", mac: "f4-92-bf-00-11-22" },
    });
    const ev = obs!.normalizedEvidence as Record<string, unknown>;
    expect(ev.oui).toBe("F492BF");
  });

  it("returns null when there is no usable day-one signal", () => {
    expect(buildDeviceFingerprintObservation({ attributes: {} })).toBeNull();
    expect(buildDeviceFingerprintObservation({ name: "  ", attributes: {} })).toBeNull();
  });

  it("includes hostname family when a name is present", () => {
    const obs = buildDeviceFingerprintObservation({ name: "kitchen-echo", attributes: { vendor: "Amazon" } });
    expect(obs!.evidenceFamilies).toEqual(expect.arrayContaining(["mac_oui", "hostname"]));
    expect((obs!.normalizedEvidence as Record<string, unknown>).hostname).toBe("kitchen-echo");
  });
});

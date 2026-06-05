import { describe, expect, it } from "vitest";
import { classifyMac, matchModuleVendor, normalizeMac } from "./discovery-mac-classification";

describe("normalizeMac", () => {
  it("canonicalizes separators and case to 12-hex upper", () => {
    expect(normalizeMac("00:a0:c9:12:34:56")).toBe("00A0C9123456");
    expect(normalizeMac("00-a0-c9-12-34-56")).toBe("00A0C9123456");
    expect(normalizeMac("00a0.c912.3456")).toBe("00A0C9123456");
  });

  it("returns null for invalid input", () => {
    expect(normalizeMac("")).toBeNull();
    expect(normalizeMac(null)).toBeNull();
    expect(normalizeMac("not-a-mac")).toBeNull();
    expect(normalizeMac("00:a0:c9:12:34")).toBeNull();
  });
});

describe("classifyMac — U/L bit (randomized / locally administered)", () => {
  it("flags a globally-administered Apple MAC as a resolvable device", () => {
    const c = classifyMac("00:a0:c9:12:34:56", "Apple, Inc.");
    expect(c.locallyAdministered).toBe(false);
    expect(c.randomized).toBe(false);
    expect(c.vendorRole).toBe("device");
    expect(c.resolvableByOui).toBe(true);
    expect(c.oui).toBe("00A0C9");
  });

  it("flags a locally-administered (randomized) MAC as unresolvable by OUI", () => {
    // 06: second-least-significant bit of first octet (0x02) set, unicast.
    const c = classifyMac("06:ae:95:aa:bb:cc", "SomeVendor");
    expect(c.locallyAdministered).toBe(true);
    expect(c.randomized).toBe(true);
    expect(c.vendorRole).toBe("unknown");
    expect(c.resolvableByOui).toBe(false);
  });

  it("detects multicast (I/G bit) separately from randomization", () => {
    // 01: least-significant bit (0x01) set → multicast; also locally admin via 0x02? no, 0x01 only.
    const c = classifyMac("01:00:5e:00:00:fb");
    expect(c.multicast).toBe(true);
    expect(c.randomized).toBe(false);
  });

  it("matches the live estate's randomized host 06:ae:95 (192.168.0.59)", () => {
    const c = classifyMac("06:ae:95:00:11:22");
    expect(c.randomized).toBe(true);
    expect(c.resolvableByOui).toBe(false);
  });
});

describe("classifyMac — module / OEM-radio vendors (vendor ≠ device)", () => {
  it("flags Espressif as a module vendor, not a device", () => {
    const c = classifyMac("24:0a:c4:11:22:33", "Espressif Inc.");
    expect(c.moduleVendor).toBe("Espressif");
    expect(c.vendorRole).toBe("module");
    expect(c.resolvableByOui).toBe(false);
  });

  it("flags Sichuan AI-Link as a module vendor", () => {
    expect(matchModuleVendor("Sichuan AI-Link Technology Co., Ltd.")).toBe("Sichuan AI-Link");
    const c = classifyMac("a0:b1:c2:d3:e4:f5", "Sichuan AI-Link Technology Co., Ltd.");
    expect(c.vendorRole).toBe("module");
    expect(c.resolvableByOui).toBe(false);
  });

  it("flags FN-Link as a module vendor", () => {
    expect(matchModuleVendor("FN-LINK TECHNOLOGY LIMITED")).toBe("FN-Link");
  });

  it("returns null moduleVendor for a normal brand", () => {
    expect(matchModuleVendor("Reolink")).toBeNull();
    expect(matchModuleVendor(null)).toBeNull();
  });
});

describe("classifyMac — unknown vendor", () => {
  it("is unresolvable when no vendor is supplied", () => {
    const c = classifyMac("00:a0:c9:12:34:56");
    expect(c.vendorRole).toBe("unknown");
    expect(c.resolvableByOui).toBe(false);
  });

  it("handles invalid MAC but still classifies module vendor from the name", () => {
    const c = classifyMac("garbage", "Espressif");
    expect(c.normalized).toBeNull();
    expect(c.moduleVendor).toBe("Espressif");
    expect(c.vendorRole).toBe("module");
  });
});

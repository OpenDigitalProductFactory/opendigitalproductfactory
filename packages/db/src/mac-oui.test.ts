import { describe, expect, it } from "vitest";

import {
  isLocallyAdministered,
  normalizeMac,
  ouiPrefix,
  parseOuiRegistry,
  resolveMacVendor,
} from "./mac-oui";

// The registry is the platform's OWN answer to "who made this device".
//
// Before it, every vendor on the live install came from the UniFi controller's
// lookup, supplied per-client in its API response — so a device the controller
// did not describe stayed unidentified forever, including all six UniFi devices
// themselves (BI-9632B15B). These pin the resolution rules, and especially the
// distinction between "cannot know" and "do not know yet".

const REGISTRY = new Map<string, string>([
  ["AC8BA9", "Ubiquiti Inc"],
  ["588C81", "Espressif Inc."],
]);

describe("normalizeMac", () => {
  it("accepts every common rendering", () => {
    for (const raw of ["ac:8b:a9:3f:1b:29", "AC-8B-A9-3F-1B-29", "ac8ba9.3f1b.29", "AC8BA93F1B29"]) {
      expect(normalizeMac(raw)).toBe("AC8BA93F1B29");
    }
  });

  it("rejects anything that is not 48 bits of hex", () => {
    for (const raw of ["", "not-a-mac", "ac:8b:a9", "ac:8b:a9:3f:1b:29:ff", null, undefined]) {
      expect(normalizeMac(raw as string)).toBeNull();
    }
  });
});

describe("isLocallyAdministered", () => {
  it("detects the randomised MACs that can never carry an OUI", () => {
    // Live sample: every ARP host swept was of this kind — 0 of 119 resolved.
    for (const raw of ["76:8b:e4:c0:29:98", "ee:8c:ac:d5:bc:3e", "d2:5d:04:37:ea:60", "c2:34:90:87:14:8a"]) {
      expect(isLocallyAdministered(raw)).toBe(true);
    }
  });

  it("does not flag burned-in addresses", () => {
    // The six UniFi devices, plus the Espressif client the controller resolved.
    for (const raw of ["ac:8b:a9:3f:1b:29", "d8:b3:70:f8:80:5b", "fc:ec:da:bc:a5:49", "58:8c:81:61:12:cc"]) {
      expect(isLocallyAdministered(raw)).toBe(false);
    }
  });
});

describe("resolveMacVendor", () => {
  it("resolves a burned-in MAC to its manufacturer", () => {
    expect(resolveMacVendor("ac:8b:a9:3f:1b:29", REGISTRY)).toEqual({
      vendor: "Ubiquiti Inc",
      reason: "resolved",
    });
  });

  it("reproduces the vendor the UniFi controller supplied independently", () => {
    // The controller returned "Espressif Inc." for this client. Our own registry
    // agreeing is what makes the lookup trustworthy as a replacement.
    expect(resolveMacVendor("58:8c:81:61:12:cc", REGISTRY).vendor).toBe("Espressif Inc.");
  });

  it("reports a randomised MAC as unresolvable, NOT merely unknown", () => {
    // Load-bearing: an unknown OUI might be fixed by refreshing the registry, but
    // a locally-administered address has no OUI by construction. Conflating them
    // sends someone hunting for registry data that will never help.
    expect(resolveMacVendor("76:8b:e4:c0:29:98", REGISTRY)).toEqual({
      vendor: null,
      reason: "randomised-mac",
    });
  });

  it("separates an unknown OUI from an invalid MAC", () => {
    expect(resolveMacVendor("00:00:5e:00:53:01", REGISTRY).reason).toBe("unknown-oui");
    expect(resolveMacVendor("nonsense", REGISTRY).reason).toBe("invalid-mac");
  });
});

describe("ouiPrefix", () => {
  it("takes the first 24 bits", () => {
    expect(ouiPrefix("ac:8b:a9:3f:1b:29")).toBe("AC8BA9");
    expect(ouiPrefix("bogus")).toBeNull();
  });
});

describe("parseOuiRegistry", () => {
  it("parses the shipped TSV shape", () => {
    expect(parseOuiRegistry("286FB9\tNokia Shanghai Bell Co., Ltd.\n08EA44\tExtreme Networks")).toEqual([
      { oui: "286FB9", vendor: "Nokia Shanghai Bell Co., Ltd." },
      { oui: "08EA44", vendor: "Extreme Networks" },
    ]);
  });

  it("skips malformed lines instead of throwing", () => {
    // One bad row in ~39k must not fail the whole seed.
    const parsed = parseOuiRegistry(
      ["# comment", "", "SHORT\tVendor", "AC8BA9\tUbiquiti Inc", "NOTABTAB", "112233\t"].join("\n"),
    );
    expect(parsed).toEqual([{ oui: "AC8BA9", vendor: "Ubiquiti Inc" }]);
  });
});

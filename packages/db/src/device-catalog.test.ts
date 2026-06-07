import { describe, expect, it } from "vitest";
import {
  buildPublicDeviceCatalog,
  projectPublicCatalogEntry,
  type PublicCatalogRuleInput,
} from "./device-catalog";

const reolink: PublicCatalogRuleInput = {
  ruleKey: "estate:reolink-camera",
  status: "active",
  scope: "global",
  matchExpression: { all: [{ type: "contains", path: "vendor", value: "reolink" }] },
  requiredEvidenceFamilies: ["mac_oui"],
  resolvedIdentity: { kind: "device", name: "Reolink IP camera / NVR", vendor: "Reolink", deviceClass: "ip_camera" },
  taxonomyNodeId: "foundational/building_management/security_and_surveillance",
  identityConfidence: 0.96,
  taxonomyConfidence: 0.96,
};

describe("projectPublicCatalogEntry", () => {
  it("projects an active global rule into a placement-aware entry", () => {
    const entry = projectPublicCatalogEntry(reolink)!;
    expect(entry.identity).toEqual({ name: "Reolink IP camera / NVR", vendor: "Reolink", deviceClass: "ip_camera" });
    expect(entry.placement.taxonomyNodeId).toBe("foundational/building_management/security_and_surveillance");
    expect(entry.placement.portfolio).toBe("foundational");
    expect(entry.placement.path).toEqual(["Foundational", "Building Management", "Security And Surveillance"]);
    expect(entry.signals).toEqual([{ signal: "vendor contains", match: "reolink" }]);
  });

  it("excludes non-active or non-global rules", () => {
    expect(projectPublicCatalogEntry({ ...reolink, status: "draft" })).toBeNull();
    expect(projectPublicCatalogEntry({ ...reolink, scope: "local" })).toBeNull();
  });

  it("drops an entry whose projected shape would leak a secret (fail-closed)", () => {
    const poisoned: PublicCatalogRuleInput = {
      ...reolink,
      matchExpression: { all: [{ type: "contains", path: "banner", value: "authorization: bearer sk-xyz" }] },
    };
    expect(projectPublicCatalogEntry(poisoned)).toBeNull();
  });
});

describe("buildPublicDeviceCatalog", () => {
  it("builds a versioned, sorted, count-bearing catalog of publishable entries", () => {
    const catalog = buildPublicDeviceCatalog(
      [
        reolink,
        { ...reolink, ruleKey: "estate:amazon-voice", resolvedIdentity: { kind: "device", name: "Amazon Echo", vendor: "Amazon", deviceClass: "voice_assistant" }, taxonomyNodeId: "foundational/network_management/voice" },
        { ...reolink, ruleKey: "estate:draft-thing", status: "draft" },
      ],
      { version: "1.2.3" },
    );
    expect(catalog.schemaVersion).toBe("2");
    expect(catalog.version).toBe("1.2.3");
    expect(catalog.count).toBe(2); // draft excluded
    expect(catalog.entries.map((e) => e.ruleKey)).toEqual(["estate:amazon-voice", "estate:reolink-camera"]);
  });

  it("never includes PII fields (no MAC/IP) in published entries", () => {
    const catalog = buildPublicDeviceCatalog([reolink]);
    expect(JSON.stringify(catalog)).not.toMatch(/(?:[0-9a-f]{2}:){5}[0-9a-f]{2}/i);
  });
});

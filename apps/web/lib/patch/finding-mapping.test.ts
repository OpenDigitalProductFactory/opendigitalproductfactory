import { describe, expect, it } from "vitest";

import type { PatchFindingUpsert } from "@dpf/db/patch";

import { toNormalizedAssuranceFinding } from "./finding-mapping";

function upsert(overrides: Partial<PatchFindingUpsert> = {}): PatchFindingUpsert {
  return {
    findingKey: "patch:ev1",
    findingKind: "patch-gap",
    title: "Firefox 120.0 → 121.0",
    description: "A newer version is available (121.0).",
    affectedType: "DiscoveredSoftwareEvidence",
    affectedId: "ev1",
    adapterKey: "patch-intel",
    vendorIdentifier: "winget:firefox",
    policySeverity: "medium",
    remediationHint: { targetVersion: "121.0", applyVia: "winget" },
    source: { inventoryEntityId: "host-1", installedVersion: "120.0" },
    ...overrides,
  };
}

describe("toNormalizedAssuranceFinding", () => {
  it("maps patch-gap -> missing-patch on the host with a weak identifier", () => {
    const n = toNormalizedAssuranceFinding(upsert());
    expect(n.findingKind).toBe("missing-patch");
    expect(n.affectedType).toBe("inventory-entity");
    expect(n.affectedId).toBe("host-1");
    expect(n.identifierStability).toBe("weak");
    expect(n.releaseImpact).toBe("track");
    expect(n.findingKey).toBe("patch:ev1");
    expect(n.evidence).toMatchObject({ installedVersion: "120.0" });
    expect(n.remediationHint).toMatchObject({ targetVersion: "121.0" });
  });

  it("maps a CVE-backed vulnerability to a strong identifier", () => {
    const n = toNormalizedAssuranceFinding(
      upsert({ findingKind: "vulnerability", vendorIdentifier: "CVE-2026-1", policySeverity: "high" }),
    );
    expect(n.findingKind).toBe("vulnerability");
    expect(n.identifierStability).toBe("strong");
    expect(n.policySeverity).toBe("high");
  });

  it("maps end-of-life -> unsupported-component", () => {
    expect(toNormalizedAssuranceFinding(upsert({ findingKind: "end-of-life" })).findingKind).toBe(
      "unsupported-component",
    );
  });

  it("falls back to the projector affectedId when the host id is absent", () => {
    expect(toNormalizedAssuranceFinding(upsert({ source: {} })).affectedId).toBe("ev1");
  });

  it("coerces an out-of-vocabulary severity to info", () => {
    expect(toNormalizedAssuranceFinding(upsert({ policySeverity: "bogus" })).policySeverity).toBe("info");
  });
});

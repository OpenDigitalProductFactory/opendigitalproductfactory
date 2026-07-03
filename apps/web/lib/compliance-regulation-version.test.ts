import { describe, it, expect } from "vitest";
import { buildNextRegulationVersion, type VersionableRegulation } from "./compliance-regulation-version";

const prev: VersionableRegulation = {
  id: "reg_v1",
  name: "UK Corporate Governance Code",
  shortName: "UK Corp Gov Code",
  jurisdiction: "UK",
  industry: null,
  applicability: { basis: ["operating"], jurisdictions: ["uk"], listingStatuses: ["premium-listed"] },
  sourceType: "external",
  sourceUrl: "https://frc.org.uk",
  notes: "2024 edition",
  version: 1,
};

describe("buildNextRegulationVersion", () => {
  it("bumps the version and links the prior row", () => {
    const next = buildNextRegulationVersion(prev);
    expect(next.version).toBe(2);
    expect(next.previousVersionId).toBe("reg_v1");
  });

  it("inherits unspecified fields and applies overrides", () => {
    const next = buildNextRegulationVersion(prev, { notes: "2027 edition", shortName: "UK Corp Gov Code v2" });
    expect(next.notes).toBe("2027 edition");
    expect(next.shortName).toBe("UK Corp Gov Code v2");
    // Inherited
    expect(next.jurisdiction).toBe("UK");
    expect(next.applicability).toEqual(prev.applicability);
  });

  it("distinguishes an explicit null override from an omitted field", () => {
    expect(buildNextRegulationVersion(prev, { sourceUrl: null }).sourceUrl).toBeNull();
    expect(buildNextRegulationVersion(prev, {}).sourceUrl).toBe("https://frc.org.uk");
  });

  it("resets effective/review dates on the new version by default", () => {
    const next = buildNextRegulationVersion(prev);
    expect(next.effectiveDate).toBeNull();
    expect(next.reviewDate).toBeNull();
  });
});

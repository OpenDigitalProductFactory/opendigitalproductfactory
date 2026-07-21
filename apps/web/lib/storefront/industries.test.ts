import { describe, expect, it } from "vitest";
import { INDUSTRY_OPTIONS, INDUSTRY_SLUGS, isIndustrySlug, industryLabel } from "./industries";

describe("industries", () => {
  it("exposes exactly the 21 canonical industries", () => {
    expect(INDUSTRY_OPTIONS).toHaveLength(22);
    expect(INDUSTRY_SLUGS).toContain("healthcare-wellness");
    expect(INDUSTRY_SLUGS).toContain("hoa-property-management");
    expect(INDUSTRY_SLUGS).toContain("software-platform");
    expect(INDUSTRY_SLUGS).toContain("banking-financial-services");
    expect(INDUSTRY_SLUGS).toContain("public-sector");
    expect(INDUSTRY_SLUGS).toContain("asset-rental");
    expect(INDUSTRY_SLUGS).toContain("real-estate-construction");
    expect(INDUSTRY_SLUGS).toContain("automotive-services");
    expect(INDUSTRY_SLUGS).toContain("moving-and-logistics");
    expect(INDUSTRY_SLUGS).toContain("security-services");
    expect(INDUSTRY_SLUGS).toContain("media-production");
    expect(INDUSTRY_SLUGS).toContain("live-events-venues");
  });

  it("slugs are kebab-case, never underscore", () => {
    for (const slug of INDUSTRY_SLUGS) {
      expect(slug).not.toMatch(/_/);
      expect(slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }
  });

  it("isIndustrySlug validates against the canonical list", () => {
    expect(isIndustrySlug("beauty-personal-care")).toBe(true);
    expect(isIndustrySlug("not-a-real-industry")).toBe(false);
    expect(isIndustrySlug("")).toBe(false);
    expect(isIndustrySlug(null)).toBe(false);
    expect(isIndustrySlug(undefined)).toBe(false);
  });

  it("industryLabel returns the label for known slugs, slug itself for unknown", () => {
    expect(industryLabel("beauty-personal-care")).toBe("Beauty & Personal Care");
    expect(industryLabel("software-platform")).toBe("Software Platform");
    expect(industryLabel("unknown-slug")).toBe("unknown-slug");
    expect(industryLabel(null)).toBe("");
    expect(industryLabel(undefined)).toBe("");
  });
});

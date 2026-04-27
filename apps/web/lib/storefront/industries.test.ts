import { describe, expect, it } from "vitest";
import { INDUSTRY_OPTIONS, INDUSTRY_SLUGS, isIndustrySlug, industryLabel } from "./industries";

describe("industries", () => {
  it("exposes exactly the 12 canonical industries", () => {
    expect(INDUSTRY_OPTIONS).toHaveLength(12);
    expect(INDUSTRY_SLUGS).toContain("healthcare-wellness");
    expect(INDUSTRY_SLUGS).toContain("hoa-property-management");
    expect(INDUSTRY_SLUGS).toContain("software-platform");
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

import { describe, it, expect } from "vitest";
import { getFinancialProfile, getAllProfiles } from "./profiles";

const EXPECTED_SLUGS = [
  "healthcare_wellness",
  "trades_construction",
  "professional_services",
  "retail",
  "education_training",
  "nonprofit",
  "food_hospitality",
  "fitness_recreation",
  "beauty_personal",
  "pet_services",
];

describe("financial profile catalog", () => {
  it("has all 10 profiles", () => {
    const all = getAllProfiles();
    expect(all).toHaveLength(10);
    const slugs = all.map((p) => p.slug);
    for (const expected of EXPECTED_SLUGS) {
      expect(slugs, `missing profile: ${expected}`).toContain(expected);
    }
  });

  it("every profile has required fields", () => {
    const all = getAllProfiles();
    for (const profile of all) {
      expect(profile.slug, "slug must be truthy").toBeTruthy();
      expect(profile.displayName, `${profile.slug} missing displayName`).toBeTruthy();
      expect(profile.archetypeCategory, `${profile.slug} missing archetypeCategory`).toBeTruthy();
      expect(profile.defaultPaymentTerms, `${profile.slug} missing defaultPaymentTerms`).toBeTruthy();
      expect(profile.defaultCurrency, `${profile.slug} missing defaultCurrency`).toBeTruthy();
      expect(typeof profile.vatRegistered, `${profile.slug} vatRegistered must be boolean`).toBe("boolean");
      expect(typeof profile.defaultTaxRate, `${profile.slug} defaultTaxRate must be number`).toBe("number");
      expect(typeof profile.dunningEnabled, `${profile.slug} dunningEnabled must be boolean`).toBe("boolean");
      expect(["standard", "aggressive", "gentle", "off"], `${profile.slug} invalid dunningStyle`).toContain(profile.dunningStyle);
      expect(typeof profile.recurringBillingEnabled, `${profile.slug} recurringBillingEnabled must be boolean`).toBe("boolean");
      expect(
        ["professional", "trade", "creative", "nonprofit", "minimal"],
        `${profile.slug} invalid invoiceTemplateStyle`,
      ).toContain(profile.invoiceTemplateStyle);
      expect(typeof profile.purchaseOrdersEnabled, `${profile.slug} purchaseOrdersEnabled must be boolean`).toBe("boolean");
    }
  });

  it("getFinancialProfile returns the correct profile for a known slug", () => {
    const profile = getFinancialProfile("healthcare_wellness");
    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe("Healthcare & Wellness");
    expect(profile!.defaultPaymentTerms).toBe("Due on receipt");
    expect(profile!.dunningStyle).toBe("standard");
    expect(profile!.invoiceTemplateStyle).toBe("professional");
  });

  it("getFinancialProfile returns null for an unknown slug", () => {
    expect(getFinancialProfile("unknown_slug")).toBeNull();
    expect(getFinancialProfile("")).toBeNull();
    expect(getFinancialProfile("HEALTHCARE_WELLNESS")).toBeNull();
  });

  it("all profiles have non-empty chartOfAccountsSeed", () => {
    const all = getAllProfiles();
    for (const profile of all) {
      expect(
        profile.chartOfAccountsSeed.length,
        `${profile.slug} chartOfAccountsSeed must not be empty`,
      ).toBeGreaterThan(0);
      for (const account of profile.chartOfAccountsSeed) {
        expect(account.code, `${profile.slug} account missing code`).toBeTruthy();
        expect(account.name, `${profile.slug} account missing name`).toBeTruthy();
        expect(
          ["revenue", "expense", "asset", "liability", "equity"],
          `${profile.slug} account has invalid type: ${account.type}`,
        ).toContain(account.type);
      }
    }
  });

  it("all profiles have non-empty expenseCategories", () => {
    const all = getAllProfiles();
    for (const profile of all) {
      expect(
        profile.expenseCategories.length,
        `${profile.slug} expenseCategories must not be empty`,
      ).toBeGreaterThan(0);
      for (const cat of profile.expenseCategories) {
        expect(cat, `${profile.slug} expenseCategory must be a non-empty string`).toBeTruthy();
      }
    }
  });

  it("nonprofit has dunning disabled", () => {
    const profile = getFinancialProfile("nonprofit");
    expect(profile).not.toBeNull();
    expect(profile!.dunningEnabled).toBe(false);
    expect(profile!.dunningStyle).toBe("off");
  });

  it("trades_construction has POs enabled and aggressive dunning", () => {
    const profile = getFinancialProfile("trades_construction");
    expect(profile).not.toBeNull();
    expect(profile!.purchaseOrdersEnabled).toBe(true);
    expect(profile!.dunningStyle).toBe("aggressive");
  });
});

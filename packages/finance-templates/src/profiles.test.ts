import { describe, it, expect } from "vitest";
import {
  deriveRecurringBillingEnabled,
  getFinancialProfile,
  getAllProfiles,
  LEDGER_COA_FRAGMENTS,
} from "./profiles";

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
  "hoa_property_management",
  "banking_financial_services",
  "fund_accounting",
  "software_platform",
  "media_production",
  "live_events_venues",
  "warehousing_fulfilment",
  "fabric_care_services",
  "agriculture_ranching",
];

describe("financial profile catalog", () => {
  it("has every expected profile", () => {
    const all = getAllProfiles();
    expect(all).toHaveLength(EXPECTED_SLUGS.length);
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
      expect(profile.billingPatternProfile, `${profile.slug} missing billingPatternProfile`).toBeDefined();
      expect(
        profile.billingPatternProfile.supportedPaymentPatterns,
        `${profile.slug} supportedPaymentPatterns must include primaryPaymentPattern`,
      ).toContain(profile.billingPatternProfile.primaryPaymentPattern);
      expect(profile.recurringBillingEnabled).toBe(
        deriveRecurringBillingEnabled(profile.billingPatternProfile),
      );
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

  it("banking profile carries interest/fee accounting and gentle collections posture (BI-5D9DCDE6)", () => {
    const profile = getFinancialProfile("banking_financial_services");
    expect(profile).not.toBeNull();
    expect(profile!.archetypeCategory).toBe("banking-financial-services");
    expect(profile!.defaultCurrency).toBe("USD");
    // A regulated depository institution does not dun its own customers the
    // way a trade business chases invoices — fees post to accounts.
    expect(profile!.dunningEnabled).toBe(false);
    expect(profile!.billingPatternProfile.invoiceExecutionMode).toBe("prepared-not-prescribed");
    // Composes the canonical financial-institution ledger fragment — the
    // interest-margin P&L shape; the core banking system stays authoritative.
    expect(profile!.ledgerModel).toBe("financial-institution");
    expect(profile!.chartOfAccountsSeed).toEqual(LEDGER_COA_FRAGMENTS["financial-institution"]);
    const accountNames = profile!.chartOfAccountsSeed.map((a) => a.name);
    expect(accountNames).toContain("Interest Income — Loans");
    expect(accountNames).toContain("Deposits / Member Shares");
    expect(accountNames).toContain("Provision for Credit Losses");
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

  it("trades_construction defaults to ad-hoc per-job invoicing, not a recurring agreement", () => {
    const profile = getFinancialProfile("trades_construction");
    expect(profile?.billingPatternProfile.primaryPaymentPattern).toBe("ad-hoc-invoice");
    expect(profile?.billingPatternProfile.recurringBillingApplicability).toBe("optional");
  });

  it("professional services supports recurring agreements without prescribing invoice execution", () => {
    const profile = getFinancialProfile("professional_services");
    expect(profile?.billingPatternProfile).toMatchObject({
      primaryPaymentPattern: "recurring-agreement",
      recurringBillingApplicability: "required",
      invoiceExecutionMode: "prepared-not-prescribed",
    });
    expect(profile?.billingPatternProfile.supportedPaymentPatterns).toEqual(
      expect.arrayContaining(["recurring-agreement", "retainer", "project-milestone", "ad-hoc-invoice"]),
    );
  });

  it("beauty and personal care is appointment checkout first with optional recurring packages", () => {
    const profile = getFinancialProfile("beauty_personal");
    expect(profile?.billingPatternProfile).toMatchObject({
      primaryPaymentPattern: "appointment-checkout",
      recurringBillingApplicability: "optional",
      invoiceExecutionMode: "manual",
    });
    expect(profile?.billingPatternProfile.supportedPaymentPatterns).toEqual(
      expect.arrayContaining(["appointment-checkout", "point-of-sale", "optional-package"]),
    );
  });

  it("every profile resolves a ledgerModel, defaulting to commercial", () => {
    for (const profile of getAllProfiles()) {
      if (profile.slug === "fund_accounting") {
        expect(profile.ledgerModel).toBe("fund-accounting");
      } else if (profile.slug === "banking_financial_services") {
        expect(profile.ledgerModel).toBe("financial-institution");
      } else {
        expect(profile.ledgerModel, `${profile.slug} should default to commercial`).toBe("commercial");
      }
    }
  });

  it("the fund_accounting profile composes the fund-accounting COA fragment with statutory billing", () => {
    const profile = getFinancialProfile("fund_accounting");
    expect(profile?.archetypeCategory).toBe("public-sector");
    expect(profile?.chartOfAccountsSeed).toEqual(LEDGER_COA_FRAGMENTS["fund-accounting"]);
    expect(profile?.billingPatternProfile).toMatchObject({
      primaryPaymentPattern: "ad-hoc-invoice",
      invoiceExecutionMode: "prepared-not-prescribed",
      recurringBillingApplicability: "optional",
    });
  });
});

describe("ledger-model chart-of-accounts fragments", () => {
  it("ships fund-accounting, financial-institution, and cooperative-equity fragments", () => {
    expect(Object.keys(LEDGER_COA_FRAGMENTS).sort()).toEqual([
      "cooperative-equity",
      "financial-institution",
      "fund-accounting",
    ]);
  });

  it("every fragment has unique codes and valid account types", () => {
    for (const [model, fragment] of Object.entries(LEDGER_COA_FRAGMENTS)) {
      expect(fragment.length, `${model} fragment must not be empty`).toBeGreaterThan(0);
      const codes = fragment.map((account) => account.code);
      expect(new Set(codes).size, `${model} fragment has duplicate codes`).toBe(codes.length);
      for (const account of fragment) {
        expect(account.name, `${model} account ${account.code} missing name`).toBeTruthy();
        expect(
          ["revenue", "expense", "asset", "liability", "equity"],
          `${model} account ${account.code} has invalid type`,
        ).toContain(account.type);
      }
    }
  });

  it("captures each model's defining accounts", () => {
    const names = (model: keyof typeof LEDGER_COA_FRAGMENTS) =>
      LEDGER_COA_FRAGMENTS[model].map((account) => account.name).join("; ");

    expect(names("fund-accounting")).toContain("Fund Balance");
    expect(names("fund-accounting")).toContain("Debt Service");
    expect(names("financial-institution")).toContain("Allowance for Credit Losses");
    expect(names("financial-institution")).toContain("Provision for Credit Losses");
    expect(names("cooperative-equity")).toContain("Allocated Member Equity");
    expect(names("cooperative-equity")).toContain("Patronage Dividends Payable");
  });
});

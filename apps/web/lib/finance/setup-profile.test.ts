import { describe, expect, it } from "vitest";

import {
  financeProfileSlugFromCategory,
  resolveFinanceSetupProfile,
} from "@/lib/finance/setup-profile";

describe("finance setup profile resolution", () => {
  it("maps storefront archetype categories to finance template slugs", () => {
    expect(financeProfileSlugFromCategory("trades-maintenance")).toBe("trades_construction");
    expect(financeProfileSlugFromCategory("education-training")).toBe("education_training");
    expect(financeProfileSlugFromCategory("retail-goods")).toBe("retail");
    expect(financeProfileSlugFromCategory("software-platform")).toBe("software_platform");
    expect(financeProfileSlugFromCategory("fabric-care-services")).toBe("fabric_care_services");
  });

  it("falls back to professional services when the business category is unknown", () => {
    expect(financeProfileSlugFromCategory(null)).toBe("professional_services");
    expect(financeProfileSlugFromCategory("unknown-category")).toBe("professional_services");
  });

  it("returns display metadata for the resolved profile", () => {
    expect(resolveFinanceSetupProfile({
      category: "retail-goods",
      archetypeName: "Retail Shop",
    })).toEqual({
      slug: "retail",
      archetypeName: "Retail Shop",
      profileName: "Retail",
      primaryPaymentPattern: "point-of-sale",
      supportedPaymentPatterns: ["point-of-sale", "ad-hoc-invoice"],
      recurringBillingApplicability: "optional",
    });
  });

  it("exposes checkout-first finance setup for beauty and personal care", () => {
    expect(resolveFinanceSetupProfile({
      category: "beauty-personal-care",
      archetypeName: "Hair Salon",
    })).toMatchObject({
      slug: "beauty_personal",
      primaryPaymentPattern: "appointment-checkout",
      recurringBillingApplicability: "optional",
    });
  });

  it("exposes point-of-sale finance setup for fabric care", () => {
    expect(resolveFinanceSetupProfile({
      category: "fabric-care-services",
      archetypeName: "Dry Cleaning Plant & Store Network",
    })).toMatchObject({
      slug: "fabric_care_services",
      primaryPaymentPattern: "point-of-sale",
      recurringBillingApplicability: "optional",
    });
  });
});

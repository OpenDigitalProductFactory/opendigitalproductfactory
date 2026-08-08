import { getFinancialProfile } from "@dpf/finance-templates";

const FINANCE_PROFILE_BY_ARCHETYPE_CATEGORY: Record<string, string> = {
  "healthcare-wellness": "healthcare_wellness",
  "beauty-personal-care": "beauty_personal",
  "trades-maintenance": "trades_construction",
  "professional-services": "professional_services",
  "education-training": "education_training",
  "pet-services": "pet_services",
  "food-hospitality": "food_hospitality",
  "retail-goods": "retail",
  "fitness-recreation": "fitness_recreation",
  "nonprofit-community": "nonprofit",
  "hoa-property-management": "hoa_property_management",
  "banking-financial-services": "banking_financial_services",
  "public-sector": "fund_accounting",
  "software-platform": "software_platform",
  "media-production": "media_production",
  "live-events-venues": "live_events_venues",
  "warehousing-fulfilment": "warehousing_fulfilment",
  "fabric-care-services": "fabric_care_services",
  "agriculture-ranching": "agriculture_ranching",
  "manufacturing": "manufacturing",
};

export function financeProfileSlugFromCategory(category: string | null | undefined): string {
  if (!category) return "professional_services";
  return FINANCE_PROFILE_BY_ARCHETYPE_CATEGORY[category] ?? "professional_services";
}

export function resolveFinanceSetupProfile(input: {
  category?: string | null;
  archetypeName?: string | null;
}) {
  const slug = financeProfileSlugFromCategory(input.category);
  const profile = getFinancialProfile(slug);

  return {
    slug,
    archetypeName: input.archetypeName ?? profile?.displayName ?? "Professional Services",
    profileName: profile?.displayName ?? "Professional Services",
    primaryPaymentPattern: profile?.billingPatternProfile.primaryPaymentPattern ?? "ad-hoc-invoice",
    supportedPaymentPatterns: profile?.billingPatternProfile.supportedPaymentPatterns ?? ["ad-hoc-invoice"],
    recurringBillingApplicability:
      profile?.billingPatternProfile.recurringBillingApplicability ?? "optional",
  };
}

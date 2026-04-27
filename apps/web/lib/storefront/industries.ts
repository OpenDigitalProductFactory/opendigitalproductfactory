export const INDUSTRY_OPTIONS = [
  { value: "healthcare-wellness", label: "Healthcare & Wellness" },
  { value: "beauty-personal-care", label: "Beauty & Personal Care" },
  { value: "trades-maintenance", label: "Trades & Maintenance" },
  { value: "professional-services", label: "Professional Services" },
  { value: "software-platform", label: "Software Platform" },
  { value: "education-training", label: "Education & Training" },
  { value: "pet-services", label: "Pet Services" },
  { value: "food-hospitality", label: "Food & Hospitality" },
  { value: "retail-goods", label: "Retail & Goods" },
  { value: "fitness-recreation", label: "Fitness & Recreation" },
  { value: "nonprofit-community", label: "Nonprofit & Community" },
  { value: "hoa-property-management", label: "HOA & Property Management" },
] as const;

export type IndustrySlug = (typeof INDUSTRY_OPTIONS)[number]["value"];
export const INDUSTRY_SLUGS: readonly IndustrySlug[] = INDUSTRY_OPTIONS.map((o) => o.value);

export function isIndustrySlug(value: string | null | undefined): value is IndustrySlug {
  return !!value && (INDUSTRY_SLUGS as readonly string[]).includes(value);
}

export function industryLabel(slug: string | null | undefined): string {
  if (!slug) return "";
  return INDUSTRY_OPTIONS.find((o) => o.value === slug)?.label ?? slug;
}

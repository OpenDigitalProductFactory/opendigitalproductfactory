// Archetype/industry-aware company-mission starter, offered during the
// onboarding business-context step. Pure and deterministic — no I/O — so it
// can be evaluated server-side to pre-fill the form and reused by the WWWD
// seeding helper. The output is a *starter* the operator is expected to edit.

export type MissionSuggestionInput = {
  /** Archetype category (e.g. "healthcare-wellness"); see ARCHETYPE_TO_INDUSTRY. */
  industry?: string | null;
  /** Friendly archetype name (e.g. "Dental Practice"); currently advisory. */
  archetypeName?: string | null;
  /** Free-text "what does your business do" answer, if already captured. */
  description?: string | null;
  /** Organization name, used to personalise the opening. */
  orgName?: string | null;
};

/**
 * Themes keyed by the coarse industry category emitted by ARCHETYPE_TO_INDUSTRY.
 * Each completes the clause "we exist to …". Keep these broad — they are
 * deliberately editable starters, not finished mission statements.
 */
const INDUSTRY_THEMES: Record<string, string> = {
  "healthcare-wellness":
    "deliver attentive, high-quality care that improves the health and wellbeing of the people we serve",
  "beauty-personal-care":
    "help every client look and feel their best through skilled, personal service",
  "fitness-recreation":
    "help our members move, train, and live healthier, more active lives",
  "food-hospitality":
    "create welcoming experiences and memorable food and hospitality for every guest",
  "professional-services":
    "deliver expert advice and dependable service that helps our clients succeed",
  "hoa-property-management":
    "manage and care for properties so owners and residents can thrive",
  "retail-ecommerce":
    "offer products our customers love, backed by service they can trust",
  "trades-field-service":
    "provide reliable, high-quality workmanship that keeps our customers' homes and businesses running",
};

const GENERIC_THEME =
  "deliver real value to the people we serve and build a business we are proud of";

function cleanName(orgName?: string | null): string | null {
  const trimmed = (orgName ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function suggestMission(input: MissionSuggestionInput): string {
  const theme =
    (input.industry && INDUSTRY_THEMES[input.industry]) || GENERIC_THEME;
  const name = cleanName(input.orgName);
  const sentence = name
    ? `At ${name}, we exist to ${theme}.`
    : `We exist to ${theme}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

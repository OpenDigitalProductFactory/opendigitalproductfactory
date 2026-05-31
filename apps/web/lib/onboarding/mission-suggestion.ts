// Archetype/industry-aware company-mission starter, offered during the
// onboarding business-context step. Pure and deterministic — no I/O — so it
// can be evaluated server-side to pre-fill the form and reused by the WWWD
// seeding helper. The output is a *starter* the operator is expected to edit.
//
// The mission theme comes from the shared archetype-business-context layer so
// the suggestion and the seeded WWWD corpus speak with one voice.

import { resolveBusinessProfile } from "./archetype-business-context";

export type MissionSuggestionInput = {
  /** Specific archetype slug (e.g. "dental-practice"); enables a flagship override. */
  archetypeId?: string | null;
  /** Archetype category (e.g. "healthcare-wellness"); see ARCHETYPE_TO_INDUSTRY. */
  industry?: string | null;
  /** Friendly archetype name (e.g. "Dental Practice"); currently advisory. */
  archetypeName?: string | null;
  /** Free-text "what does your business do" answer, if already captured. */
  description?: string | null;
  /** Organization name, used to personalise the opening. */
  orgName?: string | null;
};

function cleanName(orgName?: string | null): string | null {
  const trimmed = (orgName ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function suggestMission(input: MissionSuggestionInput): string {
  const { missionTheme } = resolveBusinessProfile({
    archetypeId: input.archetypeId ?? null,
    industry: input.industry ?? null,
  });
  const name = cleanName(input.orgName);
  const sentence = name
    ? `At ${name}, we exist to ${missionTheme}.`
    : `We exist to ${missionTheme}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

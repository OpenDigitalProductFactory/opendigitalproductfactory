/**
 * EU / EEA jurisdiction reference — the concrete set of countries that
 * sovereignty-class EU regulations (CADA, GDPR, the EU AI Act, DORA) apply to.
 *
 * Why this exists: the profession-corpus jurisdiction axis
 * (`PROFESSION_JURISDICTIONS` in wiki-taxonomy.ts) is deliberately coarse — "eu"
 * is a single bloc. For sovereignty work we need the member-state granularity:
 * naming the "countries affected" in planning, marketing, and estate assessment,
 * and deciding what counts as a "third country" for ownership/interference tests.
 *
 * ISO 3166-1 alpha-2 codes. The canonical `Country` table (seed-countries.ts /
 * countries.json) holds the full record for each of these; this module is the
 * bloc-membership grouping that the country table does not encode.
 *
 * See:
 *   docs/professions/legal-compliance/wiki/eu-cada-cloud-sovereignty.md
 *   docs/founder-kernel/wiki/principles/data-sovereignty-follows-control.md
 */

export interface JurisdictionRef {
  /** ISO 3166-1 alpha-2 code, uppercase. */
  iso2: string;
  name: string;
}

/** The 27 EU member states (ISO 3166-1 alpha-2). */
export const EU_MEMBER_STATES: readonly JurisdictionRef[] = [
  { iso2: "AT", name: "Austria" },
  { iso2: "BE", name: "Belgium" },
  { iso2: "BG", name: "Bulgaria" },
  { iso2: "HR", name: "Croatia" },
  { iso2: "CY", name: "Cyprus" },
  { iso2: "CZ", name: "Czechia" },
  { iso2: "DK", name: "Denmark" },
  { iso2: "EE", name: "Estonia" },
  { iso2: "FI", name: "Finland" },
  { iso2: "FR", name: "France" },
  { iso2: "DE", name: "Germany" },
  { iso2: "GR", name: "Greece" },
  { iso2: "HU", name: "Hungary" },
  { iso2: "IE", name: "Ireland" },
  { iso2: "IT", name: "Italy" },
  { iso2: "LV", name: "Latvia" },
  { iso2: "LT", name: "Lithuania" },
  { iso2: "LU", name: "Luxembourg" },
  { iso2: "MT", name: "Malta" },
  { iso2: "NL", name: "Netherlands" },
  { iso2: "PL", name: "Poland" },
  { iso2: "PT", name: "Portugal" },
  { iso2: "RO", name: "Romania" },
  { iso2: "SK", name: "Slovakia" },
  { iso2: "SI", name: "Slovenia" },
  { iso2: "ES", name: "Spain" },
  { iso2: "SE", name: "Sweden" },
] as const;

/** The 3 EEA-EFTA states — in the EEA (so EU data-residency holds) but not the EU. */
export const EEA_EFTA_STATES: readonly JurisdictionRef[] = [
  { iso2: "IS", name: "Iceland" },
  { iso2: "LI", name: "Liechtenstein" },
  { iso2: "NO", name: "Norway" },
] as const;

/** EU + EEA-EFTA — the geographic footprint CADA's Level 1 residency test covers. */
export const EEA_STATES: readonly JurisdictionRef[] = [
  ...EU_MEMBER_STATES,
  ...EEA_EFTA_STATES,
];

const EU_SET: ReadonlySet<string> = new Set(EU_MEMBER_STATES.map((s) => s.iso2));
const EEA_SET: ReadonlySet<string> = new Set(EEA_STATES.map((s) => s.iso2));

/** True if the ISO2 code is one of the 27 EU member states (case-insensitive). */
export function isEuMember(iso2: string): boolean {
  return EU_SET.has(iso2.trim().toUpperCase());
}

/** True if the ISO2 code is in the EEA (EU + Iceland/Liechtenstein/Norway). */
export function isEeaState(iso2: string): boolean {
  return EEA_SET.has(iso2.trim().toUpperCase());
}

/**
 * For CADA's ownership/interference tests, an entity controlled from outside the
 * EEA is a "third country" (e.g. US, UK). Residency (Level 1) is an EEA test;
 * the higher tiers turn on control by the EU/EEA, so we treat non-EEA as third.
 */
export function isThirdCountryForCada(iso2: string): boolean {
  return !isEeaState(iso2);
}

/**
 * The "countries affected" framing for CADA, ready for planning/marketing copy
 * and estate-assessment logic.
 */
export const CADA_AFFECTED = {
  euMemberStates: EU_MEMBER_STATES,
  eeaStates: EEA_STATES,
  isThirdCountry: isThirdCountryForCada,
} as const;

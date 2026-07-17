/**
 * US starter rule packs (EP-WORKFORCE-OPS / BI-4AD09A35 Phase 2). Federal (FLSA)
 * baseline + a California overlay — chosen as the first reviewed pack because CA
 * exercises the most variable families (daily overtime, rest gaps, meal
 * premiums, reporting-time). Spec §6, §9.4, §10.3, founder decision 5.
 *
 * These are DPF-supplied STARTER packs. Each rule carries its source URL,
 * severity, and legal-waivability; the deploying organization remains
 * responsible for validating labor rules with qualified counsel (spec §6). A
 * pack is authoritative for an organization only once its `employsIn` +
 * work-location jurisdiction resolve (spec §6 — otherwise the engine fails
 * closed to "requires policy review").
 */
import type { ConstraintRuleInput } from "../constraints/types";

/** FLSA baseline — applies wherever US federal law governs. */
export const US_FEDERAL_PACK: ConstraintRuleInput[] = [
  {
    ruleId: "us-flsa-weekly-overtime",
    predicateType: "max_hours_premium",
    severity: "soft",
    legallyWaivable: false,
    parameters: { thresholdHours: 40, premiumPerHour: 0.5 },
    sourcePolicyUrl: "https://www.dol.gov/agencies/whd/overtime",
  },
  {
    // The non-overlap invariant is universal; encoded as a rule so it appears in
    // the same evaluation ledger as jurisdiction rules.
    ruleId: "us-no-overlapping-assignments",
    predicateType: "no_overlap",
    severity: "hard",
    legallyWaivable: false,
    parameters: {},
    sourcePolicyUrl: null,
  },
];

/** California overlay — layered on top of the federal pack (spec §6 hierarchy). */
export const US_CALIFORNIA_PACK: ConstraintRuleInput[] = [
  {
    ruleId: "us-ca-daily-overtime",
    predicateType: "max_hours_premium",
    severity: "soft",
    legallyWaivable: false,
    parameters: { thresholdHours: 8, premiumPerHour: 0.5 },
    applicability: { jurisdictionRegion: "US-CA" },
    sourcePolicyUrl:
      "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=510.",
  },
];

/**
 * Resolve the applicable starter pack for a jurisdiction. Returns null when the
 * jurisdiction is unresolved or unsupported — the caller then fails closed to
 * "requires policy review" rather than assuming US defaults (spec §6).
 */
export function resolveStarterPack(region: string | null): ConstraintRuleInput[] | null {
  if (region === "US-CA") return [...US_FEDERAL_PACK, ...US_CALIFORNIA_PACK];
  if (region && region.startsWith("US-")) return [...US_FEDERAL_PACK];
  return null;
}

/**
 * CADA sovereignty assurance-level scoring — the reusable primitive.
 *
 * Implements constraint CON-CADA-1 from the CADA architecture note
 * (docs/architecture/2026-06-19-cada-cloud-sovereignty-architecture-note.md):
 * the achievable assurance level of a deployment/service/asset is a function of
 * `(operating-entity ownership × infrastructure location × inference locality ×
 * software control × key control)`, BOUNDED by the weakest foreign-controlled
 * dependency in the chain. The decisive axis is ownership of the operating
 * entity, not data location — see the kernel principle
 * `data-sovereignty-follows-control`.
 *
 * Pure logic, no DB. Consumed by the estate-sovereignty governance work
 * (EP-ESTATE-SOVEREIGNTY) to score the platform itself, discovered
 * infrastructure/edge nodes, and external digital products against CADA's
 * four Union assurance levels.
 */
import { isThirdCountryForCada } from "./eu-jurisdictions";

/** CADA Union assurance levels. 0 = below Level 1 (no EU residency). */
export type CadaAssuranceLevel = 0 | 1 | 2 | 3 | 4;

export const CADA_LEVEL_LABELS: Record<CadaAssuranceLevel, string> = {
  0: "Below Level 1 — no EU residency",
  1: "Level 1 — EU residency",
  2: "Level 2 — independence + supply-chain transparency",
  3: "Level 3 — EU-owned and controlled",
  4: "Level 4 — no third-country interference",
};

/**
 * The sovereignty-relevant attributes of an assessed element (a deployment, a
 * discovered host/edge node, or an external digital product). Optional fields
 * default to the conservative (non-satisfying) interpretation.
 */
export interface SovereigntyInput {
  /** ISO 3166-1 alpha-2 of the entity that ultimately owns/controls the operator. */
  operatorJurisdiction: string;
  /** Data is processed and stored within the EEA. The Level 1 baseline. */
  dataInEea: boolean;
  /** Operations, personnel, and assets are located in the EU (Level 2). */
  personnelInEea?: boolean;
  /** Software supply chain is transparent — open source and/or a signed SBOM (Level 2). */
  supplyChainTransparent?: boolean;
  /**
   * For a third-country-controlled operator, third-country access has been
   * contractually and structurally mitigated (separation from non-EU
   * subsidiaries, etc.). Lets a third-country operator reach Level 2 — but never 3/4.
   */
  thirdCountryMitigated?: boolean;
  /** Holds an EU cloud certification (EUCS); at "high" assurance for Level 4. */
  euCloudCertified?: boolean;
  /** No AI-inference-data egress — inference stays local/EU (Level 4). */
  noAiInferenceEgress?: boolean;
  /**
   * No third-country entity holds effective control over software design,
   * development, maintenance, or evolution (open source + EU steward) — Level 4.
   */
  softwareFullyControlled?: boolean;
}

export interface SovereigntyAssessment {
  level: CadaAssuranceLevel;
  /** Why this level was reached. */
  rationale: string[];
  /** What is missing to reach the next level (empty at Level 4). */
  gaps: string[];
  /**
   * Set when a foreign-controlled dependency hard-caps the level (the
   * ownership gate). The single most important field for sovereignty buyers.
   */
  cappedBy?: string;
}

/**
 * Score an element against CADA's four assurance levels. Levels are cumulative:
 * each requires everything below it plus its own gate. A third-country operator
 * is hard-capped at Level 2 regardless of every other control (CLOUD Act / FISA
 * reach the controlling entity, not the datacenter).
 */
export function assessAssuranceLevel(input: SovereigntyInput): SovereigntyAssessment {
  const rationale: string[] = [];
  const gaps: string[] = [];
  const operatorIsThirdCountry = isThirdCountryForCada(input.operatorJurisdiction);

  // Level 1 — residency.
  if (!input.dataInEea) {
    return {
      level: 0,
      rationale: ["Data is not processed/stored within the EEA."],
      gaps: ["Place data on EU/EEA infrastructure to reach Level 1 (residency)."],
    };
  }
  rationale.push("Data is processed/stored within the EEA (Level 1 residency).");

  // Level 2 — independence from third countries + supply-chain transparency.
  const thirdCountryHandled = !operatorIsThirdCountry || input.thirdCountryMitigated === true;
  const l2 =
    input.personnelInEea === true && input.supplyChainTransparent === true && thirdCountryHandled;

  if (!l2) {
    if (input.personnelInEea !== true) gaps.push("Locate operations/personnel/assets in the EU (Level 2).");
    if (input.supplyChainTransparent !== true)
      gaps.push("Provide software supply-chain transparency — open source and/or a signed SBOM (Level 2).");
    if (!thirdCountryHandled)
      gaps.push("Mitigate third-country access (structural/contractual separation) to reach Level 2.");
    return { level: 1, rationale, gaps };
  }
  rationale.push("EU operations + supply-chain transparency satisfy Level 2 independence.");

  // Level 3 — EU ownership and control. Third-country operators are hard-capped here.
  if (operatorIsThirdCountry) {
    return {
      level: 2,
      rationale,
      gaps: ["Levels 3-4 require an EU-owned and EU-controlled operating entity."],
      cappedBy: `operator controlled from a third country (${input.operatorJurisdiction.toUpperCase()}); extraterritorial law (e.g. US CLOUD Act / FISA) reaches the controlling entity, barring Levels 3-4`,
    };
  }
  rationale.push("Operator is owned and controlled in the EU/EEA (Level 3).");

  // Level 4 — no third-country interference.
  const l4 =
    input.noAiInferenceEgress === true &&
    input.softwareFullyControlled === true &&
    input.euCloudCertified === true;

  if (!l4) {
    if (input.noAiInferenceEgress !== true)
      gaps.push("Eliminate AI-inference-data egress — keep inference local/EU (Level 4).");
    if (input.softwareFullyControlled !== true)
      gaps.push("Ensure no third-country entity controls software evolution — EU steward + reproducible builds (Level 4).");
    if (input.euCloudCertified !== true)
      gaps.push("Obtain a European cybersecurity certificate at 'high' assurance (Level 4).");
    return { level: 3, rationale, gaps };
  }
  rationale.push("No AI-inference egress, full software control, and high certification satisfy Level 4.");

  return { level: 4, rationale, gaps: [] };
}

/**
 * Reference posture: a self-hosted DPF install on EU-owned infrastructure with
 * local-only inference reaches Level 3 by construction, and Level 4 once the
 * EU-key / EU-steward / high-certification build-out lands. Useful for planning
 * and marketing copy; see the strategy briefing.
 */
export const DPF_SOVEREIGN_REFERENCE_INPUT: SovereigntyInput = {
  operatorJurisdiction: "FR", // e.g. customer-operated on OVHcloud (EU-owned)
  dataInEea: true,
  personnelInEea: true,
  supplyChainTransparent: true, // open source
  noAiInferenceEgress: true, // residencyPolicy: "local_only"
  softwareFullyControlled: false, // EU steward + signed SBOM = the build-out
  euCloudCertified: false,
};

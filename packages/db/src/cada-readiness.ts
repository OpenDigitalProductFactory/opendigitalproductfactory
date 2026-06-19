/**
 * CADA install-readiness — derive an install's current assurance posture from its
 * structural facts (DPF is self-hosted + open source), the live local-only
 * inference setting, and operator-declared jurisdiction, then score it with the
 * `sovereignty-assessment` primitive (CON-CADA-1).
 *
 * EP-ESTATE-SOVEREIGNTY Phase 1 (BI-0471DC23). Pure: the live `localOnly` value
 * is passed in so the logic is fully unit-testable and the DB/setting read stays
 * in the thin apps/web caller and the operator script. Gives every install a
 * "what tier are we / what are the gaps" answer.
 */
import {
  assessAssuranceLevel,
  type SovereigntyInput,
  type SovereigntyAssessment,
  type CadaAssuranceLevel,
  CADA_LEVEL_LABELS,
} from "./sovereignty-assessment";

/**
 * Facts the platform cannot reliably infer about its own deployment and that the
 * operator declares (or an estate-assessment phase supplies per element).
 */
export interface InstallSovereigntyDeclaration {
  /** ISO 3166-1 alpha-2 of the entity that owns/operates this install. */
  operatorJurisdiction: string;
  /** Data is processed/stored within the EEA (where the install + its DB run). */
  dataInEea: boolean;
  /** EU operations/personnel (Level 2). Defaults to dataInEea. */
  personnelInEea?: boolean;
  /** EU-held keys + EU steward + reproducible builds — the Level-4 build-out. */
  euKeysAndSteward?: boolean;
  /** Holds a European cybersecurity certificate at "high" (Level 4). */
  euCloudCertified?: boolean;
}

/**
 * Map an install's declaration + the live local-only setting into a
 * SovereigntyInput, encoding DPF's structural facts: open source (supply-chain
 * transparent), self-hosted (a third-country-domiciled operator running its own
 * install has structurally mitigated foreign operator access — though Level 3/4
 * still require EU ownership, which the primitive enforces), and local-only
 * inference as the Level-4 "no AI-inference egress" control.
 */
export function buildInstallSovereigntyInput(
  declared: InstallSovereigntyDeclaration,
  localOnly: boolean,
): SovereigntyInput {
  return {
    operatorJurisdiction: declared.operatorJurisdiction,
    dataInEea: declared.dataInEea,
    personnelInEea: declared.personnelInEea ?? declared.dataInEea,
    supplyChainTransparent: true, // DPF is open source
    thirdCountryMitigated: true, // self-hosted: customer runs its own install
    noAiInferenceEgress: localOnly, // the local-only inference switch
    softwareFullyControlled: declared.euKeysAndSteward ?? false,
    euCloudCertified: declared.euCloudCertified ?? false,
  };
}

export interface InstallCadaReadiness {
  localOnlyInference: boolean;
  input: SovereigntyInput;
  assessment: SovereigntyAssessment;
  target?: CadaAssuranceLevel;
  meetsTarget?: boolean;
  summary: string;
}

/** Compute the install's current CADA posture and (optionally) compare to a target. */
export function computeInstallCadaReadiness(
  declared: InstallSovereigntyDeclaration,
  localOnly: boolean,
  target?: CadaAssuranceLevel,
): InstallCadaReadiness {
  const input = buildInstallSovereigntyInput(declared, localOnly);
  const assessment = assessAssuranceLevel(input);
  const meetsTarget = target == null ? undefined : assessment.level >= target;
  return {
    localOnlyInference: localOnly,
    input,
    assessment,
    target,
    meetsTarget,
    summary: summarizeReadiness(assessment, target),
  };
}

/** One-line, human-readable posture summary for coworker/operator/marketing copy. */
export function summarizeReadiness(
  assessment: SovereigntyAssessment,
  target?: CadaAssuranceLevel,
): string {
  const parts = [`Current CADA posture: ${CADA_LEVEL_LABELS[assessment.level]}.`];
  if (assessment.cappedBy) parts.push(`Capped by: ${assessment.cappedBy}.`);
  if (assessment.gaps.length > 0) {
    parts.push(`To advance: ${assessment.gaps.join(" ")}`);
  }
  if (target != null) {
    parts.push(
      assessment.level >= target
        ? `Meets target Level ${target}.`
        : `Below target Level ${target}.`,
    );
  }
  return parts.join(" ");
}

export interface CadaControlCoverage {
  total: number;
  implemented: number;
  inProgress: number;
  planned: number;
  notApplicable: number;
  /** Implemented as a percentage of applicable (non-N/A) controls. */
  pctImplemented: number;
  summary: string;
}

/**
 * Governance-evidence lens: summarize the implementation status of the CADA
 * controls registered in the compliance domain (seed-cada-regulation.ts). This
 * complements the signal-based tier assessment — the tier says "how sovereign is
 * the deployment", this says "how many of CADA's controls have we implemented".
 */
export function summarizeControlCoverage(
  controls: ReadonlyArray<{ implementationStatus: string }>,
): CadaControlCoverage {
  const total = controls.length;
  const count = (s: string) => controls.filter((c) => c.implementationStatus === s).length;
  const implemented = count("implemented");
  const inProgress = count("in-progress");
  const planned = count("planned");
  const notApplicable = count("not-applicable");
  const applicable = total - notApplicable;
  const pctImplemented = applicable === 0 ? 0 : Math.round((implemented / applicable) * 100);
  const summary =
    total === 0
      ? "No CADA controls registered (run seed-cada-regulation.ts)."
      : `${implemented}/${applicable} CADA controls implemented (${pctImplemented}%); ${inProgress} in progress, ${planned} planned.`;
  return { total, implemented, inProgress, planned, notApplicable, pctImplemented, summary };
}

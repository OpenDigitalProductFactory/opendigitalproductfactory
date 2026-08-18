// Acumen phase-consult composition (W16 — BI-18519A73, EP-413F2602).
//
// Routes a Build Studio phase decision through the profession gate of each
// IMPACTED acumen (deriveImpactedAcumens over the phase's planned file paths)
// instead of one flat decision layer. Each consult is a declared borrow
// (BI-52839DEA): the gate carries no agent identity of its own, names the
// acumen's professionKey, and evaluateProfessionDecisionGate resolves the
// wsid-<key> craft profile and records a DecisionInteraction with gateKey
// "profession" exactly as it would for any external caller.
//
// ADVISORY / SHADOW-CONSISTENT by contract: consults ENRICH the phase gate's
// result (attached as `acumenConsults`, summarized in the operator message)
// and land DI-ledger rows, but the gate's `allowed` verdict is never changed
// by an acumen outcome. Blocking on acumen verdicts is a later, ratified step
// (trust-ratchet pattern — see the 2026-08-16 delivery plan, W16 row).
//
// Failure posture: fail-open PER CONSULT — one acumen's resolver/evaluator
// error records `{ professionKey, error }` and the remaining consults still
// run. Gap nomination (acumen-gap-nomination.ts) hangs off each consult via an
// injectable dep and is likewise swallowed on failure (audit-only contract).

import { deriveImpactedAcumens } from "./acumen-impact";
import {
  nominateAcumenCorpusGap,
  type AcumenGapConsultOutcome,
  type AcumenGapNominationResult,
} from "./acumen-gap-nomination";
import { evaluateProfessionDecisionGate } from "./profession-gate";
import type { DecisionDomainClass, DecisionRiskTier, DecisionScoredOption } from "./types";
import { getErrorMessage } from "@/lib/shared/get-error-message";

/** Consult at most this many acumens per phase decision, to bound gate latency. */
export const MAX_ACUMEN_CONSULTS_PER_PHASE = 3;

/** All acumen consults run under the craft-practice decision class. */
export const ACUMEN_CONSULT_DOMAIN_CLASS = "professional-practice" satisfies DecisionDomainClass;

export type AcumenConsultResult = {
  professionKey: string;
  /** Present when the consult ran; absent on a failed (fail-open) consult. */
  interactionId?: string;
  outcomeType?: string;
  confidenceScore?: number;
  rationale?: string;
  professionProfileSelected?: boolean;
  /** Present only on a failed consult. */
  error?: string;
};

type ProfessionGateFn = typeof evaluateProfessionDecisionGate;
type NominateGapFn = (
  consult: AcumenGapConsultOutcome,
) => Promise<AcumenGapNominationResult>;

export type RunAcumenPhaseConsultsInput = {
  db: Parameters<ProfessionGateFn>[0]["db"];
  /** File paths the phase intends to touch; drives which acumens are consulted. */
  filePaths: readonly string[];
  question: string;
  options: string[];
  /** Optional per-option feature vectors, passed through as scoredOptions. */
  optionFeatures?: DecisionScoredOption[];
  riskTier: DecisionRiskTier;
  /** Who is borrowing the craft (mirrors principle_decide's callingPopulation). */
  callingPopulation: string;
  routeContext?: string;
  phaseFrom?: string | null;
  phaseTo?: string | null;
  triggeredByUserId?: string | null;
  /** Injectable for tests; defaults to the real profession gate. */
  professionGate?: ProfessionGateFn;
  /**
   * Injectable corpus-gap nomination hook. Tests pass a stub (no DB); gate
   * call sites register the real nominateAcumenCorpusGap. Failures are
   * swallowed with a structured log — audit-only, same as the shadow hooks.
   */
  nominateGap?: NominateGapFn | null;
};

/**
 * Consult each impacted acumen's profession gate about a phase decision.
 * Advisory: returns the collected consult results; never throws.
 */
export async function runAcumenPhaseConsults(
  input: RunAcumenPhaseConsultsInput,
): Promise<AcumenConsultResult[]> {
  const impacted = deriveImpactedAcumens(input.filePaths)
    .slice(0, MAX_ACUMEN_CONSULTS_PER_PHASE);
  if (impacted.length === 0) return [];

  const gate = input.professionGate ?? evaluateProfessionDecisionGate;
  const results: AcumenConsultResult[] = [];

  for (const professionKey of impacted) {
    try {
      const consult = await gate({
        db: input.db,
        // Declared borrow: the phase gate holds no agent identity, so the
        // profession gate resolves the named craft and stamps the ledger.
        agentIdentity: {},
        declaredBorrow: {
          callingPopulation: input.callingPopulation,
          professionKey,
        },
        question: input.question,
        options: input.options,
        scoredOptions: input.optionFeatures,
        domainClass: ACUMEN_CONSULT_DOMAIN_CLASS,
        riskTier: input.riskTier,
        routeContext: input.routeContext ?? "/build",
        phaseFrom: input.phaseFrom ?? null,
        phaseTo: input.phaseTo ?? null,
        triggeredByUserId: input.triggeredByUserId,
      });

      results.push({
        professionKey,
        interactionId: consult.interactionId,
        outcomeType: consult.evaluation.outcomeType,
        confidenceScore: consult.evaluation.confidenceScore,
        rationale: consult.evaluation.rationale,
        professionProfileSelected: consult.professionProfileSelected,
      });

      if (input.nominateGap) {
        try {
          await input.nominateGap({
            professionKey,
            interactionId: consult.interactionId,
            outcomeType: consult.evaluation.outcomeType,
            confidenceScore: consult.evaluation.confidenceScore,
            professionProfileSelected: consult.professionProfileSelected,
            coverageGap: consult.evaluation.coverageGap,
            domainClass: ACUMEN_CONSULT_DOMAIN_CLASS,
            question: input.question,
          });
        } catch (error) {
          console.warn(
            `[tool-trace] acumen.gap.nomination-failed ${JSON.stringify({
              professionKey,
              error: getErrorMessage(error),
            })}`,
          );
        }
      }
    } catch (error) {
      // Fail-open per consult: record the failure and keep consulting.
      console.warn(
        `[tool-trace] acumen.consult.failed ${JSON.stringify({
          professionKey,
          error: getErrorMessage(error),
        })}`,
      );
      results.push({ professionKey, error: getErrorMessage(error) });
    }
  }

  return results;
}

/**
 * One-line operator summary of the consults, appended to the phase gate's
 * operatorMessage, e.g.
 * "Acumen consults — data-architect: escalate (0.35) — no craft material for
 *  this class; ux-design: recommend (0.8)".
 */
export function summarizeAcumenConsults(consults: readonly AcumenConsultResult[]): string {
  if (consults.length === 0) return "";
  const parts = consults.map((c) => {
    if (c.error) return `${c.professionKey}: consult failed (fail-open)`;
    const confidence =
      typeof c.confidenceScore === "number" ? ` (${c.confidenceScore})` : "";
    const rationale = c.rationale ? ` — ${c.rationale}` : "";
    return `${c.professionKey}: ${c.outcomeType}${confidence}${rationale}`;
  });
  return `Acumen consults (advisory) — ${parts.join("; ")}`;
}

/** The real nomination dep for gate call sites. */
export const realAcumenGapNomination: NominateGapFn = nominateAcumenCorpusGap;

// Acumen corpus-gap nomination (W16 — BI-18519A73, EP-413F2602).
//
// Closes the nomination half of the enforcement loop: when a Build Studio
// phase gate consults an impacted acumen and the craft cannot answer — the
// consult defers/escalates with no applicable material, or the profession's
// own profile answered below confidence — the GUARD nominates the gap as a
// CoworkerCapabilityNeed against the acumen's resident coworker, and the
// HUMAN consolidates it in the review-service inbox
// (apps/web/lib/coworker-self-assessment/review-service.ts). Guards nominate;
// humans consolidate — nothing here writes corpus material.
//
// Reuses the EXISTING creation service (submitCoworkerSelfAssessment) rather
// than raw prisma creates, so the need lands with the same backlog auto-filing
// and origin-dedup behaviour every other capability need gets. Dedupe here is
// belt-and-braces on top of that: an OPEN need with the same
// agentId+kind+need fingerprint (capabilityNeedOriginId — the same key the
// backlog origin dedup uses) suppresses a new nomination entirely, so a
// repeatedly-consulted gap surfaces once in the inbox, not once per phase.
//
// Audit-only contract (same as the shadow hooks): every failure is swallowed
// with a structured log. A nomination must never fail a phase gate.

import {
  capabilityNeedOriginId,
  listCoworkerCapabilityNeeds,
  submitCoworkerSelfAssessment,
} from "@/lib/coworker-self-assessment/assessment-service";
import { getAcumenRoomShape } from "@/lib/work-management/acumen-room-shapes";
import { getErrorMessage } from "@/lib/shared/get-error-message";

/**
 * Below this consult confidence, a profession-profile answer still nominates a
 * corpus gap: the craft spoke, but not well enough to act on.
 */
export const ACUMEN_GAP_CONFIDENCE_THRESHOLD = 0.5;

/** Statuses that mean the need is still live in the review inbox. */
const OPEN_NEED_STATUSES: ReadonlySet<string> = new Set([
  "submitted",
  "reviewing",
  "accepted",
  "backlog-filed",
]);

/** The need kind a corpus gap files under (→ backlog workType "doc"): the
 *  missing thing is recorded craft doctrine, i.e. documentation to write. */
const CORPUS_GAP_NEED_KIND = "convention";

export type AcumenGapConsultOutcome = {
  professionKey: string;
  /** DecisionInteraction id of the consult that surfaced the gap. */
  interactionId: string | null;
  outcomeType: string;
  confidenceScore: number;
  /** True when the acumen's OWN profession profile decided (not a fallback). */
  professionProfileSelected: boolean;
  /** True when no applicable craft material covered the decision class. */
  coverageGap: boolean;
  domainClass: string;
  question: string;
};

export type AcumenGapNominationResult = {
  nominated: boolean;
  needId?: string;
  /** Why nothing was nominated ("not-a-gap" | "duplicate-open-need" | "unknown-acumen" | "error"). */
  reason?: string;
};

export type AcumenGapNominationDeps = {
  submitAssessment?: typeof submitCoworkerSelfAssessment;
  listNeeds?: typeof listCoworkerCapabilityNeeds;
};

/**
 * Nomination predicate. A consult nominates when it did NOT produce a path
 * forward (defer/escalate) AND either (a) the profession profile itself was
 * selected but answered below the confidence threshold, or (b) no applicable
 * craft material existed at all (coverage gap / fallback doctrine).
 */
export function shouldNominateAcumenGap(consult: AcumenGapConsultOutcome): boolean {
  const noPathForward = consult.outcomeType === "defer" || consult.outcomeType === "escalate";
  if (!noPathForward) return false;
  const lowConfidenceCraft =
    consult.professionProfileSelected
    && consult.confidenceScore < ACUMEN_GAP_CONFIDENCE_THRESHOLD;
  const noMaterial = consult.coverageGap || !consult.professionProfileSelected;
  return lowConfidenceCraft || noMaterial;
}

/** Stable need text — the dedupe fingerprint keys on this, so it must NOT
 *  contain per-consult ids or scores. Those go in blocks/evidence instead. */
function needTextFor(professionKey: string, domainClass: string): string {
  return (
    `Craft corpus gap: the ${professionKey} profession has no decision material `
    + `strong enough to answer ${domainClass} consults from Build Studio phase gates`
  );
}

/**
 * Nominate one acumen corpus gap for human consolidation. Never throws:
 * failures are logged and reported as `{ nominated: false, reason: "error" }`.
 */
export async function nominateAcumenCorpusGap(
  consult: AcumenGapConsultOutcome,
  deps: AcumenGapNominationDeps = {},
): Promise<AcumenGapNominationResult> {
  try {
    if (!shouldNominateAcumenGap(consult)) {
      return { nominated: false, reason: "not-a-gap" };
    }

    const acumen = getAcumenRoomShape(consult.professionKey);
    if (!acumen) {
      return { nominated: false, reason: "unknown-acumen" };
    }
    const agentId = acumen.coworkerAgentId;
    const need = needTextFor(consult.professionKey, consult.domainClass);
    const fingerprint = capabilityNeedOriginId(agentId, CORPUS_GAP_NEED_KIND, need);

    const listNeeds = deps.listNeeds ?? listCoworkerCapabilityNeeds;
    const existing = (await listNeeds({
      agentId,
      kind: CORPUS_GAP_NEED_KIND,
    })) as Array<{ needId?: string; status?: string; need?: string }>;
    const openDuplicate = existing.find(
      (row) =>
        OPEN_NEED_STATUSES.has(String(row.status ?? ""))
        && capabilityNeedOriginId(agentId, CORPUS_GAP_NEED_KIND, String(row.need ?? "")) === fingerprint,
    );
    if (openDuplicate) {
      return { nominated: false, reason: "duplicate-open-need", needId: openDuplicate.needId };
    }

    const submit = deps.submitAssessment ?? submitCoworkerSelfAssessment;
    const result = await submit({
      agentId,
      trigger: "build-studio-acumen-consult",
      routeContext: "/build",
      verdict: "gaps",
      confidence: "low",
      missionSummary: null,
      capabilitySummary: null,
      needs: [
        {
          kind: CORPUS_GAP_NEED_KIND,
          severity: "important",
          need,
          blocks:
            `Build Studio acumen consult ${consult.interactionId ?? "(unrecorded)"} returned `
            + `${consult.outcomeType} at confidence ${consult.confidenceScore} for domain class `
            + `${consult.domainClass}. Until the corpus is consolidated, this acumen cannot `
            + `advise phase decisions in this class.`,
          evidenceJson: {
            source: "acumen-gap-nomination",
            professionKey: consult.professionKey,
            decisionInteractionId: consult.interactionId,
            outcomeType: consult.outcomeType,
            confidenceScore: consult.confidenceScore,
            professionProfileSelected: consult.professionProfileSelected,
            coverageGap: consult.coverageGap,
            domainClass: consult.domainClass,
            question: consult.question,
          },
        },
      ],
    });

    console.info(
      `[tool-trace] acumen.gap.nominated ${JSON.stringify({
        professionKey: consult.professionKey,
        agentId,
        needId: result.needIds[0] ?? null,
        decisionInteractionId: consult.interactionId,
      })}`,
    );
    return { nominated: true, needId: result.needIds[0] };
  } catch (error) {
    // Audit-only contract: nomination must never fail the consulting gate.
    console.warn(
      `[tool-trace] acumen.gap.nomination-failed ${JSON.stringify({
        professionKey: consult.professionKey,
        decisionInteractionId: consult.interactionId,
        error: getErrorMessage(error),
      })}`,
    );
    return { nominated: false, reason: "error" };
  }
}

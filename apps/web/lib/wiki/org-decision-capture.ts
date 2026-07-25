// Pure helpers for the WWWD org-decision capture loop (BI-9677364B,
// EP-0AF96937 stance-onboarding design §10 Phase 3).
//
// When a business decision escalates/defers at the WWWD gate and the owner
// answers it, the answer can optionally become a STANDING stance: a published
// org-overlay page + a `ruled` (A/1.0) material in the decision's domainClass,
// so the next equivalent decision resolves instead of escalating. This module
// is pure — input validation + deriving the standing-stance page shape from a
// DecisionInteraction — so the server action stays thin and the derivation is
// unit-tested.

import type { DecisionDomainClass } from "@/lib/decision-perspective/types";
import { BUSINESS_STANCE_SLUG_PREFIX } from "./business-stance";

export type OrgDecisionCaptureInput = {
  interactionId: string;
  /** The owner's answer — what the business should do. */
  answer: string;
  /** Optional why, kept alongside the answer on the capture + stance page. */
  rationale?: string | null;
  /** When true, the answer also becomes a standing stance (ruled material). */
  makeStanding: boolean;
  /** Optional plain title for the standing stance; derived when omitted. */
  standingTitle?: string | null;
  /**
   * BI-6DCF772F: which of the gate's scored options the owner chose. Membership
   * against the row's scoredOptions is validated in the action (this pure helper
   * cannot see the row); here it is only trimmed and passed through.
   */
  chosenOptionId?: string | null;
};

export type OrgDecisionCaptureValidation =
  | { ok: true; interactionId: string; answer: string; rationale: string | null; makeStanding: boolean; standingTitle: string | null; chosenOptionId: string | null }
  | { ok: false; error: string };

export function validateOrgDecisionCapture(
  input: OrgDecisionCaptureInput,
): OrgDecisionCaptureValidation {
  const interactionId = (input.interactionId ?? "").trim();
  const answer = (input.answer ?? "").trim();
  if (!interactionId) {
    return { ok: false, error: "Missing decision id." };
  }
  if (answer.length < 8) {
    return { ok: false, error: "Describe what the business should do in a sentence or two." };
  }
  return {
    ok: true,
    interactionId,
    answer,
    rationale: (input.rationale ?? "").trim() || null,
    makeStanding: input.makeStanding === true,
    standingTitle: (input.standingTitle ?? "").trim() || null,
    chosenOptionId: (input.chosenOptionId ?? "").trim() || null,
  };
}

export type StandingStancePage = {
  slug: string;
  title: string;
  body: string;
  abstract: string;
  domainClasses: DecisionDomainClass[];
};

/** Compact a question into a readable stance title when none is supplied. */
export function deriveStandingTitle(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 79).trimEnd()}…` : oneLine;
}

/**
 * Shape the standing-stance page from the decision + the owner's ruling. The
 * slug is keyed on the interaction id — stable, collision-free, and traceable
 * back to the ledger row that produced it.
 */
export function buildStandingStancePage(input: {
  interactionId: string;
  question: string;
  domainClass: DecisionDomainClass;
  answer: string;
  rationale: string | null;
  standingTitle: string | null;
}): StandingStancePage {
  const title = input.standingTitle || deriveStandingTitle(input.question);
  const body = [
    `# ${title}`,
    "",
    `When this comes up: ${input.question.trim()}`,
    "",
    `Our standing answer: ${input.answer}`,
    input.rationale ? `\nWhy: ${input.rationale}` : "",
    "",
    `Ruled by the owner on a real decision (${input.interactionId}). Coworkers treat this as settled doctrine for equivalent cases; adjust it in Decision governance if the business changes its mind.`,
  ].join("\n");

  return {
    slug: `${BUSINESS_STANCE_SLUG_PREFIX}/ruling-${input.interactionId.toLowerCase()}`,
    title,
    body,
    abstract: input.answer,
    domainClasses: [input.domainClass],
  };
}

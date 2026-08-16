// Recent-override counting for the decision gate's confidence discount.
//
// Extracted from `evaluator.ts` (BI-ACF0D6D4) when that module crossed the
// 800-LOC ceiling. One concern: deciding what counts as the owner having
// OVERRULED a profile, which is a governance judgement worth reading on its own
// rather than buried in the evaluator.

import type { DecisionDomainClass } from "./types";

/** Window over which an overrule still counts against a profile's confidence. */
export const RECENT_OVERRIDE_WINDOW_DAYS = 30;

/**
 * How often has the owner recently OVERRULED this profile in this domain?
 *
 * The count feeds `overridePenalty`, whose purpose is "the corpus is drifting
 * from what the owner actually does, so trust it less here". It used to count
 * every `EscalationCapture` — a row written whenever a human ANSWERS an
 * escalated decision — which measured engagement, not disagreement (BI-ACF0D6D4).
 *
 * The consequence was perverse and measured live: clearing a review queue of 13
 * items drove the penalty to its 0.3 cap, which subtracted enough confidence to
 * force the NEXT decision to escalate too. Answering the queue is what kept the
 * queue full. Agreeing with the gate penalised it exactly as hard as overruling
 * it.
 *
 * An override now requires proof of divergence: the gate must have actually
 * recommended something (`recommendedOptionId`), and the human must have chosen
 * something else. Two cases deliberately do NOT count:
 *
 *  - no recommendation was made — there was nothing to overrule, which is the
 *    shape of every plain escalation;
 *  - the human answered without picking a structured option (`chosenOptionId`
 *    null) — absence of evidence is not evidence of disagreement, and guessing
 *    here would reintroduce the same false signal in a quieter form.
 *
 * Comparing two columns is not expressible in a Prisma `where`, so the
 * candidate set is narrowed in SQL (window + domain + profile + has a
 * recommendation) and the divergence test is applied in memory. The window and
 * domain filters keep that set small.
 */
export async function getRecentOverrideCount(input: {
  db: any;
  profileId: string;
  domainClass: DecisionDomainClass;
  now: Date;
}): Promise<number> {
  if (!input.db.escalationCapture?.findMany) return 0;
  const gte = new Date(input.now.getTime() - RECENT_OVERRIDE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const captures = await input.db.escalationCapture.findMany({
    where: {
      domainClass: input.domainClass,
      createdAt: { gte },
      interaction: {
        profileId: input.profileId,
        recommendedOptionId: { not: null },
      },
    },
    select: {
      interaction: { select: { recommendedOptionId: true, chosenOptionId: true } },
    },
  });
  return captures.filter((capture: {
    interaction: { recommendedOptionId: string | null; chosenOptionId: string | null } | null;
  }) => {
    const recommended = capture.interaction?.recommendedOptionId ?? null;
    const chosen = capture.interaction?.chosenOptionId ?? null;
    return recommended !== null && chosen !== null && chosen !== recommended;
  }).length;
}

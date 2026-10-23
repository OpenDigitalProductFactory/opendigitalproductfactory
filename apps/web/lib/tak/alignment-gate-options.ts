// The fixed option menu the TAK pre-execution alignment gate puts to WWWD
// (alignment-tool-gate.ts). Split out so the decision trust bridge can name the
// same menu without importing the gate's Prisma client (BI-AE416D75).
//
// The gate runs because a coworker asked to execute a governed tool, so the
// coworker's own proposal on every row it writes is to proceed. That proposal
// is a fact of the invocation, not a guess about it.

import type { DecisionScoredOption } from "@/lib/decision-perspective/types";

export const TAK_ALIGNMENT_OPTIONS = ["Proceed", "Decline"] as const;

export const TAK_ALIGNMENT_SCORED_OPTIONS: DecisionScoredOption[] = [
  { id: "proceed", description: "Proceed", features: { mission_fit: 1, market_fit: 1, product_fit: 1, gtm_fit: 1 } },
  { id: "decline", description: "Decline", features: { reversibility: 1, blast_radius: 0 } },
];

/** What the invoking coworker proposes on every TAK alignment decision. */
export const TAK_ALIGNMENT_PROPOSED_OPTION_ID = "proceed";

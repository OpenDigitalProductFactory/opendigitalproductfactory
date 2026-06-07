// Scheduled research proposals (BI-8A58C65A, EP-CORPUS-BOOTSTRAP) — slice D.
//
// The founder's open-Q#4 model: research is SCHEDULED. On a cadence, propose a
// research run per org (which then awaits human approval — slice B — before any
// execution — slice C). Proposals are harmless: they only request approval, so
// a conservative weekly default is safe. proposeResearch dedups by (org, topic)
// so a recurring scan never piles up duplicate approvals.
//
// Defaults (easily tuned): WEEKLY cadence (cron in research-schedule.ts), two
// standard topics, only for orgs that have completed enough onboarding to have
// a business context (a mission). Cost is gated downstream by the approval +
// execution slices — scheduling itself is free.

import { prisma } from "@dpf/db";
import { proposeResearch, type ProposeResearchInput } from "./research-proposal";

/** Standard recurring research topics. Each builds a query from the org's
 *  business context. Keep this list short and high-signal. */
export const STANDARD_RESEARCH_TOPICS: Array<{
  topic: string;
  buildQuery: (context: string) => string;
}> = [
  {
    topic: "competitive-landscape",
    buildQuery: (ctx) =>
      `Competitive landscape for ${ctx}: who are the main competitors and how is the market positioned?`,
  },
  {
    topic: "market-size",
    buildQuery: (ctx) => `Market size and total addressable market for ${ctx}.`,
  },
];

type BusinessContextRow = {
  organizationId: string;
  industry: string | null;
  description: string | null;
};

export type ProposeScheduledResearchDeps = {
  db?: {
    businessContext: { findMany: (args: unknown) => Promise<unknown> };
  };
  /** Defaults to proposeResearch (slice B). */
  propose?: (input: ProposeResearchInput) => Promise<{ proposalId: string; created: boolean }>;
};

export type ProposeScheduledResearchResult = {
  orgs: number;
  /** Newly-created pending proposals. */
  proposed: number;
  /** Coalesced into an already-pending proposal (no duplicate). */
  deduped: number;
};

function contextLabel(o: BusinessContextRow): string {
  return (o.industry ?? "").trim() || (o.description ?? "").trim() || "this business";
}

/** Propose the standard research topics for every org that has a business
 *  context. Idempotent across runs via proposeResearch's (org, topic) dedup. */
export async function proposeScheduledResearch(
  deps: ProposeScheduledResearchDeps = {},
): Promise<ProposeScheduledResearchResult> {
  const db = deps.db ?? prisma;
  const propose = deps.propose ?? ((input: ProposeResearchInput) => proposeResearch(input));

  // Only orgs that have completed enough onboarding to have a mission — avoids
  // proposing research for the bootstrap/empty org.
  const orgs = (await db.businessContext.findMany({
    where: { mission: { not: null } },
    select: { organizationId: true, industry: true, description: true },
  })) as BusinessContextRow[];

  let proposed = 0;
  let deduped = 0;
  for (const org of orgs) {
    const ctx = contextLabel(org);
    for (const t of STANDARD_RESEARCH_TOPICS) {
      const r = await propose({
        organizationId: org.organizationId,
        topic: t.topic,
        query: t.buildQuery(ctx),
        proposedBy: "schedule",
      });
      if (r.created) proposed++;
      else deduped++;
    }
  }

  return { orgs: orgs.length, proposed, deduped };
}

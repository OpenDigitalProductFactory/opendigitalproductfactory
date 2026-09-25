// Server-side data for the tie-out panel on Ops > Delivery Flow (BI-CBF5D708):
// the tie-out itself, this quarter's budget proposal, and the epics whose
// proposed portfolio no person has confirmed yet (BI-A73A7DA3).

import { prisma } from "@dpf/db";

import type { UnconfirmedEpic } from "@/components/ops/PortfolioTieOutPanel";

import { loadEpicPortfolioProposals } from "./epic-portfolio-attribution";
import { quarterBounds } from "./investment-points";
import { proposePortfolioBudgets } from "./portfolio-budget";
import { loadPortfolioTieOut } from "./tie-out";

export async function loadPortfolioTieOutPanel(now: Date = new Date()) {
  const db = prisma as never;
  const [tieOut, proposal, epics] = await Promise.all([
    loadPortfolioTieOut(db, now),
    proposePortfolioBudgets(db, quarterBounds(now)),
    loadEpicPortfolioProposals(db),
  ]);
  const names = new Map(tieOut.rows.map((r) => [r.portfolioId, r.name]));
  const unconfirmedEpics: UnconfirmedEpic[] = epics
    .filter((e) => e.portfolioId !== null && !e.current.some((c) => c.confirmedAt !== null))
    .map((e) => ({
      epicId: e.epicId,
      title: e.title,
      portfolioId: e.portfolioId as string,
      portfolioName: names.get(e.portfolioId) ?? (e.portfolioId as string),
      confidence: e.confidence === "high" ? "high" : "low",
    }));
  return {
    tieOut,
    proposedPoints: Object.fromEntries(proposal.rows.map((r) => [r.id, r.proposedPoints])),
    unconfirmedEpics,
  };
}

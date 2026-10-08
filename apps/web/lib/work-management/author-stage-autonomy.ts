// Whether the Workroom drive may run a room's role:author delivery stages with
// an agent (BI-8A32EBFF). Pure: the live reads are in author-stage-autonomy-live.ts.
//
// The operator decision of 2026-10-07 ("all shapes, within budget") has two
// conditions, and both must hold for a room:
//   1. the recorded operator pre-authorisation is in force
//      (author-stage-preauthorisation.ts), and
//   2. the room's work is funded within budget.
// When both hold, the room's `author` role binds to the software-engineer
// acumen coworker for this tick, through the same role-binding path a room's
// own binding uses (BI-C1781121, boundStagePrincipal). That path honours only a
// non-governed stage, so merge, acceptance and post-implementation review stay
// with a person: escalation on damaging actions is a gate, not a trust tier.
// When either fails, the stage raises attention as before and the drive's
// ledger names the missing condition.
//
// "Funded within budget" reads the budget models and adds no budget of its own:
// the item's portfolio by the attribution admission uses (resolveBudgetPortfolio
// via the investment read model), that portfolio's budget for the current
// quarter (loadPortfolioBudgets; none set is NOT funded, never read as zero),
// and the portfolio's delivered plus in-flight points this quarter within the
// allocation. An unsized or unattributed item is not funded, as admission
// refuses an unsized autonomous start.

import { ACUMEN_ROOM_SHAPES } from "./acumen-room-shapes";
import { DELIVERY_AUTHOR_ROLE, DELIVERY_XLARGE_SHAPE_KEY, isDeliveryShapeKey } from "./delivery-shapes";
import type { AuthorStagePreauthorisation } from "./author-stage-preauthorisation";
import { quarterBounds } from "@/lib/portfolio/investment-points";
import { resolveInvestmentItem, summarizePortfolioInvestment, type InvestmentItemRow } from "@/lib/portfolio/investment-read-model";
import type { PortfolioBudgetStatus } from "@/lib/portfolio/portfolio-budget";

/** The coworker that answers for author stages: the software-engineer acumen's resident coworker. */
export const AUTHOR_STAGE_AGENT_REF = `agent:${
  ACUMEN_ROOM_SHAPES.find((shape) => shape.professionKey === "software-engineer")?.coworkerAgentId ?? "build-specialist"
}`;

export type AuthorStageFunding =
  | { funded: true; portfolioId: string; summary: string }
  | { funded: false; because: string };

export type AuthorStageAutonomy = {
  /** Merged under the room's own role bindings, which win. */
  roleBindings: Record<string, string>;
  /** Why the author stage is not pre-authorised for this room; null when it is, or when the rule does not apply. */
  withheldBecause: string | null;
};

const NO_AUTONOMY: AuthorStageAutonomy = { roleBindings: {}, withheldBecause: null };

/** One funding decision per item, from one read of the investment and budget models. */
export function buildAuthorStageFunding(input: {
  items: readonly InvestmentItemRow[];
  budgets: readonly PortfolioBudgetStatus[];
  now: Date;
}): (itemId: string | null) => AuthorStageFunding {
  const period = quarterBounds(input.now);
  const byItem = new Map(input.items.map((row) => [row.itemId, row]));
  const rows = new Map(summarizePortfolioInvestment([...input.items], input.now, period).rows.map((row) => [row.portfolioId, row]));
  const budgets = new Map(input.budgets.map((status) => [status.id, status]));

  return (itemId) => {
    if (!itemId) return { funded: false, because: "The room is bound to no backlog item, so no budget funds it." };
    const item = byItem.get(itemId);
    if (!item) return { funded: false, because: `${itemId} is not live work this quarter, so no budget funds it.` };
    const { resolution, points } = resolveInvestmentItem(item, period);
    if (!resolution.portfolioId) {
      return { funded: false, because: `${itemId} reaches no portfolio, so no budget can fund it.` };
    }
    if (points === null) return { funded: false, because: `${itemId} has no size, so its investment is unknown and cannot be funded.` };
    const status = budgets.get(resolution.portfolioId);
    const name = status?.name ?? resolution.portfolioId;
    if (!status?.budget) {
      return { funded: false, because: `No budget is set for ${name} this quarter; unfunded work is not pre-authorised.` };
    }
    const row = rows.get(resolution.portfolioId);
    const committed = (row?.deliveredPoints ?? 0) + (row?.inFlightPoints ?? 0);
    const allocated = status.budget.allocatedPoints;
    if (committed > allocated) {
      return { funded: false, because: `${name} has ${committed} of ${allocated} points committed this quarter (${committed - allocated} over).` };
    }
    return { funded: true, portfolioId: resolution.portfolioId, summary: `${name}: ${committed} of ${allocated} points committed this quarter.` };
  };
}

/** The author-stage decision for one room. Applies only to delivery shapes; xlarge never enters implementation. */
export function decideAuthorStageAutonomy(input: {
  shapeKey: string | null;
  preauthorisation: AuthorStagePreauthorisation;
  funding: AuthorStageFunding;
}): AuthorStageAutonomy {
  if (!isDeliveryShapeKey(input.shapeKey)) return NO_AUTONOMY;
  if (input.shapeKey === DELIVERY_XLARGE_SHAPE_KEY) {
    return { roleBindings: {}, withheldBecause: "An xlarge shape never enters implementation; it is decomposed by a person." };
  }
  if (input.preauthorisation.state !== "in-force") return { roleBindings: {}, withheldBecause: input.preauthorisation.because };
  if (!input.funding.funded) return { roleBindings: {}, withheldBecause: input.funding.because };
  return { roleBindings: { [DELIVERY_AUTHOR_ROLE]: AUTHOR_STAGE_AGENT_REF }, withheldBecause: null };
}

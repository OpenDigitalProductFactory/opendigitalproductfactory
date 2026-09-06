// OUTSIDE-IN operator cockpit — the pure grouping + ranking for the consolidated
// workspace-home "what needs you now" surface (BI-8C3EB52C, BI-2651043B, BI-D35DE119).
//
// The governing principle (BI-8C3EB52C): the cockpit organizes the four canonical
// Portfolios FROM THE CUSTOMER INWARD. The primary organizing perspective, in order:
//   1. Goods and Services for Sale  (customer-facing, PRIMARY, outermost)
//   2. For Employees / Workforce     (PRIMARY)
//   3. Manufacturing and Delivery    (secondary)
//   4. Foundational                  (deepest inside, secondary)
//
// Inner-portfolio items (manufacturing / foundational) enter the PRIMARY attention
// surface ONLY when they are flagged as blocking a customer/business outcome — a
// blocker jumps the queue. The ranking key is customer-impact / outside-in depth,
// NOT recency or volume. This is the F7 fix: a just-now customer-blocking outage
// outranks a 12-day-old stale inner-tooling item, instead of losing to it on age.
//
// Integrity rule (inherited from triage.ts): there is NO fabricated composite score.
// Items are ordered by a TRANSPARENT TIERED RULE — blocking → outside-in depth →
// the SAME objective triage factors (time → risk → blast → age). Every position is
// explainable in one line (see outsideInReason).

import type { AttentionItem, AttentionPortfolio, AttentionSource } from "./types";
import { compareAttention, isOverrideTier } from "./triage";

// ─── Portfolio depth (outside-in: lower = closer to the customer) ─────────────

export const PORTFOLIO_DEPTH: Record<AttentionPortfolio, number> = {
  "products-and-services-sold": 0,
  "for-employees": 1,
  "manufacturing-and-delivery": 2,
  foundational: 3,
};

/** The two customer-inward PRIMARY portfolios. Items here are always primary;
 *  the inner two are secondary unless a blocker promotes them. */
const PRIMARY_PORTFOLIOS: ReadonlySet<AttentionPortfolio> = new Set<AttentionPortfolio>([
  "products-and-services-sold",
  "for-employees",
]);

export function isPrimaryPortfolio(portfolio: AttentionPortfolio): boolean {
  return PRIMARY_PORTFOLIOS.has(portfolio);
}

const PORTFOLIO_LABEL: Record<AttentionPortfolio, string> = {
  "products-and-services-sold": "Goods and services for sale",
  "for-employees": "Workforce",
  "manufacturing-and-delivery": "Manufacturing & delivery",
  foundational: "Foundational",
};

export function portfolioLabel(portfolio: AttentionPortfolio): string {
  return PORTFOLIO_LABEL[portfolio];
}

/** Ordered outside-in — customer-facing first. Used to lay out the cockpit sections. */
export const PORTFOLIOS_OUTSIDE_IN: readonly AttentionPortfolio[] = (
  Object.keys(PORTFOLIO_DEPTH) as AttentionPortfolio[]
).sort((a, b) => PORTFOLIO_DEPTH[a] - PORTFOLIO_DEPTH[b]);

// ─── Source → default portfolio classification ───────────────────────────────
//
// The outside-in classification of each scattered source. These are DEFAULTS: an
// item may carry an explicit `portfolio` that wins over this map (see portfolioOf).
// A blocker jumps the queue regardless of which portfolio it is classified under.

const SOURCE_PORTFOLIO: Record<AttentionSource, AttentionPortfolio> = {
  // Customer-facing revenue surface.
  "approval-outbound": "products-and-services-sold", // marketing/sales drafts to customers
  "reservation-exception": "products-and-services-sold", // a guest awaiting an owner reservation decision
  "hospitality-capacity": "products-and-services-sold", // capacity that blocks a reservation, event, production order, or delivery
  "storefront-inquiry": "products-and-services-sold", // a customer enquiry awaiting the owner's first reply
  // A stalled room is classified by the room's OWN portfolio when it has one
  // (projectRoomStall sets `portfolio`, which wins over this default). This
  // fallback covers a room with no portfolio role recorded.
  "workroom-stall": "foundational",
  "business-journey": "products-and-services-sold", // a customer-facing journey (find/enquire/book/pay) failed its watchdog run
  // The workforce — people + AI coworkers needing a human.
  "ai-decision": "for-employees", // a coworker's decision the kernel couldn't make
  "paused-ai": "for-employees", // a coworker paused, needs input/credential
  "scheduled-task": "for-employees", // a coworker cadence errored
  "agent-proposal": "for-employees", // a coworker wants approval to act
  "coworker-envelope": "for-employees", // a coworker is held until this employee decides
  "skill-proposal": "foundational", // a change to what every coworker knows how to do
  // Build / delivery pipeline (deeper inside).
  escalation: "manufacturing-and-delivery", // Build Studio could not self-repair
  "research-proposal": "manufacturing-and-delivery", // internal capability R&D
  "coworker-memory": "for-employees", // role-local coworker craft memory
  // Foundational back-office / platform infra (deepest inside).
  "approval-bill": "foundational", // AP bill approval
  "approval-expense": "foundational", // expense claim
  "compliance-submission": "foundational", // regulatory filing
  "ai-readiness-blocker": "foundational", // platform readiness gap
  "platform-health": "foundational", // platform health alert — infra posture
  "provider-credential": "foundational", // an AI provider's saved sign-in expired
  "compliance-source-freshness": "foundational", // governed compliance evidence lapsing — platform posture
};

/** The default portfolio for a source (outside-in classification). Pure. */
export function portfolioForSource(source: AttentionSource): AttentionPortfolio {
  return SOURCE_PORTFOLIO[source] ?? "foundational";
}

/** The portfolio an item is classified under — its explicit tag if present,
 *  otherwise the source-level default. Pure. */
export function portfolioOf(item: AttentionItem): AttentionPortfolio {
  return item.portfolio ?? portfolioForSource(item.source);
}

// ─── Blocking a customer/business outcome (the queue-jump signal) ─────────────

/** Does this item block a customer or business outcome? Such an item JUMPS the
 *  outside-in queue no matter how deep its portfolio sits — the whole point of the
 *  redesign. Two honest signals, no fabricated score:
 *    - `triage.blastRadius` is set: something/someone is explicitly blocked, OR
 *    - the item is in the override tier: a hard deadline is imminent/passed, or the
 *      action is irreversible + high-risk (a business outcome is at stake now).
 *  Pure. */
export function blocksBusinessOutcome(item: AttentionItem): boolean {
  return Boolean(item.triage.blastRadius) || isOverrideTier(item);
}

/** Whether an item belongs on the PRIMARY attention surface: it is a customer-inward
 *  (primary) portfolio, OR it is an inner item that blocks a customer/business
 *  outcome (a blocker jumps the queue). Inner, non-blocking items stay secondary.
 *  Pure. */
export function entersPrimaryQueue(item: AttentionItem): boolean {
  return isPrimaryPortfolio(portfolioOf(item)) || blocksBusinessOutcome(item);
}

// ─── Comparator ──────────────────────────────────────────────────────────────

/** Total-order comparator over attention items, OUTSIDE-IN. Pure + deterministic.
 *  Tiered rule:
 *    1. blocking a customer/business outcome sorts first (the queue-jump),
 *    2. then outside-in portfolio depth (customer-facing before deepest inside),
 *    3. then the SAME objective triage order (override → time → risk → blast → age)
 *       via compareAttention, as the within-portfolio tie-break.
 *  Sort a COPY. */
export function compareOutsideIn(a: AttentionItem, b: AttentionItem): number {
  // 1. Blocking jumps the queue.
  const ab = blocksBusinessOutcome(a) ? 0 : 1;
  const bb = blocksBusinessOutcome(b) ? 0 : 1;
  if (ab !== bb) return ab - bb;

  // 2. Outside-in depth: closer to the customer sorts first.
  const ad = PORTFOLIO_DEPTH[portfolioOf(a)];
  const bd = PORTFOLIO_DEPTH[portfolioOf(b)];
  if (ad !== bd) return ad - bd;

  // 3. Within the same blocking + portfolio band, defer to the objective triage
  //    order (never recency alone — age is the LAST tie-break, as it already is).
  return compareAttention(a, b);
}

/** Order items by the outside-in rule. Returns a new array. */
export function orderOutsideIn(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort(compareOutsideIn);
}

// ─── The consolidated cockpit queue ──────────────────────────────────────────

export type OutsideInGroup = {
  portfolio: AttentionPortfolio;
  label: string;
  items: AttentionItem[];
};

export type OutsideInCockpit = {
  /** The single source of truth for "what needs you now" — customer-inward first,
   *  plus any inner blocker that jumped the queue. Ordered by compareOutsideIn. */
  primary: AttentionItem[];
  /** Inner-portfolio items that are NOT blocking a customer/business outcome —
   *  present but demoted; they never inflate the primary "needs you" count. */
  secondary: AttentionItem[];
  /** The primary items grouped by portfolio, outside-in, for sectioned rendering.
   *  Empty groups are omitted. */
  primaryGroups: OutsideInGroup[];
  /** The ONE attention count — the length of the primary queue. This is the single
   *  number the cockpit shows; there is never a second surface claiming otherwise
   *  (the F2 contradiction fix). */
  count: number;
};

/** Partition + order the attention items into the outside-in cockpit. Pure.
 *  This is the single function the workspace-home cockpit renders from, so there is
 *  exactly ONE "what needs you" count and ONE ranking — no competing framings. */
export function buildOutsideInCockpit(items: AttentionItem[]): OutsideInCockpit {
  const primaryItems: AttentionItem[] = [];
  const secondaryItems: AttentionItem[] = [];
  for (const item of items) {
    if (entersPrimaryQueue(item)) primaryItems.push(item);
    else secondaryItems.push(item);
  }

  const primary = orderOutsideIn(primaryItems);
  const secondary = orderOutsideIn(secondaryItems);

  const byPortfolio = new Map<AttentionPortfolio, AttentionItem[]>();
  for (const item of primary) {
    const key = portfolioOf(item);
    const bucket = byPortfolio.get(key);
    if (bucket) bucket.push(item);
    else byPortfolio.set(key, [item]);
  }
  const primaryGroups: OutsideInGroup[] = PORTFOLIOS_OUTSIDE_IN.filter((p) =>
    byPortfolio.has(p),
  ).map((portfolio) => ({
    portfolio,
    label: portfolioLabel(portfolio),
    items: byPortfolio.get(portfolio) ?? [],
  }));

  return { primary, secondary, primaryGroups, count: primary.length };
}

// ─── Explainability ──────────────────────────────────────────────────────────

/** A one-line "why it's ranked here" for a cockpit item — the outside-in analogue
 *  of triage.orderReason. Names the queue-jump and the portfolio perspective so the
 *  order is legible (and overridable) by the operator. Pure. */
export function outsideInReason(item: AttentionItem): string {
  const parts: string[] = [];
  if (blocksBusinessOutcome(item)) {
    parts.push(
      item.triage.blastRadius
        ? `blocking a customer/business outcome (${item.triage.blastRadius})`
        : "blocking a customer/business outcome",
    );
  }
  parts.push(portfolioLabel(portfolioOf(item)));
  return parts.join(" · ");
}

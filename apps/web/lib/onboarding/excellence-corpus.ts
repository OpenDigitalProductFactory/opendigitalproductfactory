// apps/web/lib/onboarding/excellence-corpus.ts
//
// Excellence Corpus (EP-LIVING-BUSINESS-EXCELLENCE, workstream B) — the
// per-archetype "what great looks like": the one-line feel (from the demo-flavor
// notes), the north-star KPIs a well-run one watches (from the marketing
// playbook), and the moves a good operator makes. This is the PRIMING content
// that seeds a new org's WWWD corpus at unconfirmed B/0.6, so the twin's cog is
// primed with excellence instead of starting from a blank slate.
//
// Derived, not authored per-org: composes the shipped per-archetype signal
// (DemoFlavor notes, getPlaybook KPIs) with a thin authored per-category moves
// floor — the same derive-with-override discipline as the rest of the program.
//
// PURE + deterministic (no Date/Math.random).

import { resolveDemoFlavor, type ArchetypeCategory } from "@dpf/storefront-templates";

import { getPlaybook } from "@/lib/tak/marketing-playbooks";

export interface ExcellenceCorpus {
  archetypeId: string | null;
  /** One line: what a great one *feels* like. */
  whatGreatLooksLike: string;
  /** The north-star KPIs a well-run one watches (from the playbook). */
  northStarKpis: string[];
  /** The concrete moves a good operator makes. */
  goodOperatorMoves: string[];
  /** The primary goal the business is organised around. */
  primaryGoal: string;
}

/** Per-category "good operator moves" — the concrete habits of a well-run one.
 *  Merged/​fallen-back like the demo-flavor notes floor. */
const CATEGORY_OPERATOR_MOVES: Partial<Record<ArchetypeCategory, string[]>> = {
  "healthcare-wellness": [
    "Keep a same-day slot open for urgent cases",
    "Rebook the next visit before the patient leaves",
    "Confirm appointments the day before to cut no-shows",
  ],
  "beauty-personal-care": [
    "Rebook clients at the chair, not by chasing later",
    "Fill cancellations from a standby list, never leave a gap",
    "Track colour/repeat clients and prompt their next visit",
  ],
  "fabric-care-services": [
    "Tag every order at intake and reconcile exceptions before it leaves the counter",
    "Watch promised-ready risk daily and tell customers before they ask",
    "Balance plant capacity across dry cleaning, laundry, alterations, and pickup routes",
  ],
  "food-hospitality": [
    "Turn tables without rushing — seat from the waitlist as they clear",
    "Keep the pass moving; expedite before it backs up",
    "Protect the covers-per-shift number without cutting quality",
  ],
  "trades-maintenance": [
    "Route the nearest available tech to urgent jobs first",
    "Stock the van for the day's job mix so nothing needs a return trip",
    "Quote and schedule while you're on site, not after",
  ],
  "professional-services": [
    "Bill work-in-progress promptly — nothing sits unbilled",
    "Watch utilisation weekly and rebalance before deadlines slip",
    "Turn one engagement into the next before it closes",
  ],
  "retail-goods": [
    "Reorder to demand — stock the sellers, clear the dead stock",
    "Pick and hand off online orders fast",
    "Keep the shelf-to-sale path short at the till",
  ],
  "pet-services": [
    "Fit urgent cases in the same day",
    "Send owners home with a clear plan, not just a bill",
    "Keep boarding/daycare capacity visible so you never oversell",
  ],
  "real-estate-construction": [
    "Hit the promised handover date; manage the critical path daily",
    "Close snags fast so the client signs off clean",
    "Keep the client informed at every stage, unprompted",
  ],
  "fitness-recreation": [
    "Fill classes from the waitlist; never run an empty slot",
    "Nudge members whose streak is slipping before they lapse",
    "Flex the timetable to where demand actually is",
  ],
  "nonprofit-community": [
    "Show donors the impact of their gift, specifically",
    "Keep volunteer shifts filled and thanked",
    "Track each programme against its goal, not just activity",
  ],
};

const GENERIC_MOVES: string[] = [
  "Act on waiting demand before it ages",
  "Keep resources busy without overloading any one of them",
  "Turn each completed job into the next booking",
];

/**
 * Derive the per-archetype excellence corpus. Total and deterministic; always
 * returns usable priming content, richer for archetypes with authored flavor.
 */
export function deriveExcellenceCorpus(input: {
  archetypeId?: string | null;
  industry?: string | null;
  ctaType?: string | null;
}): ExcellenceCorpus {
  const category = (input.industry ?? undefined) as ArchetypeCategory | undefined;
  const flavor = input.archetypeId ? resolveDemoFlavor(input.archetypeId, category) : category ? resolveDemoFlavor("", category) : undefined;
  const playbook = getPlaybook(input.industry ?? null, input.ctaType ?? null);

  const whatGreatLooksLike =
    flavor?.notes?.trim() ||
    "A well-run one keeps demand moving, resources busy without strain, and every job delivered and paid.";

  const moves = (category && CATEGORY_OPERATOR_MOVES[category]) || GENERIC_MOVES;

  return {
    archetypeId: input.archetypeId ?? null,
    whatGreatLooksLike,
    northStarKpis: playbook.keyMetrics.slice(0, 4),
    goodOperatorMoves: moves,
    primaryGoal: playbook.primaryGoal,
  };
}

/** Render the corpus as a WWWD wiki-page body (markdown) — the priming material
 *  seeded into the org's stance corpus. */
export function excellenceCorpusToMarkdown(corpus: ExcellenceCorpus, orgLabel = "this business"): string {
  const kpis = corpus.northStarKpis.length
    ? corpus.northStarKpis.map((k) => `- ${k}`).join("\n")
    : "- (set your north-star metrics)";
  const moves = corpus.goodOperatorMoves.map((m) => `- ${m}`).join("\n");
  return [
    "# What great looks like",
    "",
    corpus.whatGreatLooksLike,
    "",
    `A well-run ${orgLabel} is organised around: ${corpus.primaryGoal}.`,
    "",
    "## North-star metrics",
    kpis,
    "",
    "## What a good operator does",
    moves,
    "",
    "This is a starting picture of excellence for this kind of business, derived from how the best ones operate. Confirm or refine it as the organization's own judgment is captured.",
  ].join("\n");
}

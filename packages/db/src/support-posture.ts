// Support-posture projection (BI-4731303B, HAM Phase D1, spec §5.2 step 5). Turns the
// structured CatalogLifecycleMilestone feed dates into the summarized support posture the
// estate UI reads off InventoryEntity — supportStatus + which feed/confidence it came
// from. Part-agnostic and pure (no prisma, no clock): the sweep passes `now` and applies
// the result to the InventoryEntity rows resolved to a hardware identity.
//
// Today the entity's supportStatus is a manufacturer/version heuristic; this replaces it
// with feed-grounded evidence (the eol milestone) when a resolved identity carries one.

/** One milestone as written by the feed adapters. */
export type PostureMilestone = {
  milestone: string;
  date: Date | string | null;
  source: string;
  confidence: number | null;
};

/** The summarized posture projected onto InventoryEntity. */
export type SupportPosture = {
  supportStatus: "supported" | "approaching_end" | "expired";
  supportLifecycleSource: string;
  supportLifecycleConfidence: number | null;
};

/** Days before end-of-support that flips posture from `supported` to `approaching_end`. */
const APPROACHING_END_WINDOW_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Derive support posture from a set of milestones. Keys off the `eol` milestone (end of
 * support); an entity is `expired` once past it, `approaching_end` within the window, else
 * `supported`. When several sources carry an `eol` date, the highest-confidence one wins so
 * a vendor/endoflife date beats a low-confidence Wikidata backfill. Returns null when there
 * is no dated `eol` evidence — the caller then leaves the existing heuristic status intact
 * rather than overwriting it with a guess.
 */
export function deriveSupportPostureFromMilestones(
  milestones: PostureMilestone[],
  now: Date,
): SupportPosture | null {
  const eolCandidates = milestones
    .filter((m) => m.milestone === "eol")
    .map((m) => ({ date: toDate(m.date), source: m.source, confidence: m.confidence }))
    .filter((m): m is { date: Date; source: string; confidence: number | null } => m.date !== null);

  if (eolCandidates.length === 0) return null;

  // Highest confidence first; stable so the first-listed source wins a tie.
  eolCandidates.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const best = eolCandidates[0]!;

  const daysUntilEol = (best.date.getTime() - now.getTime()) / MS_PER_DAY;
  const supportStatus: SupportPosture["supportStatus"] =
    daysUntilEol < 0 ? "expired" : daysUntilEol <= APPROACHING_END_WINDOW_DAYS ? "approaching_end" : "supported";

  return {
    supportStatus,
    supportLifecycleSource: best.source,
    supportLifecycleConfidence: best.confidence,
  };
}

// apps/web/lib/ux-budget/budgets.ts
//
// Per-shell UX budgets — EP-UX-SYSTEM spec §6 L2 / §8 (BI-B9BE9A29).
//
// HONESTY ABOUT THESE NUMBERS. The research pass behind the spec found NO evidence
// validating hard numeric cognitive-load thresholds. So these are explicitly
// PLATFORM-OWNED CALIBRATION, not science, and they are versioned in code where a
// founder can adjust them from lived review (spec §6 L6, "budget calibration" is
// named human residue).
//
// Enforcement therefore splits by ROUTE AGE, not by axis (spec rev 2 decision D1,
// PR #3434). On PRE-EXISTING routes these absolutes are advisory, and the gate that
// actually holds is the REGRESSION RATCHET in the route sweep (BI-BD81682A): a changed
// route may not exceed its own frozen baseline. Retrofitting the absolutes onto those
// routes keeps the §8 flip contract. On NET-NEW routes the absolutes BLOCK from day
// one — a pure ratchet would let a brand-new route become its own baseline and be born
// as a wall of text without ever failing. Legacy debt earns a ratchet; new code has no
// legacy excuse.
//
// PROVISIONAL NUMBERS. Rev 2 sets the day-one absolute at the measured median of
// compliant routes, which needs the §7.1 baseline sweep (not built yet). These values
// are a defensible starting point, not that median; they are expected to move once the
// sweep reports the real distribution, and they only ever move downward.
//
// One source, three consumers: these values feed the prompts agents read (L3), the
// CI checkers (L4/L5), and the migration league table (§7.1).

import type { ReadingLevel } from "@dpf/validators";
import type { RouteAudience } from "../navigation/route-audience";

/**
 * The page shells a surface can intend to be. Deliberately NOT called "archetype" —
 * that word already means industry vertical on this platform (spec §6 L1).
 */
export const UX_SHELLS = [
  "cockpit",
  "list",
  "detail",
  "settings",
  "form",
  "public",
  "unclassified",
] as const;
export type UxShell = (typeof UX_SHELLS)[number];

export type UxBudget = {
  /** Words visible on arrival, collapsed disclosure already excised. */
  maxDefaultVisibleWords: number;
  /** Words in the lead band — the first thing read. */
  maxLeadBandWords: number;
  /** Whether a lead band is expected at all. */
  requireLeadBand: boolean;
  maxPrimaryActions: number;
  maxVisibleFields: number;
  maxChoicesPerControl: number;
  /** Sub-legible / sub-tappable controls tolerated. Always 0: WCAG 2.2 AA 2.5.8. */
  maxSubLegibleControls: number;
  readingLevel: ReadingLevel;
  requireNextActionMarker: boolean;
  /**
   * When true, a marked primary action may not be buried behind a collapsed
   * disclosure — it must be reachable in the default-visible scope. Set for shells
   * where the user comes to DO something (cockpit/detail/settings/form), so hiding
   * the primary verb behind "Advanced" is a finding rather than a word-count win.
   * The self-upgrade regression (BI-D77BF495) is the motivating case.
   */
  requirePrimaryActionReachable: boolean;
  /**
   * Above this many default-visible words the surface must defer detail into at
   * least one disclosure region. This is the anti-wall-of-text rule with teeth:
   * "long" is allowed, "long AND undifferentiated" is not.
   */
  deferredDetailRequiredAboveWords: number;
};

/**
 * Calibration table. Derived from the EP-UX-COGLOAD live audit (a domain landing page
 * measured 818 words / 56 controls / 34 sub-legible controls) and the owner-first
 * summary thresholds already in production (160 words for a summary band).
 */
export const UX_BUDGETS: Record<UxShell, UxBudget> = {
  // The owner's home base: status at a glance, one obvious next move.
  cockpit: {
    maxDefaultVisibleWords: 350,
    maxLeadBandWords: 60,
    requireLeadBand: true,
    maxPrimaryActions: 3,
    maxVisibleFields: 4,
    maxChoicesPerControl: 12,
    maxSubLegibleControls: 0,
    readingLevel: "high-school",
    requireNextActionMarker: true,
    requirePrimaryActionReachable: true,
    deferredDetailRequiredAboveWords: 250,
  },
  // Scanning many rows: the rows carry the words, so the chrome must stay thin.
  list: {
    maxDefaultVisibleWords: 500,
    maxLeadBandWords: 50,
    requireLeadBand: true,
    maxPrimaryActions: 3,
    maxVisibleFields: 6,
    maxChoicesPerControl: 20,
    maxSubLegibleControls: 0,
    readingLevel: "high-school",
    requireNextActionMarker: true,
    requirePrimaryActionReachable: false,
    deferredDetailRequiredAboveWords: 400,
  },
  // One thing in depth — the shell where disclosure earns its keep.
  detail: {
    maxDefaultVisibleWords: 450,
    maxLeadBandWords: 70,
    requireLeadBand: true,
    maxPrimaryActions: 4,
    maxVisibleFields: 8,
    maxChoicesPerControl: 20,
    maxSubLegibleControls: 0,
    readingLevel: "high-school",
    requireNextActionMarker: true,
    requirePrimaryActionReachable: true,
    deferredDetailRequiredAboveWords: 300,
  },
  // Config surfaces were the worst offenders in the audit: everything, all at once.
  settings: {
    maxDefaultVisibleWords: 400,
    maxLeadBandWords: 60,
    requireLeadBand: true,
    maxPrimaryActions: 2,
    maxVisibleFields: 10,
    maxChoicesPerControl: 15,
    maxSubLegibleControls: 0,
    readingLevel: "high-school",
    requireNextActionMarker: false,
    requirePrimaryActionReachable: true,
    deferredDetailRequiredAboveWords: 250,
  },
  // Filling something in: fields are the point, prose is not.
  form: {
    maxDefaultVisibleWords: 300,
    maxLeadBandWords: 50,
    requireLeadBand: true,
    maxPrimaryActions: 2,
    maxVisibleFields: 12,
    maxChoicesPerControl: 15,
    maxSubLegibleControls: 0,
    readingLevel: "high-school",
    requireNextActionMarker: false,
    requirePrimaryActionReachable: true,
    deferredDetailRequiredAboveWords: 250,
  },
  // Customer-facing. Strictest prose budget; the reader owes us no patience.
  public: {
    maxDefaultVisibleWords: 400,
    maxLeadBandWords: 40,
    requireLeadBand: true,
    maxPrimaryActions: 2,
    maxVisibleFields: 12,
    maxChoicesPerControl: 15,
    maxSubLegibleControls: 0,
    readingLevel: "high-school",
    requireNextActionMarker: false,
    requirePrimaryActionReachable: false,
    deferredDetailRequiredAboveWords: 250,
  },
  // Not yet migrated. Generous on purpose — the RATCHET is what holds these routes,
  // not the absolute number. Recorded baseline debt, never hidden (spec §7.1).
  unclassified: {
    maxDefaultVisibleWords: 900,
    maxLeadBandWords: 120,
    requireLeadBand: false,
    maxPrimaryActions: 8,
    maxVisibleFields: 20,
    maxChoicesPerControl: 40,
    maxSubLegibleControls: 0,
    readingLevel: "college",
    requireNextActionMarker: false,
    requirePrimaryActionReachable: false,
    deferredDetailRequiredAboveWords: 700,
  },
};

// ── Audience-aware reading tier: WITHDRAWN (BI-1DE6F69E → BI-0ED0F6B3) ──────
//
// This table used to re-tier `admin` and `builder` to `college` (grade 13). Its
// justification, measured on 2026-07-31, was that EVERY /admin route failed the
// high-school cap — /admin/archetypes 57.9, /admin/business-models 29.4,
// /admin/data-stewardship 18.6, /admin 15.4, /admin/cockpit 12.5 — and that the
// first NET-NEW admin route, /admin/graph-explorer, blocked at 11.0 despite being
// the plainest admin surface in the family. A bar that only the newest route must
// clear, and that the plainest surface cannot, is measuring the wrong thing.
//
// It was. Those numbers were produced by counting full stops, not difficulty
// (BI-0ED0F6B3): the grade was computed over the whole page flattened to one
// string, so a screen of unpunctuated labels collapsed into a single enormous
// "sentence". With the measure corrected, every route in that justification passes
// at grade 9 — /admin/graph-explorer 3.4, /admin/cockpit 6.4, /admin 8.2,
// /admin/data-stewardship 6.5, /admin/business-models 8.4 — and the sole net-new
// route in the confirming sweep measures 8.5.
//
// The premise having been withdrawn, so is the exception. Every audience is held
// to its shell's tier, which is what the hide-complexity-from-layman-users
// doctrine asked for in the first place. 53 of 99 formerly-college routes still
// read above 9 on genuine operator vocabulary; those are now visible advisory
// findings on pre-existing routes rather than a bar quietly lowered to meet them.
//
// Evidence: sweep runs 32625564367 (before) and 32661659842 (after).
// Decision ledger: DI-710B4860812F.

/** Reading tier by route audience. Empty: no audience currently overrides its
 *  shell's tier. Kept as the seam, so a future exception is a data change with a
 *  measured justification rather than a rewrite of `readingLevelFor`. */
export const AUDIENCE_READING_LEVELS: Partial<Record<RouteAudience, ReadingLevel>> = {};

/** Permissiveness order. Later entries tolerate a higher grade. */
const READING_LEVEL_ORDER: readonly ReadingLevel[] = ["high-school", "college", "uncapped"];

function morePermissive(a: ReadingLevel, b: ReadingLevel): ReadingLevel {
  return READING_LEVEL_ORDER.indexOf(a) >= READING_LEVEL_ORDER.indexOf(b) ? a : b;
}

/**
 * The reading tier a route is judged against.
 *
 * The audience may only LOOSEN the shell default, never tighten it: a shell that
 * is already permissive (`unclassified`, at college) must not be pulled back to
 * high school just because its audience carries no override.
 */
export function readingLevelFor(shell: UxShell, audience?: RouteAudience | null): ReadingLevel {
  const shellLevel = UX_BUDGETS[shell].readingLevel;
  const audienceLevel = audience ? AUDIENCE_READING_LEVELS[audience] : undefined;
  return audienceLevel ? morePermissive(shellLevel, audienceLevel) : shellLevel;
}

/**
 * The budget a route is judged against.
 *
 * `audience` is optional so every existing caller keeps its behaviour; omitting it
 * yields exactly the shell table above.
 */
export function budgetFor(shell: UxShell, audience?: RouteAudience | null): UxBudget {
  const budget = UX_BUDGETS[shell];
  const readingLevel = readingLevelFor(shell, audience);
  return readingLevel === budget.readingLevel ? budget : { ...budget, readingLevel };
}

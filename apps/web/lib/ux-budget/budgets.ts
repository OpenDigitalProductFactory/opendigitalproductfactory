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

export function budgetFor(shell: UxShell): UxBudget {
  return UX_BUDGETS[shell];
}

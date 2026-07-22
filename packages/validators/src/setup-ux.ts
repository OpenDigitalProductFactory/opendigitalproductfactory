import { z } from "zod";
import { analyzeReadability } from "./readability";

// ============================================================================
// Setup-surface UX ceilings — the route-level checks BI-C39DC90C asks for.
//
// A non-technical owner's setup surface fails when it dumps too much prose,
// exposes too many competing actions, repeats undistinguishable terse labels
// (Edit / Del / On / Off / ↑ / ↓), buries a long option list in the page and
// accessibility stream (a 101-option service-line select, a 418-option
// timezone select), or generates content the owner cannot see or recover.
//
// This module is pure + shared (no React, no DB) so a page's own descriptor
// — or a rendered-route audit — can be checked against one contract, and the
// thresholds live in one place. Mirrors readability.ts as a sibling policy.
//
// Related: docs/platform-usability-standards.md → Cognitive Load & Setup
// ============================================================================

/** A single interactive control counted on a setup surface. */
export interface SetupSurfaceAction {
  /** Visible label (button text, link text, icon glyph). */
  label: string;
  /**
   * Accessible name if it differs from the visible label — e.g. an icon button
   * whose aria-label is "Remove Coffee Shop line". A terse visible label that
   * carries a distinguishing accessible name does NOT count as a repeated
   * terse label, because assistive tech and the audit both read the aria name.
   */
  accessibleLabel?: string;
}

/** A `<select>` / option group whose length is what matters for exposure. */
export interface SetupSurfaceOptionGroup {
  /** What the control is for, used in the violation message. */
  label: string;
  /** Number of options exposed inline (in the DOM / a11y stream). */
  optionCount: number;
  /**
   * True when the long list is only mounted after an explicit open (a
   * disclosure, a search-then-pick, a dedicated route) so it never sits in the
   * default page/accessibility stream. Collapsed long lists are exempt.
   */
  collapsedUntilOpened?: boolean;
}

/** Generated (auto-seeded) content the owner should be able to see + recover. */
export interface SetupSurfaceRecoveryState {
  /** Distinct generated groups present (e.g. a seeded service line). */
  generatedGroups: number;
  /** Of those, how many expose a recover / undo / remove path. */
  recoverableGroups: number;
}

export interface SetupSurfaceDescriptor {
  /** Route or surface id, only used to label violations. */
  route: string;
  /** All rendered prose on the surface, concatenated. */
  text: string;
  /** Every interactive control the surface renders by default. */
  actions: SetupSurfaceAction[];
  /** Option groups (selects, long pick lists). */
  optionGroups?: SetupSurfaceOptionGroup[];
  /** Generated-content recovery posture, when the surface owns generated content. */
  recovery?: SetupSurfaceRecoveryState;
}

// ── Ceilings ────────────────────────────────────────────────────────────────

export const SETUP_UX_CEILINGS = {
  /** Max words of prose before a setup surface reads as a wall of text. */
  maxWords: 350,
  /** Max interactive controls competing for a non-technical owner's attention. */
  maxActions: 14,
  /**
   * Max options a single control may expose inline. Above this a control must
   * collapse behind an explicit open (search/disclosure/route) instead of
   * dumping every option into the page + accessibility stream.
   */
  maxInlineOptions: 12,
  /**
   * How many times one terse label may repeat (without a distinguishing
   * accessible name) before the row actions are indistinguishable. One pair is
   * tolerated; three identical "Edit" names in the a11y tree is the smell.
   */
  maxRepeatedTerseLabel: 2,
} as const;

/**
 * A label is "terse" when it is too short, or a bare icon glyph / stock verb,
 * to identify WHICH artifact it acts on. These are exactly the labels the audit
 * flagged: Edit / Del / On / Off / Hide / Show / ↑ / ↓ / Remove.
 */
const TERSE_LABELS = new Set(
  [
    "edit",
    "del",
    "delete",
    "on",
    "off",
    "hide",
    "show",
    "remove",
    "add",
    "up",
    "down",
    "↑",
    "↓",
    "×",
    "x",
  ].map((s) => s.toLowerCase()),
);

export function isTerseLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  if (TERSE_LABELS.has(lower)) return true;
  // A single glyph or a 1–2 char control is terse regardless of set membership.
  return trimmed.length <= 2;
}

export type SetupUxViolationCode =
  | "word-ceiling"
  | "action-ceiling"
  | "repeated-terse-label"
  | "long-option-exposure"
  | "generated-content-recovery";

export interface SetupUxViolation {
  code: SetupUxViolationCode;
  message: string;
}

export interface SetupUxReport {
  route: string;
  ok: boolean;
  words: number;
  actionCount: number;
  violations: SetupUxViolation[];
}

/**
 * The accessible name an action presents to the audit + assistive tech: its
 * explicit accessibleLabel when set, otherwise its visible label.
 */
function resolvedName(action: SetupSurfaceAction): string {
  return (action.accessibleLabel ?? action.label).trim();
}

/**
 * Evaluate a setup surface against the ceilings. Pure — returns every
 * violation so a test can assert the full set, and `ok` for a quick gate.
 */
export function analyzeSetupSurface(descriptor: SetupSurfaceDescriptor): SetupUxReport {
  const violations: SetupUxViolation[] = [];

  const words = analyzeReadability(descriptor.text).words;
  if (words > SETUP_UX_CEILINGS.maxWords) {
    violations.push({
      code: "word-ceiling",
      message: `${descriptor.route} renders ~${words} words (ceiling ${SETUP_UX_CEILINGS.maxWords}). Split into task-first steps or move detail behind disclosures.`,
    });
  }

  const actionCount = descriptor.actions.length;
  if (actionCount > SETUP_UX_CEILINGS.maxActions) {
    violations.push({
      code: "action-ceiling",
      message: `${descriptor.route} exposes ${actionCount} actions (ceiling ${SETUP_UX_CEILINGS.maxActions}). Group secondary actions or hide advanced expansion until opened.`,
    });
  }

  // Repeated terse labels — count only labels that are terse AND have no
  // distinguishing accessible name. A terse visible label with a unique aria
  // name (icon button → "Remove Coffee Shop line") is fine.
  const terseCounts = new Map<string, number>();
  for (const action of descriptor.actions) {
    const name = resolvedName(action);
    if (isTerseLabel(name)) {
      const key = name.toLowerCase();
      terseCounts.set(key, (terseCounts.get(key) ?? 0) + 1);
    }
  }
  for (const [label, count] of terseCounts) {
    if (count > SETUP_UX_CEILINGS.maxRepeatedTerseLabel) {
      violations.push({
        code: "repeated-terse-label",
        message: `${descriptor.route} repeats the terse label "${label}" ${count} times with no distinguishing accessible name. Give each row action a name that says which item it acts on.`,
      });
    }
  }

  for (const group of descriptor.optionGroups ?? []) {
    if (group.optionCount > SETUP_UX_CEILINGS.maxInlineOptions && !group.collapsedUntilOpened) {
      violations.push({
        code: "long-option-exposure",
        message: `${descriptor.route} exposes ${group.optionCount} inline options in "${group.label}" (ceiling ${SETUP_UX_CEILINGS.maxInlineOptions}). Collapse it behind an explicit open (search/disclosure) so it stays out of the default page and accessibility stream.`,
      });
    }
  }

  if (descriptor.recovery && descriptor.recovery.generatedGroups > 0) {
    const { generatedGroups, recoverableGroups } = descriptor.recovery;
    if (recoverableGroups < generatedGroups) {
      violations.push({
        code: "generated-content-recovery",
        message: `${descriptor.route} has ${generatedGroups} generated content group(s) but only ${recoverableGroups} expose a recovery path. Every generated section, item, or service line must be recoverable (undo) or explain what is retained.`,
      });
    }
  }

  return {
    route: descriptor.route,
    ok: violations.length === 0,
    words,
    actionCount,
    violations,
  };
}

// ── Runtime-parseable descriptor (for future audit ingestion) ───────────────

export const setupSurfaceActionSchema = z.object({
  label: z.string(),
  accessibleLabel: z.string().optional(),
});

export const setupSurfaceDescriptorSchema = z.object({
  route: z.string(),
  text: z.string(),
  actions: z.array(setupSurfaceActionSchema),
  optionGroups: z
    .array(
      z.object({
        label: z.string(),
        optionCount: z.number().int().nonnegative(),
        collapsedUntilOpened: z.boolean().optional(),
      }),
    )
    .optional(),
  recovery: z
    .object({
      generatedGroups: z.number().int().nonnegative(),
      recoverableGroups: z.number().int().nonnegative(),
    })
    .optional(),
});

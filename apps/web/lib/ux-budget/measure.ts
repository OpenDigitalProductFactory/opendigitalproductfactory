// apps/web/lib/ux-budget/measure.ts
//
// L2 budget metrics — EP-UX-SYSTEM spec §6 L2 (BI-B9BE9A29).
//
// Extends the owner-first audit signals (lib/owner-first/ux-audit.ts, BI-3BCAF95F)
// from "one summary band" to "a whole surface, scoped to what is visible on
// arrival". The primitives it already got right — visible text extraction, word and
// control counting, sub-legible control detection, the next-action marker — are
// REUSED here rather than reimplemented, so there is one definition of "a word" on
// this platform.
//
// Every function is pure and DOM-free so the same module runs in a unit test, in the
// CI route sweep (BI-BD81682A), and as the source of the numbers quoted to agents in
// prompts (L3). Readability uses the PURE analyzer from @dpf/validators, NOT
// lib/readability/policy.ts — that module reads PlatformConfig through Prisma, and a
// CI checker must never need a database. The policy vocabulary (ReadingLevel, the
// grade caps) is shared; only the DB-backed override resolution stays at runtime.

import { analyzeUiReadability, withinReadingLevel, type ReadingLevel } from "@dpf/validators";
import {
  countSmallControls,
  countWords,
  visibleUtterances,
  OWNER_FIRST_NEXT_ACTION_ATTR,
} from "../owner-first/ux-audit";
import {
  countDisclosureRegions,
  defaultVisibleHtml,
  leadBandHtml,
  routeContentHtml,
} from "./scope";

/** Marks the one control a surface most wants the owner to press. */
export const PRIMARY_ACTION_ATTR = "data-dpf-primary-action";

const FIELD_RE = /<(input|select|textarea)\b([^>]*)>/gi;
const NON_FIELD_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

/** Form fields the owner must actually fill in (excludes hidden/submit inputs). */
export function countVisibleFields(html: string): number {
  let count = 0;
  FIELD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_RE.exec(html)) !== null) {
    if (m[1].toLowerCase() !== "input") {
      count += 1;
      continue;
    }
    const type = /\btype\s*=\s*["']?([a-zA-Z-]+)/.exec(m[2])?.[1]?.toLowerCase() ?? "text";
    if (!NON_FIELD_INPUT_TYPES.has(type)) count += 1;
  }
  return count;
}

/** Controls the surface presents as the owner's next move. */
export function countPrimaryActions(html: string): number {
  const marked = html.match(new RegExp(PRIMARY_ACTION_ATTR, "g"))?.length ?? 0;
  if (marked > 0) return marked;
  // Un-migrated surfaces carry no marker; a submit button is the honest proxy.
  return (html.match(/<button\b[^>]*type\s*=\s*["']?submit/gi) ?? []).length;
}

/**
 * The largest number of options any single control offers. Hick's law: a 40-option
 * select is a decision the surface pushed onto the owner instead of resolving.
 */
export function maxChoicesPerControl(html: string): number {
  const selects = html.match(/<select\b[\s\S]*?<\/select>/gi) ?? [];
  let max = 0;
  for (const select of selects) {
    max = Math.max(max, (select.match(/<option\b/gi) ?? []).length);
  }
  return max;
}

export type UxBudgetMetrics = {
  /** Words visible on arrival — collapsed disclosure already excised. */
  defaultVisibleWords: number;
  /** Words in the lead band; 0 when the surface has no marked lead. */
  leadBandWords: number;
  hasLeadBand: boolean;
  primaryActions: number;
  visibleFields: number;
  maxChoicesPerControl: number;
  /** Controls rendered below a legible/tappable size. */
  subLegibleControls: number;
  disclosureRegions: number;
  hasNextActionMarker: boolean;
  /**
   * 1 when the surface HAS a marked primary action somewhere in the DOM but it is
   * NOT in the default-visible scope — i.e. the primary action is buried behind a
   * collapsed disclosure. 0 otherwise (visible, or no marked primary action at all).
   *
   * This is the axis that catches "the trigger button is hard to find": moving a
   * primary action behind Advanced REDUCES word/control counts, so the volume
   * budgets read it as an improvement. This does not — a buried verb is a
   * regression whatever the word count says. Numeric (not boolean) so the ratchet
   * catches a 0→1 transition on a pre-existing route.
   */
  buriedPrimaryAction: number;
/**
   * Flesch–Kincaid grade of the route's own default-visible copy, measured one
   * UI utterance at a time (BI-0ED0F6B3). Scored over `<main>` where the shell
   * marks one, so the number describes this page rather than the shared chrome.
   */
  readingGradeLevel: number;
};

/** Attributes that mark the one action a surface most wants the user to take. */
const PRIMARY_ACTION_MARKERS = [PRIMARY_ACTION_ATTR, OWNER_FIRST_NEXT_ACTION_ATTR];

function hasMarkedPrimaryAction(html: string): boolean {
  return PRIMARY_ACTION_MARKERS.some((m) => html.includes(m));
}

/** Measure a served-DOM HTML string against every budget axis at once. */
export function measureUxBudget(html: string): UxBudgetMetrics {
  const visible = defaultVisibleHtml(html);
  const lead = leadBandHtml(html);
  const utterances = visibleUtterances(routeContentHtml(visible));
  // Compare the FULL DOM against the visible scope: a marker present in one but not
  // the other means the primary action exists yet the owner cannot see it on arrival.
  const buried = hasMarkedPrimaryAction(html) && !hasMarkedPrimaryAction(visible);
  return {
    defaultVisibleWords: countWords(visible),
    leadBandWords: countWords(lead),
    hasLeadBand: lead.trim().length > 0,
    primaryActions: countPrimaryActions(visible),
    visibleFields: countVisibleFields(visible),
    maxChoicesPerControl: maxChoicesPerControl(visible),
    subLegibleControls: countSmallControls(visible),
    disclosureRegions: countDisclosureRegions(html),
    hasNextActionMarker: visible.includes(OWNER_FIRST_NEXT_ACTION_ATTR),
    buriedPrimaryAction: buried ? 1 : 0,
    // An empty surface has no prose to grade; report 0 rather than a fabricated score.
    readingGradeLevel:
      utterances.length === 0 ? 0 : analyzeUiReadability(utterances).gradeLevel,
  };
}

/** Does this surface's prose sit within the shell's reading tier? */
export function meetsReadingLevel(metrics: UxBudgetMetrics, level: ReadingLevel): boolean {
  return withinReadingLevel(metrics.readingGradeLevel, level);
}

// apps/web/lib/workforce/oversight-copy.ts
//
// Canonical user-facing copy for the oversight tier an AI coworker runs under
// (BI-F2EC4699).
//
// The stored column is `hitlTierDefault` / `hitlTier` (0..3) and the internal
// term stays "HITL" — it is the accurate technical name for the mechanism, and
// "human" remains the correct principal-kind opposite of "agent" in the
// identity domain. What changes here is what a NON-TECHNICAL reader sees: the
// portal no longer renders "HITL T2", "HITL-0", or "human-only". It names the
// role that actually does the work — an employee — in plain language.
//
// This mirrors the pattern set by BI-08393602 / PR #3527 for "Agent" vs
// "AI coworker": keep the technical term in the technical domain, standardize
// the user-facing workforce term.
//
// Before this module the tier labels and colours were re-declared inline in six
// components, and they had DRIFTED — tier 1 resolved to three different tokens
// across files (a raw orange hex, `var(--dpf-warning)`, and `var(--dpf-accent)`)
// and tier 2 to two (`var(--dpf-info)` and a raw blue hex). Two of those maps
// used raw hex, which AGENTS.md §12 prohibits. Colour now resolves through the
// report-kit `employeeOversight` intent registry, so there is one source of
// truth for both the words and the colour.

import { resolveIntent, intentStyle, type Intent } from "@/components/ui/report-kit/statusColors";

/**
 * The stored oversight tier. 0 = the coworker never acts; 3 = it acts alone.
 * Persisted as `Agent.hitlTierDefault` / `CoworkerService.hitlTier`.
 */
export type OversightTier = 0 | 1 | 2 | 3;

/** Stable slug per tier — the key used in the report-kit intent registry. */
export type OversightSlug = "employee-only" | "needs-approval" | "employee-review" | "on-its-own";

export interface OversightCopy {
  tier: OversightTier;
  slug: OversightSlug;
  /** Full label for cards, detail rows, and selects. */
  label: string;
  /** Compact label for chips and badges. */
  shortLabel: string;
  /**
   * Single-word token for DENSE surfaces — matrix cells and per-row badges on
   * pages that render hundreds of rows (`/platform/audit/authority` alone shows
   * ~15,500 words). Those cells previously showed a bare tier number, which is
   * meaningless to a reader; a one-word token carries the meaning at the same
   * word cost, with `description` supplied as the tooltip. Keeping this separate
   * from `shortLabel` is what lets the plain language land without regressing
   * the UX route word budget.
   */
  cellLabel: string;
  /** One sentence a non-technical owner can act on. */
  description: string;
  /** Semantic intent — resolves to a --dpf-* token via report-kit. */
  intent: Intent;
  /** Screen-reader label, so a badge is not read as a bare word. */
  ariaLabel: string;
}

const TIER_SLUG: Record<OversightTier, OversightSlug> = {
  0: "employee-only",
  1: "needs-approval",
  2: "employee-review",
  3: "on-its-own",
};

export const OVERSIGHT_COPY: Record<OversightSlug, OversightCopy> = {
  "employee-only": {
    tier: 0,
    slug: "employee-only",
    label: "Employee only",
    shortLabel: "Employee only",
    cellLabel: "Manual",
    description: "An employee does this work. Your AI coworker never acts on it.",
    intent: resolveIntent("employeeOversight", "employee-only"),
    ariaLabel: "Employee only, your AI coworker never acts on this",
  },
  "needs-approval": {
    tier: 1,
    slug: "needs-approval",
    label: "Needs approval",
    shortLabel: "Needs approval",
    cellLabel: "Approve",
    description: "Your AI coworker prepares the work, then waits for an employee to approve it.",
    intent: resolveIntent("employeeOversight", "needs-approval"),
    ariaLabel: "Needs approval from an employee before it goes ahead",
  },
  "employee-review": {
    tier: 2,
    slug: "employee-review",
    label: "Employee review",
    shortLabel: "Reviewed",
    cellLabel: "Review",
    description: "Your AI coworker does the work, and an employee reviews it afterwards.",
    intent: resolveIntent("employeeOversight", "employee-review"),
    ariaLabel: "Reviewed by an employee after the work is done",
  },
  "on-its-own": {
    tier: 3,
    slug: "on-its-own",
    label: "Runs on its own",
    shortLabel: "On its own",
    cellLabel: "Auto",
    description: "Your AI coworker handles this without asking.",
    intent: resolveIntent("employeeOversight", "on-its-own"),
    ariaLabel: "Runs on its own, no employee step needed",
  },
};

/** True when `tier` is a tier the platform defines copy for. */
export function isOversightTier(tier: number | null | undefined): tier is OversightTier {
  return tier === 0 || tier === 1 || tier === 2 || tier === 3;
}

/**
 * Resolve the stored tier to user-facing copy. An out-of-range or missing tier
 * returns null so callers render their own "not set" state rather than
 * inventing a label — the platform never fabricates a governance posture.
 */
export function getOversightCopy(tier: number | null | undefined): OversightCopy | null {
  if (!isOversightTier(tier)) return null;
  return OVERSIGHT_COPY[TIER_SLUG[tier]];
}

/**
 * Token-backed colour for a tier, for surfaces that colour a cell or dot
 * directly. Falls back to the muted token for an unmapped tier.
 */
export function oversightColour(tier: number | null | undefined): string {
  const copy = getOversightCopy(tier);
  return copy ? intentStyle(copy.intent).fg : "var(--dpf-muted)";
}

/** Full token-backed style (fg/border/softBg) for a tier. */
export function oversightStyle(tier: number | null | undefined) {
  const copy = getOversightCopy(tier);
  return intentStyle(copy?.intent ?? "neutral");
}

/**
 * Label for a tier, with an explicit fallback for an unmapped value. Use
 * `short` for chips and dense table cells.
 */
export function oversightLabel(
  tier: number | null | undefined,
  options?: { short?: boolean; dense?: boolean; fallback?: string },
): string {
  const copy = getOversightCopy(tier);
  if (!copy) return options?.fallback ?? "Not set";
  if (options?.dense) return copy.cellLabel;
  return options?.short ? copy.shortLabel : copy.label;
}

/** Every tier in ascending order — for selects and legends. */
export const OVERSIGHT_TIERS_ASC: OversightCopy[] = [0, 1, 2, 3].map(
  (t) => OVERSIGHT_COPY[TIER_SLUG[t as OversightTier]],
);

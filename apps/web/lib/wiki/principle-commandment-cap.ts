// Phase 1 Task 1.6 of the principles-as-wiki-kind plan: cross-page
// detector that enforces the commandment cap. Spec section 5.1 caps
// published kernel commandments at 10 — the inflation guard for the
// top tier. If every rule is a commandment, nothing is.
//
// Cross-page detector: unlike per-page detectors this needs the full
// principle page list to count. Wired into runDetectors as a separate
// invocation so the orchestrator's contract stays clean.
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §5.1, §14
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 1 Task 1.6)

import { PRINCIPLE_TIER_CAPS } from "@dpf/db/wiki-taxonomy";
import type { LintFinding } from "./lint-detectors";
import type { LintPrincipleWikiPage } from "./principle-lint-detectors";

const COMMANDMENT_CAP = PRINCIPLE_TIER_CAPS.commandment ?? 10;

/**
 * Order commandments newest-first by lastReviewedAt. Pages with no review
 * timestamp fall back to descending id order — deterministic so re-runs
 * don't oscillate which commandment is flagged.
 */
function orderNewestFirst(
  pages: LintPrincipleWikiPage[],
): LintPrincipleWikiPage[] {
  return [...pages].sort((a, b) => {
    const aTime = a.lastReviewedAt?.getTime() ?? null;
    const bTime = b.lastReviewedAt?.getTime() ?? null;
    if (aTime !== null && bTime !== null) {
      return bTime - aTime;
    }
    if (aTime !== null) return -1;
    if (bTime !== null) return 1;
    // both null — fall back to id desc (lexicographically largest first)
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/**
 * Emit one error finding per published kernel commandment that exceeds
 * the cap. Each finding is attached to a specific page so the lint UI
 * can show the author exactly which rows need re-tiering.
 *
 * Severity: error. Blocks publish (the cap is a hard cap; over the
 * cap, every excess commandment must be reassigned to core via the
 * regular PR review path).
 *
 * Scope: kernel rows only (organizationId === null AND isKernel).
 * Org-overlay principles can layer additional commandments — those
 * are governed by the org's own discipline, not the kernel cap.
 */
export function detectPrincipleCommandmentCapExceeded(input: {
  pages: LintPrincipleWikiPage[];
}): LintFinding[] {
  const commandments = input.pages.filter(
    (p) =>
      p.pageKind === "principle" &&
      p.principleTier === "commandment" &&
      p.status === "published" &&
      p.isKernel &&
      p.organizationId === null,
  );
  if (commandments.length <= COMMANDMENT_CAP) {
    return [];
  }

  const ordered = orderNewestFirst(commandments);
  const overflow = ordered.slice(0, commandments.length - COMMANDMENT_CAP);

  return overflow.map((page) => ({
    organizationId: page.organizationId,
    pageId: page.id,
    findingKind: "principle-commandment-cap-exceeded",
    severity: "error",
    detail: {
      slug: page.slug,
      blocksPublish: true,
      cap: COMMANDMENT_CAP,
      currentCount: commandments.length,
      message:
        "Published kernel commandments exceed the cap. The cap is the " +
        "inflation guard for the top tier — if every rule is a commandment, " +
        "nothing is. Reassign this principle to core or contextual via PR " +
        "review, or downgrade an older commandment.",
    },
  }));
}

// EP-WIKI-001 Phase 6a: small chip rendering a wiki page kind.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §6
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 6)
//
// Page-kind colour is part of the visual encoding called out in
// EP-WIKI-005 §6 (the future visual-nav spec). Phase 6a uses muted
// theme tokens because the list and viewer are read-only chrome —
// the heavier shape vocabulary lives on the future kernel atlas.

import type { ReactNode } from "react";

export const WIKI_PAGE_KIND_LABELS: Record<string, string> = {
  entity: "Entity",
  summary: "Summary",
  decision: "Decision",
  runbook: "Runbook",
  index: "Index",
  stance: "Stance",
  heuristic: "Heuristic",
  principle: "Principle",
};

/**
 * Pure helper: resolve the human-readable label for a page kind. Falls
 * back to the raw kind string for unknown values so unrecognized kinds
 * still render legibly instead of as a blank badge.
 */
export function getWikiPageKindLabel(pageKind: string): string {
  return WIKI_PAGE_KIND_LABELS[pageKind] ?? pageKind;
}

type Props = {
  pageKind: string;
};

export function WikiPageKindBadge({ pageKind }: Props): ReactNode {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border border-[var(--dpf-border)] text-[var(--dpf-muted)] bg-[var(--dpf-surface-2)]">
      {getWikiPageKindLabel(pageKind)}
    </span>
  );
}

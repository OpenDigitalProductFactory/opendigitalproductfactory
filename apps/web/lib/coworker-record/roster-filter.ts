// apps/web/lib/coworker-record/roster-filter.ts
// EP-AI-WORKFORCE-001 / EP-COWORKER-RT (HRIS surface) — pure roster filter
// predicates, shared by the client RosterView and unit tests. No DB / no React.
//
// Phase 4 (coworker-management-consolidation, WS3/WS5) adds the founder's
// directory-search win: a free-text query over displayName / slug / family and a
// `kind` facet. Both stay here (pure + tested) so RosterView only wires controls.

import type { RosterRow } from "./roster";

export type RosterFilters = {
  /** Free-text query — case-insensitive substring over displayName / slug / family. */
  query: string;
  family: string;
  /** Role-type facet (orchestrator / specialist / advisor / …); "" = all. */
  kind: string;
  valueStream: string;
  competency: string;
  jurisdiction: string;
  lifecycle: string;
  coverageGap: boolean;
};

export const EMPTY_FILTERS: RosterFilters = {
  query: "",
  family: "",
  kind: "",
  valueStream: "",
  competency: "",
  jurisdiction: "",
  lifecycle: "",
  coverageGap: false,
};

/** Coverage gap = unmapped role, empty corpus, or below 80% checklist coverage. */
export function isCoverageGap(row: RosterRow): boolean {
  return row.unmapped || row.emptyCorpus || (row.coveragePct ?? 100) < 80;
}

/**
 * Directory search — case-insensitive substring over the human-facing identity:
 * displayName, slug (slugId), and the profession family label. This is the
 * "hard to find the one I'm looking for" fix (design §5). An empty/whitespace
 * query matches everything.
 */
export function matchesQuery(row: RosterRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [row.displayName, row.slugId ?? "", row.name, row.familyLabel ?? ""]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function matchesFilters(row: RosterRow, f: RosterFilters): boolean {
  if (!matchesQuery(row, f.query)) return false;
  if (f.family && row.familyKey !== f.family) return false;
  if (f.kind && row.kind !== f.kind) return false;
  if (f.valueStream && row.valueStream !== f.valueStream) return false;
  if (f.competency && !row.competencies.includes(f.competency)) return false;
  if (f.jurisdiction && !row.jurisdictions.includes(f.jurisdiction)) return false;
  if (f.lifecycle && row.lifecycleStage !== f.lifecycle) return false;
  if (f.coverageGap && !isCoverageGap(row)) return false;
  return true;
}

/**
 * The distinct `kind` values present across the loaded rows, sorted — the option
 * set for the kind facet is derived from the roster (design item 1) so it never
 * shows an empty option a fresh install can't populate.
 */
export function kindOptions(rows: RosterRow[]): string[] {
  return [...new Set(rows.map((r) => r.kind).filter((k): k is string => !!k))].sort();
}

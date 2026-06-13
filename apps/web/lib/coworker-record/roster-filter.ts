// apps/web/lib/coworker-record/roster-filter.ts
// EP-AI-WORKFORCE-001 (HRIS surface) — pure roster filter predicates, shared by
// the client RosterView and unit tests. No DB / no React.

import type { RosterRow } from "./roster";

export type RosterFilters = {
  family: string;
  valueStream: string;
  competency: string;
  jurisdiction: string;
  lifecycle: string;
  coverageGap: boolean;
};

export const EMPTY_FILTERS: RosterFilters = {
  family: "",
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

export function matchesFilters(row: RosterRow, f: RosterFilters): boolean {
  if (f.family && row.familyKey !== f.family) return false;
  if (f.valueStream && row.valueStream !== f.valueStream) return false;
  if (f.competency && !row.competencies.includes(f.competency)) return false;
  if (f.jurisdiction && !row.jurisdictions.includes(f.jurisdiction)) return false;
  if (f.lifecycle && row.lifecycleStage !== f.lifecycle) return false;
  if (f.coverageGap && !isCoverageGap(row)) return false;
  return true;
}

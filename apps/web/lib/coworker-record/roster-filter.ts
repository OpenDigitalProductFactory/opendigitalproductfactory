// apps/web/lib/coworker-record/roster-filter.ts
// EP-AI-WORKFORCE-001 / EP-COWORKER-RT (HRIS surface) — pure roster filter
// predicates, shared by the client RosterView and unit tests. No DB / no React.
//
// Phase 4 (coworker-management-consolidation, WS3/WS5) adds the founder's
// directory-search win: a free-text query over displayName / slug / family and a
// `kind` facet. Both stay here (pure + tested) so RosterView only wires controls.

import type { RosterRow } from "./roster";
import { AGENT_KINDS } from "@dpf/db/agent-identity";
import { COWORKER_AVAILABILITY_STATES } from "@/lib/coworker-service-catalog/availability-projection";
import { COWORKER_AUTHORITY_LEVELS } from "@/lib/coworker-service-catalog/authority-projection-contract";
import {
  OTHER_OWNER_FACING_AREA,
  OWNER_FACING_AREAS,
} from "./owner-areas";
import {
  COWORKER_INTERACTION_SCOPES,
  type CoworkerInteractionScope,
} from "./roster-presentation";

export type RosterFilters = {
  /** Free-text query over owner-facing identity and work. */
  query: string;
  area: string;
  interaction: string;
  availability: string;
  authority: string;
  attentionOnly: boolean;
  /** Advanced technical facets retained behind progressive disclosure. */
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
  area: "",
  interaction: "",
  availability: "",
  authority: "",
  attentionOnly: false,
  family: "",
  kind: "",
  valueStream: "",
  competency: "",
  jurisdiction: "",
  lifecycle: "",
  coverageGap: false,
};

export type RosterFilterValueSets = {
  families: readonly string[];
  kinds: readonly string[];
  valueStreams: readonly string[];
  competencies: readonly string[];
  jurisdictions: readonly string[];
  lifecycleStages: readonly string[];
};

/** Coverage gap = unmapped role, empty corpus, or below 80% checklist coverage. */
export function isCoverageGap(row: RosterRow): boolean {
  return row.unmapped || row.emptyCorpus || (row.coveragePct ?? 100) < 80;
}

/**
 * Directory search — case-insensitive substring over the human-facing identity:
 * displayName, plain job, area, slug, and profession family label. This is the
 * "hard to find the one I'm looking for" fix (design §5). An empty/whitespace
 * query matches everything.
 */
export function matchesQuery(row: RosterRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    row.displayName,
    row.plainJob,
    row.workSearchText,
    row.area.label,
    row.slugId ?? "",
    row.name,
    row.familyLabel ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function matchesFilters(row: RosterRow, f: RosterFilters): boolean {
  if (!matchesQuery(row, f.query)) return false;
  if (f.area && !row.areas.some((area) => area.key === f.area)) return false;
  if (
    f.interaction &&
    !row.interaction.scopes.includes(
      f.interaction as CoworkerInteractionScope,
    )
  ) {
    return false;
  }
  if (f.availability && row.availability.state !== f.availability) return false;
  if (
    f.authority &&
    (row.authority.state === "resolved"
      ? row.authority.level
      : "review-needed") !== f.authority
  ) {
    return false;
  }
  if (f.attentionOnly && !needsAttention(row)) return false;
  if (f.family && row.familyKey !== f.family) return false;
  if (f.kind && row.kind !== f.kind) return false;
  if (f.valueStream && row.valueStream !== f.valueStream) return false;
  if (f.competency && !row.competencies.includes(f.competency)) return false;
  if (f.jurisdiction && !row.jurisdictions.includes(f.jurisdiction)) return false;
  if (f.lifecycle && row.lifecycleStage !== f.lifecycle) return false;
  if (f.coverageGap && !isCoverageGap(row)) return false;
  return true;
}

export function needsAttention(row: RosterRow): boolean {
  return (
    row.availability.state === "setup-needed" ||
    row.availability.state === "needs-attention" ||
    row.authority.state === "review-needed" ||
    row.openBlockers > 0
  );
}

type SearchParamsReader = Pick<URLSearchParams, "get">;

const FILTER_PARAM_KEYS = {
  query: "q",
  area: "area",
  interaction: "interaction",
  availability: "availability",
  authority: "authority",
  attentionOnly: "attention",
  family: "family",
  kind: "kind",
  valueStream: "valueStream",
  competency: "competency",
  jurisdiction: "jurisdiction",
  lifecycle: "lifecycle",
  coverageGap: "coverageGap",
} as const;

export function filtersFromSearchParams(
  searchParams: SearchParamsReader,
  valueSets: RosterFilterValueSets,
): RosterFilters {
  return {
    query: searchParams.get(FILTER_PARAM_KEYS.query) ?? "",
    area: closedValue(searchParams.get(FILTER_PARAM_KEYS.area), [
      ...OWNER_FACING_AREAS.map((area) => area.key),
      OTHER_OWNER_FACING_AREA.key,
    ]),
    interaction: closedValue(
      searchParams.get(FILTER_PARAM_KEYS.interaction),
      COWORKER_INTERACTION_SCOPES,
    ),
    availability: closedValue(
      searchParams.get(FILTER_PARAM_KEYS.availability),
      COWORKER_AVAILABILITY_STATES,
    ),
    authority: closedValue(searchParams.get(FILTER_PARAM_KEYS.authority), [
      ...COWORKER_AUTHORITY_LEVELS,
      "review-needed",
    ]),
    attentionOnly: searchParams.get(FILTER_PARAM_KEYS.attentionOnly) === "1",
    family: closedValue(
      searchParams.get(FILTER_PARAM_KEYS.family),
      valueSets.families,
    ),
    kind: closedValue(searchParams.get(FILTER_PARAM_KEYS.kind), [
      ...AGENT_KINDS.filter((kind) => valueSets.kinds.includes(kind)),
    ]),
    valueStream: closedValue(
      searchParams.get(FILTER_PARAM_KEYS.valueStream),
      valueSets.valueStreams,
    ),
    competency: closedValue(
      searchParams.get(FILTER_PARAM_KEYS.competency),
      valueSets.competencies,
    ),
    jurisdiction: closedValue(
      searchParams.get(FILTER_PARAM_KEYS.jurisdiction),
      valueSets.jurisdictions,
    ),
    lifecycle: closedValue(
      searchParams.get(FILTER_PARAM_KEYS.lifecycle),
      valueSets.lifecycleStages,
    ),
    coverageGap: searchParams.get(FILTER_PARAM_KEYS.coverageGap) === "1",
  };
}

function closedValue(
  value: string | null,
  allowed: readonly string[],
): string {
  return value && allowed.includes(value) ? value : "";
}

export function filtersToSearchParams(
  filters: RosterFilters,
  current = new URLSearchParams(),
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const [filterKey, paramKey] of Object.entries(FILTER_PARAM_KEYS)) {
    const value = filters[filterKey as keyof RosterFilters];
    if (typeof value === "boolean") {
      if (value) next.set(paramKey, "1");
      else next.delete(paramKey);
    } else if (value) {
      next.set(paramKey, value);
    } else {
      next.delete(paramKey);
    }
  }
  return next;
}

/**
 * The distinct `kind` values present across the loaded rows, sorted — the option
 * set for the kind facet is derived from the roster (design item 1) so it never
 * shows an empty option a fresh install can't populate.
 */
export function kindOptions(rows: RosterRow[]): string[] {
  return [...new Set(rows.map((r) => r.kind).filter((k): k is string => !!k))].sort();
}

export function safeRosterReturnTo(
  value: string | string[] | undefined,
): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate &&
    /^\/platform\/ai\/overview(?:[?#][^\r\n\\]*)?$/.test(candidate)
    ? candidate
    : "/platform/ai/overview";
}

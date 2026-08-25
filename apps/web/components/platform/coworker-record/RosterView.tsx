"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  ChevronRight,
  MessageSquare,
  RotateCcw,
  Search,
  Settings2,
} from "lucide-react";

import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";
import { OwnerFirstDisclosure } from "@/components/owner-first/OwnerFirstDisclosure";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  kindOptions,
  matchesFilters,
  needsAttention,
  EMPTY_FILTERS,
  type RosterFilterValueSets,
  type RosterFilters,
} from "@/lib/coworker-record/roster-filter";
import type {
  RosterFacets,
  RosterRow,
} from "@/lib/coworker-record/roster";
import { availabilityRecoveryTarget } from "@/lib/coworker-record/availability-recovery";
import type { CapabilityKey } from "@/lib/permissions";
import {
  OTHER_OWNER_FACING_AREA,
  OWNER_FACING_AREAS,
} from "@/lib/coworker-record/owner-areas";

const INTERACTION_OPTIONS = [
  { value: "talks-to-customers", label: "Talks to customers" },
  { value: "works-with-partners", label: "Works with partners" },
  { value: "internal-only", label: "Internal only" },
  { value: "not-defined", label: "Not defined" },
];

const AVAILABILITY_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "setup-needed", label: "Setup needed" },
  { value: "needs-attention", label: "Needs attention" },
  { value: "not-available", label: "Not available" },
  { value: "coverage-not-defined", label: "Coverage not defined" },
];

const AUTHORITY_OPTIONS = [
  { value: "cannot-act", label: "Cannot act" },
  { value: "advice-only", label: "Advises only" },
  { value: "proposal-only", label: "Prepares work for approval" },
  { value: "approval-required", label: "Acts with approval" },
  { value: "review-required", label: "Acts with review" },
  { value: "autonomous", label: "Can act within limits" },
  { value: "review-needed", label: "Approval rules need review" },
];

const DIRECTORY_PAGE_SIZE = 12;

export function RosterView({
  rows,
  facets,
  initialQuery = "",
  grantedCapabilities = [],
  presentation = "cards",
}: {
  rows: RosterRow[];
  facets: RosterFacets;
  initialQuery?: string;
  grantedCapabilities?: CapabilityKey[];
  presentation?: "cards" | "directory";
}) {
  const isDirectory = presentation === "directory";
  const kindOpts = useMemo(() => kindOptions(rows), [rows]);
  const grantedCapabilitySet = useMemo(
    () => new Set(grantedCapabilities),
    [grantedCapabilities],
  );
  const filterValueSets = useMemo<RosterFilterValueSets>(
    () => ({
      families: facets.families.map((family) => family.key),
      kinds: kindOpts,
      valueStreams: facets.valueStreams,
      competencies: facets.competencies,
      jurisdictions: facets.jurisdictions,
      lifecycleStages: facets.lifecycleStages,
    }),
    [facets, kindOpts],
  );
  const [filters, setFilters] = useState<RosterFilters>(() =>
    filtersFromSearchParams(
      new URLSearchParams(initialQuery),
      filterValueSets,
    ),
  );
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [visibleDirectoryCount, setVisibleDirectoryCount] = useState(
    DIRECTORY_PAGE_SIZE,
  );
  useEffect(() => {
    const restoreFilters = () =>
      setFilters(
        filtersFromSearchParams(
          new URLSearchParams(window.location.search),
          filterValueSets,
        ),
      );
    window.addEventListener("popstate", restoreFilters);
    return () => window.removeEventListener("popstate", restoreFilters);
  }, [filterValueSets]);
  const filtered = useMemo(
    () => rows.filter((row) => matchesFilters(row, filters)),
    [rows, filters],
  );
  const groups = useMemo(() => {
    const byArea = new Map<string, { row: RosterRow; rows: RosterRow[] }>();
    for (const row of filtered) {
      const existing = byArea.get(row.area.key);
      if (existing) existing.rows.push(row);
      else byArea.set(row.area.key, { row, rows: [row] });
    }
    return [...byArea.values()]
      .sort((left, right) => left.row.area.order - right.row.area.order)
      .map((group) => ({
        area: group.row.area,
        rows: group.rows.sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        ),
      }));
  }, [filtered]);
  const directoryRows = useMemo(
    () =>
      [...filtered]
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
        .slice(0, visibleDirectoryCount),
    [filtered, visibleDirectoryCount],
  );

  const advancedFilterCount = [
    filters.authority,
    filters.family,
    filters.kind,
    filters.valueStream,
    filters.competency,
    filters.jurisdiction,
    filters.lifecycle,
    filters.coverageGap ? "coverage" : "",
  ].filter(Boolean).length;
  const secondaryFilterCount =
    advancedFilterCount +
    [filters.interaction, filters.availability, filters.attentionOnly]
      .filter(Boolean).length;

  function replaceFilters(next: RosterFilters) {
    setFilters(next);
    setVisibleDirectoryCount(DIRECTORY_PAGE_SIZE);
    if (typeof window === "undefined") return;
    const params = filtersToSearchParams(
      next,
      new URLSearchParams(window.location.search),
    );
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }

  function set(patch: Partial<RosterFilters>) {
    replaceFilters({ ...filters, ...patch });
  }

  const currentQuery = filtersToSearchParams(
    filters,
    new URLSearchParams(initialQuery),
  ).toString();
  const returnHref = `/platform/ai/overview${currentQuery ? `?${currentQuery}` : ""}`;

  return (
    <div>
      <div className="mb-5 border-y border-[var(--dpf-border)] py-4">
        <div
          className={
            isDirectory
              ? "grid gap-3 md:grid-cols-[minmax(260px,1fr)_minmax(180px,0.35fr)]"
              : "grid gap-3 lg:grid-cols-[minmax(260px,1fr)_repeat(3,minmax(150px,0.45fr))]"
          }
        >
          <label className="relative block">
            <span className="mb-1 block text-xs font-medium text-[var(--dpf-text-secondary)]">
              Find a coworker
            </span>
            <Search
              aria-hidden
              className="absolute bottom-2.5 left-3 h-4 w-4 text-[var(--dpf-muted)]"
            />
            <input
              type="search"
              value={filters.query}
              onChange={(event) => set({ query: event.target.value })}
              placeholder="Search"
              className="h-11 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] pl-9 pr-3 text-sm text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
            />
          </label>
          <Select
            label="Business area"
            value={filters.area}
            onChange={(value) => set({ area: value })}
            options={[...OWNER_FACING_AREAS, OTHER_OWNER_FACING_AREA].map((area) => ({
              value: area.key,
              label: area.label,
            }))}
          />
          {!isDirectory && <button
            type="button"
            aria-controls="coworker-core-filters coworker-secondary-filters"
            aria-expanded={mobileFiltersOpen}
            onClick={() => setMobileFiltersOpen((open) => !open)}
            className="inline-flex min-h-11 items-center justify-between gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 text-sm font-medium text-[var(--dpf-text)] lg:hidden"
          >
            <span>
              Filters
              {secondaryFilterCount > 0 ? ` (${secondaryFilterCount})` : ""}
            </span>
            {mobileFiltersOpen ? (
              <ChevronUp aria-hidden className="h-4 w-4" />
            ) : (
              <ChevronDown aria-hidden className="h-4 w-4" />
            )}
          </button>}
          {!isDirectory && <div
            id="coworker-core-filters"
            className={
              mobileFiltersOpen
                ? "grid gap-3 sm:grid-cols-2 lg:contents"
                : "hidden lg:contents"
            }
          >
            <Select
              label="Interaction"
              value={filters.interaction}
              onChange={(value) => set({ interaction: value })}
              options={INTERACTION_OPTIONS}
            />
            <Select
              label="Availability"
              value={filters.availability}
              onChange={(value) => set({ availability: value })}
              options={AVAILABILITY_OPTIONS}
            />
          </div>}
        </div>

        {isDirectory ? (
          <OwnerFirstDisclosure
            summary={`More filters${secondaryFilterCount > 0 ? ` (${secondaryFilterCount})` : ""}`}
            hint="Availability, work, and role"
          >
            <div className="grid gap-3 pb-2 sm:grid-cols-2 xl:grid-cols-4">
              <Select
                label="Interaction"
                value={filters.interaction}
                onChange={(value) => set({ interaction: value })}
                options={INTERACTION_OPTIONS}
              />
              <Select
                label="Availability"
                value={filters.availability}
                onChange={(value) => set({ availability: value })}
                options={AVAILABILITY_OPTIONS}
              />
              <AdvancedFilterFields
                filters={filters}
                set={set}
                facets={facets}
                kindOpts={kindOpts}
              />
              <label className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--dpf-text-secondary)]">
                <input
                  type="checkbox"
                  checked={filters.attentionOnly}
                  onChange={(event) =>
                    set({ attentionOnly: event.target.checked })
                  }
                  className="h-4 w-4"
                />
                Needs attention
              </label>
              <button
                type="button"
                onClick={() => replaceFilters(EMPTY_FILTERS)}
                className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)] hover:text-[var(--dpf-text)]"
              >
                <RotateCcw aria-hidden className="h-4 w-4" />
                Reset
              </button>
            </div>
          </OwnerFirstDisclosure>
        ) : <div
          id="coworker-secondary-filters"
          className={mobileFiltersOpen ? "mt-3" : "hidden lg:block"}
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--dpf-text-secondary)]">
              <input
                type="checkbox"
                checked={filters.attentionOnly}
                onChange={(event) =>
                  set({ attentionOnly: event.target.checked })
                }
                className="h-4 w-4"
              />
              Needs attention
            </label>
            <button
              type="button"
              onClick={() => replaceFilters(EMPTY_FILTERS)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)] hover:text-[var(--dpf-text)]"
              title="Reset filters"
            >
              <RotateCcw aria-hidden className="h-4 w-4" />
              Reset
            </button>
          </div>

          <OwnerFirstDisclosure
            summary={`More filters${advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ""}`}
            hint="Role and knowledge"
          >
            <div className="grid gap-3 pb-2 sm:grid-cols-2 xl:grid-cols-4">
              <AdvancedFilterFields
                filters={filters}
                set={set}
                facets={facets}
                kindOpts={kindOpts}
              />
            </div>
          </OwnerFirstDisclosure>
        </div>}
      </div>

      <p
        className="mb-5 text-sm text-[var(--dpf-muted)]"
        aria-live="polite"
        aria-atomic="true"
      >
        {filtered.length} coworker{filtered.length === 1 ? "" : "s"}
      </p>

      {isDirectory ? (
        <>
          <ul
            aria-label="Coworker directory results"
            className="divide-y divide-[var(--dpf-border)] border-y border-[var(--dpf-border)]"
          >
            {directoryRows.map((row) => (
              <li key={row.agentId}>
                <Link
                  href={coworkerIdentityHref(row, returnHref)}
                  className="flex min-h-11 items-center justify-between gap-3 px-2 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
                >
                  <span>{row.displayName}</span>
                  <ChevronRight aria-hidden className="h-4 w-4 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
          {visibleDirectoryCount < filtered.length && (
            <button
              type="button"
              onClick={() =>
                setVisibleDirectoryCount((count) => count + DIRECTORY_PAGE_SIZE)
              }
              className="mt-4 inline-flex min-h-11 items-center rounded-md border border-[var(--dpf-border)] px-3 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
            >
              Show {Math.min(DIRECTORY_PAGE_SIZE, filtered.length - visibleDirectoryCount)} more
            </button>
          )}
        </>
      ) : <div className="space-y-8">
        {groups.map(({ area, rows: areaRows }) => (
          <section key={area.key} aria-labelledby={`area-${area.key}`}>
            <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-[var(--dpf-border)] pb-2">
              <h2
                id={`area-${area.key}`}
                className="text-base font-semibold text-[var(--dpf-text)]"
              >
                {area.label}
              </h2>
              <span className="text-xs text-[var(--dpf-muted)]">
                {areaRows.length}
              </span>
            </div>
            <div className="grid gap-3">
              {areaRows.map((row) => (
                <RosterRowCard
                  key={row.agentId}
                  row={row}
                  returnHref={returnHref}
                  grantedCapabilities={grantedCapabilitySet}
                />
              ))}
            </div>
          </section>
        ))}
      </div>}

      {filtered.length === 0 && (
        <div className="border-y border-[var(--dpf-border)] py-8 text-center">
          <p className="text-sm font-medium text-[var(--dpf-text)]">
            No coworkers found.
          </p>
          <button
            type="button"
            onClick={() => replaceFilters(EMPTY_FILTERS)}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
          >
            <RotateCcw aria-hidden className="h-4 w-4" />
            Reset filters
          </button>
        </div>
      )}
    </div>
  );
}

function RosterRowCard({
  row,
  returnHref,
  grantedCapabilities,
}: {
  row: RosterRow;
  returnHref: string;
  grantedCapabilities: ReadonlySet<CapabilityKey>;
}) {
  // EP-COWORKER-IDENTITY-360: the roster is the directory; a row opens the
  // coworker's IDENTITY (peer to People/Customers), which deep-links to the admin
  // record via "Manage". Setup/recovery still targets the admin record, where the
  // configuration affordances live.
  const identityRoute = `/workforce/${encodeURIComponent(row.agentId)}`;
  const adminRoute = `/platform/ai/agent/${encodeURIComponent(row.agentId)}`;
  const identityHref = coworkerIdentityHref(row, returnHref);
  const adminHref = `${adminRoute}?returnTo=${encodeURIComponent(returnHref)}`;
  const canStartConversation = row.canStartConversation;
  const attention = needsAttention(row);
  const availabilityOwnsAttention =
    row.availability.state === "setup-needed" ||
    row.availability.state === "needs-attention";
  const recovery = availabilityRecoveryTarget(
    row.availability,
    adminHref,
    grantedCapabilities,
  );

  return (
    <article
      className="grid min-w-0 gap-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      data-coworker-card={row.agentId}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
            {row.displayName}
          </h3>
          {attention && !availabilityOwnsAttention && (
            <StatusBadge
              intent="warning"
              label="Needs attention"
              uppercase={false}
            />
          )}
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-[var(--dpf-text-secondary)]">
          {row.plainJob}
        </p>
        <div
          className="mt-3 flex min-w-0 flex-wrap gap-2"
          role="group"
          aria-label="Work includes"
        >
          {row.interaction.scopes.map((scope, index) => (
            <StatusBadge
              key={scope}
              intent={interactionIntent(scope)}
              label={row.interaction.labels[index]}
              uppercase={false}
            />
          ))}
          <StatusBadge
            intent={availabilityIntent(row.availability.state)}
            label={row.availability.label}
            uppercase={false}
          />
          <StatusBadge
            intent={row.authority.state === "resolved" ? "neutral" : "warning"}
            label={row.authority.label}
            uppercase={false}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
        {canStartConversation && (
          <AskCoworkerButton
            routeContext={identityRoute}
            label={`Ask ${row.displayName}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--dpf-accent)] px-3 text-sm font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] hover:opacity-90"
          >
            <MessageSquare aria-hidden className="h-4 w-4" />
            <span>{`Ask ${row.displayName}`}</span>
          </AskCoworkerButton>
        )}
        {!canStartConversation && recovery && (
          <Link
            href={recovery.href}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
          >
            <Settings2 aria-hidden className="h-4 w-4" />
            {recovery.label}
          </Link>
        )}
        <Link
          href={identityHref}
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
        >
          View coworker
          <ChevronRight aria-hidden className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}

function coworkerIdentityHref(row: RosterRow, returnHref: string): string {
  return `/workforce/${encodeURIComponent(row.agentId)}?returnTo=${encodeURIComponent(returnHref)}`;
}

function AdvancedFilterFields({
  filters,
  set,
  facets,
  kindOpts,
}: {
  filters: RosterFilters;
  set: (patch: Partial<RosterFilters>) => void;
  facets: RosterFacets;
  kindOpts: string[];
}) {
  return (
    <>
      <Select
        label="Approval and autonomy"
        value={filters.authority}
        onChange={(value) => set({ authority: value })}
        options={AUTHORITY_OPTIONS}
      />
      <Select
        label="Profession"
        value={filters.family}
        onChange={(value) => set({ family: value })}
        options={facets.families.map((family) => ({
          value: family.key,
          label: family.label,
        }))}
      />
      <Select
        label="Role type"
        value={filters.kind}
        onChange={(value) => set({ kind: value })}
        options={kindOpts.map((kind) => ({
          value: kind,
          label: titleCase(kind),
        }))}
      />
      <Select
        label="Lifecycle"
        value={filters.lifecycle}
        onChange={(value) => set({ lifecycle: value })}
        options={facets.lifecycleStages.map((value) => ({
          value,
          label: titleCase(value),
        }))}
      />
      <Select
        label="Value stream"
        value={filters.valueStream}
        onChange={(value) => set({ valueStream: value })}
        options={facets.valueStreams.map((value) => ({
          value,
          label: titleCase(value),
        }))}
      />
      <Select
        label="Competency"
        value={filters.competency}
        onChange={(value) => set({ competency: value })}
        options={facets.competencies.map((value) => ({
          value,
          label: titleCase(value),
        }))}
      />
      <Select
        label="Jurisdiction"
        value={filters.jurisdiction}
        onChange={(value) => set({ jurisdiction: value })}
        options={facets.jurisdictions.map((value) => ({ value, label: value }))}
      />
      <label className="inline-flex min-h-11 items-end gap-2 pb-2 text-sm text-[var(--dpf-text-secondary)]">
        <input
          type="checkbox"
          checked={filters.coverageGap}
          onChange={(event) => set({ coverageGap: event.target.checked })}
          className="mb-0.5 h-4 w-4"
        />
        Knowledge coverage gaps
      </label>
    </>
  );
}

function interactionIntent(
  scope: RosterRow["interaction"]["scopes"][number],
): "neutral" | "success" {
  if (scope === "talks-to-customers" || scope === "works-with-partners") {
    return "success";
  }
  return "neutral";
}

function availabilityIntent(
  state: RosterRow["availability"]["state"],
): "success" | "warning" | "neutral" {
  if (state === "available") return "success";
  if (state === "setup-needed" || state === "needs-attention") {
    return "warning";
  }
  return "neutral";
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-[var(--dpf-text-secondary)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full min-w-0 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 text-sm text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

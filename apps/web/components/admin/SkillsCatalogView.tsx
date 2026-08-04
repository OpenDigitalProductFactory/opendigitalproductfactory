"use client";

import { useState, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types matching the server query shape
// ---------------------------------------------------------------------------

interface SkillRow {
  id: string;
  skillId: string;
  name: string;
  description: string;
  version: string;
  sourceType: string;
  sourceRegistry: string | null;
  category: string;
  tags: string[];
  author: string | null;
  license: string | null;
  riskBand: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count: { assignments: number };
}

interface CatalogStats {
  total: number;
  byStatus: Array<{ status: string; _count: number }>;
  bySource: Array<{ sourceType: string; _count: number }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLOURS: Record<string, string> = {
  discovered: "var(--dpf-muted)",
  evaluated: "var(--dpf-info)",
  approved: "var(--dpf-accent)",
  installed: "var(--dpf-warning)",
  active: "var(--dpf-success)",
  deprecated: "var(--dpf-error)",
};

const RISK_COLOURS: Record<string, string> = {
  low: "var(--dpf-success)",
  medium: "var(--dpf-warning)",
  // "high" sits between warning and critical; lacking a dedicated token, map to
  // the warning token to stay within AGENTS.md §12 theme-token discipline.
  // If the design system later adds a --dpf-warning-strong, swap here.
  high: "var(--dpf-warning)",
  critical: "var(--dpf-error)",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillsCatalogView({
  skills,
  stats,
}: {
  skills: SkillRow[];
  stats: CatalogStats;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  // Derive unique values for filter dropdowns
  const statuses = useMemo(
    () => [...new Set(skills.map((s) => s.status))].sort(),
    [skills]
  );
  const sources = useMemo(
    () => [...new Set(skills.map((s) => s.sourceType))].sort(),
    [skills]
  );

  // Client-side filter (server already returned all; for small catalogs this is fine)
  const filtered = useMemo(() => {
    let list = skills;
    if (statusFilter) list = list.filter((s) => s.status === statusFilter);
    if (sourceFilter) list = list.filter((s) => s.sourceType === sourceFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)) ||
          s.category.toLowerCase().includes(q)
      );
    }
    return list;
  }, [skills, search, statusFilter, sourceFilter]);

  // When any filter is active the reader has already narrowed the set, so the
  // groups open — collapsing a 3-result search behind category headers would be
  // disclosure working against the reader instead of for them.
  const isFiltering = Boolean(search || statusFilter || sourceFilter);

  /**
   * Grouped by category, because 92 flat rows is still a wall.
   *
   * Measured: the flat list rendered 562 default-visible words against this
   * shell's 450-word budget — better than the 5,349 it replaced, but still over.
   * Grouping defers the rows behind ~8 category headers, so arrival costs a few
   * dozen words and every skill is two clicks away at worst. Nothing is dropped;
   * a capped or paged list would trade this defect for a worse one (BI-836923AD).
   */
  const grouped = useMemo(() => {
    const byCategory = new Map<string, SkillRow[]>();
    for (const skill of filtered) {
      const bucket = byCategory.get(skill.category);
      if (bucket) bucket.push(skill);
      else byCategory.set(skill.category, [skill]);
    }
    return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  return (
    <div>
      {/* Stats bar */}
      <div className="flex flex-wrap gap-3 mb-5">
        {stats.byStatus.map((s) => (
          <div
            key={s.status}
            className="px-3 py-1.5 rounded-md text-xs font-medium"
            style={{
              background: `color-mix(in srgb, ${STATUS_COLOURS[s.status] ?? "var(--dpf-muted)"} 10%, transparent)`,
              color: STATUS_COLOURS[s.status] ?? "var(--dpf-muted)",
            }}
          >
            {s.status}: {s._count}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          placeholder="Search skills..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 rounded-md text-xs bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] border border-[var(--dpf-border)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)] w-56"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-md text-xs bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] border border-[var(--dpf-border)]"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="px-3 py-1.5 rounded-md text-xs bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] border border-[var(--dpf-border)]"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-xs text-[var(--dpf-muted)] self-center">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Skills grid */}
      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">
          {skills.length === 0
            ? "No skills in the catalog yet. Skills are added by placing .skill.md files in the skills/ directory and running the seed. Built-in coworker actions still work from route configuration."
            : "No skills match the current filters."}
        </p>
      ) : (
        // One row per skill, detail deferred (BI-36CE8BAB).
        //
        // This used to be a 3-column card grid rendering every skill's FULL
        // description. `line-clamp-2` hid the overflow visually but left every
        // word in the DOM, which is how one catalog of 92 skills put 5,349
        // words on arrival — 12x this route's budget and the 2nd-worst surface
        // in the portal. Clamping is a paint-time trick; it is not disclosure.
        //
        // Each row is now a closed <details>: the summary carries what you scan
        // by (name, status, category), and description, provenance and tags
        // live one click away. The sweep excises closed disclosures, so the
        // route is measured on what a reader actually meets.
        <div className="space-y-2">
          {grouped.map(([category, rows]) => (
            <details
              key={category}
              open={isFiltering}
              className="group/cat rounded border border-[var(--dpf-border)]"
            >
              <summary className="dpf-tap-target flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-[var(--dpf-text)] marker:hidden hover:bg-[var(--dpf-surface-2)] [&::-webkit-details-marker]:hidden">
                <span
                  aria-hidden
                  className="text-[var(--dpf-muted)] transition-transform group-open/cat:rotate-90"
                >
                  ▸
                </span>
                <span className="flex-1">{category}</span>
                <span className="text-xs text-[var(--dpf-muted)]">{rows.length}</span>
              </summary>

              <ul className="divide-y divide-[var(--dpf-border)] border-t border-[var(--dpf-border)]">
                {rows.map((skill) => (
            <li key={skill.id}>
              <details className="group">
                <summary
                  className="dpf-tap-target flex cursor-pointer list-none items-center gap-3 px-3 py-2 marker:hidden hover:bg-[var(--dpf-surface-2)] [&::-webkit-details-marker]:hidden"
                  style={{ borderLeft: `3px solid ${STATUS_COLOURS[skill.status] ?? "var(--dpf-muted)"}` }}
                >
                  <span
                    aria-hidden
                    className="text-[var(--dpf-muted)] transition-transform group-open:rotate-90"
                  >
                    ▸
                  </span>
                  <span className="flex-1 truncate text-sm text-[var(--dpf-text)]">{skill.name}</span>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
                    style={{
                      background: `color-mix(in srgb, ${STATUS_COLOURS[skill.status] ?? "var(--dpf-muted)"} 13%, transparent)`,
                      color: STATUS_COLOURS[skill.status] ?? "var(--dpf-muted)",
                    }}
                  >
                    {skill.status}
                  </span>
                </summary>

                <div className="border-t border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-3">
                  <p className="mb-2 text-xs text-[var(--dpf-muted)]">{skill.description}</p>

                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <span className="font-mono text-[var(--dpf-muted)]">v{skill.version}</span>
                    <span
                      className="rounded px-1 py-0.5"
                      style={{
                        background: `color-mix(in srgb, ${RISK_COLOURS[skill.riskBand] ?? "var(--dpf-muted)"} 10%, transparent)`,
                        color: RISK_COLOURS[skill.riskBand] ?? "var(--dpf-muted)",
                      }}
                    >
                      {skill.riskBand} risk
                    </span>
                    <span className="text-[var(--dpf-muted)]">
                      {skill.sourceType}
                      {skill.sourceRegistry ? ` / ${skill.sourceRegistry}` : ""}
                    </span>
                    <span className="text-[var(--dpf-muted)]">
                      {skill._count.assignments} agent{skill._count.assignments !== 1 ? "s" : ""} assigned
                    </span>
                    {skill.author ? (
                      <span className="text-[var(--dpf-muted)]">by {skill.author}</span>
                    ) : null}
                  </div>

                  {skill.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {skill.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--dpf-muted)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

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
  discovered: "#8888a0",
  evaluated: "#60a5fa",
  approved: "#a78bfa",
  installed: "#fbbf24",
  active: "#4ade80",
  deprecated: "#f87171",
};

const RISK_COLOURS: Record<string, string> = {
  low: "#4ade80",
  medium: "#fbbf24",
  high: "#fb923c",
  critical: "#f87171",
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

  return (
    <div>
      {/* Stats bar */}
      <div className="flex flex-wrap gap-3 mb-5">
        {stats.byStatus.map((s) => (
          <div
            key={s.status}
            className="px-3 py-1.5 rounded-md text-xs font-medium"
            style={{
              background: `${STATUS_COLOURS[s.status] ?? "#8888a0"}18`,
              color: STATUS_COLOURS[s.status] ?? "#8888a0",
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
            ? "No skills discovered yet. Ingest SKILL.md files to populate the catalog."
            : "No skills match the current filters."}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((skill) => (
            <div
              key={skill.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{
                borderLeftColor: STATUS_COLOURS[skill.status] ?? "#8888a0",
              }}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight truncate">
                  {skill.name}
                </p>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{
                    background: `${STATUS_COLOURS[skill.status] ?? "#8888a0"}20`,
                    color: STATUS_COLOURS[skill.status] ?? "#8888a0",
                  }}
                >
                  {skill.status}
                </span>
              </div>

              {/* Description */}
              <p className="text-[11px] text-[var(--dpf-muted)] line-clamp-2 mb-2">
                {skill.description}
              </p>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-1.5 text-[9px]">
                <span className="font-mono text-[var(--dpf-muted)]">
                  v{skill.version}
                </span>
                <span
                  className="px-1 py-0.5 rounded"
                  style={{
                    background: `${RISK_COLOURS[skill.riskBand] ?? "#8888a0"}18`,
                    color: RISK_COLOURS[skill.riskBand] ?? "#8888a0",
                  }}
                >
                  {skill.riskBand} risk
                </span>
                <span className="text-[var(--dpf-muted)]">
                  {skill.sourceType}
                  {skill.sourceRegistry ? ` / ${skill.sourceRegistry}` : ""}
                </span>
                <span className="text-[var(--dpf-muted)]">
                  {skill.category}
                </span>
              </div>

              {/* Tags */}
              {skill.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {skill.tags.slice(0, 5).map((tag) => (
                    <span
                      key={tag}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]"
                    >
                      {tag}
                    </span>
                  ))}
                  {skill.tags.length > 5 && (
                    <span className="text-[9px] text-[var(--dpf-muted)]">
                      +{skill.tags.length - 5}
                    </span>
                  )}
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--dpf-border)]">
                <span className="text-[9px] text-[var(--dpf-muted)]">
                  {skill._count.assignments} agent{skill._count.assignments !== 1 ? "s" : ""} assigned
                </span>
                {skill.author && (
                  <span className="text-[9px] text-[var(--dpf-muted)] truncate max-w-[120px]">
                    by {skill.author}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

// EP-AI-WORKFORCE-001 (HRIS surface) — the AI-workforce directory view.
// Filter rail (profession family / value stream / competency / jurisdiction /
// lifecycle / coverage-gap) + tier|family grouping over the annotated roster
// rows, with fitness-for-duty signals per coworker. Spec §7. Theme tokens only.

import { useMemo, useState } from "react";
import Link from "next/link";
import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";
import type { RosterRow, RosterFacets } from "@/lib/coworker-record/roster";
import { matchesFilters, kindOptions, EMPTY_FILTERS, type RosterFilters } from "@/lib/coworker-record/roster-filter";
import { computeWorkforceSummary } from "@/lib/coworker-record/workforce-summary";
import { WorkforceSummaryPanel } from "./WorkforceSummaryPanel";

// Tier is a span-of-control level, not a role — the role-type lives in each
// coworker's `kind` chip (a tier-1 group can hold a specialist, e.g. an analyst
// reporting at orchestration tier). Labels stay neutral so they never contradict
// the kind chip (EP-COWORKER-RT follow-up: tier said "Orchestrators" over a COO
// whose kind chip read "Specialist").
const TIER_LABELS: Record<number, string> = {
  1: "Tier 1",
  2: "Tier 2",
  3: "Tier 3",
};

type Filters = RosterFilters;

const EMPTY = EMPTY_FILTERS;

// Coarse relative label for the last-activity chip (EP-26E528F5 P2) — same
// idiom as AsyncOperationsTable. Coarse units keep SSR/client hydration stable.
function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function RosterView({ rows, facets }: { rows: RosterRow[]; facets: RosterFacets }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [groupBy, setGroupBy] = useState<"tier" | "family" | "domain">("domain");

  // Kind facet option set is derived from the rows present (design item 1) so a
  // fresh install never shows a role-type it has no coworker for.
  const kindOpts = useMemo(() => kindOptions(rows), [rows]);
  // WS5 workforce summary — computed once from the full roster (not the filtered
  // view): the at-a-glance "whole workforce" panel is a fixed denominator.
  const summary = useMemo(() => computeWorkforceSummary(rows), [rows]);

  const filtered = useMemo(() => rows.filter((r) => matchesFilters(r, filters)), [rows, filters]);

  const groups = useMemo(() => {
    const map = new Map<string, RosterRow[]>();
    for (const r of filtered) {
      const key =
        groupBy === "tier"
          ? TIER_LABELS[r.tier] ?? `Tier ${r.tier}`
          : groupBy === "domain"
            ? r.valueStream
              ? r.valueStream.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
              : "Core Platform / Universal"
            : r.familyLabel ?? "Unmapped";
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, groupBy]);

  const gaps = filtered.filter((r) => r.unmapped || r.emptyCorpus).length;
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <div>
      {/* WS5 — workforce summary (at-a-glance, computed from the full roster). */}
      <WorkforceSummaryPanel summary={summary} />

      {/* Filter rail */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          padding: "10px 12px",
          border: "1px solid var(--dpf-border)",
          borderRadius: 8,
          background: "var(--dpf-surface)",
          marginBottom: 14,
        }}
      >
        {/* Directory search (design §5) — name / slug / family substring. */}
        <label style={{ display: "inline-flex", flexDirection: "column", gap: 2, flex: "1 1 220px", minWidth: 200 }}>
          <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dpf-muted)" }}>Search</span>
          <input
            type="search"
            value={filters.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder="name, slug, or family…"
            aria-label="Search coworkers by name, slug, or family"
            style={{
              fontSize: 11,
              padding: "5px 8px",
              borderRadius: 5,
              border: "1px solid var(--dpf-border)",
              background: "var(--dpf-bg)",
              color: "var(--dpf-text)",
              width: "100%",
            }}
          />
        </label>
        <Select label="Family" value={filters.family} onChange={(v) => set({ family: v })} options={facets.families.map((f) => ({ value: f.key, label: f.label }))} />
        <Select label="Kind" value={filters.kind} onChange={(v) => set({ kind: v })} options={kindOpts.map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) }))} />
        <Select label="Value stream" value={filters.valueStream} onChange={(v) => set({ valueStream: v })} options={facets.valueStreams.map((v) => ({ value: v, label: v }))} />
        <Select label="Competency" value={filters.competency} onChange={(v) => set({ competency: v })} options={facets.competencies.map((v) => ({ value: v, label: v }))} />
        <Select label="Jurisdiction" value={filters.jurisdiction} onChange={(v) => set({ jurisdiction: v })} options={facets.jurisdictions.map((v) => ({ value: v, label: v }))} />
        <Select label="Lifecycle" value={filters.lifecycle} onChange={(v) => set({ lifecycle: v })} options={facets.lifecycleStages.map((v) => ({ value: v, label: v }))} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--dpf-text-secondary)" }}>
          <input type="checkbox" checked={filters.coverageGap} onChange={(e) => set({ coverageGap: e.target.checked })} />
          coverage gaps only
        </label>
        <button type="button" onClick={() => setFilters(EMPTY)} style={linkBtn}>reset</button>
        <div style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>group by</span>
          <button type="button" onClick={() => setGroupBy("domain")} style={toggleBtn(groupBy === "domain")}>domain</button>
          <button type="button" onClick={() => setGroupBy("tier")} style={toggleBtn(groupBy === "tier")}>tier</button>
          <button type="button" onClick={() => setGroupBy("family")} style={toggleBtn(groupBy === "family")}>family</button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 14 }}>
        {filtered.length} coworker{filtered.length !== 1 ? "s" : ""}
        {gaps > 0 ? ` · ${gaps} with coverage gap` : ""}
      </div>

      {groups.map(([groupName, groupRows]) => (
        <section key={groupName} style={{ marginBottom: 22 }}>
          <h2 style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--dpf-muted)", marginBottom: 8 }}>
            {groupName} <span style={{ fontWeight: 400 }}>({groupRows.length})</span>
          </h2>
          <div style={{ display: "grid", gap: 6 }}>
            {groupRows.map((r) => (
              <Link
                key={r.agentId}
                href={`/platform/ai/agent/${encodeURIComponent(r.agentId)}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <RosterRowCard row={r} />
              </Link>
            ))}
          </div>
        </section>
      ))}

      {filtered.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--dpf-muted)" }}>No coworkers match the current filters.</p>
      )}
    </div>
  );
}

function RosterRowCard({ row }: { row: RosterRow }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        background: "var(--dpf-surface)",
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)", minWidth: 180 }}>{row.displayName}</span>
      <Badge tone="muted">{row.kind.charAt(0).toUpperCase() + row.kind.slice(1)}</Badge>
      {row.familyLabel ? (
        <Badge tone="accent">{row.familyLabel}</Badge>
      ) : (
        <Badge tone="error">unmapped role</Badge>
      )}
      {row.valueStream && <Badge tone="muted">{row.valueStream}</Badge>}
      <Badge tone="muted">{row.lifecycleStage}</Badge>
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {row.coveragePct !== null && (
          <Badge tone={row.coveragePct >= 80 ? "success" : row.coveragePct >= 40 ? "warning" : "error"}>
            corpus {row.coveragePct}%
          </Badge>
        )}
        {row.emptyCorpus && row.familyKey && <Badge tone="warning">empty corpus</Badge>}
        {!row.providerHealthy && (
          <AskCoworkerButton
            prompt={`The AI workforce roster shows "${row.displayName}" with a "provider down" warning — its AI provider isn't healthy, so this coworker may not respond. Please check the provider status, explain what's wrong in plain language, and give me the exact next step (or fix it if you have a safe way to do so).`}
            routeContext="/platform"
            title="This coworker's AI provider isn't healthy — click to ask what's wrong and how to fix it"
            className=""
          >
            <Badge tone="warning">provider down — ask</Badge>
          </AskCoworkerButton>
        )}
        {row.openBlockers > 0 && <Badge tone="error">{row.openBlockers} blocker{row.openBlockers !== 1 ? "s" : ""}</Badge>}
        {row.deferRate > 0.25 && <Badge tone="warning">defer {Math.round(row.deferRate * 100)}%</Badge>}
        {/* Live "what are they doing" signal (BI-CF6D8C12): most recent visible
            work, so the fleet home reads as activity, not a static HR roster. */}
        <Badge tone={row.lastActiveAt ? "muted" : "warning"}>
          {row.lastActiveAt ? `active ${formatRelative(row.lastActiveAt)}` : "never active"}
        </Badge>
      </span>
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "muted" | "accent" | "success" | "warning" | "error" }) {
  const toneVar = {
    muted: "var(--dpf-muted)",
    accent: "var(--dpf-accent)",
    success: "var(--dpf-success)",
    warning: "var(--dpf-warning)",
    error: "var(--dpf-error)",
  }[tone];
  return (
    <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4, border: `1px solid ${toneVar}`, color: toneVar, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--dpf-muted)" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          fontSize: 11,
          padding: "4px 6px",
          borderRadius: 5,
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-bg)",
          color: "var(--dpf-text)",
          minWidth: 110,
        }}
      >
        <option value="">all</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

const linkBtn: React.CSSProperties = {
  appearance: "none",
  background: "transparent",
  border: "none",
  color: "var(--dpf-accent)",
  fontSize: 11,
  cursor: "pointer",
  padding: 0,
};

const toggleBtn = (active: boolean): React.CSSProperties => ({
  appearance: "none",
  background: active ? "var(--dpf-surface-2)" : "transparent",
  border: "1px solid var(--dpf-border)",
  borderColor: active ? "var(--dpf-accent)" : "var(--dpf-border)",
  color: active ? "var(--dpf-text)" : "var(--dpf-text-secondary)",
  fontSize: 11,
  padding: "3px 9px",
  borderRadius: 5,
  cursor: "pointer",
});

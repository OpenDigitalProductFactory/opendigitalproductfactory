// apps/web/components/platform/SkillsObservatoryPanel.tsx
"use client";

import { useState } from "react";
import type { SkillEntry, FinishingPassEntry, SkillExecutionEntry } from "@/lib/actions/skills-observatory";

type Props = {
  skills: SkillEntry[];
  finishingPasses: FinishingPassEntry[];
  specialistExecutions: SkillExecutionEntry[];
  stats: {
    totalSkills: number;
    userFacing: number;
    universal: number;
    specialistInternal: number;
    routes: number;
    totalToolExecutions: number;
    totalBuildActivities: number;
  };
};

type TabId = "catalog" | "passes" | "executions";

const AUDIENCE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  user: { bg: "color-mix(in srgb, var(--dpf-success) 12%, transparent)", text: "var(--dpf-success)", label: "User-Facing" },
  universal: { bg: "color-mix(in srgb, var(--dpf-info) 12%, transparent)", text: "var(--dpf-info)", label: "Universal" },
  "specialist-internal": { bg: "color-mix(in srgb, var(--dpf-warning) 12%, transparent)", text: "var(--dpf-warning)", label: "Specialist" },
};

export function SkillsObservatoryPanel({ skills, finishingPasses, specialistExecutions, stats }: Props) {
  const [tab, setTab] = useState<TabId>("catalog");
  const [audienceFilter, setAudienceFilter] = useState<string | null>(null);
  const [routeFilter, setRouteFilter] = useState<string | null>(null);

  const routes = [...new Set(skills.map((s) => s.route))].sort();
  const filtered = skills.filter((s) => {
    if (audienceFilter && s.audience !== audienceFilter) return false;
    if (routeFilter && s.route !== routeFilter) return false;
    return true;
  });

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "catalog", label: "Skills Catalog", count: skills.length },
    { id: "passes", label: "Finishing Passes", count: finishingPasses.length },
    { id: "executions", label: "Specialist Executions", count: specialistExecutions.length },
  ];

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Skills" value={stats.totalSkills} />
        <StatCard label="User-Facing" value={stats.userFacing} accent="var(--dpf-success)" />
        <StatCard label="Specialist-Internal" value={stats.specialistInternal} accent="var(--dpf-warning)" />
        <StatCard label="Routes Covered" value={stats.routes} accent="var(--dpf-info)" />
      </div>

      {/* Tab selector */}
      <div role="tablist" aria-label="Observatory views" className="flex gap-1 border-b border-[var(--dpf-border)]">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") setTab(tabs[(i + 1) % tabs.length]!.id);
              if (e.key === "ArrowLeft") setTab(tabs[(i - 1 + tabs.length) % tabs.length]!.id);
            }}
            className="px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
            style={{
              color: tab === t.id ? "var(--dpf-text)" : "var(--dpf-muted)",
              borderBottom: tab === t.id ? "2px solid var(--dpf-accent)" : "2px solid transparent",
            }}
          >
            {t.label} <span className="text-[var(--dpf-muted)] ml-1">({t.count})</span>
          </button>
        ))}
      </div>

      {/* Skills Catalog */}
      {tab === "catalog" && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex gap-2 flex-wrap">
            <FilterButton label="All" active={!audienceFilter} onClick={() => setAudienceFilter(null)} />
            <FilterButton label="User-Facing" active={audienceFilter === "user"} onClick={() => setAudienceFilter("user")} />
            <FilterButton label="Universal" active={audienceFilter === "universal"} onClick={() => setAudienceFilter("universal")} />
            <FilterButton label="Specialist" active={audienceFilter === "specialist-internal"} onClick={() => setAudienceFilter("specialist-internal")} />
            <select
              value={routeFilter ?? ""}
              onChange={(e) => setRouteFilter(e.target.value || null)}
              className="text-xs px-2 py-1 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)]"
              aria-label="Filter by route"
            >
              <option value="">All routes</option>
              {routes.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {filtered.map((skill, i) => (
            <SkillRow
              key={`${skill.route}-${skill.label}-${i}`}
              skill={skill}
              style={AUDIENCE_STYLES[skill.audience] ?? AUDIENCE_STYLES.user!}
            />
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-[var(--dpf-muted)] text-center py-8">No skills match the current filters.</p>
          )}
        </div>
      )}

      {/* Finishing Passes */}
      {tab === "passes" && (
        <div className="space-y-2 animate-fade-in">
          {finishingPasses.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)] text-center py-8">No finishing pass activity recorded yet.</p>
          ) : (
            finishingPasses.map((fp) => (
              <div key={fp.id} className="flex items-start gap-2 px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] shadow-dpf-xs">
                <span
                  className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                  style={{ background: fp.passType ? "var(--dpf-success)" : "var(--dpf-muted)" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--dpf-text)]">{fp.tool}</span>
                    {fp.passType && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: "color-mix(in srgb, var(--dpf-accent) 12%, transparent)", color: "var(--dpf-accent)" }}
                      >
                        {fp.passType}
                      </span>
                    )}
                    <span className="text-[10px] text-[var(--dpf-muted)] ml-auto shrink-0">
                      {new Date(fp.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--dpf-text-secondary)] mt-0.5 leading-relaxed">{fp.summary}</p>
                  <span className="text-[10px] text-[var(--dpf-muted)]">Build: {fp.buildId}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Specialist Executions */}
      {tab === "executions" && (
        <div className="space-y-2 animate-fade-in">
          {specialistExecutions.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)] text-center py-8">No specialist executions recorded yet.</p>
          ) : (
            specialistExecutions.map((ex) => (
              <div key={ex.id} className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] shadow-dpf-xs">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: ex.success ? "var(--dpf-success)" : "var(--dpf-error)" }}
                />
                <span className="text-xs font-medium text-[var(--dpf-text)] w-24 shrink-0">{ex.agentId}</span>
                <span className="text-xs text-[var(--dpf-text-secondary)] flex-1 truncate">{ex.toolName}</span>
                {ex.durationMs !== null && (
                  <span className="text-[10px] text-[var(--dpf-muted)]">{ex.durationMs}ms</span>
                )}
                <span className="text-[10px] text-[var(--dpf-muted)] shrink-0">
                  {new Date(ex.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="px-4 py-3 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] shadow-dpf-xs animate-slide-up">
      <div className="text-xl font-bold" style={{ color: accent ?? "var(--dpf-text)" }}>{value}</div>
      <div className="text-xs text-[var(--dpf-muted)]">{label}</div>
    </div>
  );
}

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 text-xs rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)]"
      style={{
        background: active ? "color-mix(in srgb, var(--dpf-accent) 15%, transparent)" : "transparent",
        borderColor: active ? "var(--dpf-accent)" : "var(--dpf-border)",
        color: active ? "var(--dpf-accent)" : "var(--dpf-muted)",
      }}
    >
      {label}
    </button>
  );
}

function SkillRow({ skill, style }: { skill: SkillEntry; style: { bg: string; text: string; label: string } }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] shadow-dpf-xs">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--dpf-surface-3)] transition-colors rounded focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)]"
        aria-expanded={expanded}
        aria-label={`${skill.label} — ${style.label} skill on ${skill.route}`}
      >
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium"
          style={{ background: style.bg, color: style.text }}
        >
          {style.label}
        </span>
        <span className="text-xs font-medium text-[var(--dpf-text)] flex-1">{skill.label}</span>
        <span className="text-[10px] text-[var(--dpf-muted)] shrink-0">{skill.route}</span>
        <span className="text-[10px] text-[var(--dpf-muted)]">{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 pt-0 border-t border-[var(--dpf-border)] animate-fade-in">
          <p className="text-xs text-[var(--dpf-text-secondary)] mt-2">{skill.description}</p>
          {skill.capability && (
            <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
              Requires: <span className="font-mono">{skill.capability}</span>
            </p>
          )}
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">Task type: {skill.taskType}</p>
          <details className="mt-2">
            <summary className="text-[10px] text-[var(--dpf-muted)] cursor-pointer hover:text-[var(--dpf-text-secondary)]">
              View prompt
            </summary>
            <pre className="text-[10px] text-[var(--dpf-text-secondary)] whitespace-pre-wrap leading-relaxed mt-1 p-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] max-h-40 overflow-auto">
              {skill.prompt}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

// Unified Workforce roster panel (BI-554E1A14, EP-BOM-WIRING Phase 2).
//
// Renders the org's workforce as ONE roster spanning human employees and AI
// agents. For agents it shows the "needs lens" — what the non-human identity
// needs to contribute: value-stream role, supervising human, HITL tier, model +
// token budget, tool/skill counts, and unmet capability needs (the gap signal).
//
// Presentational and theme-aware (DPF CSS custom properties, dense layout, no
// hardcoded colors, no nested cards). Server component — no client state.

import type { WorkforceMember, WorkforceRoster } from "@/lib/workforce/workforce-roster";

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="text-[9px] text-[var(--dpf-muted)]">
      {label} <span className="text-[var(--dpf-text)]">{value}</span>
    </span>
  );
}

function AgentNeeds({ member }: { member: WorkforceMember }) {
  const needs = member.agentNeeds;
  if (!needs) return null;

  const tokenBudget =
    needs.dailyTokenLimit != null ? `${(needs.dailyTokenLimit / 1000).toFixed(0)}k/day` : "—";

  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      <StatPill label="stream" value={needs.valueStream ?? "—"} />
      <StatPill label="supervisor" value={needs.supervisorId ?? "unassigned"} />
      <StatPill label="HITL" value={`T${needs.hitlTier}`} />
      <StatPill label="model" value={needs.model ?? "unset"} />
      <StatPill label="budget" value={tokenBudget} />
      <StatPill label="tools" value={needs.toolGrantCount} />
      <StatPill label="skills" value={needs.skillCount} />
      <span
        className={[
          "text-[9px]",
          needs.unmetNeedCount > 0 ? "text-[var(--dpf-accent)]" : "text-[var(--dpf-muted)]",
        ].join(" ")}
      >
        unmet needs <span className="text-[var(--dpf-text)]">{needs.unmetNeedCount}</span>
      </span>
    </div>
  );
}

function MemberRow({ member }: { member: WorkforceMember }) {
  const isAgent = member.kind === "agent";
  return (
    <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight truncate">
            {member.displayName}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] truncate">
            {member.role ?? "—"}
            {member.group ? ` · ${member.group}` : ""}
          </p>
        </div>
        <span className="text-[9px] font-mono uppercase tracking-wide text-[var(--dpf-muted)] shrink-0">
          {isAgent ? "AI agent" : "human"}
        </span>
      </div>
      {isAgent && <AgentNeeds member={member} />}
    </div>
  );
}

export function WorkforceRosterPanel({ roster }: { roster: WorkforceRoster }) {
  const { members, summary } = roster;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Workforce</h2>
        <StatPill label="total" value={summary.total} />
        <StatPill label="people" value={summary.humans} />
        <StatPill label="AI agents" value={summary.agents} />
        <StatPill label="agents w/ unmet needs" value={summary.agentsWithUnmetNeeds} />
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)] py-8 text-center">
          No workforce members yet. Humans and AI agents will appear here as they are onboarded.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {members.map((m) => (
            <MemberRow key={`${m.kind}:${m.id}`} member={m} />
          ))}
        </div>
      )}
    </div>
  );
}

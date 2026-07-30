// Unified Workforce roster panel (BI-554E1A14 + BI-9A5F0EA3, EP-BOM-WIRING).
//
// Renders the org's workforce as ONE roster spanning human employees and AI
// coworkers. For coworkers it shows the "needs lens" — what the non-human peer
// needs to contribute: value-stream role, HITL tier, model + token budget,
// tool/skill counts, and unmet capability needs (the gap signal) — plus, per the
// founder invariant DOC-7693D528, its human-role parity anchor (the equivalent
// human role it is patterned against) and its approval/interface owner (broad
// role → specific employee as headcount grows).
//
// Presentational and theme-aware (DPF CSS custom properties, dense layout, no
// hardcoded colors, no nested cards). Server component — no client state.

import Link from "next/link";

import type { WorkforceMember, WorkforceRoster } from "@/lib/workforce/workforce-roster";
import { oversightLabel } from "@/lib/workforce/oversight-copy";

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

  // DOC-7693D528: each AI coworker is a role-shaped peer — show the equivalent
  // human role it is patterned against and the responsible approval/interface
  // owner, whose specificity (a named employee vs the broad role) scales with
  // headcount.
  const owner = needs.approvalInterfaceOwner;
  const ownerValue =
    owner.scope === "unassigned" ? "unassigned" : `${owner.label ?? "—"} (${owner.scope})`;

  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      <StatPill label="stream" value={needs.valueStream ?? "—"} />
      <StatPill label="role parity" value={needs.humanRoleParity?.roleName ?? "—"} />
      <StatPill label="approval owner" value={ownerValue} />
      <StatPill label="Oversight" value={oversightLabel(needs.hitlTier, { short: true })} />
      <StatPill label="model" value={needs.model ?? "unset"} />
      <StatPill label="budget" value={tokenBudget} />
      <StatPill label="tools" value={needs.toolGrantCount} />
      <StatPill label="skills" value={needs.skillCount} />
      {/* EP-COWORKER-LIFECYCLE Phase 2: behavioral certification from the
          nightly golden-journey sweep — honest "does this coworker work". */}
      <span
        className={[
          "text-[9px]",
          needs.certification === "certified"
            ? "text-[var(--dpf-muted)]"
            : "text-[var(--dpf-accent)]",
        ].join(" ")}
      >
        certification <span className="text-[var(--dpf-text)]">{needs.certification}</span>
      </span>
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
          {/* EP-26E528F5: the HR roster stays the humans+AI altitude, but each
              coworker deep-links to its ONE record instead of dead-ending here. */}
          {isAgent ? (
            <Link
              href={`/platform/ai/agent/${encodeURIComponent(member.id)}`}
              className="text-sm font-semibold text-[var(--dpf-text)] leading-tight truncate block hover:text-[var(--dpf-accent)]"
            >
              {member.displayName}
            </Link>
          ) : (
            <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight truncate">
              {member.displayName}
            </p>
          )}
          <p className="text-[10px] text-[var(--dpf-muted)] truncate">
            {member.role ?? "—"}
            {member.group ? ` · ${member.group}` : ""}
          </p>
        </div>
        <span className="text-[9px] font-mono uppercase tracking-wide text-[var(--dpf-muted)] shrink-0">
          {isAgent ? "AI coworker" : "employee"}
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
        <StatPill label="AI coworkers" value={summary.agents} />
        <StatPill label="coworkers w/ unmet needs" value={summary.agentsWithUnmetNeeds} />
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)] py-8 text-center">
          No workforce members yet. Employees and AI coworkers will appear here as they are onboarded.
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

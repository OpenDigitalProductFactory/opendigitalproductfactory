// Workforce ACTIVITY lead (BI-D80A1C3E).
//
// The lead for the Workforce view: what the AI + human workforce is actively
// working on (tied to customer/business outcomes) and what needs the operator
// right now. The unified HR/AI roster renders BELOW this as the secondary
// directory. Presentational + theme-aware (DPF CSS custom properties, dense
// layout, no hardcoded colors). Server component — no client state.

import type {
  WorkforceActiveWorkItem,
  WorkforceActivity,
  WorkforceConcern,
  WorkforceConcernSeverity,
} from "@/lib/workforce/workforce-activity";

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="text-[9px] text-[var(--dpf-muted)]">
      {label} <span className="text-[var(--dpf-text)]">{value}</span>
    </span>
  );
}

const SEVERITY_COLOR: Record<WorkforceConcernSeverity, string> = {
  high: "var(--dpf-error)",
  medium: "var(--dpf-warning)",
  low: "var(--dpf-muted)",
};

const SEVERITY_LABEL: Record<WorkforceConcernSeverity, string> = {
  high: "Act now",
  medium: "Attention",
  low: "Watch",
};

function ConcernRow({ concern }: { concern: WorkforceConcern }) {
  return (
    <div
      className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
      style={{ borderLeftColor: SEVERITY_COLOR[concern.severity] }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight">
          {concern.title}
        </p>
        <span
          className="text-[9px] font-mono uppercase tracking-wide shrink-0"
          style={{ color: SEVERITY_COLOR[concern.severity] }}
        >
          {SEVERITY_LABEL[concern.severity]}
        </span>
      </div>
      <p className="text-[10px] text-[var(--dpf-muted)] mt-1">{concern.detail}</p>
    </div>
  );
}

function ownerChip(item: WorkforceActiveWorkItem): string {
  if (item.ownerKind === "agent") return "AI agent";
  if (item.ownerKind === "human") return "employee";
  return "unassigned";
}

function ActiveWorkRow({ item }: { item: WorkforceActiveWorkItem }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight truncate">
            {item.title}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] truncate">
            {item.ownerLabel} · {ownerChip(item)}
          </p>
        </div>
        <div className="flex flex-col items-end shrink-0 gap-0.5">
          <span className="text-[9px] font-mono uppercase tracking-wide text-[var(--dpf-muted)]">
            {item.phase}
          </span>
          {item.kind === "fix" && (
            <span className="text-[9px] font-mono uppercase tracking-wide text-[var(--dpf-accent)]">
              fix
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function WorkforceActivityPanel({ activity }: { activity: WorkforceActivity }) {
  const { activeWork, concerns, summary } = activity;

  return (
    <div className="space-y-6">
      {/* Needs-operator lead */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Needs you</h2>
          <StatPill label="items" value={summary.concernCount} />
          <StatPill label="act now" value={summary.highSeverity} />
        </div>

        {concerns.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)] py-6 text-center rounded-lg bg-[var(--dpf-surface-1)]">
            Nothing needs the operator right now — no unowned SLAs, approvals, or open handoffs.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {concerns.map((c) => (
              <ConcernRow key={`${c.kind}:${c.id}`} concern={c} />
            ))}
          </div>
        )}
      </section>

      {/* Active work the workforce owns */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Workforce at work</h2>
          <StatPill label="active" value={summary.activeWorkCount} />
          <StatPill label="AI-driven" value={summary.agentDriven} />
          <StatPill label="human-driven" value={summary.humanDriven} />
        </div>

        {activeWork.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)] py-6 text-center rounded-lg bg-[var(--dpf-surface-1)]">
            No active work in flight. Builds and engagements the workforce owns will appear here.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {activeWork.map((item) => (
              <ActiveWorkRow key={item.buildId} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

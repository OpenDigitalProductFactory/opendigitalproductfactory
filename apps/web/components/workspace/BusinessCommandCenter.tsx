// apps/web/components/workspace/BusinessCommandCenter.tsx
//
// The SECONDARY at-a-glance surface for the workspace home: a "platform posture"
// watch strip (metrics-derived exceptions), an at-a-glance StatCard snapshot, and
// the human + AI "work in motion" list. The 6×6 Six-Cs readiness matrix that used
// to live here is an operator/governance view and now renders on the platform
// surface (see PlatformReadinessMatrix and
// docs/superpowers/specs/2026-06-06-main-portal-workspace-home-redesign-design.md §7).
//
// The single "what needs you now" surface is the OperatorCockpit (BI-2651043B /
// BI-D35DE119 F2 fix): this strip is deliberately posture/watch, NOT a competing
// "needs attention" claim — so it never says "nothing needs you" while the cockpit
// shows a count. When it is empty it reports clear POSTURE, not clear attention.
//
// Real data only — every block renders from the command-center loader and shows
// an empty state when there is nothing, never synthesized rows.

import { StatCard } from "@/components/ui/report-kit";
import type { CommandSeverity, WorkspaceCommandCenterView } from "@/lib/workspace-home/command-center";

type Props = {
  view: WorkspaceCommandCenterView;
};

const severityClass: Record<CommandSeverity, string> = {
  critical: "border-[var(--dpf-error)] text-[var(--dpf-error)]",
  warning: "border-[var(--dpf-warning)] text-[var(--dpf-warning)]",
  info: "border-[var(--dpf-info)] text-[var(--dpf-info)]",
};

export function BusinessCommandCenter({ view }: Props) {
  return (
    <section aria-labelledby="business-command-center-title" className="space-y-4">
      <h2 id="business-command-center-title" className="sr-only">
        Platform posture and at-a-glance
      </h2>

      {/* Posture watch strip — metrics-derived exceptions to keep an eye on. This is
          SECONDARY to the OperatorCockpit's "what needs you now"; it never competes as
          an attention claim (BI-D35DE119 F2). */}
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <div className="border-b border-[var(--dpf-border)] px-4 py-3">
          <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Platform posture</p>
        </div>
        <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-3">
          {view.commandStrip.length > 0 ? (
            view.commandStrip.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className="min-h-24 border-b border-[var(--dpf-border)] px-4 py-3 hover:bg-[var(--dpf-surface-2)] md:border-r xl:last:border-r-0"
              >
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${severityClass[item.severity]}`}
                >
                  {item.severity}
                </span>
                <p className="mt-2 text-sm font-semibold text-[var(--dpf-text)]">{item.label}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{item.description}</p>
              </a>
            ))
          ) : (
            <div className="px-4 py-6 text-sm text-[var(--dpf-muted)]">
              Platform posture is clear.
            </div>
          )}
        </div>
      </div>

      {/* At-a-glance snapshot — report-kit StatCards */}
      {view.snapshot.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {view.snapshot.map((item) => (
            <StatCard key={item.id} label={item.label} value={item.value} href={item.href} />
          ))}
        </div>
      )}

      {/* Human + AI work in motion */}
      {view.workInMotion.length > 0 && (
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <div className="border-b border-[var(--dpf-border)] px-4 py-3">
            <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Work in motion</p>
          </div>
          <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-3">
            {view.workInMotion.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className="min-h-20 border-b border-[var(--dpf-border)] px-4 py-3 hover:bg-[var(--dpf-surface-2)] md:border-r xl:last:border-r-0"
              >
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{item.label}</p>
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">{item.actor}</p>
                <span className="mt-2 inline-flex rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--dpf-muted)]">
                  {item.status}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

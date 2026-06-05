"use client";

import { StatusBadge } from "@/components/ui/report-kit";
import { LocalTime } from "@/components/ui/LocalTime";
import type {
  OperationsMapDeliberation,
  OperationsMapDeliberationBranch,
} from "@/lib/ai-operations-map/types";

type Props = {
  deliberations: OperationsMapDeliberation[];
};

/**
 * Deliberation lens (Option B). A deliberation is a coordinating coworker
 * fanning a decision out to N review branches. Those branches are NOT distinct
 * coworkers today, so this renders a coordinator-side summary (role + model/
 * provider) rather than coworker↔coworker edges — never fabricating identity.
 * See docs/superpowers/specs/2026-06-05-deliberation-branch-identity-for-a2a-ops-map-design.md
 */
export function DeliberationLensPanel({ deliberations }: Props) {
  return (
    <section
      aria-label="Deliberation lens"
      className="space-y-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Deliberations</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
            Internal review fans: a coordinating coworker deliberated across review branches (by role, and where the
            run is diverse, by model/provider). Branches are review facets of the coordinator, not separate coworkers.
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-[var(--dpf-surface-2)] px-2.5 py-1">
          <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">Runs</span>
          <span className="ml-2 text-xs font-semibold text-[var(--dpf-text)]">{deliberations.length}</span>
        </span>
      </header>

      {deliberations.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-6 text-center text-sm text-[var(--dpf-muted)]">
          No deliberations recorded in the current window. Multi-branch reviews appear here as coworkers deliberate.
        </div>
      ) : (
        <ul className="space-y-2">
          {deliberations.map((deliberation) => (
            <li
              key={deliberation.id}
              data-deliberation={deliberation.id}
              className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--dpf-text)]">{deliberation.coordinatorLabel}</p>
                  <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
                    {deliberation.pattern ?? "Deliberation"} · {diversityModeLabel(deliberation.diversityMode)} ·{" "}
                    {deliberation.branches.length} branch{deliberation.branches.length === 1 ? "" : "es"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    domain="deliberationConsensus"
                    status={deliberation.consensusState}
                    label={consensusLabel(deliberation.consensusState)}
                    variant="soft"
                  />
                  <LocalTime
                    value={deliberation.occurredAt}
                    className="text-[10px] text-[var(--dpf-muted)]"
                    fallback="Unknown time"
                  />
                </div>
              </div>

              <ul className="mt-2 flex flex-wrap gap-1.5">
                {deliberation.branches.map((branch) => (
                  <li
                    key={branch.nodeId}
                    data-deliberation-branch={branch.nodeId}
                    className="inline-flex items-center gap-1.5 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[11px]"
                    title={branchTitle(branch)}
                  >
                    <span className="font-medium text-[var(--dpf-text)]">{humanize(branch.role) || "Branch"}</span>
                    {branch.modelId ? (
                      <span className="text-[var(--dpf-muted)]">
                        {branch.providerId ? `${branch.providerId} / ${branch.modelId}` : branch.modelId}
                      </span>
                    ) : null}
                    {branch.status ? (
                      <span className="text-[var(--dpf-muted)]">· {humanize(branch.status)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function branchTitle(branch: OperationsMapDeliberationBranch): string {
  const parts = [humanize(branch.role) || "Branch"];
  if (branch.modelId) parts.push(branch.providerId ? `${branch.providerId} / ${branch.modelId}` : branch.modelId);
  if (branch.status) parts.push(humanize(branch.status));
  return parts.join(" · ");
}

function diversityModeLabel(mode: string): string {
  switch (mode) {
    case "single-model-multi-persona":
      return "Single model · multi-persona";
    case "multi-model-same-provider":
      return "Multi-model · same provider";
    case "multi-provider-heterogeneous":
      return "Multi-provider";
    default:
      return humanize(mode);
  }
}

function consensusLabel(state: string): string {
  return humanize(state);
}

function humanize(value: string | null): string {
  if (!value) return "";
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

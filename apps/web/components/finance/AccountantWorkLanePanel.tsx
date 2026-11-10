import { ArrowRight, Plug, ShieldCheck, Workflow } from "lucide-react";
import Link from "next/link";
import {
  type ResolvedAccountantWorkLane,
  type AccountantProviderBoundary,
  type AccountantWorkstream,
} from "@/lib/finance/accountant-work-lane";

const POSTURE_LABELS: Record<AccountantProviderBoundary["posture"], string> = {
  "read-first": "Read-first",
  "import-staging": "Import staging",
  "reconciliation-anchor": "Reconciliation anchor",
  "not-mapped": "Not mapped",
};

export function AccountantWorkLanePanel({ lane }: { lane: ResolvedAccountantWorkLane }) {
  return (
    <section className="mb-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            Employee Work Lane
          </p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">{lane.roleLabel}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
            One operating lane for the finance routes, AI coworker handoffs, and provider boundaries
            a small-business bookkeeper or accountant needs every day.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-[var(--dpf-text)]">
            {lane.taxonomyNodeId}
          </span>
          <span className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-[var(--dpf-text)]">
            Hybrid posture
          </span>
          <span className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-[var(--dpf-text)]">
            Observe maturity
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
            <Workflow className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
            Daily finance path
          </div>
          <div className="divide-y divide-[var(--dpf-border)] border-y border-[var(--dpf-border)]">
            {lane.workstreams.map((workstream) => (
              <WorkstreamRow key={workstream.key} workstream={workstream} />
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
            <ShieldCheck className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
            Coworker and approval handoffs
          </div>
          <div className="divide-y divide-[var(--dpf-border)] border-y border-[var(--dpf-border)]">
            {lane.handoffs.map((handoff) => (
              <div key={handoff.actorId} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--dpf-text)]">{handoff.label}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
                      {handoff.actorKind.replace("-", " ")}
                    </p>
                    <p className="font-mono text-xs text-[var(--dpf-muted)]">{handoff.actorId}</p>
                  </div>
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{handoff.responsibility}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--dpf-text)]">{handoff.boundary}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
          <Plug className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
          Provider boundaries and missing coverage
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[920px] text-left text-sm">
            <thead className="border-b border-[var(--dpf-border)] text-[11px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
              <tr>
                <th className="py-3 pr-4 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Current coverage</th>
                <th className="px-4 py-3 font-medium">Missing coverage</th>
                <th className="py-3 pl-4 font-medium">Boundary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dpf-border)]">
              {lane.providerBoundaries.map((boundary) => (
                <tr key={boundary.provider} className="align-top">
                  <td className="py-4 pr-4">
                    <Link href={boundary.href} className="font-medium text-[var(--dpf-accent)] hover:underline">
                      {boundary.label}
                    </Link>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">{POSTURE_LABELS[boundary.posture]}</p>
                    <p className="mt-2 font-mono text-xs text-[var(--dpf-text)]">
                      {boundary.nextStep.label}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <TagList values={boundary.currentCoverage} />
                  </td>
                  <td className="px-4 py-4">
                    <TagList values={boundary.missingCoverage} muted />
                  </td>
                  <td className="py-4 pl-4">
                    <p className="max-w-[320px] text-xs leading-5 text-[var(--dpf-muted)]">
                      {boundary.writeBoundary}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-t border-[var(--dpf-border)] pt-4 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm leading-6 text-[var(--dpf-text)]">{lane.promotionGuardrail}</p>
        <Link
          href={lane.nextWorkflow.route}
          className="inline-flex max-w-full items-center gap-2 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        >
          <span className="shrink-0">{lane.nextWorkflow.nextStep.label}</span>
          <span className="min-w-0 truncate">{lane.nextWorkflow.title}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function WorkstreamRow({ workstream }: { workstream: AccountantWorkstream }) {
  return (
    <div className="py-4">
      <p className="text-sm font-medium text-[var(--dpf-text)]">{workstream.label}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{workstream.dailyWork}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {workstream.routes.map((route) => (
          <Link
            key={route.href}
            href={route.href}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
          >
            {route.label}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--dpf-text)]">{workstream.handoffRule}</p>
    </div>
  );
}

function TagList({ values, muted = false }: { values: string[]; muted?: boolean }) {
  return (
    <div className="flex max-w-[260px] flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className={[
            "rounded-lg border border-[var(--dpf-border)] px-2 py-0.5 text-xs",
            muted
              ? "bg-[var(--dpf-bg)] text-[var(--dpf-muted)]"
              : "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
          ].join(" ")}
        >
          {value}
        </span>
      ))}
    </div>
  );
}

import Link from "next/link";
import type { DecisionCanvasViewModel } from "@/lib/decision-perspective/canvas";

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function stateLabel(state: DecisionCanvasViewModel["recommendation"]["state"]) {
  if (state === "needs-review") return "Needs Review";
  if (state === "blocked") return "Blocked";
  if (state === "deferred") return "Deferred";
  return "Recommended";
}

function perspectiveLabel(perspective: DecisionCanvasViewModel["header"]["perspective"]) {
  if (perspective === "wwmd") return "WWMD";
  if (perspective === "wwwd") return "WWWD";
  return "Decision Perspective";
}

export function DecisionCanvas({ viewModel }: { viewModel: DecisionCanvasViewModel }) {
  const perspective = perspectiveLabel(viewModel.header.perspective);

  return (
    <section className="space-y-5 text-[var(--dpf-text)]" aria-label="Decision canvas">
      <div className="flex flex-col gap-3 border-b border-[var(--dpf-border)] pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2 text-xs text-[var(--dpf-muted)]">
            <span>{perspective}</span>
            <span aria-hidden="true">/</span>
            <span>{viewModel.header.profileLabel}</span>
            <span aria-hidden="true">/</span>
            <span>{viewModel.header.domainClass}</span>
          </div>
          <h1 className="text-xl font-semibold leading-snug">{viewModel.header.question}</h1>
          <p className="text-sm text-[var(--dpf-muted)]">
            {viewModel.header.routeContext ?? "No route context"} / {formatDate(viewModel.header.createdAt)}
          </p>
          {viewModel.header.seededFromWwmd ? (
            <p className="text-xs italic text-[var(--dpf-muted)]" data-testid="seeded-from-wwmd">
              Seeded from WWMD doctrine — the organization perspective has no approved material of its own yet.
            </p>
          ) : null}
        </div>
        <div className="grid min-w-[12rem] gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <span className="text-xs font-medium text-[var(--dpf-muted)]">{stateLabel(viewModel.recommendation.state)}</span>
          <span className="text-2xl font-semibold">{formatPercent(viewModel.recommendation.confidenceScore)}</span>
          <span className="text-xs text-[var(--dpf-muted)]">{viewModel.recommendation.confidenceLabel} confidence</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.7fr)]">
        <div className="space-y-4">
          <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4" aria-label="Recommendation">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold">Decision</h2>
                <p className="mt-1 text-sm text-[var(--dpf-muted)]">{viewModel.recommendation.operatorMessage}</p>
              </div>
              <span className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm">
                {viewModel.recommendation.nextActionLabel}
              </span>
            </div>
            {viewModel.options.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {viewModel.options.map((option) => (
                  <div
                    key={option.id}
                    className="flex items-start justify-between gap-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
                  >
                    <span className="min-w-0 text-sm">{option.label}</span>
                    <span className="shrink-0 text-xs text-[var(--dpf-muted)]">
                      {option.humanSelected ? "Chosen" : option.selected ? "Recommended" : "Option"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {viewModel.outcome.hasHumanOutcome ? (
            <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4" aria-label="Owner outcome">
              <h2 className="text-sm font-semibold">Owner outcome</h2>
              <p className="mt-2 text-sm">{viewModel.outcome.chosenOption ?? "Outcome recorded"}</p>
              {viewModel.outcome.rationale ? (
                <p className="mt-1 text-sm text-[var(--dpf-muted)]">{viewModel.outcome.rationale}</p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3" aria-label="Material pulls">
            <h2 className="text-sm font-semibold">Material Pulls</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <MaterialPullColumn label="Supports" items={viewModel.materialPulls.positive} />
              <MaterialPullColumn label="Opposes" items={viewModel.materialPulls.negative} />
              <MaterialPullColumn label="Neutral" items={viewModel.materialPulls.neutral} />
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4" aria-label="Evidence sources">
            <h2 className="text-sm font-semibold">Sources</h2>
            <div className="mt-3 space-y-3">
              {viewModel.sources.length === 0 ? (
                <p className="text-sm text-[var(--dpf-muted)]">No source material was attached.</p>
              ) : (
                viewModel.sources.map((source) => (
                  <div key={source.id} className="space-y-1 border-b border-[var(--dpf-border)] pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      {source.href ? (
                        <Link className="min-w-0 text-sm font-medium text-[var(--dpf-accent)]" href={source.href}>
                          {source.label}
                        </Link>
                      ) : (
                        <span className="min-w-0 text-sm font-medium">{source.label}</span>
                      )}
                      {typeof source.weight === "number" ? (
                        <span className="shrink-0 text-xs text-[var(--dpf-muted)]">{source.weight.toFixed(2)}</span>
                      ) : null}
                    </div>
                    <p className="text-xs text-[var(--dpf-muted)]">{source.sourceType}</p>
                    <p className="text-sm">{source.summary}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4" aria-label="Audit identifiers">
            <h2 className="text-sm font-semibold">Audit</h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <AuditRow label="Interaction" value={viewModel.audit.interactionId} />
              <AuditRow label="Profile" value={viewModel.audit.profileId} />
              <AuditRow label="Version" value={viewModel.audit.profileVersionId} />
            </dl>
          </section>
        </aside>
      </div>
    </section>
  );
}

function MaterialPullColumn({
  label,
  items,
}: {
  label: string;
  items: DecisionCanvasViewModel["materialPulls"]["positive"];
}) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <h3 className="text-xs font-semibold text-[var(--dpf-muted)]">{label}</h3>
      <div className="mt-2 space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">None</p>
        ) : (
          items.map((item) => (
            <div key={`${item.principleId}-${item.contribution}`} className="space-y-1">
              <p className="text-sm">{item.principleName}</p>
              <p className="text-xs text-[var(--dpf-muted)]">{item.contribution.toFixed(2)}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AuditRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
      <dt className="text-[var(--dpf-muted)]">{label}</dt>
      <dd className="min-w-0 break-words">{value ?? "None"}</dd>
    </div>
  );
}

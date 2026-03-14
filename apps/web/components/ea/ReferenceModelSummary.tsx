import Link from "next/link";
import type { ReferenceModelSummary as ReferenceModelSummaryRow } from "@/lib/reference-model-types";

type Props = {
  models: ReferenceModelSummaryRow[];
};

export function ReferenceModelSummary({ models }: Props) {
  if (models.length === 0) {
    return (
      <div className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-sm text-[var(--dpf-muted)]">
          No reference models have been registered yet.
        </p>
      </div>
    );
  }

  return (
    <section className="mb-6">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-white">Reference Models</h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          Assessment-ready models managed through Enterprise Architecture.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {models.map((model) => (
          <Link
            key={model.id}
            href={`/ea/models/${model.slug}`}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 transition-colors hover:border-[var(--dpf-accent)]"
          >
            <p className="mb-1 text-[10px] font-mono uppercase tracking-widest text-[var(--dpf-muted)]">
              {model.status}
            </p>
            <p className="text-sm font-semibold text-white">{model.name}</p>
            <p className="mb-2 text-xs text-[var(--dpf-muted)]">{model.version}</p>
            <div className="space-y-1 text-xs text-[var(--dpf-muted)]">
              <p>{model.criteriaCount} criteria</p>
              <p>{model.assessmentCount} assessments</p>
              <p>{model.proposalCount} proposals</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

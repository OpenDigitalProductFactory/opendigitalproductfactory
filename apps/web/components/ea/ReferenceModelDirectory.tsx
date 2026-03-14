import Link from "next/link";
import type { ReferenceModelSummary } from "@/lib/reference-model-types";

type Props = {
  models: ReferenceModelSummary[];
};

export function ReferenceModelDirectory({ models }: Props) {
  return (
    <section>
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--dpf-muted)]">
          EA Conformance
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">Reference Models</h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Compare the platform against seeded and approved reference models.
        </p>
      </div>

      {models.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No reference models loaded yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {models.map((model) => (
            <Link
              key={model.id}
              href={`/ea/models/${model.slug}`}
              className="block rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 hover:opacity-90"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{model.name}</p>
                  <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
                    {model.version} · {model.status}
                  </p>
                </div>
                <span className="rounded-full bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] text-[var(--dpf-muted)]">
                  {model.criteriaCount} criteria
                </span>
              </div>
              <div className="mt-3 flex gap-3 text-[11px] text-[var(--dpf-muted)]">
                <span>{model.assessmentCount} assessments</span>
                <span>{model.proposalCount} proposals</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

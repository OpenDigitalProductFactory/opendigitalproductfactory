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
        <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">Reference Models</h2>
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
              className={`block rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 hover:opacity-90${
                model.applies ? "" : " opacity-70"
              }`}
              data-applies={model.applies ? "true" : "false"}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--dpf-text)]">{model.name}</p>
                  <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
                    {model.version} · {model.applies ? model.status : "not this archetype"}
                  </p>
                </div>
                {model.applies && (
                  <span className="rounded-full bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] text-[var(--dpf-muted)]">
                    {model.criteriaCount} criteria
                  </span>
                )}
              </div>
              {/* Counts on a model this install does not serve are zero because
                  its hierarchy was never imported, which is correct. Printing
                  them under a lifecycle status made a banking standard look live
                  and broken on a pet rescue (BI-C44EAEE6). */}
              {model.applies ? (
                <div className="mt-3 flex gap-3 text-[11px] text-[var(--dpf-muted)]">
                  <span>{model.assessmentCount} assessments</span>
                  <span>{model.proposalCount} proposals</span>
                </div>
              ) : (
                <p className="mt-3 text-dpf-caption text-[var(--dpf-muted)]">
                  {model.applicabilityReason}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

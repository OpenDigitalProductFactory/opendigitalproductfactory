import { BootstrapBindingsButton } from "./BootstrapBindingsButton";
import type { BootstrapAuthorityBindingsReport } from "@/lib/authority/bootstrap-bindings";

type BindingBootstrapPanelProps = {
  autoApplied: boolean;
  totalBindings?: number | null;
  report: BootstrapAuthorityBindingsReport;
};

const WARNING_REASON_COPY: Record<string, string> = {
  "ungated-route": "Route is not capability-gated yet.",
  "missing-agent": "Mapped coworker identity could not be resolved.",
  "missing-subjects": "Subject mapping could not be inferred from current authority data.",
};

export function BindingBootstrapPanel({
  autoApplied,
  totalBindings,
  report,
}: BindingBootstrapPanelProps) {
  const isEmpty = (totalBindings ?? 0) === 0 && report.created === 0;
  const hasLowConfidence = report.lowConfidence.length > 0;

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Bootstrap coverage</h3>
          <p className="text-xs text-[var(--dpf-muted)]">
            Authority bindings are inferred from current route-to-coworker mappings and human access layers. Review
            anything we could not infer confidently before assuming the control plane is complete.
          </p>
        </div>
        <BootstrapBindingsButton />
      </div>

      {autoApplied ? (
        <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text)]">
          <div className="font-medium">Auto-applied initial authority binding bootstrap</div>
          <div className="mt-1 text-xs text-[var(--dpf-muted)]">
            Created {report.created} binding(s) and skipped {report.skippedExisting} existing record(s) during first-run
            setup.
          </div>
        </div>
      ) : null}

      {isEmpty ? (
        <div className="rounded-xl border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text)]">
          <div className="font-medium">No authority bindings are active yet</div>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            This environment still needs an initial binding pass or manual binding creation before route and coworker
            access can be centrally reviewed here.
          </p>
        </div>
      ) : null}

      {!autoApplied && report.wouldCreate > 0 ? (
        <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text)]">
          <div className="font-medium">Additional inferred bindings available</div>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            A fresh inference pass can create {report.wouldCreate} more binding(s) from current route mappings without
            changing existing shared binding records.
          </p>
        </div>
      ) : null}

      {hasLowConfidence ? (
        <div className="space-y-2">
          <div>
            <h4 className="text-sm font-semibold text-[var(--dpf-text)]">Manual review needed</h4>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              These routes or coworker mappings were intentionally skipped because the authority source of truth was not
              strong enough to infer a safe binding.
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-[var(--dpf-border)]">
            <table className="w-full border-collapse text-left text-sm text-[var(--dpf-text)]">
              <thead className="bg-[var(--dpf-surface-2)] text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Resource</th>
                  <th className="px-3 py-2 font-medium">Coworker</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {report.lowConfidence.map((warning) => (
                  <tr key={`${warning.resourceRef}:${warning.agentId ?? "none"}:${warning.reason}`} className="border-t border-[var(--dpf-border)]">
                    <td className="px-3 py-2">{warning.resourceRef}</td>
                    <td className="px-3 py-2">{warning.agentId ?? "Unassigned"}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">
                      {WARNING_REASON_COPY[warning.reason] ?? warning.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

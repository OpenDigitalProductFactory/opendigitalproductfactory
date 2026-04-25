import type { BuildFlowState } from "@/lib/build-flow-state";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import {
  describePromoteFork,
  describeReleaseReadiness,
  describeUpstreamFork,
  type ReleaseDecisionSummary,
  type ReleaseDecisionTone,
} from "@/lib/build/release-decision";

type Props = {
  build: FeatureBuildRow;
  flowState: BuildFlowState | null;
};

const TONE_CLASSNAMES: Record<ReleaseDecisionTone, string> = {
  neutral: "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)]",
  info: "border-[color-mix(in_srgb,#3b82f6_35%,var(--dpf-border))] bg-[color-mix(in_srgb,#3b82f6_10%,var(--dpf-surface-1))] text-[#3b82f6]",
  success: "border-[color-mix(in_srgb,#22c55e_35%,var(--dpf-border))] bg-[color-mix(in_srgb,#22c55e_10%,var(--dpf-surface-1))] text-[#22c55e]",
  warning: "border-[color-mix(in_srgb,#f59e0b_35%,var(--dpf-border))] bg-[color-mix(in_srgb,#f59e0b_10%,var(--dpf-surface-1))] text-[#f59e0b]",
  danger: "border-[color-mix(in_srgb,#ef4444_35%,var(--dpf-border))] bg-[color-mix(in_srgb,#ef4444_10%,var(--dpf-surface-1))] text-[#ef4444]",
};

export function ReleaseDecisionPanel({ build, flowState }: Props) {
  const upstream = describeUpstreamFork(flowState?.upstream ?? {
    state: "pending",
    prUrl: null,
    prNumber: null,
    packId: null,
    errorMessage: null,
  });
  const readiness = describeReleaseReadiness(build, flowState);
  const promote = describePromoteFork(flowState?.promote ?? {
    state: "pending",
    promotionId: null,
    deployedAt: null,
    scheduleDescription: null,
    rollbackReason: null,
    errorMessage: null,
  });

  return (
    <section
      className="rounded-[20px] border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3"
      data-testid="release-decision-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Release Lanes</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">
            End-of-flow status stays compact here; select the ship stage or end nodes in the workflow for full detail.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 xl:grid-cols-3">
        <ReleaseCard summary={upstream}>
          {upstream.href && (
            <a
              href={upstream.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--dpf-accent)] hover:underline"
            >
              View pull request
            </a>
          )}
        </ReleaseCard>

        <ReleaseCard summary={readiness}>
          {build.sandboxPort != null && (
            <a
              href={`http://localhost:${build.sandboxPort}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--dpf-accent)] hover:underline"
            >
              Open sandbox preview
            </a>
          )}
        </ReleaseCard>

        <ReleaseCard summary={promote}>
          {flowState?.promote.promotionId && (
            <div className="text-[11px] text-[var(--dpf-muted)]">
              Promotion record: <span className="font-mono text-[var(--dpf-text)]">{flowState.promote.promotionId}</span>
            </div>
          )}
        </ReleaseCard>
      </div>
    </section>
  );
}

function ReleaseCard({
  summary,
  children,
}: {
  summary: ReleaseDecisionSummary;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-3 shadow-dpf-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--dpf-text)]">{summary.title}</div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--dpf-muted)]">{summary.detail}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${TONE_CLASSNAMES[summary.tone]}`}>
          {summary.statusLabel}
        </span>
      </div>

      {summary.artifacts.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {summary.artifacts.slice(0, 1).map((artifact) => (
            <div
              key={artifact}
              className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-2 text-[11px] text-[var(--dpf-text)]"
            >
              {artifact}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 text-[11px] leading-relaxed text-[var(--dpf-muted)]">
        <span className="font-semibold uppercase tracking-[0.05em]">Next</span> {summary.nextAction}
      </div>

      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

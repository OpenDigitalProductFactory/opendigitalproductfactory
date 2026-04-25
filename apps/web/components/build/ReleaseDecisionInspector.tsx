"use client";

import { useCallback, useEffect } from "react";
import type { BuildFlowState } from "@/lib/build-flow-state";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import {
  describePromoteFork,
  describeUpstreamFork,
} from "@/lib/build/release-decision";
import { WorkflowDetailPanel } from "./WorkflowDetailPanel";

type Props = {
  build: FeatureBuildRow;
  flowState: BuildFlowState;
  forkKind: "upstream" | "promote";
  onClose: () => void;
};

export function ReleaseDecisionInspector({
  build,
  flowState,
  forkKind,
  onClose,
}: Props) {
  const summary = forkKind === "upstream"
    ? describeUpstreamFork(flowState.upstream)
    : describePromoteFork(flowState.promote);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <WorkflowDetailPanel
      eyebrow="Release Decision"
      title={summary.title}
      subtitle="Review the outcome, linked artifacts, and next governed action without leaving the workflow."
      onClose={onClose}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
        <div className="space-y-4">
          <InfoSection label="Current Status">
            <p className="text-sm leading-relaxed text-[var(--dpf-text)]">
              {summary.statusLabel}
            </p>
          </InfoSection>

          <InfoSection label="What Happened">
            <p className="text-sm leading-relaxed text-[var(--dpf-text)]">
              {summary.detail}
            </p>
          </InfoSection>

          <InfoSection label="Next Action">
            <p className="text-sm leading-relaxed text-[var(--dpf-text)]">
              {summary.nextAction}
            </p>
          </InfoSection>
        </div>

        <div className="space-y-4">
          {summary.artifacts.length > 0 ? (
            <InfoSection label="Related Artifacts">
              <div className="space-y-2">
                {summary.artifacts.map((line) => (
                  <div
                    key={line}
                    className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
                  >
                    {line}
                  </div>
                ))}
              </div>
            </InfoSection>
          ) : null}

          {summary.href ? (
            <InfoSection label="External Link">
              <a
                href={summary.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-[var(--dpf-accent)] hover:underline"
              >
                Open pull request
              </a>
            </InfoSection>
          ) : null}

          {forkKind === "promote" && flowState.promote.promotionId ? (
            <InfoSection label="Operational Change">
              <p className="text-sm leading-relaxed text-[var(--dpf-text)]">
                Promotion {flowState.promote.promotionId} is the governed production-change record for this build.
              </p>
            </InfoSection>
          ) : null}

          {forkKind === "upstream" && build.product ? (
            <InfoSection label="Linked Product">
              <p className="text-sm leading-relaxed text-[var(--dpf-text)]">
                {build.product.productId} v{build.product.version}
              </p>
            </InfoSection>
          ) : null}
        </div>
      </div>
    </WorkflowDetailPanel>
  );
}

function InfoSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--dpf-muted)]">
        {label}
      </div>
      {children}
    </section>
  );
}

// apps/web/components/workspace-home/WorkspaceTwinPanel.tsx
//
// The operational twin as it renders on the /workspace hero (EP-LIVING-BUSINESS-VIZ
// P3, increment 2). A thin wrapper over the sibling-owned `TwinView`: it adds the
// honest "demo data" badge and nothing else. `TwinView` is a client component; this
// server component renders it with serializable props.
//
// Plan: docs/superpowers/plans/2026-07-15-twin-workspace-home-placement-execution.md

import { TwinView } from "@/components/twin";
import type { WorkspaceTwinPresentation } from "@/lib/workspace-home/twin-panel-data";

export interface WorkspaceTwinPanelProps {
  presentation: WorkspaceTwinPresentation;
  className?: string;
}

export function WorkspaceTwinPanel({ presentation, className = "" }: WorkspaceTwinPanelProps) {
  return (
    <div className={`flex flex-col gap-3 ${className}`.trim()}>
      {presentation.demo ? (
        <p
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--dpf-muted)]"
          data-testid="twin-demo-badge"
        >
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--dpf-muted)]"
          />
          Demo data — live business projection pending
        </p>
      ) : null}
      <TwinView profile={presentation.profile} snapshot={presentation.snapshot} />
    </div>
  );
}

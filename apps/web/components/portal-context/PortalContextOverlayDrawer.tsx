"use client";

import { X } from "lucide-react";

import type { PortalContextEnvelope } from "@/lib/portal-context";
import { EvidenceSummaryList } from "./EvidenceSummaryList";
import { HiveMindCandidateList } from "./HiveMindCandidateList";
import { PortalContextSummaryRows } from "./PortalContextSummaryRows";
import { PortalContextTabs } from "./PortalContextTabs";

export function PortalContextOverlayDrawer({
  envelope,
  open,
  onClose,
}: {
  envelope: PortalContextEnvelope | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!envelope || !open) return null;

  return (
    <aside
      aria-label="Portal context overlay"
      // Dock to the LEFT of the AI coworker panel instead of underneath it.
      // The coworker panel (z-50) docks to the viewport's right edge on desktop
      // and reserves a gutter via --agent-panel-reserved-width — the same gutter
      // the shell content honors in (shell)/layout.tsx. Offsetting our right
      // edge by that gutter lets both panels sit side by side rather than
      // overlapping. When the coworker is closed or floating the gutter is 0px
      // and we fall back to the right edge. z-[60] keeps the drawer above the
      // coworker tier (z-50) for the narrow-viewport floating case, where there
      // is no gutter to offset around, while staying below the z-[80] banner
      // overlay tier.
      style={{ right: "var(--agent-panel-reserved-width, 0px)" }}
      className="fixed inset-y-0 z-[60] flex w-full max-w-xl flex-col border-l border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] shadow-xl transition-[right] duration-200"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--dpf-border)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-[var(--dpf-text)]">Portal context</h2>
          <p className="truncate text-xs text-[var(--dpf-muted)]">{envelope.envelopeId}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close portal context"
          className="grid h-10 w-10 place-items-center rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] transition-colors hover:text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <PortalContextTabs
          tabs={[
            {
              id: "context",
              label: "Context",
              panel: <PortalContextSummaryRows envelope={envelope} />,
            },
            {
              id: "work",
              label: "Work",
              panel: <PortalContextSummaryRows envelope={envelope} />,
            },
            {
              id: "hive",
              label: "Hive",
              panel: (
                <HiveMindCandidateList
                  candidates={envelope.coworkers}
                  work={envelope.work}
                  authority={envelope.authority}
                  routeContext={envelope.route.routeContext}
                  envelopeId={envelope.envelopeId}
                />
              ),
            },
            {
              id: "evidence",
              label: "Evidence",
              panel: <EvidenceSummaryList evidence={envelope.evidence} />,
            },
          ]}
        />
      </div>
    </aside>
  );
}

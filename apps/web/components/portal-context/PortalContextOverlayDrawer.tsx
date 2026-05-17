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
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] shadow-xl"
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
              panel: <HiveMindCandidateList candidates={envelope.coworkers} />,
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

"use client";

// apps/web/components/twin/CogBanner.tsx
//
// Primitive 6/10 — the cog: an AI coworker's allocation proposal over live state,
// following the constraint → proposal → confirm loop (seat-from-dwell-time /
// nearest-tech-by-travel / best-asset-by-readiness). This is the ONE inherently
// interactive primitive: HITL is mandatory on every cog action (parent spec §3),
// so the proposal is never auto-applied — a human taps Confirm.
//
// Client because it owns the confirm/dismiss interaction; the surrounding twin
// stays server-rendered.

import { Bot, Check, X } from "lucide-react";

export interface CogBannerProps {
  /** The proposed allocation, e.g. "Seat the Nguyen party (4) at Table 12". */
  proposal: string;
  /** The live signals the proposal is derived from (dwell-time, travel-time…). */
  signals: string[];
  /** Label of the AI coworker making the proposal. */
  cogLabel?: string;
  confirmLabel?: string;
  onConfirm?: () => void;
  onDismiss?: () => void;
  /** Confirmed/handled — collapses to an attributed, non-actionable state. */
  resolved?: boolean;
}

export function CogBanner({
  proposal,
  signals,
  cogLabel = "AI coworker",
  confirmLabel = "Confirm",
  onConfirm,
  onDismiss,
  resolved,
}: CogBannerProps) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border p-3"
      style={{
        borderColor: "var(--dpf-accent)",
        backgroundColor: "var(--dpf-accent-soft)",
      }}
      data-resolved={resolved ? "true" : undefined}
    >
      <div className="flex items-start gap-2">
        <Bot aria-hidden size={16} style={{ color: "var(--dpf-accent)" }} className="mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--dpf-accent)]">
            {cogLabel} suggests
          </span>
          <span className="text-sm font-medium text-[var(--dpf-text)]">{proposal}</span>
        </div>
      </div>

      {signals.length > 0 ? (
        <div className="flex flex-wrap gap-1 pl-6">
          {signals.map((s) => (
            <span
              key={s}
              className="rounded-full border border-[var(--dpf-accent)] px-1.5 py-0.5 text-[10px] text-[var(--dpf-accent)]"
            >
              {s}
            </span>
          ))}
        </div>
      ) : null}

      {resolved ? (
        <span className="inline-flex items-center gap-1 pl-6 text-[11px] text-[var(--dpf-success)]">
          <Check aria-hidden size={12} /> Confirmed
        </span>
      ) : (
        <div className="flex items-center gap-2 pl-6">
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-[var(--dpf-surface-1)]"
            style={{ backgroundColor: "var(--dpf-accent)" }}
          >
            <Check aria-hidden size={13} />
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          >
            <X aria-hidden size={13} />
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

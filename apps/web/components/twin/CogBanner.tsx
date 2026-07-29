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
  status?: "idle" | "pending" | "confirmed" | "conflict" | "rejected" | "unsupported";
  statusMessage?: string;
  /** Conflict-safe choices returned by the durable operations provider. */
  alternatives?: readonly string[];
  /** @deprecated Use status="confirmed". Preserved for existing callers. */
  resolved?: boolean;
}

export function CogBanner({
  proposal,
  signals,
  cogLabel = "AI coworker",
  confirmLabel = "Confirm",
  onConfirm,
  onDismiss,
  status = onConfirm ? "idle" : "unsupported",
  statusMessage,
  alternatives = [],
  resolved,
}: CogBannerProps) {
  const effectiveStatus = resolved ? "confirmed" : status;
  const actionable = effectiveStatus === "idle" || effectiveStatus === "conflict";
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border p-3"
      style={{
        borderColor: "var(--dpf-accent)",
        backgroundColor: "var(--dpf-accent-soft)",
      }}
      data-resolved={effectiveStatus === "confirmed" ? "true" : undefined}
      data-command-status={effectiveStatus}
    >
      <div className="flex items-start gap-2">
        <Bot aria-hidden size={16} style={{ color: "var(--dpf-accent)" }} className="mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <span className="text-dpf-caption font-semibold uppercase tracking-[0.14em] text-[var(--dpf-accent)]">
            {cogLabel} suggests
          </span>
          <span className="text-dpf-body font-medium text-[var(--dpf-text)]">{proposal}</span>
        </div>
      </div>

      {signals.length > 0 ? (
        <div className="flex flex-wrap gap-1 pl-6">
          {signals.map((s) => (
            <span
              key={s}
              className="rounded-full border border-[var(--dpf-accent)] px-1.5 py-0.5 text-dpf-caption text-[var(--dpf-accent)]"
            >
              {s}
            </span>
          ))}
        </div>
      ) : null}

      {effectiveStatus === "confirmed" ? (
        <span className="inline-flex items-center gap-1 pl-6 text-dpf-caption text-[var(--dpf-success)]">
          <Check aria-hidden size={12} /> Confirmed
        </span>
      ) : (
        <div className="flex flex-col gap-1.5 pl-6">
          {effectiveStatus !== "idle" ? (
            <span className="text-dpf-caption text-[var(--dpf-muted)]" role="status">
              {statusMessage ??
                (effectiveStatus === "pending"
                  ? "Assigning…"
                  : effectiveStatus === "conflict"
                    ? "The operation changed. Review the latest state and try again."
                    : effectiveStatus === "rejected"
                      ? "This assignment was not applied."
                      : "Connect an operations command provider before assigning.")}
            </span>
          ) : null}
          {effectiveStatus === "conflict" && alternatives.length > 0 ? (
            <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1.5">
              <span className="text-dpf-caption font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
                Available alternatives
              </span>
              <ul className="mt-1 list-disc pl-4 text-dpf-caption text-[var(--dpf-text-secondary)]">
                {alternatives.map((alternative) => (
                  <li key={alternative}>{alternative}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={!actionable || !onConfirm}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-dpf-caption font-medium text-[var(--dpf-surface-1)]"
              style={{ backgroundColor: "var(--dpf-accent)" }}
            >
              <Check aria-hidden size={13} />
              {effectiveStatus === "pending"
                ? "Assigning…"
                : effectiveStatus === "unsupported"
                  ? "Command unavailable"
                  : effectiveStatus === "conflict"
                    ? "Try again"
                    : confirmLabel}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--dpf-border)] px-2 py-1 text-dpf-caption text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            >
              <X aria-hidden size={13} />
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

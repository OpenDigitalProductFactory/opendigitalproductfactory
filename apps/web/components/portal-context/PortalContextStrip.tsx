"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Network, Users } from "lucide-react";

import type { AttentionSignal, PortalContextEnvelope } from "@/lib/portal-context";
import { PortalContextOverlayDrawer } from "./PortalContextOverlayDrawer";

export function PortalContextStrip({ envelope }: { envelope: PortalContextEnvelope | null }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  if (!envelope) return null;

  const primarySignal = envelope.attention[0] ?? null;
  const buildLabel = envelope.work.featureBuild?.buildId ?? "No active build";
  const capsuleLabel = envelope.work.capsule?.capsuleId ?? "No capsule";
  // D11 (2026-05-23): suppress the AttentionChip rendering when it would
  // duplicate the "No active build" text already shown in the buildLabel
  // chip to its left. The chip's job is to carry build identity; when
  // there is no build, the chip says so — adding a yellow warning chip
  // with the same text was straight duplication that made the strip
  // look broken. We KEEP the right-side action button (e.g. "Select
  // build") because that button is genuinely useful — it just shouldn't
  // be paired with a redundant warning chip on the left.
  const showAttentionChip = !(
    primarySignal?.kind === "no_active_build" && !envelope.work.featureBuild
  );

  return (
    <div className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-2 text-[var(--dpf-text)]" data-testid="portal-context-strip">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-normal text-[var(--dpf-muted)]">
            <Network className="h-4 w-4" aria-hidden="true" />
            Portal context
          </span>
          <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs font-medium text-[var(--dpf-text)]">
            {envelope.route.domain}
          </span>
          <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]">
            {buildLabel}
          </span>
          <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]">
            {capsuleLabel}
          </span>
          {primarySignal && showAttentionChip && <AttentionChip signal={primarySignal} />}
        </div>

        <div className="flex items-center gap-2">
          {primarySignal?.actionHref && primarySignal.actionLabel && (
            <Link
              href={primarySignal.actionHref}
              className="inline-flex min-h-10 items-center rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm font-medium text-[var(--dpf-accent)] transition-colors hover:border-[var(--dpf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
            >
              {primarySignal.actionLabel}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            Open context
          </button>
        </div>
      </div>

      <PortalContextOverlayDrawer
        envelope={envelope}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}

function AttentionChip({ signal }: { signal: AttentionSignal }) {
  return (
    <span className={[
      "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium",
      severityClassName(signal.severity),
    ].join(" ")}>
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      {signalLabel(signal)}
    </span>
  );
}

function severityClassName(severity: AttentionSignal["severity"]): string {
  if (severity === "error") return "border-[var(--dpf-error)] bg-[var(--dpf-state-error)] text-[var(--dpf-error)]";
  if (severity === "warning") return "border-[var(--dpf-warning)] bg-[var(--dpf-state-warning)] text-[var(--dpf-warning)]";
  return "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-info)]";
}

function signalLabel(signal: AttentionSignal): string {
  if (signal.kind === "no_active_build") return "No active build";
  if (signal.kind === "capsule_not_linked") return "Capsule not linked";
  if (signal.kind === "missing_evidence") return "Missing evidence";
  if (signal.kind === "lease_expired") return "Lease expired";
  return signal.kind.replace(/_/g, " ");
}

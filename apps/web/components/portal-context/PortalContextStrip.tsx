"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Network, Users } from "lucide-react";

import type {
  AttentionSignal,
  FeatureBuildAnchor,
  PortalContextEnvelope,
  WorkCapsuleAnchor,
} from "@/lib/portal-context";
import { PortalContextOverlayDrawer } from "./PortalContextOverlayDrawer";

type PortalContextStripProps = {
  envelope: PortalContextEnvelope | null;
  contextLabel?: string;
  showInternalIds?: boolean;
};

export function PortalContextStrip({
  envelope,
  contextLabel = "Portal context",
  showInternalIds = true,
}: PortalContextStripProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  if (!envelope) return null;

  const primarySignal = envelope.attention[0] ?? null;
  const buildLabel = formatBuildLabel(envelope.work.featureBuild ?? null, showInternalIds);
  const capsuleLabel = formatCapsuleLabel(envelope.work.capsule ?? null, showInternalIds);
  // D11 (2026-05-23): suppress the AttentionChip rendering when it would
  // duplicate the "No build selected" text already shown in the buildLabel
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
            {contextLabel}
          </span>
          <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs font-medium text-[var(--dpf-text)]">
            {envelope.route.domain}
          </span>
          <span
            className="inline-block max-w-[18rem] truncate rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]"
            title={formatBuildTitle(envelope.work.featureBuild ?? null, showInternalIds)}
            data-testid="portal-context-build-label"
          >
            {buildLabel}
          </span>
          <span
            className="inline-block max-w-[18rem] truncate rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-muted)]"
            title={formatCapsuleTitle(envelope.work.capsule ?? null, showInternalIds)}
            data-testid="portal-context-capsule-label"
          >
            {capsuleLabel}
          </span>
          {primarySignal && showAttentionChip && (
            <AttentionChip signal={primarySignal} showInternalIds={showInternalIds} />
          )}
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

function formatBuildLabel(build: FeatureBuildAnchor | null, showInternalIds: boolean): string {
  // BI-AC156613: the strip reflects the work object ANCHORED in the URL, not
  // system-wide activity. On list/control routes (e.g. /build/work) nothing is
  // anchored, so this renders. "No active build" read as an activity claim and
  // contradicted the page's own "Active capsules: N" count directly below it —
  // "No build selected" states the true (selection) meaning without the clash.
  if (!build) return "No build selected";
  if (showInternalIds) return build.buildId;
  return build.title || "Active build";
}

function formatCapsuleLabel(capsule: WorkCapsuleAnchor | null, showInternalIds: boolean): string {
  if (!capsule) return "No workroom selected";
  if (showInternalIds) return capsule.capsuleId;
  return capsule.title || "Workroom";
}

function formatBuildTitle(build: FeatureBuildAnchor | null, showInternalIds: boolean): string | undefined {
  if (!build) return undefined;
  if (showInternalIds) return `${build.title || "Active build"} (${build.buildId})`;
  return build.title || "Active build";
}

function formatCapsuleTitle(capsule: WorkCapsuleAnchor | null, showInternalIds: boolean): string | undefined {
  if (!capsule) return undefined;
  if (showInternalIds) return `${capsule.title || "Workroom"} (${capsule.capsuleId})`;
  return capsule.title || "Workroom";
}

function AttentionChip({
  signal,
  showInternalIds,
}: {
  signal: AttentionSignal;
  showInternalIds: boolean;
}) {
  return (
    <span className={[
      "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium",
      severityClassName(signal.severity),
    ].join(" ")}>
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      {signalLabel(signal, showInternalIds)}
    </span>
  );
}

function severityClassName(severity: AttentionSignal["severity"]): string {
  if (severity === "error") return "border-[var(--dpf-error)] bg-[var(--dpf-state-error)] text-[var(--dpf-error)]";
  if (severity === "warning") return "border-[var(--dpf-warning)] bg-[var(--dpf-state-warning)] text-[var(--dpf-warning)]";
  return "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-info)]";
}

function signalLabel(signal: AttentionSignal, showInternalIds: boolean): string {
  if (signal.kind === "no_active_build") return "No build selected";
  if (signal.kind === "capsule_not_linked") return "Workroom not linked";
  if (signal.kind === "missing_evidence") return showInternalIds ? "Missing evidence" : "Waiting on you";
  if (signal.kind === "lease_expired") return "Lease expired";
  return signal.kind.replace(/_/g, " ");
}

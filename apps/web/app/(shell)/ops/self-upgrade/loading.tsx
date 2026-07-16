import { OpsTabNav } from "@/components/ops/OpsTabNav";

/**
 * Instant Suspense fallback for the Self-Upgrade route (BI-4A400DE4).
 *
 * page.tsx blocks on a fan-out of ~5 loaders (status + ~10 DB queries, run
 * history, dev config, the git-backed local-changes ledger, the impact summary)
 * before it can return any markup — making it by far the heaviest /ops render
 * (~25-30x the sibling tabs). When the host is saturated by the portal's agent
 * subprocesses that render degrades to tens of seconds, and with no streaming
 * boundary the operator saw a blank page that "won't come up". This file is that
 * boundary: Next renders it immediately so the shell, heading, and tab nav paint
 * at once and the data streams in underneath. The page is responsive under load
 * instead of hanging.
 */

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] ${className}`}
      aria-hidden
    />
  );
}

export default function SelfUpgradeLoading() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Self-Upgrade</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Automated portal self-upgrade status and controls.
        </p>
      </div>

      <OpsTabNav />

      <div className="mt-6 space-y-4" aria-busy="true" aria-label="Loading self-upgrade status">
        <SkeletonBlock className="h-20" />
        <SkeletonBlock className="h-32" />
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-40" />
      </div>
    </div>
  );
}

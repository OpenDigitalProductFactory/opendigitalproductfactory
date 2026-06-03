"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

type Props = {
  pendingVersion: string;
};

const STORAGE_PREFIX = "dpf:update-pending-banner-collapsed:";

export function UpdatePendingBannerClient({ pendingVersion }: Props) {
  const versionLabel = formatPendingVersion(pendingVersion);
  const storageKey = useMemo(() => `${STORAGE_PREFIX}${pendingVersion}`, [pendingVersion]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(storageKey) === "true");
    } catch {
      setCollapsed(false);
    }
  }, [storageKey]);

  function updateCollapsed(next: boolean) {
    setCollapsed(next);
    try {
      window.localStorage.setItem(storageKey, String(next));
    } catch {
      /* localStorage may be unavailable in private contexts */
    }
  }

  if (collapsed) {
    return (
      <button
        type="button"
        aria-expanded="false"
        aria-label="Expand platform update banner"
        onClick={() => updateCollapsed(false)}
        className="pointer-events-auto flex max-w-[calc(100vw-24px)] items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs font-medium text-[var(--dpf-text)] shadow-[0_10px_30px_color-mix(in_srgb,var(--dpf-text)_14%,transparent)]"
      >
        <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 text-[var(--dpf-accent)]" />
        <span className="max-w-[min(72vw,40rem)] truncate">Platform update {versionLabel}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-[var(--dpf-muted)]" />
      </button>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-overlay-banner="true"
      className="pointer-events-auto w-[min(960px,calc(100vw-24px))] rounded-md border border-[color-mix(in_srgb,var(--dpf-accent)_34%,var(--dpf-border))] bg-[color-mix(in_srgb,var(--dpf-accent)_12%,var(--dpf-surface-1))] px-3 py-2 text-xs text-[var(--dpf-text)] shadow-[0_10px_30px_color-mix(in_srgb,var(--dpf-text)_14%,transparent)]"
    >
      <div className="flex items-center gap-2">
        <RefreshCw aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--dpf-accent)]" />
        <div className="min-w-0 flex-1">
          <span className="font-medium">Platform update {versionLabel} is ready.</span>{" "}
          <span className="text-[var(--dpf-muted)]">Your customisations are preserved.</span>{" "}
          <Link
            href="/admin/platform-development"
            className="font-medium text-[var(--dpf-accent)] underline underline-offset-2"
          >
            Review in Admin - Platform Development
          </Link>
        </div>
        <button
          type="button"
          aria-expanded="true"
          aria-label="Collapse platform update banner"
          title="Collapse platform update banner"
          onClick={() => updateCollapsed(true)}
          className="shrink-0 rounded p-1 text-[var(--dpf-muted)] transition hover:bg-[var(--dpf-surface-2)] hover:text-[var(--dpf-text)]"
        >
          <ChevronUp aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Render a user-facing label for the pending platform version.
 *
 * BI-EC26D09D (D7): Dale saw "Platform update v<64-char-bundle-hash> is
 * ready." at the top of every page — the raw bundle hash was the literal
 * first thing he read above the fold after login. The prior implementation
 * left 40-char SHAs full-length and silently fell through to `v<...>` for
 * anything longer (e.g. 64-char sha256 bundle hashes), so the banner shipped
 * the full hex blob.
 *
 * Now: semver passes through; any hex string ≥ 8 chars is truncated to its
 * git-style 8-char short form (`update-2e89dd8a…`) so the banner reads as a
 * recognisable build identifier rather than a wall of hex. Storage key,
 * collapse state, and the underlying `pendingVersion` prop are unchanged —
 * only the visible label shortens.
 */
export function formatPendingVersion(pendingVersion: string): string {
  if (/^v\d+\.\d+\.\d+$/i.test(pendingVersion)) return pendingVersion;
  const hex = pendingVersion.match(/^([0-9a-f]+)$/i);
  if (hex && hex[1].length >= 8) {
    return `update-${hex[1].slice(0, 8)}…`;
  }
  return `v${pendingVersion}`;
}

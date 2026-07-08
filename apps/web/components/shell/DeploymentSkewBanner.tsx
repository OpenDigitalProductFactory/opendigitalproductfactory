"use client";

/**
 * DeploymentSkewBanner — global recovery prompt for a browser tab left open
 * across a self-upgrade container swap (BI-F381D902).
 *
 * DPF self-upgrades autonomously, so every long-lived tab eventually crosses a
 * deployment boundary and its next server action fails ("Failed to find Server
 * Action … from an older or newer deployment"). The crash boundary
 * (app/(shell)/error.tsx, BI-D22D4607) already auto-reloads once — but only for
 * errors that BUBBLE UP to it. The coworker composer and other surfaces catch
 * the failure locally and flip to a "failed" state, so the boundary never sees
 * it and the user is left with a dead button and no hint.
 *
 * This sentinel closes that gap without duplicating the reload logic:
 *   1. Reactive — listens for skew errors at the window level (`error` and
 *      `unhandledrejection`), covering the throws that aren't swallowed.
 *   2. Proactive — compares the tab's boot identity (window.__DPF_BOOT__)
 *      against the running deployment (/api/internal/quiescence-state) shortly
 *      after mount, on every tab refocus, and on a slow poll while the tab is
 *      visible. This catches the SWALLOWED case (a stale tab is detectable even
 *      when no error surfaces) including a tab that stayed focused through the
 *      swap and never re-fired a visibility event.
 *
 * On detection it shows a friendly, non-dismissible "Reload to continue"
 * banner. Reload is user-initiated (a button, not an auto-reload) so a
 * half-typed message or unsaved input is never discarded out from under the
 * user, and there is no reload-loop risk.
 */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  fetchServedIdentity,
  isBundleMismatch,
  isDeploymentSkewReason,
  readBootIdentity,
} from "@/lib/deployment-skew";

export function DeploymentSkewBanner(): React.ReactElement | null {
  const [skewed, setSkewed] = useState(false);

  const checkServedIdentity = useCallback(async () => {
    // Only meaningful once we have a known boot identity to compare against;
    // in `next dev` boot is "unknown" and isBundleMismatch never fires.
    const boot = readBootIdentity();
    if (!boot) return;
    const served = await fetchServedIdentity();
    if (isBundleMismatch(boot, served)) setSkewed(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const trip = () => {
      if (!cancelled) setSkewed(true);
    };

    const onError = (event: ErrorEvent) => {
      if (isDeploymentSkewReason(event)) trip();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isDeploymentSkewReason(event.reason)) trip();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkServedIdentity();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    document.addEventListener("visibilitychange", onVisibility);

    // One proactive check shortly after mount catches a tab that was already
    // stale before this sentinel loaded (e.g. reopened after the swap).
    const initialCheck = window.setTimeout(() => void checkServedIdentity(), 2_000);

    // Slow poll while visible closes the focused-through-swap case: a tab that
    // never blurs and swallows its server-action error would otherwise never
    // learn it is stale. Only fetches when visible, so a backgrounded tab costs
    // nothing.
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkServedIdentity();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearTimeout(initialCheck);
      window.clearInterval(poll);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkServedIdentity]);

  if (!skewed) return null;

  return (
    <div
      role="alert"
      data-testid="deployment-skew-banner"
      className="pointer-events-auto flex w-[min(960px,calc(100vw-24px))] flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-[var(--dpf-warning)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs text-[var(--dpf-text)] shadow-[0_10px_30px_color-mix(in_srgb,var(--dpf-text)_14%,transparent)]"
    >
      <RefreshCw aria-hidden="true" className="size-4 shrink-0 text-[var(--dpf-warning)]" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">The platform was updated in the background.</p>
        <p className="text-[var(--dpf-muted)]">
          This page is running an older version. Reload to continue — anything you were typing may be
          lost, so copy it first if you need to.
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded border border-[var(--dpf-warning)] bg-[color-mix(in_srgb,var(--dpf-warning)_12%,var(--dpf-surface-1))] px-3 py-1 font-medium text-[var(--dpf-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--dpf-warning)_20%,var(--dpf-surface-1))] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-warning)]"
      >
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Reload to continue
      </button>
    </div>
  );
}

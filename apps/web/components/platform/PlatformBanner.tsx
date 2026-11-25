"use client";

/**
 * PlatformBanner — operator-facing banner for Activity Quiescence Protocol
 * drain windows (BI-QUIESCE-006).
 *
 * Mounted in (shell)/layout.tsx (authenticated routes only — anonymous
 * storefront doesn't need to see operator-facing maintenance state).
 *
 * Subscribes to /api/agent/system-stream for system:quiescence events.
 * State machine (spec §7.3):
 *   hidden → preparing → swapping → reconnecting → hidden
 *   alternate: → deferred-or-aborted → hidden (after dismiss / 60s)
 *
 * Bundle-hash mismatch detection: on receiving the cleared/succeeded
 * event, polls /api/internal/quiescence-state and compares the version
 * + bundleHash to window.__DPF_BOOT__. Mismatch → soft reload after 1s.
 */

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Info,
  RefreshCw,
  X,
} from "lucide-react";
import { useSystemEvent } from "@/lib/hooks/system-events";
import { useT } from "@/lib/i18n/use-t";
import { useMessagesContext } from "@/lib/i18n/messages-context";

type BannerState =
  | { kind: "hidden" }
  | { kind: "preparing"; runId: string; swapEtaSeconds: number | null; deadline?: string }
  | { kind: "swapping"; runId: string; deadline?: string }
  | { kind: "reconnecting"; runId: string }
  | { kind: "deferred"; reason: string | null; surface: string | null };

type SystemQuiescenceEvent = {
  type: "system:quiescence";
  level: "draining" | "swapping" | "cleared";
  runId: string;
  swapEtaSeconds: number | null;
  readyToSwapDeadlineAt?: string;
  deferReason: string | null;
  deferSurface: string | null;
  outcome: "draining" | "swapping" | "succeeded" | "deferred" | "aborted" | "failed";
};

type BootGlobal = { version: string; bundleHash: string };

declare global {
  interface Window {
    __DPF_BOOT__?: BootGlobal;
  }
}

export function PlatformBanner(): React.ReactElement | null {
  const t = useT("shell");
  const { locale, formatLocale } = useMessagesContext();
  const [state, setState] = useState<BannerState>({ kind: "hidden" });
  const [collapsed, setCollapsed] = useState(false);
  const activeOwner = useRef<string | null>(null);
  const eventRevision = useRef(0);

  // The shell-owned SystemEventProvider holds the one resilient system stream
  // for this tab. Banner, readiness, and live-operation consumers fan out from
  // it without consuming additional HTTP/1.1 connection slots.
  useSystemEvent("system:quiescence", (event: SystemQuiescenceEvent) => {
      if (event.level === "cleared" && activeOwner.current && activeOwner.current !== event.runId) return;
      const revision = ++eventRevision.current;
      activeOwner.current = event.level === "cleared" ? null : event.runId;
      if (event.level === "draining") {
        setState({ kind: "preparing", runId: event.runId, swapEtaSeconds: event.swapEtaSeconds, deadline: event.readyToSwapDeadlineAt });
      } else if (event.level === "swapping") {
        setState({ kind: "swapping", runId: event.runId, deadline: event.readyToSwapDeadlineAt });
      } else if (event.level === "cleared") {
        if (event.outcome === "succeeded") {
          // Show reconnecting state, then check for bundle-hash mismatch.
          setState({ kind: "reconnecting", runId: event.runId });
          void detectBundleMismatchAndReload();
        } else {
          // deferred / aborted / failed — show defer message with auto-
          // dismiss after 60s.
          setState({
            kind: "deferred",
            reason: event.deferReason ?? event.outcome,
            surface: event.deferSurface,
          });
          setTimeout(() => { if (eventRevision.current === revision) setState({ kind: "hidden" }); }, 60_000);
        }
      }
  });

  // A tab opened during recovery may have missed its stream event.
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/internal/quiescence-state?display=1", { cache: "no-store", signal: abort.signal })
      .then(async (res) => res.ok ? await res.json() as { runId?: string; readyToSwapDeadlineAt?: string; swapStarted?: boolean } : null)
      .then((display) => {
        if (!display?.runId || !display.readyToSwapDeadlineAt || eventRevision.current !== 0 || abort.signal.aborted) return;
        activeOwner.current = display.runId;
        const identity = { runId: display.runId, deadline: display.readyToSwapDeadlineAt };
        setState(display.swapStarted ? { kind: "swapping", ...identity } : { kind: "preparing", swapEtaSeconds: null, ...identity });
      })
      .catch(() => { /* The system stream remains authoritative. */ });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (state.kind === "hidden") setCollapsed(false);
  }, [state.kind]);

  if (state.kind === "hidden") return null;

  const view = getPlatformBannerView(state, t);
  const Icon = view.icon;

  if (collapsed) {
    return (
      <button
        type="button"
        aria-expanded="false"
        aria-label="Expand platform status banner"
        data-quiescence-state={state.kind}
        data-quiescence-collapsed="true"
        onClick={() => setCollapsed(false)}
        className="pointer-events-auto flex max-w-[calc(100vw-24px)] items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs font-medium text-[var(--dpf-text)] shadow-[0_10px_30px_color-mix(in_srgb,var(--dpf-text)_14%,transparent)]"
      >
        <Icon aria-hidden="true" className={`h-3.5 w-3.5 ${view.iconClassName}`} />
        <span className="max-w-[min(72vw,40rem)] truncate">{view.compactLabel}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 text-[var(--dpf-muted)]" />
      </button>
    );
  }

  return (
    <div
      role="status"
      aria-live={view.assertive ? "assertive" : "polite"}
      className={`pointer-events-auto w-[min(960px,calc(100vw-24px))] rounded-md border px-3 py-2 text-xs text-[var(--dpf-text)] shadow-[0_10px_30px_color-mix(in_srgb,var(--dpf-text)_14%,transparent)] ${view.frameClassName}`}
      data-overlay-banner="true"
      data-quiescence-state={state.kind}
    >
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${view.iconClassName}`} />
        <span className="min-w-0 flex-1" style={{ overflowWrap: "anywhere" }}>
          {view.message}{view.deadline && <>{" "}{t("platformMaintenance.finishBy")}{" "}<time dateTime={view.deadline}>{formatDeadline(view.deadline, formatLocale ?? locale)}</time>.</>}
        </span>
        <button
          type="button"
          aria-expanded="true"
          aria-label="Collapse platform status banner"
          title="Collapse platform status banner"
          onClick={() => setCollapsed(true)}
          className="shrink-0 rounded p-1 text-[var(--dpf-muted)] transition hover:bg-[var(--dpf-surface-2)] hover:text-[var(--dpf-text)]"
        >
          <ChevronUp aria-hidden="true" className="h-4 w-4" />
        </button>
        {state.kind === "deferred" && (
          <button
            type="button"
            onClick={() => setState({ kind: "hidden" })}
            className="shrink-0 rounded p-1 text-[var(--dpf-muted)] transition hover:bg-[var(--dpf-surface-2)] hover:text-[var(--dpf-text)]"
            aria-label="Dismiss platform status banner"
            title="Dismiss platform status banner"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

type PlatformBannerView = {
  compactLabel: string;
  message: string;
  deadline?: string;
  assertive: boolean;
  frameClassName: string;
  iconClassName: string;
  icon: typeof Clock;
};

function getPlatformBannerView(state: Exclude<BannerState, { kind: "hidden" }>, t: ReturnType<typeof useT<"shell">>): PlatformBannerView {
  const warningFrame =
    "border-[color-mix(in_srgb,var(--dpf-warning)_34%,var(--dpf-border))] bg-[color-mix(in_srgb,var(--dpf-warning)_12%,var(--dpf-surface-1))]";
  const infoFrame =
    "border-[color-mix(in_srgb,var(--dpf-accent)_34%,var(--dpf-border))] bg-[color-mix(in_srgb,var(--dpf-accent)_10%,var(--dpf-surface-1))]";
  const neutralFrame =
    "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]";

  switch (state.kind) {
    case "preparing":
      return {
        compactLabel: state.deadline ? t("platformMaintenance.recoveryCompact") : "Platform upgrade preparing",
        deadline: state.deadline,
        message: state.deadline ? t("platformMaintenance.preparingRecovery") : `Platform upgrade preparing. Current work will finish before the update${
          state.swapEtaSeconds != null ? `, ETA about ${Math.ceil(state.swapEtaSeconds / 60)} min` : ""
        }.`,
        assertive: false,
        frameClassName: warningFrame,
        iconClassName: "text-[var(--dpf-warning)]",
        icon: Clock,
      };
    case "swapping":
      return {
        compactLabel: "Platform upgrading",
        deadline: state.deadline,
        message: t(state.deadline ? "platformMaintenance.installing" : "platformMaintenance.waiting"),
        assertive: true,
        frameClassName: warningFrame,
        iconClassName: "text-[var(--dpf-warning)]",
        icon: RefreshCw,
      };
    case "reconnecting":
      return {
        compactLabel: "Upgrade complete",
        message: "Upgrade complete. Reloading.",
        assertive: true,
        frameClassName: infoFrame,
        iconClassName: "text-[var(--dpf-accent)]",
        icon: CheckCircle2,
      };
    case "deferred":
      return {
        compactLabel: "Upgrade postponed",
        message: `Upgrade postponed${state.surface ? `, blocker: ${state.surface}` : ""}${
          state.reason ? `, ${state.reason}` : ""
        }. You can continue working.`,
        assertive: false,
        frameClassName: neutralFrame,
        iconClassName: "text-[var(--dpf-muted)]",
        icon: state.reason === "failed" ? AlertCircle : Info,
      };
  }
}

function formatDeadline(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  });
}

/**
 * Polls the internal state route to see if the running bundle differs from
 * boot. On mismatch, triggers a soft reload after 1s grace (so any final
 * SSE events deliver to the UI before refresh).
 *
 * Tolerates fetch failures — if the state route is briefly unreachable
 * during the swap, the next response from any other route will carry the
 * X-Bundle-Hash header (BI-QUIESCE-003) which the Proxy now emits on every
 * response; future BIs can hook into that header for a second detection
 * path.
 */
async function detectBundleMismatchAndReload(): Promise<void> {
  if (typeof window === "undefined") return;
  const boot = window.__DPF_BOOT__;
  if (!boot) return; // Boot data wasn't injected; can't compare.
  try {
    const res = await fetch("/api/internal/quiescence-state", { cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as { version?: string; bundleHash?: string };
    const versionChanged = body.version && body.version !== boot.version;
    const bundleChanged = body.bundleHash && body.bundleHash !== boot.bundleHash;
    if (versionChanged || bundleChanged) {
      setTimeout(() => window.location.reload(), 1_000);
    }
  } catch {
    // Best-effort — defer to operator manual reload if needed.
  }
}

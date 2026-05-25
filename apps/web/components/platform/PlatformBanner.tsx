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

import { useEffect, useState } from "react";

type BannerState =
  | { kind: "hidden" }
  | { kind: "preparing"; runId: string; swapEtaSeconds: number | null }
  | { kind: "swapping"; runId: string }
  | { kind: "reconnecting"; runId: string }
  | { kind: "deferred"; reason: string | null; surface: string | null };

type SystemQuiescenceEvent = {
  type: "system:quiescence";
  level: "draining" | "swapping" | "cleared";
  runId: string;
  swapEtaSeconds: number | null;
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
  const [state, setState] = useState<BannerState>({ kind: "hidden" });

  useEffect(() => {
    const source = new EventSource("/api/agent/system-stream");

    source.onmessage = (msg) => {
      let event: SystemQuiescenceEvent;
      try {
        event = JSON.parse(msg.data) as SystemQuiescenceEvent;
      } catch {
        return;
      }
      if (event.type !== "system:quiescence") return;

      if (event.level === "draining") {
        setState({ kind: "preparing", runId: event.runId, swapEtaSeconds: event.swapEtaSeconds });
      } else if (event.level === "swapping") {
        setState({ kind: "swapping", runId: event.runId });
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
          setTimeout(() => setState({ kind: "hidden" }), 60_000);
        }
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects. Don't change state — the previous
      // banner state should persist across transient disconnects.
    };

    return () => {
      source.close();
    };
  }, []);

  if (state.kind === "hidden") return null;

  // Theme tokens per AGENTS.md (CSS custom properties). Banner is rendered
  // as a narrow strip at the top of the shell, above StatusBanner +
  // UpdatePendingBanner.
  const baseStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 16px",
    fontSize: "14px",
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: "12px",
    borderBottom: "1px solid var(--dpf-border, rgba(0,0,0,0.08))",
  };

  if (state.kind === "preparing") {
    return (
      <div
        style={{
          ...baseStyle,
          background: "var(--dpf-surface-warning, #fff8e1)",
          color: "var(--dpf-text, #3e2723)",
        }}
        role="status"
        aria-live="polite"
        data-quiescence-state="preparing"
      >
        <span aria-hidden>⏳</span>
        <span>
          Platform upgrade preparing. Your current work will finish — please don&apos;t start new actions.
          {state.swapEtaSeconds != null ? ` (ETA ~${Math.ceil(state.swapEtaSeconds / 60)}min)` : ""}
        </span>
      </div>
    );
  }

  if (state.kind === "swapping") {
    return (
      <div
        style={{
          ...baseStyle,
          background: "var(--dpf-surface-warning, #fff3e0)",
          color: "var(--dpf-text, #3e2723)",
        }}
        role="status"
        aria-live="assertive"
        data-quiescence-state="swapping"
      >
        <span aria-hidden>🔄</span>
        <span>Platform upgrading. Please wait — should take about 30 seconds.</span>
      </div>
    );
  }

  if (state.kind === "reconnecting") {
    return (
      <div
        style={{
          ...baseStyle,
          background: "var(--dpf-surface-info, #e3f2fd)",
          color: "var(--dpf-text, #0d47a1)",
        }}
        role="status"
        aria-live="assertive"
        data-quiescence-state="reconnecting"
      >
        <span aria-hidden>✓</span>
        <span>Upgrade complete. Reloading…</span>
      </div>
    );
  }

  // deferred
  return (
    <div
      style={{
        ...baseStyle,
        background: "var(--dpf-surface-muted, #f5f5f5)",
        color: "var(--dpf-text, #424242)",
      }}
      role="status"
      aria-live="polite"
      data-quiescence-state="deferred"
    >
      <span aria-hidden>ℹ️</span>
      <span>
        Upgrade postponed
        {state.surface ? ` (blocker: ${state.surface})` : ""}
        {state.reason ? `: ${state.reason}` : ""}. You can continue working.
      </span>
      <button
        type="button"
        onClick={() => setState({ kind: "hidden" })}
        style={{
          marginLeft: "auto",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          fontSize: "14px",
        }}
        aria-label="Dismiss banner"
      >
        ✕
      </button>
    </div>
  );
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

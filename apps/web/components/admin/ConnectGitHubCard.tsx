"use client";

import { useEffect, useRef, useState } from "react";

import {
  disconnectGitHub,
  initiateDeviceFlow,
  pollDeviceFlow,
} from "@/lib/actions/github-device-flow";

// Connect GitHub card — Tier 1 (OAuth Device Flow) of the 2026-04-24 GitHub
// auth 2FA readiness spec. The user clicks Connect, sees a short user code +
// the github.com/login/device URL, and authorizes our OAuth App in their
// normal browser session. We never see the user's GitHub password or 2FA
// challenge — that lives entirely between the user and GitHub.
//
// Polling is GitHub-supplied-interval-driven. On `slow_down` we cancel the
// current interval and restart at the new (slower) cadence. When the page
// unmounts mid-flight the interval is cleared.

const PSEUDONYMITY_DISCLOSURE =
  "Your GitHub username will be visible on every PR you contribute. Use a pseudonymous GitHub account if that's not acceptable.";

type ViewState =
  | { kind: "idle" }
  | { kind: "initiating" }
  | {
      kind: "awaiting";
      sessionId: string;
      userCode: string;
      verificationUri: string;
      interval: number;
      copied: boolean;
    }
  | { kind: "success"; username: string }
  | { kind: "error"; message: string };

export interface ConnectedState {
  username: string;
  connectedAt: Date;
}

export interface ConnectGitHubCardProps {
  /**
   * Server-resolved snapshot of the currently-stored credential. `null` means
   * "not connected" — the card renders the Connect button. Non-null renders
   * the "Connected as @username" state with a Disconnect action.
   */
  initialConnected: ConnectedState | null;
}

export function ConnectGitHubCard({ initialConnected }: ConnectGitHubCardProps) {
  const [view, setView] = useState<ViewState>({ kind: "idle" });
  const [connected, setConnected] = useState<ConnectedState | null>(initialConnected);
  const [disconnecting, setDisconnecting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // Cleanup any in-flight poll when the component unmounts.
  useEffect(() => () => clearPolling(), []);

  const startPolling = (sessionId: string, intervalSec: number) => {
    clearPolling();
    intervalRef.current = setInterval(async () => {
      let pollResult;
      try {
        pollResult = await pollDeviceFlow(sessionId);
      } catch (err) {
        clearPolling();
        setView({
          kind: "error",
          message: err instanceof Error ? err.message : "Polling failed.",
        });
        return;
      }

      if (pollResult.status === "pending") return;
      if (pollResult.status === "slow_down") {
        // Reschedule at the slower interval. The current interval-callback
        // returns; the *next* tick is on the new schedule.
        startPolling(sessionId, pollResult.interval);
        return;
      }
      clearPolling();
      if (pollResult.status === "success") {
        const now = new Date();
        setConnected({ username: pollResult.username, connectedAt: now });
        setView({ kind: "success", username: pollResult.username });
        return;
      }
      // status === "error"
      setView({ kind: "error", message: pollResult.error });
    }, intervalSec * 1000);
  };

  const onConnect = async () => {
    setView({ kind: "initiating" });
    let result;
    try {
      result = await initiateDeviceFlow();
    } catch (err) {
      setView({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not start Device Flow.",
      });
      return;
    }
    if (!result.success) {
      setView({ kind: "error", message: result.error });
      return;
    }
    const { sessionId, userCode, verificationUri, interval } = result.data;
    setView({
      kind: "awaiting",
      sessionId,
      userCode,
      verificationUri,
      interval,
      copied: false,
    });
    startPolling(sessionId, interval);
  };

  const onCopyCode = async (code: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(code);
      }
      setView((prev) => (prev.kind === "awaiting" ? { ...prev, copied: true } : prev));
      // Reset the "Copied" label after a short delay so a second click works.
      setTimeout(() => {
        setView((prev) =>
          prev.kind === "awaiting" ? { ...prev, copied: false } : prev,
        );
      }, 1500);
    } catch {
      // Clipboard API may be unavailable (insecure context, restricted
      // permissions). Silently no-op — the code is still selectable in the UI.
    }
  };

  const onCancel = () => {
    clearPolling();
    setView({ kind: "idle" });
  };

  const onRetry = () => {
    clearPolling();
    setView({ kind: "idle" });
  };

  const onDisconnect = async () => {
    setDisconnecting(true);
    try {
      const result = await disconnectGitHub();
      if (!result.success) {
        setView({ kind: "error", message: result.error ?? "Disconnect failed." });
        return;
      }
      setConnected(null);
      setView({ kind: "idle" });
    } finally {
      setDisconnecting(false);
    }
  };

  // ─── Connected state ─────────────────────────────────────────────────────
  if (connected && view.kind !== "initiating" && view.kind !== "awaiting") {
    return (
      <section
        aria-labelledby="connect-github-heading"
        className="rounded-lg border border-green-500/30 bg-green-500/5 p-4"
        data-testid="connect-github-card"
      >
        <h3
          id="connect-github-heading"
          className="text-sm font-semibold text-[var(--dpf-text)] mb-1"
        >
          GitHub connected
        </h3>
        <p className="text-xs text-[var(--dpf-text)] leading-relaxed">
          Connected as{" "}
          <span className="font-mono text-[var(--dpf-accent)]">@{connected.username}</span>
          {", since "}
          {connected.connectedAt.toLocaleDateString()}.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={onDisconnect}
            disabled={disconnecting}
            className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-border)] transition-colors disabled:opacity-50"
            data-testid="disconnect-github-button"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </section>
    );
  }

  // ─── Awaiting (poll-in-flight) ───────────────────────────────────────────
  if (view.kind === "awaiting") {
    return (
      <section
        aria-labelledby="connect-github-heading"
        className="rounded-lg border border-[var(--dpf-accent)]/30 bg-[var(--dpf-accent)]/5 p-4"
        data-testid="connect-github-card"
      >
        <h3
          id="connect-github-heading"
          className="text-sm font-semibold text-[var(--dpf-text)] mb-1"
        >
          Authorize on GitHub
        </h3>
        <p className="text-xs text-[var(--dpf-text)] leading-relaxed mb-3">
          Visit{" "}
          <a
            href={view.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[var(--dpf-accent)] hover:underline"
          >
            {view.verificationUri}
          </a>{" "}
          and enter this code:
        </p>
        <div className="flex items-center gap-3 mb-3">
          <code
            className="select-all rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2 font-mono text-base tracking-widest text-[var(--dpf-text)]"
            data-testid="device-user-code"
          >
            {view.userCode}
          </code>
          <button
            type="button"
            onClick={() => onCopyCode(view.userCode)}
            className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-border)] transition-colors"
            data-testid="copy-device-code"
          >
            {view.copied ? "Copied" : "Copy code"}
          </button>
          <a
            href={view.verificationUri}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
          >
            Open GitHub
          </a>
        </div>
        <p className="text-xs text-[var(--dpf-muted)] mb-3" data-testid="awaiting-status">
          Waiting for you to authorize on GitHub…
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-[var(--dpf-muted)] hover:underline"
        >
          Cancel
        </button>
      </section>
    );
  }

  // ─── Initiating ──────────────────────────────────────────────────────────
  if (view.kind === "initiating") {
    return (
      <section
        aria-labelledby="connect-github-heading"
        className="rounded-lg border border-[var(--dpf-border)] p-4"
        data-testid="connect-github-card"
      >
        <h3
          id="connect-github-heading"
          className="text-sm font-semibold text-[var(--dpf-text)] mb-1"
        >
          Connect GitHub
        </h3>
        <p className="text-xs text-[var(--dpf-muted)]">Requesting a device code from GitHub…</p>
      </section>
    );
  }

  // ─── Success (transient — caller usually replaces with the connected card
  //     on the next render via initialConnected refresh) ──────────────────
  if (view.kind === "success") {
    return (
      <section
        aria-labelledby="connect-github-heading"
        className="rounded-lg border border-green-500/30 bg-green-500/5 p-4"
        data-testid="connect-github-card"
      >
        <h3
          id="connect-github-heading"
          className="text-sm font-semibold text-[var(--dpf-text)] mb-1"
        >
          GitHub connected
        </h3>
        <p className="text-xs text-[var(--dpf-text)]">
          Connected as{" "}
          <span className="font-mono text-[var(--dpf-accent)]">@{view.username}</span>.
        </p>
      </section>
    );
  }

  // ─── Error ───────────────────────────────────────────────────────────────
  if (view.kind === "error") {
    return (
      <section
        aria-labelledby="connect-github-heading"
        className="rounded-lg border border-red-400/50 bg-red-400/10 p-4"
        data-testid="connect-github-card"
      >
        <h3
          id="connect-github-heading"
          className="text-sm font-semibold text-[var(--dpf-text)] mb-1"
        >
          Connect GitHub
        </h3>
        <p className="text-xs text-red-600 dark:text-red-400 mb-3" data-testid="connect-error">
          {view.message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
          data-testid="retry-connect"
        >
          Retry
        </button>
      </section>
    );
  }

  // ─── Idle (default) ──────────────────────────────────────────────────────
  return (
    <section
      aria-labelledby="connect-github-heading"
      className="rounded-lg border border-[var(--dpf-border)] p-4"
      data-testid="connect-github-card"
    >
      <h3
        id="connect-github-heading"
        className="text-sm font-semibold text-[var(--dpf-text)] mb-1"
      >
        Connect GitHub
      </h3>
      <p className="text-xs text-[var(--dpf-text)] leading-relaxed mb-3">
        Authorize Digital Product Factory to push contribution branches under your GitHub
        account. We use the OAuth Device Flow — your password and 2FA challenge stay
        between you and GitHub.
      </p>
      <p className="text-xs text-[var(--dpf-muted)] mb-3" data-testid="pseudonymity-disclosure">
        {PSEUDONYMITY_DISCLOSURE}
      </p>
      <button
        type="button"
        onClick={onConnect}
        className="rounded border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        data-testid="connect-github-button"
      >
        Connect GitHub
      </button>
    </section>
  );
}

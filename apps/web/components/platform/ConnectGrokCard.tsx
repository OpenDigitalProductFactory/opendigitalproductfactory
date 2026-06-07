"use client";

import { useEffect, useRef, useState } from "react";

import {
  startGrokDeviceLogin,
  completeGrokDeviceLogin,
} from "@/lib/actions/grok-device-login";

// Connect Grok card — the "sign in with Google" (device-code OAuth) alternative to
// pasting an xAI API key, for the Build Studio `grok` dispatch engine. Mirrors the
// GitHub device-flow card: click → see a short code + the accounts.x.ai/oauth2/device
// URL → authorize in your normal browser session → we capture the token. The password
// and account 2FA stay between you and xAI.
//
// State lives in the sandbox (the grok CLI runs the device flow), so polling just calls
// completeGrokDeviceLogin() until the CLI has written its credential.

type ViewState =
  | { kind: "idle" }
  | { kind: "initiating" }
  | { kind: "awaiting"; verificationUrl: string; userCode: string; copied: boolean }
  | { kind: "success" }
  | { kind: "error"; message: string };

const POLL_INTERVAL_MS = 3000;

export function ConnectGrokCard({ canWrite }: { canWrite: boolean }) {
  const [view, setView] = useState<ViewState>({ kind: "idle" });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };
  useEffect(() => () => clearPolling(), []);

  const startPolling = () => {
    clearPolling();
    intervalRef.current = setInterval(async () => {
      let result: Awaited<ReturnType<typeof completeGrokDeviceLogin>>;
      try {
        result = await completeGrokDeviceLogin();
      } catch (err) {
        clearPolling();
        setView({ kind: "error", message: err instanceof Error ? err.message : "Polling failed." });
        return;
      }
      if (result.status === "pending") return;
      clearPolling();
      if (result.status === "ok") {
        setView({ kind: "success" });
      } else {
        setView({ kind: "error", message: result.detail || "Sign-in did not complete." });
      }
    }, POLL_INTERVAL_MS);
  };

  const onConnect = async () => {
    setView({ kind: "initiating" });
    let result: Awaited<ReturnType<typeof startGrokDeviceLogin>>;
    try {
      result = await startGrokDeviceLogin();
    } catch (err) {
      setView({ kind: "error", message: err instanceof Error ? err.message : "Could not start sign-in." });
      return;
    }
    if ("error" in result) {
      setView({ kind: "error", message: result.error });
      return;
    }
    setView({ kind: "awaiting", verificationUrl: result.verificationUrl, userCode: result.userCode, copied: false });
    startPolling();
  };

  const onCopy = async (code: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(code);
      }
      setView((prev) => (prev.kind === "awaiting" ? { ...prev, copied: true } : prev));
      setTimeout(() => {
        setView((prev) => (prev.kind === "awaiting" ? { ...prev, copied: false } : prev));
      }, 1500);
    } catch {
      /* clipboard unavailable — code is still selectable */
    }
  };

  const onCancel = () => {
    clearPolling();
    setView({ kind: "idle" });
  };

  const card = (border: string, bg: string, children: React.ReactNode) => (
    <section
      aria-label="Sign in to Grok"
      data-testid="connect-grok-card"
      style={{ border: `1px solid ${border}`, background: bg, borderRadius: 8, padding: 14, marginBottom: 12 }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 6 }}>
        Sign in to Grok
      </div>
      {children}
    </section>
  );

  const btnPrimary: React.CSSProperties = {
    border: "1px solid var(--dpf-accent)", background: "var(--dpf-accent)", color: "white",
    borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "none",
  };
  const btnGhost: React.CSSProperties = {
    border: "1px solid var(--dpf-border)", background: "transparent", color: "var(--dpf-text)",
    borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer",
  };

  if (view.kind === "success") {
    return card("color-mix(in srgb, var(--dpf-success) 30%, transparent)", "color-mix(in srgb, var(--dpf-success) 6%, transparent)",
      <p style={{ fontSize: 12, color: "var(--dpf-text)", margin: 0 }}>
        Grok is connected via your xAI account. Build Studio will use it for the <code>grok</code> engine.
      </p>);
  }

  if (view.kind === "awaiting") {
    return card("color-mix(in srgb, var(--dpf-accent) 30%, transparent)", "color-mix(in srgb, var(--dpf-accent) 5%, transparent)",
      <>
        <p style={{ fontSize: 12, color: "var(--dpf-text)", lineHeight: 1.6, marginTop: 0, marginBottom: 10 }}>
          Open{" "}
          <a href={view.verificationUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--dpf-accent)", fontFamily: "monospace" }}>
            {view.verificationUrl}
          </a>{" "}
          and sign in with your xAI account (Google / X / Apple). {view.userCode ? "Confirm this code if prompted:" : ""}
        </p>
        {view.userCode && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <code style={{
              userSelect: "all", border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)",
              padding: "6px 12px", fontFamily: "monospace", fontSize: 16, letterSpacing: "0.15em", color: "var(--dpf-text)", borderRadius: 4,
            }}>
              {view.userCode}
            </code>
            <button type="button" onClick={() => onCopy(view.userCode)} style={btnGhost}>
              {view.copied ? "Copied" : "Copy code"}
            </button>
            <a href={view.verificationUrl} target="_blank" rel="noopener noreferrer" style={btnPrimary}>Open xAI</a>
          </div>
        )}
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: "0 0 10px" }} data-testid="grok-awaiting-status">
          Waiting for you to authorize…
        </p>
        <button type="button" onClick={onCancel} style={{ ...btnGhost, border: "none", background: "transparent", color: "var(--dpf-muted)", padding: 0 }}>
          Cancel
        </button>
      </>);
  }

  if (view.kind === "initiating") {
    return card("var(--dpf-border)", "transparent",
      <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: 0 }}>Requesting a device code from xAI…</p>);
  }

  if (view.kind === "error") {
    return card("color-mix(in srgb, var(--dpf-error) 40%, transparent)", "color-mix(in srgb, var(--dpf-error) 8%, transparent)",
      <>
        <p style={{ fontSize: 12, color: "var(--dpf-error)", margin: "0 0 10px" }} data-testid="grok-connect-error">{view.message}</p>
        <button type="button" onClick={onCancel} style={btnPrimary}>Retry</button>
      </>);
  }

  // idle
  return card("var(--dpf-border)", "transparent",
    <>
      <p style={{ fontSize: 12, color: "var(--dpf-text)", lineHeight: 1.6, marginTop: 0, marginBottom: 10 }}>
        Sign in with your xAI account instead of pasting an API key — uses your SuperGrok / X&nbsp;Premium+ subscription.
        Your password and 2FA stay between you and xAI.
      </p>
      <button type="button" onClick={onConnect} disabled={!canWrite} style={{ ...btnPrimary, opacity: canWrite ? 1 : 0.5, cursor: canWrite ? "pointer" : "not-allowed" }} data-testid="connect-grok-button">
        Sign in to Grok
      </button>
    </>);
}

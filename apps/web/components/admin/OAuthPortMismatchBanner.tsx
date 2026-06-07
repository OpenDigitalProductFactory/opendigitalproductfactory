"use client";

// BI-87D93A71 (Minimum tier — document the workaround in the UI).
//
// Some OAuth clients (notably the shared ChatGPT/Codex OpenAI client
// `app_EMoamEEZ73f0CkXaXp7hrann`) are registered with a callback URL pinned
// to `http://localhost:1455/auth/callback`. Customer installs map both
// `:3000` and `:1455` to the portal container's `:3000` (see
// docker-compose.yml around lines 90-92), but the user has to be browsing
// on the matching port for the OAuth callback to land in the same origin
// as the authorize-flow tab.
//
// This banner detects the mismatch and tells the user how to fix it
// before they ever click Connect, so the failure mode isn't:
//   1. start OAuth on :3000 → 2. callback lands on :1455 → 3. confused user.
//
// The PROPER fix paths (re-register the OAuth client with :3000, or auto-
// redirect the user to :1455 before they click Connect) are explicitly
// deferred — see the BI body for the three-tier plan. This is tier 1.

import { useEffect, useState } from "react";

export type OAuthPortMismatchBannerProps = {
  /**
   * The provider's configured OAuth callback URL, e.g.
   * "http://localhost:1455/auth/callback". When this is null the banner
   * never renders (no port pinning to surface).
   */
  oauthRedirectUri: string | null | undefined;
  /** Display label for the provider, used in the warning copy. */
  providerLabel: string;
};

/**
 * Parse the port number a provider's OAuth callback requires from its
 * configured redirect URI. Returns `null` when the URI is missing or
 * unparseable. Defaults port-less URIs to the protocol default (80 / 443)
 * because the canonical host runs the portal on standard ports in that
 * case (no port pinning to surface).
 *
 * Exported so the unit tests can hit it directly without spinning up the
 * component.
 */
export function parseRequiredOAuthPort(
  oauthRedirectUri: string | null | undefined,
): number | null {
  if (!oauthRedirectUri) return null;
  try {
    const url = new URL(oauthRedirectUri);
    if (url.port) return Number.parseInt(url.port, 10);
    if (url.protocol === "https:") return 443;
    if (url.protocol === "http:") return 80;
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the current window's effective port. Returns 80 / 443 for
 * port-less origins (the browser strips the default port off
 * `window.location.port` when it matches the protocol default).
 *
 * Exported so the unit tests can stub it.
 */
export function getCurrentOriginPort(): number | null {
  if (typeof window === "undefined") return null;
  const explicit = window.location.port;
  if (explicit) return Number.parseInt(explicit, 10);
  if (window.location.protocol === "https:") return 443;
  if (window.location.protocol === "http:") return 80;
  return null;
}

export function OAuthPortMismatchBanner({
  oauthRedirectUri,
  providerLabel,
}: OAuthPortMismatchBannerProps) {
  // Defer the check to a client-side effect because the required vs. current
  // port comparison can only be made in the browser. SSR renders nothing —
  // server-rendered markup never shows the banner, so there is no flicker
  // on the no-mismatch path.
  const [currentPort, setCurrentPort] = useState<number | null>(null);
  useEffect(() => {
    setCurrentPort(getCurrentOriginPort());
  }, []);

  const requiredPort = parseRequiredOAuthPort(oauthRedirectUri);
  if (requiredPort === null) return null;
  if (currentPort === null) return null; // still hydrating
  if (currentPort === requiredPort) return null;

  // Build the "switch to" URL: same path + search + hash, swapped host port.
  // Falls back to "/" if we can't read the location (e.g. constructed URL
  // throws).
  let switchHref = "/";
  if (typeof window !== "undefined") {
    try {
      const target = new URL(window.location.href);
      target.port = String(requiredPort);
      switchHref = target.toString();
    } catch {
      // Leave the fallback "/" so the link is at least navigable to root.
    }
  }

  return (
    <div
      role="alert"
      data-testid="oauth-port-mismatch-banner"
      style={{
        border: "1px solid var(--dpf-warning)",
        background: "var(--dpf-state-warning, color-mix(in srgb, var(--dpf-warning) 12%, var(--dpf-surface-1)))",
        color: "var(--dpf-text)",
        borderRadius: 6,
        padding: "12px 16px",
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ display: "block", marginBottom: 4 }}>
        {providerLabel} OAuth requires port {requiredPort}
      </strong>
      <div style={{ marginBottom: 8, color: "var(--dpf-muted)" }}>
        You're on port {currentPort}. The shared {providerLabel} OAuth client
        has its callback URL registered against{" "}
        <code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          :{requiredPort}
        </code>
        , so the sign-in callback won't land in this browser tab unless you
        switch first. Customer installs already map both ports to the same
        portal container — just open the matching port.
      </div>
      <a
        href={switchHref}
        style={{
          display: "inline-block",
          color: "var(--dpf-accent, var(--dpf-text))",
          fontWeight: 600,
          textDecoration: "underline",
        }}
      >
        Open in :{requiredPort} →
      </a>
    </div>
  );
}

// BI-2DD7042A: the OAuth connection card used to (a) link its Sign in button to
// /api/oauth/authorize/{providerId} — a route that has never existed → 404 —
// and (b) demand a sign-in for any expired token even when a stored refresh
// token means the platform heals itself on next use.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { CredentialRow } from "@/lib/ai-provider-types";
import { OAuthConnectionStatus } from "./OAuthConnectionStatus";

vi.mock("@/lib/actions/provider-oauth", () => ({
  startProviderOAuth: vi.fn(),
}));

function credentialFixture(overrides: Partial<CredentialRow> = {}): CredentialRow {
  return {
    providerId: "anthropic-sub",
    secretHint: null,
    clientId: null,
    clientSecretHint: null,
    tokenEndpoint: null,
    scope: null,
    status: "ok",
    tokenExpiresAt: null,
    hasRefreshToken: false,
    hasUsableMaterial: true,
    ...overrides,
  };
}

const HOUR = 60 * 60 * 1000;

function render(credential: CredentialRow) {
  return renderToStaticMarkup(
    <OAuthConnectionStatus
      credential={credential}
      authMethod="oauth2_authorization_code"
      authorizeUrl="https://claude.ai/oauth/authorize"
      providerId="anthropic-sub"
    />,
  );
}

describe("OAuthConnectionStatus", () => {
  it("renders a Sign in button wired to the server action, not the dead authorize URL", () => {
    const html = render(credentialFixture({ status: "unconfigured" }));
    expect(html).toContain("Sign in");
    expect(html).toContain("<button");
    // The old dead link — must never come back.
    expect(html).not.toContain("/api/oauth/authorize");
  });

  it("says the token refreshes automatically when expired but a refresh token exists", () => {
    const html = render(
      credentialFixture({
        tokenExpiresAt: new Date(Date.now() - 2 * HOUR).toISOString(),
        hasRefreshToken: true,
      }),
    );
    expect(html).toContain("refreshes automatically on next use");
    expect(html).not.toContain("sign in again");
    // Sign-in stays available as a fallback (refresh may be revoked upstream).
    expect(html).toContain("Sign in");
  });

  it("demands a sign-in when expired with no refresh token", () => {
    const html = render(
      credentialFixture({
        tokenExpiresAt: new Date(Date.now() - 2 * HOUR).toISOString(),
        hasRefreshToken: false,
      }),
    );
    expect(html).toContain("Token expired — sign in again");
  });

  it("shows Connected for a valid unexpired token", () => {
    const html = render(
      credentialFixture({
        tokenExpiresAt: new Date(Date.now() + 24 * HOUR).toISOString(),
        hasRefreshToken: true,
      }),
    );
    expect(html).toContain("Connected");
    expect(html).not.toContain("expired");
  });

  it("renders nothing for non-OAuth auth methods", () => {
    const html = renderToStaticMarkup(
      <OAuthConnectionStatus
        credential={credentialFixture()}
        authMethod="api_key"
        authorizeUrl={null}
        providerId="anthropic-sub"
      />,
    );
    expect(html).toBe("");
  });
});

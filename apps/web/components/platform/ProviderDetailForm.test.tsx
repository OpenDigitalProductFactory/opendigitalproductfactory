import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProviderWithCredential } from "@/lib/ai-provider-types";
import { ProviderDetailForm } from "./ProviderDetailForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/ai-providers", () => ({
  configureProvider: vi.fn(),
  testProviderAuth: vi.fn(),
  discoverModels: vi.fn(),
  profileModels: vi.fn(),
  toggleProviderStatus: vi.fn(),
}));

vi.mock("@/lib/actions/provider-oauth", () => ({
  startProviderOAuth: vi.fn(),
  disconnectProviderOAuth: vi.fn(),
}));

const providerFixture: ProviderWithCredential = {
  provider: {
    id: "provider-1",
    providerId: "zai",
    name: "Z.ai",
    families: ["glm"],
    enabledFamilies: ["glm"],
    status: "active",
    costModel: "token",
    category: "direct",
    baseUrl: "https://api.z.ai/v1",
    authMethod: "api_key",
    supportedAuthMethods: ["api_key"],
    authHeader: "Authorization",
    endpoint: null,
    inputPricePerMToken: null,
    outputPricePerMToken: null,
    computeWatts: null,
    electricityRateKwh: null,
    docsUrl: null,
    consoleUrl: null,
    billingLabel: null,
    costPerformanceNotes: null,
    endpointType: "model",
    serviceKind: null,
    sensitivityClearance: ["internal"],
    capabilityTier: "adequate",
    costBand: "standard",
    taskTags: [],
    mcpTransport: null,
    maxConcurrency: null,
    authorizeUrl: null,
    tokenUrl: null,
    oauthClientId: null,
    oauthRedirectUri: null,
  },
  credential: {
    providerId: "zai",
    secretHint: "sk-...",
    clientId: null,
    clientSecretHint: null,
    tokenEndpoint: null,
    scope: null,
    status: "ok",
    tokenExpiresAt: null,
    hasRefreshToken: false,
    hasUsableMaterial: true,
  },
};

describe("ProviderDetailForm", () => {
  it("presents one managed readiness action instead of separate setup chores", () => {
    const html = renderToStaticMarkup(
      <ProviderDetailForm
        pw={providerFixture}
        canWrite={true}
        models={[]}
        profiles={[]}
        hasActiveProvider={true}
      />,
    );

    expect(html).toContain("Technical readiness");
    expect(html).toContain("Data-use eligibility is evaluated separately");
    expect(html).toContain("Save &amp; ready provider");
    expect(html).not.toContain(">Save<");
    expect(html).not.toContain("Test &amp; Discover");
    expect(html).not.toContain("Discover &amp; Profile Models");
    expect(html).not.toContain("Advanced: model families");
  });

  // BI-2DD7042A: connected/expired must be judged by the tokenExpiresAt
  // timestamp, not the stored status enum. The enum only flips to "expired"
  // when a refresh attempt FAILS — an idle provider's lapsed token kept
  // status="ok", rendered green "Connected", and hid the working sign-in
  // button while the OAuth card above said "Token expired".
  const HOUR = 60 * 60 * 1000;
  const oauthFixture = (tokenExpiresAt: string, hasRefreshToken: boolean): ProviderWithCredential => ({
    provider: {
      ...providerFixture.provider,
      providerId: "anthropic-sub",
      name: "Claude / Anthropic (OAuth Subscription)",
      authMethod: "oauth2_authorization_code",
      supportedAuthMethods: ["oauth2_authorization_code"],
      authorizeUrl: "https://claude.ai/oauth/authorize",
      tokenUrl: "https://platform.claude.com/v1/oauth/token",
      oauthClientId: "client-id",
    },
    credential: {
      ...providerFixture.credential!,
      providerId: "anthropic-sub",
      status: "ok",
      tokenExpiresAt,
      hasRefreshToken,
    },
  });

  it("treats a timestamp-expired token as expired even when the status enum still says ok", () => {
    const html = renderToStaticMarkup(
      <ProviderDetailForm
        pw={oauthFixture(new Date(Date.now() - 2 * HOUR).toISOString(), true)}
        canWrite={true}
        models={[]}
        profiles={[]}
        hasActiveProvider={true}
      />,
    );
    expect(html).not.toContain("Connected · token expires");
    expect(html).toContain("refreshes automatically on next use");
    // The WORKING sign-in path (startProviderOAuth) must be reachable.
    expect(html).toContain("Sign in with");
  });

  it("shows Connected for a valid unexpired OAuth token", () => {
    const html = renderToStaticMarkup(
      <ProviderDetailForm
        pw={oauthFixture(new Date(Date.now() + 24 * HOUR).toISOString(), true)}
        canWrite={true}
        models={[]}
        profiles={[]}
        hasActiveProvider={true}
      />,
    );
    expect(html).toContain("Connected · token expires");
  });
});

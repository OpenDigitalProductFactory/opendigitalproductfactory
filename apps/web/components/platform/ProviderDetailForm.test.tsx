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

    expect(html).toContain("Provider readiness");
    expect(html).toContain("Save &amp; ready provider");
    expect(html).not.toContain(">Save<");
    expect(html).not.toContain("Test &amp; Discover");
    expect(html).not.toContain("Discover &amp; Profile Models");
    expect(html).not.toContain("Advanced: model families");
  });
});

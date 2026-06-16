import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProviderRow, ProviderWithCredential } from "@/lib/ai-provider-types";
import type { RoutingEligibility } from "@/lib/routing/provider-routing-eligibility";

// ProviderStatusToggle pulls in next/navigation + a server action; stub it so
// the row renders in a plain node environment. We are testing the eligibility
// surface, not the admin toggle.
vi.mock("./ProviderStatusToggle", () => ({
  ProviderStatusToggle: ({ initialStatus }: { initialStatus: string }) => (
    <span>toggle:{initialStatus}</span>
  ),
}));

import { ServiceRow } from "./ServiceRow";

function provider(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: "p1",
    providerId: "local",
    name: "Docker Model Runner (local)",
    families: [],
    enabledFamilies: [],
    status: "active",
    costModel: "compute",
    category: "direct",
    baseUrl: "http://localhost:12434/engines/v1",
    authMethod: "none",
    supportedAuthMethods: ["none"],
    authHeader: null,
    endpoint: null,
    inputPricePerMToken: null,
    outputPricePerMToken: null,
    computeWatts: null,
    electricityRateKwh: null,
    docsUrl: null,
    consoleUrl: null,
    billingLabel: null,
    costPerformanceNotes: null,
    endpointType: "llm",
    serviceKind: null,
    sensitivityClearance: [],
    capabilityTier: "basic",
    costBand: "free",
    taskTags: [],
    mcpTransport: null,
    maxConcurrency: null,
    reasoning: 50,
    codegen: 50,
    toolFidelity: 50,
    instructionFollowing: 50,
    structuredOutput: 50,
    conversational: 50,
    contextRetention: 50,
    authorizeUrl: null,
    tokenUrl: null,
    oauthClientId: null,
    oauthRedirectUri: null,
    ...overrides,
  };
}

function pw(p: ProviderRow, credential: ProviderWithCredential["credential"] = null): ProviderWithCredential {
  return { provider: p, credential };
}

const routable: RoutingEligibility = {
  state: "routable",
  eligible: true,
  label: "Routable",
  reason: "Reachable and enabled — routing can use it now.",
};

describe("ServiceRow eligibility surface (BI-1C4AAE1E)", () => {
  it("an active local provider shows its eligibility and NEVER the bogus billing 'Not connected'", () => {
    const html = renderToStaticMarkup(
      <ServiceRow pw={pw(provider())} eligibility={routable} />,
    );
    expect(html).toContain("Routable");
    // The exact regression: an active provider must not also read "Not connected".
    expect(html).not.toContain("Not connected");
  });

  it("renders the eligibility label and reason for a credential-gap provider", () => {
    const eligibility: RoutingEligibility = {
      state: "needs_credentials",
      eligible: false,
      label: "Needs credentials",
      reason: "Enabled, but no credentials are connected yet.",
    };
    const html = renderToStaticMarkup(
      <ServiceRow
        pw={pw(provider({ providerId: "openai", name: "OpenAI", authMethod: "api_key", costModel: "token" }))}
        eligibility={eligibility}
      />,
    );
    expect(html).toContain("Needs credentials");
    expect(html).toContain("Enabled, but no credentials are connected yet.");
    expect(html).not.toContain("Not connected");
  });

  it("surfaces rate_limited for a CLI-backed provider whose pool is exhausted", () => {
    const eligibility: RoutingEligibility = {
      state: "rate_limited",
      eligible: false,
      label: "Rate-limited",
      reason: "Temporarily rate-limited at the provider. Recovers in ~5min.",
    };
    const html = renderToStaticMarkup(
      <ServiceRow
        pw={pw(provider({ providerId: "codex", name: "OpenAI Codex", endpointType: "responses", category: "agent", authMethod: "api_key" }))}
        eligibility={eligibility}
      />,
    );
    expect(html).toContain("Rate-limited");
  });
});

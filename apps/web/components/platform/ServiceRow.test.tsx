// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProviderRow, ProviderWithCredential, ProviderModelSummary } from "@/lib/ai-provider-types";
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

afterEach(cleanup);

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

function summary(overrides: Partial<ProviderModelSummary> = {}): ProviderModelSummary {
  return {
    totalModels: 1,
    activeModels: 1,
    nonChatClasses: [],
    derivedTier: null,
    routingScores: { reasoning: 90, codegen: 100, toolFidelity: 100 },
    representativeModelId: "docker.io/ai/qwen3-coder:latest",
    measuredModels: 1,
    evaluatedModels: 0,
    lastEvalAt: null,
    ...overrides,
  };
}

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

describe("ServiceRow weekly allocation hint (BI-779FA953)", () => {
  it("keeps weekly allocation out of the collapsed setup row", () => {
    const html = renderToStaticMarkup(
      <ServiceRow
        pw={pw(provider({ providerId: "anthropic", name: "Anthropic", authMethod: "oauth" }))}
        eligibility={routable}
        weeklyAllocationHint="63% weekly left · resets ~2d 4h"
      />,
    );
    expect(html).not.toContain("63% weekly left · resets ~2d 4h");
    // Informational only — it never replaces the routing answer.
    expect(html).toContain("Routable");
  });

  it("shows weekly allocation in expanded diagnostics even when the pool is rate-limited", () => {
    const rateLimited: RoutingEligibility = {
      state: "rate_limited",
      eligible: false,
      label: "Rate-limited",
      reason: "Temporarily rate-limited at the provider. Recovers in ~5min.",
    };
    render(
      <ServiceRow
        pw={pw(provider({ providerId: "anthropic", name: "Anthropic", authMethod: "oauth" }))}
        eligibility={rateLimited}
        weeklyAllocationHint="12% weekly left · resets ~18h"
      />,
    );
    expect(screen.queryByText("12% weekly left · resets ~18h")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Anthropic/ }));
    expect(screen.getByText("12% weekly left · resets ~18h")).toBeTruthy();
    expect(screen.getByText("Rate-limited")).toBeTruthy();
  });

  it("renders nothing extra when no hint is provided", () => {
    const html = renderToStaticMarkup(
      <ServiceRow pw={pw(provider())} eligibility={routable} />,
    );
    expect(html).not.toContain("weekly left");
  });
});

describe("ServiceRow calibrated routing scores (BI-1B46967D)", () => {
  it("keeps calibrated ModelProfile rollup scores out of the collapsed setup row", () => {
    const html = renderToStaticMarkup(
      <ServiceRow pw={pw(provider())} eligibility={routable} modelSummary={summary()} />,
    );
    expect(html).not.toContain("Reasoning: 90/100");
    expect(html).not.toContain("Codegen: 100/100");
    expect(html).not.toContain("Tools: 100/100");
    expect(html).not.toContain("baseline");
    // The whole point: a measured provider never shows the dead seed 50.
    expect(html).not.toContain("Reasoning: 50/100");
  });

  it("shows routing scores in expanded diagnostics", () => {
    render(<ServiceRow pw={pw(provider())} eligibility={routable} modelSummary={summary()} />);
    expect(screen.queryByText("baseline")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Docker Model Runner/ }));
    expect(screen.getByText("baseline")).toBeTruthy();
    expect(screen.getByTitle("Reasoning: 90/100 (docker.io/ai/qwen3-coder:latest)")).toBeTruthy();
  });

  it("reads 'not measured' in expanded diagnostics, not in the collapsed setup row", () => {
    const html = renderToStaticMarkup(
      <ServiceRow
        pw={pw(provider())}
        eligibility={routable}
        modelSummary={summary({ routingScores: null, representativeModelId: null, measuredModels: 0 })}
      />,
    );
    expect(html).not.toContain("not measured");
    expect(html).not.toContain("Reasoning: 50/100");

    render(
      <ServiceRow
        pw={pw(provider())}
        eligibility={routable}
        modelSummary={summary({ routingScores: null, representativeModelId: null, measuredModels: 0 })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Docker Model Runner/ }));
    expect(screen.getByText("not measured")).toBeTruthy();
  });
});

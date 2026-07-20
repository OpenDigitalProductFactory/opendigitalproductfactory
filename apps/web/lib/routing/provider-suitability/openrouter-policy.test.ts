import { describe, expect, it } from "vitest";
import {
  OpenRouterPolicyError,
  compileOpenRouterExecutionPolicy,
  parseOpenRouterRoutingEvidence,
} from "./openrouter-policy";

const restrictedObligations = {
  requireProviderAllowlist: true,
  requireProviderBlocklist: true,
  requireZdr: true,
  denyDataCollection: true,
  requireBoundedFallbacks: true,
  requiredRegion: null,
  approvedEndpointSlugs: ["anthropic", "google-vertex/europe-west4"],
  providerConnectionId: "conn-openrouter-enterprise",
  accountClass: "enterprise" as const,
  evidenceStatus: "contract-uploaded" as const,
  regionalProcessingEntitled: true,
  enabledRegions: ["eu"],
  requiredBaseUrl: null,
};

describe("OpenRouter execution policy", () => {
  it("compiles restricted work to explicit ZDR, no-collection, parameter-safe bounded routing", () => {
    expect(compileOpenRouterExecutionPolicy(restrictedObligations)).toEqual({
      posture: "restricted",
      providerSettings: {
        only: ["anthropic", "google-vertex/europe-west4"],
        allow_fallbacks: false,
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      },
      requestRouterMetadata: true,
      requireUnderlyingProviderEvidence: true,
      providerConnectionId: "conn-openrouter-enterprise",
    });
  });

  it("fails restricted work closed without a bounded underlying-provider allowlist", () => {
    expect(() => compileOpenRouterExecutionPolicy({
      ...restrictedObligations,
      approvedEndpointSlugs: [],
    })).toThrowError(OpenRouterPolicyError);
  });

  it("uses the EU endpoint only for the connection with proven enterprise entitlement", () => {
    expect(compileOpenRouterExecutionPolicy({
      ...restrictedObligations,
      requiredRegion: "eu",
      requiredBaseUrl: "https://eu.openrouter.ai/api/v1",
    }).requiredBaseUrl).toBe("https://eu.openrouter.ai/api/v1");
  });

  it.each(["regular", "business-team", "unknown"] as const)(
    "does not let a %s account inherit enterprise EU routing",
    (accountClass) => {
      expect(() => compileOpenRouterExecutionPolicy({
        ...restrictedObligations,
        requiredRegion: "eu",
        requiredBaseUrl: "https://eu.openrouter.ai/api/v1",
        accountClass,
      })).toThrow(/enterprise entitlement/i);
    },
  );

  it("keeps public cost-first routing available without manufacturing privacy claims", () => {
    expect(compileOpenRouterExecutionPolicy({
      requireProviderAllowlist: false,
      requireProviderBlocklist: false,
      requireZdr: false,
      denyDataCollection: false,
      requireBoundedFallbacks: false,
      requiredRegion: null,
      approvedEndpointSlugs: [],
      providerConnectionId: "conn-openrouter-regular",
      accountClass: "regular",
      evidenceStatus: "unreviewed",
      regionalProcessingEntitled: false,
      enabledRegions: [],
      requiredBaseUrl: null,
    }, {
      only: ["anthropic", "mistral"],
      ignore: ["deepinfra"],
      order: ["mistral", "anthropic"],
      sort: "price",
      allow_fallbacks: true,
    })).toEqual({
      posture: "public",
      providerSettings: {
        only: ["anthropic", "mistral"],
        ignore: ["deepinfra"],
        order: ["mistral", "anthropic"],
        sort: "price",
        allow_fallbacks: true,
      },
      requestRouterMetadata: true,
      requireUnderlyingProviderEvidence: false,
      providerConnectionId: "conn-openrouter-regular",
    });
  });
});

describe("OpenRouter routing evidence", () => {
  it("extracts only policy-safe provider attempts and ignores unknown metadata", () => {
    expect(parseOpenRouterRoutingEvidence({
      requested: "anthropic/claude-sonnet",
      region: "fra",
      secret_future_field: { prompt: "must not persist" },
      endpoints: {
        available: [
          { provider: "Anthropic", model: "anthropic/claude-sonnet", selected: true, prompt: "drop" },
        ],
      },
      attempts: [
        { provider: "Google Vertex", model: "google/gemini", status: 503, output: "drop" },
        { provider: "Anthropic", model: "anthropic/claude-sonnet", status: 200 },
      ],
    })).toEqual({
      underlyingProviderEvidence: "returned",
      selectedProvider: "Anthropic",
      selectedModel: "anthropic/claude-sonnet",
      region: "fra",
      attempts: [
        { provider: "Google Vertex", model: "google/gemini", status: 503 },
        { provider: "Anthropic", model: "anthropic/claude-sonnet", status: 200 },
      ],
    });
  });

  it("records an explicit not-returned state when metadata is absent", () => {
    expect(parseOpenRouterRoutingEvidence(undefined)).toEqual({
      underlyingProviderEvidence: "not-returned",
      attempts: [],
    });
  });
});

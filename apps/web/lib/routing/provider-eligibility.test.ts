import { describe, expect, it } from "vitest";
import {
  backgroundModelEvalSkipReason,
  canQueueBackgroundModelEvals,
  canRunStartupModelDiscovery,
  isModelRoutingProvider,
  MODEL_ROUTING_ENDPOINT_TYPES,
} from "./provider-eligibility";

describe("provider eligibility", () => {
  it("treats chat, responses, and provider-specific chat endpoints as routable model providers", () => {
    for (const endpointType of MODEL_ROUTING_ENDPOINT_TYPES) {
      expect(
        isModelRoutingProvider({
          providerId: `provider-${endpointType}`,
          endpointType,
          category: "direct",
          authMethod: "api_key",
        }),
      ).toBe(true);
    }
  });

  it("excludes MCP services and transcription sidecars from startup model discovery", () => {
    expect(
      canRunStartupModelDiscovery({
        providerId: "mcp-filesystem",
        endpointType: "service",
        serviceKind: "mcp",
        category: "mcp-subscribed",
      }),
    ).toBe(false);

    expect(
      canRunStartupModelDiscovery({
        providerId: "speaches",
        endpointType: "transcription",
        category: "direct",
      }),
    ).toBe(false);
  });

  it("does not queue unattended evals for user-delegated OAuth providers", () => {
    expect(
      canQueueBackgroundModelEvals({
        providerId: "anthropic-sub",
        endpointType: "llm",
        category: "direct",
        authMethod: "oauth2_authorization_code",
      }),
    ).toBe(false);

    expect(
      backgroundModelEvalSkipReason({
        providerId: "anthropic-sub",
        endpointType: "llm",
        category: "direct",
        authMethod: "oauth2_authorization_code",
      }),
    ).toContain("user-delegated OAuth");
  });

  it("does not queue evals for responses providers until eval runner uses the responses adapter", () => {
    expect(
      canQueueBackgroundModelEvals({
        providerId: "codex",
        endpointType: "responses",
        category: "agent",
        authMethod: "api_key",
        cliEngine: "codex",
      }),
    ).toBe(false);
  });
});

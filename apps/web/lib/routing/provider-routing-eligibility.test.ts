import { describe, expect, it } from "vitest";
import {
  cliAdapterTypeForProvider,
  deriveRoutingEligibility,
  recommendedActionFor,
  type RoutingEligibilityInput,
} from "./provider-routing-eligibility";

/** Base = a healthy local provider (no credentials required). */
function base(overrides: Partial<RoutingEligibilityInput> = {}): RoutingEligibilityInput {
  return {
    status: "active",
    endpointType: "llm",
    category: "direct",
    authMethod: "none",
    hasCredential: false,
    discoveredModelCount: 3,
    ...overrides,
  };
}

describe("recommendedActionFor", () => {
  it("returns a concrete action for each blocking state and null when none applies", () => {
    expect(recommendedActionFor(deriveRoutingEligibility(base()))).toBeNull(); // routable
    expect(recommendedActionFor(deriveRoutingEligibility(base({ status: "unconfigured" })))).toMatch(/Set this provider up/);
    expect(recommendedActionFor(deriveRoutingEligibility(base({ status: "inactive" })))).toMatch(/Enable/);
    expect(recommendedActionFor(deriveRoutingEligibility(base({ authMethod: "api_key", hasCredential: false })))).toMatch(/credentials/);
    expect(recommendedActionFor(deriveRoutingEligibility(base({ discoveredModelCount: 0 })))).toMatch(/model sync/);
    expect(recommendedActionFor(deriveRoutingEligibility(base({ cliPoolExhausted: true })))).toBeNull(); // rate_limited self-recovers
    expect(recommendedActionFor(deriveRoutingEligibility(base({ endpointType: "service" })))).toBeNull(); // not_routable
  });
});

describe("deriveRoutingEligibility", () => {
  it("local active provider with models is routable (no credentials needed)", () => {
    const r = deriveRoutingEligibility(base());
    expect(r.state).toBe("routable");
    expect(r.eligible).toBe(true);
    expect(r.label).toBe("Routable");
    expect(r.reason).toMatch(/Reachable and enabled/);
  });

  it("cloud provider with a credential is routable", () => {
    const r = deriveRoutingEligibility(
      base({ authMethod: "api_key", hasCredential: true }),
    );
    expect(r.state).toBe("routable");
    expect(r.reason).toMatch(/Connected and enabled/);
  });

  it("the bogus 'Not connected' case: active local provider is NEVER not-connected", () => {
    // Regression for BI-1C4AAE1E: Docker Model Runner / Local STT show active +
    // a billing 'Not connected' label at once. A reachable local provider must
    // read as routable, not as anything connectivity-negative.
    const docker = deriveRoutingEligibility(
      base({ endpointType: "llm", authMethod: "none", hasCredential: false }),
    );
    const whisper = deriveRoutingEligibility(
      base({ endpointType: "transcription", authMethod: "none", discoveredModelCount: 1 }),
    );
    expect(docker.eligible).toBe(true);
    expect(whisper.eligible).toBe(true);
    expect(whisper.state).toBe("routable");
  });

  it("transcription endpoints are routable and skip the model-count gate when count omitted", () => {
    const r = deriveRoutingEligibility({
      status: "active",
      endpointType: "transcription",
      category: "direct",
      authMethod: "none",
      hasCredential: false,
      // discoveredModelCount intentionally omitted
    });
    expect(r.state).toBe("routable");
  });

  it("unconfigured provider reads as 'Not set up'", () => {
    const r = deriveRoutingEligibility(base({ status: "unconfigured" }));
    expect(r.state).toBe("unconfigured");
    expect(r.eligible).toBe(false);
    expect(r.label).toBe("Not set up");
  });

  it("inactive/disabled provider reads as disabled", () => {
    expect(deriveRoutingEligibility(base({ status: "inactive" })).state).toBe("disabled");
    expect(deriveRoutingEligibility(base({ status: "disabled" })).state).toBe("disabled");
  });

  it("active provider that requires creds but has none → needs_credentials", () => {
    const r = deriveRoutingEligibility(
      base({ authMethod: "api_key", hasCredential: false }),
    );
    expect(r.state).toBe("needs_credentials");
    expect(r.reason).toMatch(/no credentials are connected/);
  });

  it("expired OAuth credential → needs_credentials with reconnect wording", () => {
    const r = deriveRoutingEligibility(
      base({
        authMethod: "oauth2_authorization_code",
        hasCredential: true,
        credentialExpired: true,
      }),
    );
    expect(r.state).toBe("needs_credentials");
    expect(r.reason).toMatch(/expired/);
  });

  it("CLI pool exhaustion surfaces rate_limited with the reset hint", () => {
    const r = deriveRoutingEligibility(
      base({
        authMethod: "oauth2_authorization_code",
        hasCredential: true,
        cliPoolExhausted: true,
        cliPoolResetHint: "~5min",
      }),
    );
    expect(r.state).toBe("rate_limited");
    expect(r.eligible).toBe(false);
    expect(r.reason).toContain("~5min");
  });

  it("disabled wins over a missing credential (off is the dominant action)", () => {
    const r = deriveRoutingEligibility(
      base({ status: "inactive", authMethod: "api_key", hasCredential: false }),
    );
    expect(r.state).toBe("disabled");
  });

  it("needs_credentials wins over an exhausted pool (connect first, then it can rate-limit)", () => {
    const r = deriveRoutingEligibility(
      base({
        authMethod: "oauth2_authorization_code",
        hasCredential: false,
        cliPoolExhausted: true,
      }),
    );
    expect(r.state).toBe("needs_credentials");
  });

  it("model-routing endpoint with zero discovered models → no_models", () => {
    const r = deriveRoutingEligibility(base({ discoveredModelCount: 0 }));
    expect(r.state).toBe("no_models");
    expect(r.eligible).toBe(false);
  });

  it("degraded provider is still routable but the reason notes the errors", () => {
    const r = deriveRoutingEligibility(base({ status: "degraded" }));
    expect(r.state).toBe("routable");
    expect(r.eligible).toBe(true);
    expect(r.reason).toMatch(/recent requests showed some errors/);
  });

  it("MCP service is not_routable", () => {
    const r = deriveRoutingEligibility(
      base({ endpointType: "service", category: "mcp-subscribed", serviceKind: "mcp" }),
    );
    expect(r.state).toBe("not_routable");
    expect(r.eligible).toBe(false);
  });

  it("every state maps to a distinct label", () => {
    const labels = new Set(
      [
        deriveRoutingEligibility(base()).label,
        deriveRoutingEligibility(base({ status: "unconfigured" })).label,
        deriveRoutingEligibility(base({ status: "inactive" })).label,
        deriveRoutingEligibility(base({ authMethod: "api_key", hasCredential: false })).label,
        deriveRoutingEligibility(base({ discoveredModelCount: 0 })).label,
        deriveRoutingEligibility(base({ cliPoolExhausted: true })).label,
        deriveRoutingEligibility(base({ endpointType: "service" })).label,
      ],
    );
    expect(labels.size).toBe(7);
  });
});

describe("cliAdapterTypeForProvider", () => {
  it("maps the subscription CLI providers to their pools", () => {
    expect(cliAdapterTypeForProvider("anthropic-sub")).toBe("claude-cli");
    expect(cliAdapterTypeForProvider("codex")).toBe("codex-cli");
    expect(cliAdapterTypeForProvider("chatgpt")).toBe("codex-cli");
  });

  it("returns null for direct-HTTP providers", () => {
    expect(cliAdapterTypeForProvider("anthropic")).toBeNull();
    expect(cliAdapterTypeForProvider("openai")).toBeNull();
    expect(cliAdapterTypeForProvider("local")).toBeNull();
    expect(cliAdapterTypeForProvider("gemini")).toBeNull();
  });
});

describe("public-only clearance (BI-1BF425BF)", () => {
  // deriveActivationClearance keeps a hosted provider public-only until its
  // account is reviewed. Coworker turns ask for internal, so such a provider is
  // connected and healthy yet takes none of that work: it must not read as routable.
  const hosted = (sensitivityClearance?: string[]) =>
    base({ authMethod: "oauth2_authorization_code", hasCredential: true, sensitivityClearance });

  it("names a hosted provider cleared only for public work instead of calling it routable", () => {
    const r = deriveRoutingEligibility(hosted(["public"]));
    expect(r.state).toBe("public_only");
    expect(r.eligible).toBe(false);
    expect(r.label).toBe("Public work only");
    expect(r.reason).toMatch(/not been reviewed for company data/);
    expect(recommendedActionFor(r)).toMatch(/Review this provider's account/);
  });

  it("stays routable once the account is cleared for internal work, or when clearance is not supplied", () => {
    expect(deriveRoutingEligibility(hosted(["public", "internal", "confidential"])).state).toBe("routable");
    expect(deriveRoutingEligibility(hosted(undefined)).state).toBe("routable");
  });

  it("keeps the more actionable state first", () => {
    expect(deriveRoutingEligibility({ ...hosted(["public"]), hasCredential: false }).state).toBe("needs_credentials");
    expect(deriveRoutingEligibility({ ...hosted(["public"]), cliPoolExhausted: true }).state).toBe("rate_limited");
  });
});


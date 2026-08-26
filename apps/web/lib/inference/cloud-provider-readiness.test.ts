import { describe, expect, it } from "vitest";

import { resolveCloudProviderReadiness } from "./cloud-provider-readiness";

// BI-575F0046. On a fresh install the owner connects a cloud provider, sees it
// active, and every coworker turn still runs locally — because a new connection
// is cleared for `public` and no turn is ever `public`.
describe("resolveCloudProviderReadiness", () => {
  const local = {
    providerId: "local",
    name: "Docker Model Runner (local)",
    status: "active",
    sensitivityClearance: ["public", "internal", "confidential", "restricted"],
  };

  it("reports none when only the local model is active", () => {
    expect(resolveCloudProviderReadiness([local])).toEqual({ state: "none", providerNames: [] });
  });

  it("does not count the local sidecars as cloud", () => {
    const ollama = { ...local, providerId: "ollama", name: "Ollama" };
    expect(resolveCloudProviderReadiness([local, ollama]).state).toBe("none");
  });

  // The shape a fresh install lands in, and the one that used to read as success.
  it("separates 'connected' from 'usable' for a public-only provider", () => {
    const result = resolveCloudProviderReadiness([
      local,
      { providerId: "chatgpt", name: "ChatGPT", status: "active", sensitivityClearance: ["public"] },
    ]);

    expect(result.state).toBe("public-only");
    expect(result.providerNames).toEqual(["ChatGPT"]);
  });

  it("reports ready once a provider is cleared for internal", () => {
    const result = resolveCloudProviderReadiness([
      local,
      {
        providerId: "anthropic-sub",
        name: "Claude / Anthropic",
        status: "active",
        sensitivityClearance: ["public", "internal", "confidential"],
      },
    ]);

    expect(result.state).toBe("ready");
    expect(result.providerNames).toEqual(["Claude / Anthropic"]);
  });

  // The live install's actual mix: one reviewed provider, one not.
  it("is ready when any one provider is usable, and names only that one", () => {
    const result = resolveCloudProviderReadiness([
      local,
      { providerId: "chatgpt", name: "ChatGPT", status: "active", sensitivityClearance: ["public"] },
      {
        providerId: "anthropic-sub",
        name: "Claude / Anthropic",
        status: "active",
        sensitivityClearance: ["public", "internal", "confidential"],
      },
    ]);

    expect(result.state).toBe("ready");
    expect(result.providerNames).toEqual(["Claude / Anthropic"]);
  });

  it("ignores providers that are not active", () => {
    const result = resolveCloudProviderReadiness([
      local,
      {
        providerId: "anthropic-sub",
        name: "Claude / Anthropic",
        status: "unconfigured",
        sensitivityClearance: ["public", "internal", "confidential"],
      },
    ]);

    expect(result.state).toBe("none");
  });

  it("treats an empty clearance array as unusable rather than unrestricted", () => {
    const result = resolveCloudProviderReadiness([
      { providerId: "openai", name: "OpenAI", status: "active", sensitivityClearance: [] },
    ]);

    expect(result.state).toBe("public-only");
  });
});

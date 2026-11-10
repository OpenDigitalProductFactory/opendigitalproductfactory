import { describe, expect, it } from "vitest";
import { codexSubscriptionModelExclusionReason } from "./codex-subscription-model-eligibility";

describe("codexSubscriptionModelExclusionReason", () => {
  it("excludes gpt-5.3-codex for a ChatGPT-authenticated Codex connection", () => {
    expect(codexSubscriptionModelExclusionReason({
      providerId: "codex",
      authMethod: "oauth2_authorization_code",
      modelId: "gpt-5.3-codex",
    })).toMatch(/not supported.*ChatGPT account/i);
  });

  it("keeps gpt-5.4 eligible for a ChatGPT-authenticated Codex connection", () => {
    expect(codexSubscriptionModelExclusionReason({
      providerId: "codex",
      authMethod: "oauth2_authorization_code",
      modelId: "gpt-5.4",
    })).toBeNull();
  });

  it("does not restrict API-key Codex accounts", () => {
    expect(codexSubscriptionModelExclusionReason({
      providerId: "codex",
      authMethod: "api_key",
      modelId: "gpt-5.3-codex",
    })).toBeNull();
  });

  it("does not apply Codex account rules to other providers", () => {
    expect(codexSubscriptionModelExclusionReason({
      providerId: "openai",
      authMethod: "oauth2_authorization_code",
      modelId: "gpt-5.3-codex",
    })).toBeNull();
  });
});

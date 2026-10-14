import { describe, expect, it } from "vitest";
import { getExclusionReasonV2 } from "./pipeline-v2";
import type { EndpointManifest } from "./types";
import type { RequestContract } from "./request-contract";
import { accountExecutionVersion, bindProviderAccountExecution, bindProviderAccountSuitability, expandProviderAccountCandidates, type ProviderAccountCandidateFacts } from "./provider-account-candidates";
import type { RoutedExecutionPlan } from "./recipe-types";

const endpoint = { id: "model-profile", providerId: "anthropic", modelId: "model", providerConnectionId: "personal", status: "active", sensitivityClearance: ["public"], modelClass: "chat", maxContextTokens: 10000, maxOutputTokens: 1000, modelRestrictions: [], capabilities: {}, customScores: {} } as unknown as EndpointManifest;
const contract = { contractId: "work", taskType: "summarization", sensitivity: "public", modality: { input: ["text"], output: ["text"] }, estimatedInputTokens: 10, estimatedOutputTokens: 10 } as RequestContract;

describe("account candidate hard fence", () => {
  it("excludes an unapproved sibling before capability or capacity ranking", () => {
    expect(getExclusionReasonV2(endpoint, { ...contract, allowedProviderConnectionIds: ["business"] })).toContain("account");
  });
  it("refuses an account denial even when also allowed", () => {
    expect(getExclusionReasonV2(endpoint, { ...contract, allowedProviderConnectionIds: ["personal"], deniedProviderConnectionIds: ["personal"] })).toContain("account");
  });
  it("refuses an identity-free legacy candidate when an account fence exists", () => {
    expect(getExclusionReasonV2({ ...endpoint, providerConnectionId: undefined }, { ...contract, allowedProviderConnectionIds: ["business"] })).toContain("account");
  });
});

function account(overrides: Partial<ProviderAccountCandidateFacts> = {}): ProviderAccountCandidateFacts {
  return { connectionId: "business", providerId: "anthropic", status: "active", authMethod: "api-key", executionChannel: "direct-api", credentialEntryId: "owned-credential", credentialEntry: { status: "ok" }, accessibleModelIds: ["model"], modelsVerifiedAt: new Date(), evidenceStatus: "unreviewed", ...overrides };
}
describe("account manifest expansion", () => {
  it("preserves the selected response protocol and recipe when binding an HTTP account", () => {
    const plan = { providerId: "chatgpt", executionAdapter: "responses", recipeId: "reviewed-recipe" } as RoutedExecutionPlan;
    const bound = bindProviderAccountExecution(plan, { ...endpoint, providerId: "chatgpt", providerConnectionId: "business", accountAuthMethod: "oauth2_authorization_code", executionChannel: "direct-api" });
    expect(bound).toMatchObject({ executionAdapter: "responses", recipeId: "reviewed-recipe", providerConnectionId: "business" });
  });
  it.each(["codex", "anthropic-sub"])("admits the verified isolated subscription channel for %s", (providerId) => {
    const candidate = expandProviderAccountCandidates({ ...endpoint, providerId }, [account({ providerId, authMethod: "oauth", executionChannel: "subscription-cli" })], false, {})[0]!;
    expect(candidate.eligibilityExclusionReason).toBeUndefined();
    expect(candidate.providerConnectionId).toBe("business");
  });
  it("uses verified account model access instead of another account's learned refusal", () => {
    const candidate = expandProviderAccountCandidates(endpoint, [account()], false, { authEligibility: { api_key: { supported: false, source: "runtime-refusal", learnedAt: new Date().toISOString() } } })[0]!;
    expect(candidate.eligibilityExclusionReason).toBeUndefined();
  });
  it("keeps capacity observation timestamps out of the execution revision while binding credential changes", () => {
    const a = account({ updatedAt: new Date("2026-10-14T00:00:00Z") });
    expect(accountExecutionVersion(a)).toBe(accountExecutionVersion({ ...a, updatedAt: new Date("2026-10-14T01:00:00Z") }));
    expect(accountExecutionVersion(a)).not.toBe(accountExecutionVersion({ ...a, credentialEntry: { status: "ok", updatedAt: new Date("2026-10-14T01:00:00Z") } }));
  });
  it("keeps secret-bearing fields out of the execution metadata fingerprint", () => {
    const a = account({ credentialEntry: Object.assign({ status: "ok" }, { secretRef: "fake-a" }) });
    const b = account({ ...a, credentialEntry: Object.assign({ status: "ok" }, { secretRef: "fake-b" }) });
    expect(accountExecutionVersion(a)).toBe(accountExecutionVersion(b));
  });
  it("binds work clearance to only the approved account without mutating cached manifests", () => {
    const candidates = expandProviderAccountCandidates(endpoint, [account(), account({ connectionId: "personal" })], false, {});
    const bound = bindProviderAccountSuitability(candidates, "confidential", ["business"]);
    expect(bound[0]!.sensitivityClearance).toEqual(["public", "confidential"]);
    expect(bound[1]!.sensitivityClearance).toEqual(["public"]);
    expect(candidates[0]!.sensitivityClearance).toEqual(["public"]);
  });
  it("keeps the default profile identity and adds a distinct selected credential candidate", () => {
    const candidates = expandProviderAccountCandidates(endpoint, [account(), account({ connectionId: "provider-default-anthropic" })], true, {});
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ id: "model-profile", providerConnectionId: "provider-default-anthropic" });
    expect(candidates[1]).toMatchObject({ id: "model-profile:account:business", modelProfileId: "model-profile", providerConnectionId: "business", sensitivityClearance: ["public"], riskAcceptedClearances: [] });
  });
  it("admits a configured account independently of missing default credentials", () => {
    expect(expandProviderAccountCandidates(endpoint, [account()], false, {})).toHaveLength(1);
  });
  it("never borrows model access, data clearance or credentials from a sibling", () => {
    const candidate = expandProviderAccountCandidates({ ...endpoint, sensitivityClearance: ["restricted"] }, [account({ accessibleModelIds: [] })], false, {})[0]!;
    expect(candidate.eligibilityExclusionReason).toContain("Model access");
    expect(candidate.sensitivityClearance).toEqual(["public"]);
    expect(candidate).not.toHaveProperty("credentialEntry");
  });
  it("excludes disabled and foreign accounts and preserves an intentional default disable", () => {
    expect(expandProviderAccountCandidates(endpoint, [account({ status: "disabled" }), account({ providerId: "openai" }), account({ connectionId: "provider-default-anthropic", status: "disabled" })], true, {})).toEqual([]);
  });
  it("keeps unsupported CLI isolation and expired evidence explicitly excluded", () => {
    expect(expandProviderAccountCandidates(endpoint, [account({ executionChannel: "subscription-cli" })], false, {})[0]!.eligibilityExclusionReason).toContain("isolation");
    expect(expandProviderAccountCandidates(endpoint, [account({ evidenceStatus: "expired" })], false, {})[0]!.eligibilityExclusionReason).toContain("expired");
  });
});

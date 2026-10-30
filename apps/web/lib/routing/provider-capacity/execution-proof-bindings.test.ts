import { describe, expect, it } from "vitest";
import { captureExecutionProofBinding, modelExecutionRevision, endpointExecutionRevision } from "./execution-proof.server";

describe("execution identity excludes unrelated presentation and evaluation churn", () => {
  it("retains model proof after a score or last-seen update, but rejects an actual catalog/contract change", () => {
    const model = { id: "profile", modelId: "target", providerId: "chatgpt", modelStatus: "active", modelClass: "chat", capabilities: { streaming: true }, catalogHash: "catalog" } as unknown as Parameters<typeof modelExecutionRevision>[0];
    expect(modelExecutionRevision({ ...model, codegen: 90, lastSeenAt: new Date() } as never)).toBe(modelExecutionRevision(model));
    expect(modelExecutionRevision({ ...model, catalogHash: "changed" } as never)).not.toBe(modelExecutionRevision(model));
    expect(modelExecutionRevision({ ...model, capabilities: { streaming: false } } as never)).not.toBe(modelExecutionRevision(model));
  });
  it("retains endpoint proof after a display name or score update, but rejects a different transport", () => {
    const provider = { providerId: "chatgpt", status: "active", authMethod: "oauth2_authorization_code", baseUrl: "https://fixture.invalid", supportsStreaming: true } as unknown as Parameters<typeof endpointExecutionRevision>[0];
    expect(endpointExecutionRevision({ ...provider, name: "new name", reasoning: 95, updatedAt: new Date() } as never, "https://fixture.invalid")).toBe(endpointExecutionRevision(provider, "https://fixture.invalid"));
    expect(endpointExecutionRevision(provider, "https://different.invalid")).not.toBe(endpointExecutionRevision(provider, "https://fixture.invalid"));
  });
});

describe("account quota ownership remains unresolved", () => {
  it.each(["quota_resets_at", "rate_limited", "cooling_down"])("refuses an owned-account %s row before admitting a check", async state => {
    const row = { id: "owned-limit", ownedAccountId: "owned", providerId: null, state, retryAt: new Date(Date.now() + 86400_000), lastObservedAt: new Date(), updatedAt: new Date(), observedCredentialRevision: null };
    const before = structuredClone(row);
    const db = {
      aiProviderConnection: { findUnique: async () => ({ id: "owned", connectionId: "provider-default-chatgpt", providerId: "chatgpt", organizationId: null,
        authMethod: "oauth", executionChannel: "direct-api", status: "active", accessibleModelIds: [], credentialEntryId: "credential", updatedAt: new Date(),
        credentialEntry: { id: "credential", status: "ok", updatedAt: new Date(), secretRef: null, clientSecret: null, cachedToken: "synthetic", refreshToken: null },
        provider: { providerId: "chatgpt", status: "active", baseUrl: "https://fixture.invalid" } }) },
      modelProfile: { findFirst: async () => ({ modelId: "target", providerId: "chatgpt" }) },
      providerCapacityStatus: { findMany: async () => [row] }, cliPoolStatus: { findMany: async () => [] },
    };
    expect(await captureExecutionProofBinding("provider-default-chatgpt", "target", db as never)).toBeNull();
    expect(row).toEqual(before);
  });
});

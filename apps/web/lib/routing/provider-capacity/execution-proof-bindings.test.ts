import { describe, expect, it } from "vitest";
import { modelExecutionRevision, endpointExecutionRevision } from "./execution-proof.server";

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

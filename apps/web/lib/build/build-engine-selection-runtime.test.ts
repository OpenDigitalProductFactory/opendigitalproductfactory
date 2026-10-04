import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ providers: vi.fn(), preview: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {
  modelProvider: { findMany: mocks.providers },
  credentialEntry: { findMany: async () => [] },
  buildEngine: { findMany: async () => [{ engineId: "opencode", state: { present: true } }] },
  providerCapacityStatus: { findMany: async () => [] },
  cliPoolStatus: { findMany: async () => [] },
} }));
vi.mock("@/lib/inference/local-only", () => ({ getLocalOnlyInference: async () => false }));
vi.mock("@/lib/inference/routed-inference", () => ({ previewRoute: mocks.preview }));
vi.mock("@/lib/inference/ai-provider-internals", () => ({ resolveCredentialProviderId: (id: string) => id }));
vi.mock("@/lib/routing/provider-health-loader", () => ({ loadProviderHealthBatch: async () => new Map() }));

import { resolveBuildEngineSelection } from "./build-engine-selection-runtime";

const config = {
  claudeProviderId: "", codexProviderId: "", grokProviderId: "",
  opencodeProviderId: "preferred-cloud", claudeModel: "", codexModel: "", grokModel: "",
  opencodeModel: "cloud-model",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.providers.mockResolvedValue([
    { providerId: "local", status: "active", authMethod: "none", cliEngine: "opencode", category: "direct" },
    { providerId: "preferred-cloud", status: "unconfigured", authMethod: "api_key", cliEngine: "opencode", category: "direct" },
  ]);
  mocks.preview.mockResolvedValue({
    selectedManifest: { providerId: "local" },
    decision: { selectedEndpoint: "local-ep", selectedModelId: "local-model", reason: "eligible local alternative", fallbackChain: [], candidates: [] },
  });
});

describe("automatic build provider alternatives", () => {
  it("retains local alternatives when the saved provider preference is unavailable", async () => {
    const result = await resolveBuildEngineSelection(config, { policy: { mode: "auto", pinnedEngine: null } });
    expect(mocks.preview).toHaveBeenCalledWith(expect.anything(), "development", expect.objectContaining({ allowedProviders: ["local"], requireTools: true }));
    expect(result.status).toBe("selected");
    expect(result.selected).toMatchObject({ providerId: "local", modelId: "local-model" });
    expect(result.selected?.modelId).not.toBe("cloud-model");
  });

  it("keeps an explicit pin within its configured provider boundary", async () => {
    const result = await resolveBuildEngineSelection(config, { policy: { mode: "pinned", pinnedEngine: "opencode" } });
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(result.status).toBe("blocked");
    expect(result.fallbackDisabled).toBe(true);
  });
});

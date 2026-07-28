import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @dpf/db so providerHasConfiguredCredential can be exercised without a
// live database. The other (pure) functions under test never touch prisma, so
// this mock is inert for them.
const credState = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  rows: new Map<string, Record<string, unknown>>(),
}));
const discoveredModelMock = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  createMany: vi.fn(),
}));
const modelProfileMock = vi.hoisted(() => ({
  updateMany: vi.fn(async () => ({ count: 0 })),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    credentialEntry: {
      findUnique: vi.fn(async (args: { where?: { providerId?: string } } | undefined) => {
        const providerId = args?.where?.providerId;
        if (providerId && credState.rows.has(providerId)) return credState.rows.get(providerId) ?? null;
        return credState.row;
      }),
    },
    discoveredModel: discoveredModelMock,
    modelProfile: modelProfileMock,
  },
}));

import {
  buildAutoDiscoveryEvalEvents,
  extractTokenUsage,
  providerHasConfiguredCredential,
  getDecryptedCredential,
  resolveSyncedToolUse,
  upsertDiscoveredModels,
  reconcileDiscoveredModelPresence,
  PERMANENT_RETIRE_REASONS,
} from "./ai-provider-internals";

describe("extractTokenUsage", () => {
  it("reads OpenAI-compatible prompt and completion token fields", () => {
    expect(
      extractTokenUsage({
        usage: {
          prompt_tokens: 12,
          completion_tokens: 7,
        },
      }),
    ).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it("reads anthropic-style input and output token fields", () => {
    expect(
      extractTokenUsage({
        usage: {
          input_tokens: 20,
          output_tokens: 9,
        },
      }),
    ).toEqual({ inputTokens: 20, outputTokens: 9 });
  });

  it("returns undefined values when usage is missing", () => {
    expect(extractTokenUsage({})).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
    });
  });
});

describe("buildAutoDiscoveryEvalEvents", () => {
  it("uses the provider id as endpointId, not the ModelProfile row id", () => {
    const events = buildAutoDiscoveryEvalEvents("anthropic-sub", [
      { id: "cmogs56yp00018xqagh6iq4px", modelId: "claude-sonnet-4-6" },
      { id: "cmogs56z800038xqa9gwwdmlq", modelId: "claude-opus-4-6" },
    ]);

    expect(events).toEqual([
      {
        name: "ai/eval.run",
        data: {
          endpointId: "anthropic-sub",
          modelId: "claude-sonnet-4-6",
          userId: "system",
        },
      },
      {
        name: "ai/eval.run",
        data: {
          endpointId: "anthropic-sub",
          modelId: "claude-opus-4-6",
          userId: "system",
        },
      },
    ]);
  });
});

describe("providerHasConfiguredCredential", () => {
  beforeEach(() => {
    credState.row = null;
    credState.rows = new Map();
  });

  it("treats no-auth endpoints (local runner) as always eligible", async () => {
    expect(await providerHasConfiguredCredential("local", "none")).toBe(true);
    // null / empty auth is treated the same as "none"
    expect(await providerHasConfiguredCredential("speaches", null)).toBe(true);
  });

  it("api_key provider is eligible only when a secretRef is stored", async () => {
    credState.row = { secretRef: "enc:abc", clientSecret: null, cachedToken: null, refreshToken: null };
    expect(await providerHasConfiguredCredential("anthropic", "api_key")).toBe(true);
  });

  it("api_key provider with a credential row but NO secret is NOT eligible", async () => {
    // The exact xAI / gemini state that flooded the eval logs.
    credState.row = { secretRef: null, clientSecret: null, cachedToken: null, refreshToken: null };
    expect(await providerHasConfiguredCredential("gemini", "api_key")).toBe(false);
  });

  it("api_key provider with no credential row at all is NOT eligible", async () => {
    credState.row = null;
    expect(await providerHasConfiguredCredential("xai", "api_key")).toBe(false);
  });

  it("treats zai-coding as configured when the main zai provider has an API key", async () => {
    credState.rows = new Map([
      ["zai", { providerId: "zai", secretRef: "zai-main-key", clientSecret: null, cachedToken: null, refreshToken: null }],
    ]);

    expect(await providerHasConfiguredCredential("zai-coding", "api_key")).toBe(true);
  });

  it("oauth2_client_credentials is eligible with a client secret or token material", async () => {
    credState.row = { secretRef: null, clientSecret: "enc:cs", cachedToken: null, refreshToken: null };
    expect(await providerHasConfiguredCredential("p", "oauth2_client_credentials")).toBe(true);
    credState.row = { secretRef: null, clientSecret: null, cachedToken: null, refreshToken: null };
    expect(await providerHasConfiguredCredential("p", "oauth2_client_credentials")).toBe(false);
  });
});

describe("getDecryptedCredential", () => {
  beforeEach(() => {
    credState.row = null;
    credState.rows = new Map();
  });

  it("inherits the main zai API key for the zai-coding endpoint", async () => {
    credState.rows = new Map([
      ["zai", {
        providerId: "zai",
        secretRef: "zai-main-key",
        clientSecret: null,
        cachedToken: null,
        refreshToken: null,
        status: "ok",
      }],
    ]);

    const credential = await getDecryptedCredential("zai-coding");

    expect(credential?.providerId).toBe("zai");
    expect(credential?.secretRef).toBe("zai-main-key");
  });
});

describe("resolveSyncedToolUse (sticky-false trap — BI-B6DEBFFE)", () => {
  it("provider floor of false floors everything", () => {
    expect(
      resolveSyncedToolUse({
        providerToolFloor: false,
        extractedToolUse: true,
        existing: { profileSource: "evaluated", supportsToolUse: true, capabilityOverrides: { toolUse: true } },
      }),
    ).toBe(false);
  });

  it("admin override wins over a stale stored false (the live qwen3-coder relief)", () => {
    expect(
      resolveSyncedToolUse({
        providerToolFloor: true,
        extractedToolUse: null,
        existing: { profileSource: "evaluated", supportsToolUse: false, capabilityOverrides: { toolUse: true } },
      }),
    ).toBe(true);
  });

  it("admin override can also pin OFF a capable model", () => {
    expect(
      resolveSyncedToolUse({
        providerToolFloor: true,
        extractedToolUse: true,
        existing: { profileSource: "seed", supportsToolUse: true, capabilityOverrides: { toolUse: false } },
      }),
    ).toBe(false);
  });

  it("HEALS a stale discovery-owned false when the adapter now extracts true (the core bug)", () => {
    // qwen3-coder: stored false from before the adapter recognised the coder family,
    // seed/auto-discover profile, no override. The fresh true must win — previously
    // the existing===false branch re-pinned it false forever.
    expect(
      resolveSyncedToolUse({
        providerToolFloor: true,
        extractedToolUse: true,
        existing: { profileSource: "seed", supportsToolUse: false, capabilityOverrides: null },
      }),
    ).toBe(true);
  });

  it("a measured eval (no override) is NOT clobbered by a low-confidence re-discovery", () => {
    // An evaluated profile that legitimately measured non-tool-use keeps its value
    // when the optimistic adapter prior disagrees and there is no admin override.
    expect(
      resolveSyncedToolUse({
        providerToolFloor: true,
        extractedToolUse: true,
        existing: { profileSource: "evaluated", supportsToolUse: false, capabilityOverrides: null },
      }),
    ).toBe(false);
  });

  it("keeps an embedding model false (adapter extracts a definitive false)", () => {
    expect(
      resolveSyncedToolUse({
        providerToolFloor: true,
        extractedToolUse: false,
        existing: { profileSource: "seed", supportsToolUse: false, capabilityOverrides: null },
      }),
    ).toBe(false);
  });

  it("unknown with no signal falls back to the provider floor, not false", () => {
    expect(
      resolveSyncedToolUse({
        providerToolFloor: true,
        extractedToolUse: null,
        existing: null,
      }),
    ).toBe(true);
  });
});

describe("upsertDiscoveredModels (model-discovery N+1 batching — BI-OPT-DB-HOTPATH)", () => {
  beforeEach(() => {
    discoveredModelMock.findMany.mockReset();
    discoveredModelMock.update.mockReset();
    discoveredModelMock.createMany.mockReset();
    discoveredModelMock.findMany.mockResolvedValue([]);
    discoveredModelMock.update.mockResolvedValue({});
    discoveredModelMock.createMany.mockResolvedValue({ count: 0 });
  });

  it("reads existing models with ONE findMany keyed on providerId + modelId IN [...]", async () => {
    await upsertDiscoveredModels("openrouter", [
      { modelId: "a", rawMetadata: { id: "a" } },
      { modelId: "b", rawMetadata: { id: "b" } },
    ]);
    expect(discoveredModelMock.findMany).toHaveBeenCalledTimes(1);
    expect(discoveredModelMock.findMany.mock.calls[0][0]).toMatchObject({
      where: { providerId: "openrouter", modelId: { in: ["a", "b"] } },
    });
  });

  it("createMany's only the new models and returns their count; existing rows are updated, not created", async () => {
    // "a" already stored, "b" and "c" are new.
    discoveredModelMock.findMany.mockResolvedValue([{ modelId: "a" }]);
    const newCount = await upsertDiscoveredModels("p", [
      { modelId: "a", rawMetadata: { id: "a", v: 2 } },
      { modelId: "b", rawMetadata: { id: "b" } },
      { modelId: "c", rawMetadata: { id: "c" } },
    ]);

    expect(newCount).toBe(2);
    // existing "a" refreshed via a single update
    expect(discoveredModelMock.update).toHaveBeenCalledTimes(1);
    expect(discoveredModelMock.update.mock.calls[0][0]).toMatchObject({
      where: { providerId_modelId: { providerId: "p", modelId: "a" } },
      data: { rawMetadata: { id: "a", v: 2 } },
    });
    // new "b","c" inserted with one createMany
    expect(discoveredModelMock.createMany).toHaveBeenCalledTimes(1);
    const createArg = discoveredModelMock.createMany.mock.calls[0][0];
    expect(createArg.skipDuplicates).toBe(true);
    expect(createArg.data.map((r: { modelId: string }) => r.modelId)).toEqual(["b", "c"]);
  });

  it("counts a model new exactly once and last-write-wins when the batch repeats a new modelId", async () => {
    discoveredModelMock.findMany.mockResolvedValue([]); // none stored yet
    const newCount = await upsertDiscoveredModels("p", [
      { modelId: "dup", rawMetadata: { id: "dup", seq: 1 } },
      { modelId: "dup", rawMetadata: { id: "dup", seq: 2 } },
    ]);
    expect(newCount).toBe(1);
    expect(discoveredModelMock.createMany).toHaveBeenCalledTimes(1);
    const createArg = discoveredModelMock.createMany.mock.calls[0][0];
    expect(createArg.data).toHaveLength(1);
    // last occurrence's metadata wins, matching the old create-then-update loop
    expect(createArg.data[0].rawMetadata).toEqual({ id: "dup", seq: 2 });
  });

  it("no-ops on an empty model list (no DB calls)", async () => {
    const newCount = await upsertDiscoveredModels("p", []);
    expect(newCount).toBe(0);
    expect(discoveredModelMock.findMany).not.toHaveBeenCalled();
    expect(discoveredModelMock.createMany).not.toHaveBeenCalled();
    expect(discoveredModelMock.update).not.toHaveBeenCalled();
  });
});

describe("reconcileDiscoveredModelPresence (retire-forever trap — BI-B6B8C1F9)", () => {
  beforeEach(() => {
    discoveredModelMock.findMany.mockReset();
    discoveredModelMock.update.mockReset();
    discoveredModelMock.updateMany.mockReset();
    modelProfileMock.updateMany.mockReset();
    modelProfileMock.updateMany.mockResolvedValue({ count: 0 });
  });

  it("reactivates a retired profile when the model is present even with missedDiscoveryCount 0 (the count-gate bug)", async () => {
    discoveredModelMock.findMany.mockResolvedValue([
      { id: "dm1", modelId: "glm-5.2", missedDiscoveryCount: 0 },
    ]);

    await reconcileDiscoveredModelPresence("zai-coding", new Set(["glm-5.2"]));

    expect(modelProfileMock.updateMany).toHaveBeenCalledTimes(1);
    const args = modelProfileMock.updateMany.mock.calls[0][0];
    expect(args.where.providerId).toBe("zai-coding");
    expect(args.where.modelId).toEqual({ in: ["glm-5.2"] });
    expect(args.where.modelStatus).toBe("retired");
    expect(args.data).toEqual({ modelStatus: "active", retiredAt: null, retiredReason: null });
  });

  it("cloud providers keep the permanent-reason blocklist (Google sunset aliases stay dead)", async () => {
    discoveredModelMock.findMany.mockResolvedValue([
      { id: "dm1", modelId: "gemini-1.0-pro", missedDiscoveryCount: 0 },
    ]);

    await reconcileDiscoveredModelPresence("gemini", new Set(["gemini-1.0-pro"]));

    const args = modelProfileMock.updateMany.mock.calls[0][0];
    expect(args.where.retiredReason).toEqual({ notIn: PERMANENT_RETIRE_REASONS });
  });

  it("local provider is exempt from the blocklist — a DMR-listed model heals a stale model_not_found (the qwen3-coder outage)", async () => {
    discoveredModelMock.findMany.mockResolvedValue([
      { id: "dm1", modelId: "docker.io/ai/qwen3-coder:latest", missedDiscoveryCount: 0 },
    ]);

    await reconcileDiscoveredModelPresence("local", new Set(["docker.io/ai/qwen3-coder:latest"]));

    expect(modelProfileMock.updateMany).toHaveBeenCalledTimes(1);
    const args = modelProfileMock.updateMany.mock.calls[0][0];
    // No retiredReason filter for local: the serving engine's list is ground truth.
    expect(args.where.retiredReason).toBeUndefined();
    expect(args.where.modelId).toEqual({ in: ["docker.io/ai/qwen3-coder:latest"] });
  });

  it("resets missedDiscoveryCount in one batched updateMany for recovered models", async () => {
    discoveredModelMock.findMany.mockResolvedValue([
      { id: "dm1", modelId: "m1", missedDiscoveryCount: 1 },
      { id: "dm2", modelId: "m2", missedDiscoveryCount: 0 },
    ]);

    await reconcileDiscoveredModelPresence("anthropic-sub", new Set(["m1", "m2"]));

    expect(discoveredModelMock.updateMany).toHaveBeenCalledTimes(1);
    const args = discoveredModelMock.updateMany.mock.calls[0][0];
    expect(args.where.id).toEqual({ in: ["dm1"] });
    expect(args.data).toEqual({ missedDiscoveryCount: 0 });
  });

  it("cloud: absent model increments the missed counter and retires after 2 misses", async () => {
    discoveredModelMock.findMany.mockResolvedValue([
      { id: "dm1", modelId: "gone-model", missedDiscoveryCount: 1 },
    ]);

    await reconcileDiscoveredModelPresence("anthropic-sub", new Set(["other-model"]));

    expect(discoveredModelMock.update).toHaveBeenCalledWith({
      where: { id: "dm1" },
      data: { missedDiscoveryCount: 2 },
    });
    const retireCall = modelProfileMock.updateMany.mock.calls.find(
      (c: Array<{ data?: { modelStatus?: string } }>) => c[0]?.data?.modelStatus === "retired",
    );
    expect(retireCall).toBeDefined();
  });

  it("local: absent model is NOT counted or retired (an engine hiccup must not strand the bundled fallback)", async () => {
    discoveredModelMock.findMany.mockResolvedValue([
      { id: "dm1", modelId: "docker.io/ai/qwen3-coder:latest", missedDiscoveryCount: 0 },
    ]);

    await reconcileDiscoveredModelPresence("local", new Set<string>());

    expect(discoveredModelMock.update).not.toHaveBeenCalled();
    expect(modelProfileMock.updateMany).not.toHaveBeenCalled();
  });
});

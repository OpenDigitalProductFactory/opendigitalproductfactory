import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @dpf/db so providerHasConfiguredCredential can be exercised without a
// live database. The other (pure) functions under test never touch prisma, so
// this mock is inert for them.
const credState = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    credentialEntry: {
      findUnique: vi.fn(async () => credState.row),
    },
  },
}));

import {
  buildAutoDiscoveryEvalEvents,
  extractTokenUsage,
  providerHasConfiguredCredential,
  resolveSyncedToolUse,
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

  it("oauth2_client_credentials is eligible with a client secret or token material", async () => {
    credState.row = { secretRef: null, clientSecret: "enc:cs", cachedToken: null, refreshToken: null };
    expect(await providerHasConfiguredCredential("p", "oauth2_client_credentials")).toBe(true);
    credState.row = { secretRef: null, clientSecret: null, cachedToken: null, refreshToken: null };
    expect(await providerHasConfiguredCredential("p", "oauth2_client_credentials")).toBe(false);
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

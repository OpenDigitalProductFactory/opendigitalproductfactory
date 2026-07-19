import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBuildStudioConfig } from "./build-studio-config";

const resolveSelection = vi.hoisted(() => vi.fn());
vi.mock("./build-engine-selection-runtime", () => ({
  resolveBuildEngineSelection: resolveSelection,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: {
      findUnique: vi.fn(),
    },
    modelProvider: {
      findMany: vi.fn(),
    },
    credentialEntry: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
const mockFindUnique = vi.mocked(prisma.platformConfig.findUnique);
const mockProviderFindMany = vi.mocked(prisma.modelProvider.findMany);
const mockCredentialFindUnique = vi.mocked(prisma.credentialEntry.findUnique);

function providerRow(
  providerId: string,
  status: "active" | "inactive" | "unconfigured" = "active",
  authMethod: string = "api_key",
): Awaited<ReturnType<typeof prisma.modelProvider.findMany>>[number] {
  return { providerId, status, authMethod } as Awaited<ReturnType<typeof prisma.modelProvider.findMany>>[number];
}

function credentialRow(status: "active" | "configured" | "pending"): NonNullable<Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>> {
  return { status } as NonNullable<Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>>;
}

function selection(engine: "claude" | "codex" | "grok" | "opencode" | "agentic", providerId: string = engine) {
  return {
    status: "selected" as const,
    policy: { mode: "auto" as const, pinnedEngine: null },
    selected: {
      engine,
      providerId,
      modelId: null,
      local: engine === "opencode",
      registered: true,
      present: true,
      providerStatus: "active",
      authMethod: engine === "opencode" ? "none" : "oauth",
      credentialStatus: engine === "opencode" ? null : "active",
      credentialExpiresAt: null,
      providerCapacityState: "available",
      providerRetryAt: null,
      cliRetryAt: null,
      providerHealth: "healthy" as const,
    },
    reason: `Selected ${engine} through routeEndpointV2.`,
    rejected: [],
    fallbackChain: [],
    fallbackDisabled: false,
    action: null,
  };
}

describe("getBuildStudioConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLI_DISPATCH_PROVIDER;
    delete process.env.CODEX_DISPATCH;
    delete process.env.CLAUDE_CODE_PROVIDER_ID;
    delete process.env.CODEX_PROVIDER_ID;
    delete process.env.GROK_PROVIDER_ID;
    delete process.env.CLAUDE_CODE_MODEL;
    delete process.env.CODEX_MODEL;
    delete process.env.GROK_MODEL;
    delete process.env.OPENCODE_PROVIDER_ID;
    delete process.env.OPENCODE_MODEL;
    mockProviderFindMany.mockResolvedValue([]);
    mockCredentialFindUnique.mockResolvedValue(null);
    resolveSelection.mockResolvedValue(selection("agentic"));
  });

  it("returns defaults when no DB config and no env vars", async () => {
    mockFindUnique.mockResolvedValue(null);
    const config = await getBuildStudioConfig();
    expect(config).toMatchObject({
      provider: "agentic",
      enginePolicy: "auto",
      pinnedEngine: null,
      claudeProviderId: "",
      codexProviderId: "",
      grokProviderId: "",
      opencodeProviderId: "",
      claudeModel: "sonnet",
      codexModel: "",
      grokModel: "",
      opencodeModel: "",
    });
    expect(config.selection?.selected?.engine).toBe("agentic");
  });

  it("reads config from PlatformConfig DB row", async () => {
    mockFindUnique.mockResolvedValue({
      id: "1",
      key: "build-studio-dispatch",
      value: {
        provider: "claude",
        claudeProviderId: "anthropic",
        codexProviderId: "codex",
        claudeModel: "opus",
        codexModel: "o4-mini",
      },
      updatedAt: new Date(),
    });
    resolveSelection.mockResolvedValue(selection("claude", "anthropic"));
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.enginePolicy).toBe("auto");
    expect(config.claudeProviderId).toBe("anthropic");
    expect(config.claudeModel).toBe("opus");
  });

  it("merges partial DB config with defaults", async () => {
    mockProviderFindMany
      .mockResolvedValueOnce([providerRow("anthropic-sub")])
      .mockResolvedValueOnce([providerRow("chatgpt")]);
    mockCredentialFindUnique
      .mockResolvedValueOnce(credentialRow("active"))
      .mockResolvedValueOnce(credentialRow("active"));
    mockFindUnique.mockResolvedValue({
      id: "1",
      key: "build-studio-dispatch",
      value: { provider: "claude" },
      updatedAt: new Date(),
    });
    resolveSelection.mockResolvedValue(selection("claude", "anthropic-sub"));
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.claudeProviderId).toBe("anthropic-sub");
    expect(config.codexProviderId).toBe("chatgpt");
    expect(config.claudeModel).toBe("sonnet");
  });

  it("treats an env engine override as a deliberate hard pin", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.CLI_DISPATCH_PROVIDER = "claude";
    process.env.CLAUDE_CODE_MODEL = "opus";
    resolveSelection.mockResolvedValue({
      status: "blocked",
      policy: { mode: "pinned", pinnedEngine: "claude" },
      selected: null,
      reason: "Claude is not ready.",
      rejected: [],
      fallbackChain: [],
      fallbackDisabled: true,
      action: "Restore Claude; automatic fallback was disabled by the hard pin.",
    });
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.enginePolicy).toBe("pinned");
    expect(config.pinnedEngine).toBe("claude");
    expect(config.claudeModel).toBe("opus");
  });

  it("prefers configured claude provider over codex during auto-detect", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockProviderFindMany
      .mockResolvedValueOnce([providerRow("anthropic-sub")])
      .mockResolvedValueOnce([providerRow("chatgpt")]);
    mockCredentialFindUnique
      .mockResolvedValueOnce(credentialRow("active"))
      .mockResolvedValueOnce(credentialRow("active"));

    resolveSelection.mockResolvedValue(selection("claude", "anthropic-sub"));
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.claudeProviderId).toBe("anthropic-sub");
    expect(config.codexProviderId).toBe("chatgpt");
  });

  it("ignores inactive CLI providers when auto-detecting dispatch engine", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockProviderFindMany
      .mockResolvedValueOnce([providerRow("anthropic-sub", "inactive")])
      .mockResolvedValueOnce([providerRow("chatgpt", "active")]);
    mockCredentialFindUnique
      .mockResolvedValueOnce(credentialRow("active"))
      .mockResolvedValueOnce(credentialRow("active"));

    resolveSelection.mockResolvedValue(selection("codex", "chatgpt"));
    const config = await getBuildStudioConfig();

    expect(config.provider).toBe("codex");
    expect(config.claudeProviderId).toBe("");
    expect(config.codexProviderId).toBe("chatgpt");
  });

  it("falls back to legacy CODEX_DISPATCH=false as agentic", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.CODEX_DISPATCH = "false";
    resolveSelection.mockResolvedValue({ ...selection("agentic"), policy: { mode: "pinned", pinnedEngine: "agentic" }, fallbackDisabled: true });
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("agentic");
  });

  it("auto-detects opencode from an active no-auth local provider with no credential row", async () => {
    mockFindUnique.mockResolvedValue(null);
    // claude, codex, grok find nothing; opencode finds the local model provider.
    mockProviderFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([providerRow("local", "active", "none")]);
    // No credentialEntry exists for the no-auth provider — must still detect.
    mockCredentialFindUnique.mockResolvedValue(null);

    resolveSelection.mockResolvedValue(selection("opencode", "local"));
    const config = await getBuildStudioConfig();

    expect(config.provider).toBe("opencode");
    expect(config.opencodeProviderId).toBe("local");
  });

  it("auto-detects zai-coding for OpenCode when only the main zai credential exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockProviderFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([providerRow("zai-coding", "active", "api_key")]);
    mockCredentialFindUnique.mockResolvedValue(credentialRow("active"));

    resolveSelection.mockResolvedValue(selection("opencode", "zai-coding"));
    const config = await getBuildStudioConfig();

    expect(config.provider).toBe("opencode");
    expect(config.opencodeProviderId).toBe("zai-coding");
  });

  it("prefers a configured frontier CLI over the local opencode provider", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockProviderFindMany
      .mockResolvedValueOnce([providerRow("anthropic-sub")])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([providerRow("local", "active", "none")]);
    mockCredentialFindUnique.mockResolvedValueOnce(credentialRow("active"));

    resolveSelection.mockResolvedValue(selection("claude", "anthropic-sub"));
    const config = await getBuildStudioConfig();

    expect(config.provider).toBe("claude");
    expect(config.opencodeProviderId).toBe("local");
  });

  it("honors CLI_DISPATCH_PROVIDER=opencode when a local provider is active", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.CLI_DISPATCH_PROVIDER = "opencode";
    mockProviderFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([providerRow("local", "active", "none")]);
    mockCredentialFindUnique.mockResolvedValue(null);

    resolveSelection.mockResolvedValue({ ...selection("opencode", "local"), policy: { mode: "pinned", pinnedEngine: "opencode" }, fallbackDisabled: true });
    const config = await getBuildStudioConfig();

    expect(config.provider).toBe("opencode");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBuildStudioConfig } from "./build-studio-config";

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

function providerRow(providerId: string): Awaited<ReturnType<typeof prisma.modelProvider.findMany>>[number] {
  return { providerId } as Awaited<ReturnType<typeof prisma.modelProvider.findMany>>[number];
}

function credentialRow(status: "ok" | "configured" | "pending"): NonNullable<Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>> {
  return { status } as NonNullable<Awaited<ReturnType<typeof prisma.credentialEntry.findUnique>>>;
}

describe("getBuildStudioConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLI_DISPATCH_PROVIDER;
    delete process.env.CODEX_DISPATCH;
    delete process.env.CLAUDE_CODE_PROVIDER_ID;
    delete process.env.CODEX_PROVIDER_ID;
    delete process.env.CLAUDE_CODE_MODEL;
    delete process.env.CODEX_MODEL;
    mockProviderFindMany.mockResolvedValue([]);
    mockCredentialFindUnique.mockResolvedValue(null);
  });

  it("returns defaults when no DB config and no env vars", async () => {
    mockFindUnique.mockResolvedValue(null);
    const config = await getBuildStudioConfig();
    expect(config).toEqual({
      provider: "agentic",
      claudeProviderId: "",
      codexProviderId: "",
      claudeModel: "sonnet",
      codexModel: "",
    });
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
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.claudeProviderId).toBe("anthropic");
    expect(config.claudeModel).toBe("opus");
  });

  it("merges partial DB config with defaults", async () => {
    mockProviderFindMany
      .mockResolvedValueOnce([providerRow("anthropic-sub")])
      .mockResolvedValueOnce([providerRow("chatgpt")]);
    mockCredentialFindUnique
      .mockResolvedValueOnce(credentialRow("ok"))
      .mockResolvedValueOnce(credentialRow("ok"));
    mockFindUnique.mockResolvedValue({
      id: "1",
      key: "build-studio-dispatch",
      value: { provider: "claude" },
      updatedAt: new Date(),
    });
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.claudeProviderId).toBe("anthropic-sub");
    expect(config.codexProviderId).toBe("chatgpt");
    expect(config.claudeModel).toBe("sonnet");
  });

  it("stays on agentic when env vars request claude but no configured cli provider exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.CLI_DISPATCH_PROVIDER = "claude";
    process.env.CLAUDE_CODE_MODEL = "opus";
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("agentic");
    expect(config.claudeModel).toBe("opus");
  });

  it("prefers configured claude provider over codex during auto-detect", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockProviderFindMany
      .mockResolvedValueOnce([providerRow("anthropic-sub")])
      .mockResolvedValueOnce([providerRow("chatgpt")]);
    mockCredentialFindUnique
      .mockResolvedValueOnce(credentialRow("ok"))
      .mockResolvedValueOnce(credentialRow("ok"));

    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.claudeProviderId).toBe("anthropic-sub");
    expect(config.codexProviderId).toBe("chatgpt");
  });

  it("falls back to legacy CODEX_DISPATCH=false as agentic", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.CODEX_DISPATCH = "false";
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("agentic");
  });
});

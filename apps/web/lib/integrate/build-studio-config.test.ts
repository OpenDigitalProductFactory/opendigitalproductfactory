import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBuildStudioConfig } from "./build-studio-config";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
const mockFindUnique = vi.mocked(prisma.platformConfig.findUnique);

describe("getBuildStudioConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLI_DISPATCH_PROVIDER;
    delete process.env.CODEX_DISPATCH;
    delete process.env.CLAUDE_CODE_PROVIDER_ID;
    delete process.env.CODEX_PROVIDER_ID;
    delete process.env.CLAUDE_CODE_MODEL;
    delete process.env.CODEX_MODEL;
  });

  it("returns defaults when no DB config and no env vars", async () => {
    mockFindUnique.mockResolvedValue(null);
    const config = await getBuildStudioConfig();
    expect(config).toEqual({
      provider: "codex",
      claudeProviderId: "anthropic-sub",
      codexProviderId: "chatgpt",
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
    mockFindUnique.mockResolvedValue({
      id: "1",
      key: "build-studio-dispatch",
      value: { provider: "claude" },
      updatedAt: new Date(),
    });
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.claudeProviderId).toBe("anthropic-sub");
    expect(config.claudeModel).toBe("sonnet");
  });

  it("falls back to env vars when no DB config", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.CLI_DISPATCH_PROVIDER = "claude";
    process.env.CLAUDE_CODE_MODEL = "opus";
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.claudeModel).toBe("opus");
  });

  it("falls back to legacy CODEX_DISPATCH=false as agentic", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.CODEX_DISPATCH = "false";
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("agentic");
  });
});

// apps/web/lib/integrate/build-studio-config.ts
// Reads Build Studio dispatch configuration from PlatformConfig DB table.
// Falls back to env vars for backward compatibility with existing deployments.

import { prisma } from "@dpf/db";

export type BuildStudioDispatchConfig = {
  provider: "claude" | "codex" | "agentic";
  claudeProviderId: string;
  codexProviderId: string;
  claudeModel: string;
  codexModel: string;
};

const DEFAULTS: BuildStudioDispatchConfig = {
  provider: "codex",
  claudeProviderId: "anthropic-sub",
  codexProviderId: "chatgpt",
  claudeModel: "sonnet",
  codexModel: "",
};

function resolveProviderFromEnv(): "claude" | "codex" | "agentic" {
  const raw = process.env.CLI_DISPATCH_PROVIDER ?? process.env.CODEX_DISPATCH;
  if (raw === "claude") return "claude";
  if (raw === "false" || raw === "agentic") return "agentic";
  return "codex";
}

export async function getBuildStudioConfig(): Promise<BuildStudioDispatchConfig> {
  const row = await prisma.platformConfig.findUnique({
    where: { key: "build-studio-dispatch" },
  });
  if (row?.value && typeof row.value === "object") {
    return { ...DEFAULTS, ...(row.value as Partial<BuildStudioDispatchConfig>) };
  }
  return {
    provider: resolveProviderFromEnv(),
    claudeProviderId: process.env.CLAUDE_CODE_PROVIDER_ID ?? DEFAULTS.claudeProviderId,
    codexProviderId: process.env.CODEX_PROVIDER_ID ?? DEFAULTS.codexProviderId,
    claudeModel: process.env.CLAUDE_CODE_MODEL ?? DEFAULTS.claudeModel,
    codexModel: process.env.CODEX_MODEL ?? DEFAULTS.codexModel,
  };
}

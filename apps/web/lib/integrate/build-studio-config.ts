// apps/web/lib/integrate/build-studio-config.ts
// Reads Build Studio dispatch configuration from PlatformConfig DB table.
// Auto-resolves from configured providers when no explicit config exists.

import { prisma } from "@dpf/db";

export type BuildStudioDispatchConfig = {
  provider: "claude" | "codex" | "grok" | "agentic";
  claudeProviderId: string;
  codexProviderId: string;
  grokProviderId: string;
  claudeModel: string;
  codexModel: string;
  grokModel: string;
};

const DEFAULTS: BuildStudioDispatchConfig = {
  provider: "agentic",   // safe default — no external provider needed
  claudeProviderId: "",
  codexProviderId: "",
  grokProviderId: "",
  claudeModel: "sonnet",
  codexModel: "",
  grokModel: "",
};

/**
 * Find the first configured provider for a given CLI engine.
 * Returns the providerId or empty string if none configured.
 */
async function findConfiguredProvider(cliEngine: string): Promise<string> {
  // Find providers tagged with this CLI engine
  const providers = await prisma.modelProvider.findMany({
    where: { cliEngine },
    select: { providerId: true, status: true },
    orderBy: { providerId: "asc" },
  });

  if (providers.length === 0) return "";

  // Check which ones have working credentials
  for (const p of providers) {
    if (p.status !== "active") continue;
    const cred = await prisma.credentialEntry.findUnique({
      where: { providerId: p.providerId },
      select: { status: true },
    });
    if (cred && (cred.status === "ok" || cred.status === "configured" || cred.status === "pending")) {
      return p.providerId;
    }
  }
  return "";
}

/**
 * Auto-detect the best dispatch provider based on what's configured.
 * Prefers active Claude over active Codex; falls back to agentic if nothing configured.
 */
async function autoDetectConfig(): Promise<BuildStudioDispatchConfig> {
  const claudeId = await findConfiguredProvider("claude");
  const codexId = await findConfiguredProvider("codex");
  const grokId = await findConfiguredProvider("grok");

  // Pick the first available CLI engine
  let provider: BuildStudioDispatchConfig["provider"] = "agentic";
  if (claudeId) provider = "claude";
  else if (codexId) provider = "codex";
  else if (grokId) provider = "grok";

  // Env var override
  const envProvider = process.env.CLI_DISPATCH_PROVIDER ?? process.env.CODEX_DISPATCH;
  if (envProvider === "claude" && claudeId) provider = "claude";
  else if (envProvider === "codex" && codexId) provider = "codex";
  else if (envProvider === "grok" && grokId) provider = "grok";
  else if (envProvider === "false" || envProvider === "agentic") provider = "agentic";

  return {
    provider,
    claudeProviderId: process.env.CLAUDE_CODE_PROVIDER_ID ?? claudeId,
    codexProviderId: process.env.CODEX_PROVIDER_ID ?? codexId,
    grokProviderId: process.env.GROK_PROVIDER_ID ?? grokId,
    claudeModel: process.env.CLAUDE_CODE_MODEL ?? DEFAULTS.claudeModel,
    codexModel: process.env.CODEX_MODEL ?? DEFAULTS.codexModel,
    grokModel: process.env.GROK_MODEL ?? DEFAULTS.grokModel,
  };
}

export async function getBuildStudioConfig(): Promise<BuildStudioDispatchConfig> {
  // If explicit config exists, use it
  const row = await prisma.platformConfig.findUnique({
    where: { key: "build-studio-dispatch" },
  });
  if (row?.value && typeof row.value === "object") {
    const saved = row.value as Partial<BuildStudioDispatchConfig>;
    // Still auto-fill provider IDs if they were left empty
    const claudeId = saved.claudeProviderId || await findConfiguredProvider("claude");
    const codexId = saved.codexProviderId || await findConfiguredProvider("codex");
    const grokId = saved.grokProviderId || await findConfiguredProvider("grok");
    return {
      ...DEFAULTS,
      ...saved,
      claudeProviderId: claudeId,
      codexProviderId: codexId,
      grokProviderId: grokId,
    };
  }

  // No explicit config — auto-detect from configured providers
  return autoDetectConfig();
}

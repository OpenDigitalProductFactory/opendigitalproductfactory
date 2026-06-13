"use server";

import { prisma, type Prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { BuildStudioDispatchConfig } from "@/lib/integrate/build-studio-config";
import { getOllamaBaseUrl } from "@/lib/inference/ollama-url";
import { preflightLocalEndpoint, type LocalEndpointPreflight } from "@/lib/integrate/opencode-dispatch";

async function requireManageProviders(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

const VALID_ENGINES = new Set(["claude", "codex", "grok", "opencode", "agentic"]);
const VALID_CLAUDE_MODELS = new Set(["haiku", "sonnet", "opus"]);

export async function saveBuildStudioConfig(
  config: BuildStudioDispatchConfig,
): Promise<{ ok: true }> {
  await requireManageProviders();

  if (!VALID_ENGINES.has(config.provider)) {
    throw new Error(`Invalid provider engine: ${config.provider}`);
  }

  // Validate provider IDs dynamically against what's in the DB
  if (config.claudeProviderId) {
    const claudeProvider = await prisma.modelProvider.findFirst({
      where: { providerId: config.claudeProviderId, cliEngine: "claude" },
    });
    if (!claudeProvider) {
      throw new Error(`Provider ${config.claudeProviderId} is not a Claude-compatible provider`);
    }
  }
  if (config.codexProviderId) {
    const codexProvider = await prisma.modelProvider.findFirst({
      where: { providerId: config.codexProviderId, cliEngine: "codex" },
    });
    if (!codexProvider) {
      throw new Error(`Provider ${config.codexProviderId} is not a Codex-compatible provider`);
    }
  }
  if (config.grokProviderId) {
    const grokProvider = await prisma.modelProvider.findFirst({
      where: { providerId: config.grokProviderId, cliEngine: "grok" },
    });
    if (!grokProvider) {
      throw new Error(`Provider ${config.grokProviderId} is not a Grok-compatible provider`);
    }
  }
  if (config.opencodeProviderId) {
    const opencodeProvider = await prisma.modelProvider.findFirst({
      where: { providerId: config.opencodeProviderId, cliEngine: "opencode" },
    });
    if (!opencodeProvider) {
      throw new Error(`Provider ${config.opencodeProviderId} is not an OpenCode-compatible (local) provider`);
    }
  }

  if (config.claudeModel && !VALID_CLAUDE_MODELS.has(config.claudeModel)) {
    throw new Error(`Invalid Claude model: ${config.claudeModel}`);
  }

  await prisma.platformConfig.upsert({
    where: { key: "build-studio-dispatch" },
    update: { value: config as unknown as Prisma.InputJsonValue },
    create: { key: "build-studio-dispatch", value: config as unknown as Prisma.InputJsonValue },
  });

  return { ok: true };
}

/**
 * Config-time preflight of the local model endpoint behind the opencode engine.
 * Surfaces, at configuration time rather than first at dispatch, whether the
 * install's local OpenAI-compatible endpoint is reachable and serving the
 * desired model. Read-only; gated on the same manage-providers capability.
 */
export async function checkLocalEndpoint(
  model: string,
): Promise<LocalEndpointPreflight> {
  await requireManageProviders();
  const portalBaseUrl = getOllamaBaseUrl().replace(/\/$/, "");
  return preflightLocalEndpoint(portalBaseUrl, model ?? "");
}

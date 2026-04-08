"use server";

import { prisma, type Prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { BuildStudioDispatchConfig } from "@/lib/integrate/build-studio-config";

async function requireManageProviders(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

const VALID_PROVIDERS = new Set(["claude", "codex", "agentic"]);
const VALID_CLAUDE_PROVIDERS = new Set(["anthropic", "anthropic-sub"]);
const VALID_CODEX_PROVIDERS = new Set(["codex", "chatgpt"]);
const VALID_CLAUDE_MODELS = new Set(["haiku", "sonnet", "opus"]);

export async function saveBuildStudioConfig(
  config: BuildStudioDispatchConfig,
): Promise<{ ok: true }> {
  await requireManageProviders();

  if (!VALID_PROVIDERS.has(config.provider)) {
    throw new Error(`Invalid provider: ${config.provider}`);
  }
  if (!VALID_CLAUDE_PROVIDERS.has(config.claudeProviderId)) {
    throw new Error(`Invalid Claude provider ID: ${config.claudeProviderId}`);
  }
  if (!VALID_CODEX_PROVIDERS.has(config.codexProviderId)) {
    throw new Error(`Invalid Codex provider ID: ${config.codexProviderId}`);
  }
  if (!VALID_CLAUDE_MODELS.has(config.claudeModel)) {
    throw new Error(`Invalid Claude model: ${config.claudeModel}`);
  }

  await prisma.platformConfig.upsert({
    where: { key: "build-studio-dispatch" },
    update: { value: config as unknown as Prisma.InputJsonValue },
    create: { key: "build-studio-dispatch", value: config as unknown as Prisma.InputJsonValue },
  });

  return { ok: true };
}

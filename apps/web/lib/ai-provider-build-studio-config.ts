import { prisma, type Prisma } from "@dpf/db";

/**
 * If no Build Studio config exists, automatically set it based on the newly
 * configured provider. If config exists but the relevant engine's providerId is
 * empty, fill it in.
 */
export async function autoConfigureBuildStudio(providerId: string): Promise<void> {
  const buildProviderId = providerId === "zai" ? "zai-coding" : providerId;
  const provider = await prisma.modelProvider.findUnique({
    where: { providerId: buildProviderId },
    select: { cliEngine: true },
  });
  if (!provider?.cliEngine) return;

  const cliEngine = provider.cliEngine as "claude" | "codex" | "grok" | "opencode";
  const existing = await prisma.platformConfig.findUnique({
    where: { key: "build-studio-dispatch" },
  });

  if (!existing) {
    const config = {
      provider: cliEngine,
      claudeProviderId: cliEngine === "claude" ? buildProviderId : "",
      codexProviderId: cliEngine === "codex" ? buildProviderId : "",
      grokProviderId: cliEngine === "grok" ? buildProviderId : "",
      opencodeProviderId: cliEngine === "opencode" ? buildProviderId : "",
      claudeModel: "sonnet",
      codexModel: "",
      grokModel: "",
      opencodeModel: "",
    };
    await prisma.platformConfig.create({
      data: {
        key: "build-studio-dispatch",
        value: config as unknown as Prisma.InputJsonValue,
      },
    });
    return;
  }

  if (existing.value && typeof existing.value === "object") {
    const config = existing.value as Record<string, unknown>;
    const claudeKey = "claudeProviderId";
    const codexKey = "codexProviderId";
    const grokKey = "grokProviderId";
    const opencodeKey = "opencodeProviderId";

    if (cliEngine === "claude" && !config[claudeKey]) {
      config[claudeKey] = buildProviderId;
      if (config.provider === "agentic" || (config.provider === "codex" && !config[codexKey])) {
        config.provider = "claude";
      }
      await prisma.platformConfig.update({
        where: { key: "build-studio-dispatch" },
        data: { value: config as unknown as Prisma.InputJsonValue },
      });
    } else if (cliEngine === "codex" && !config[codexKey]) {
      config[codexKey] = buildProviderId;
      if (config.provider === "agentic") {
        config.provider = "codex";
      }
      await prisma.platformConfig.update({
        where: { key: "build-studio-dispatch" },
        data: { value: config as unknown as Prisma.InputJsonValue },
      });
    } else if (cliEngine === "grok" && !config[grokKey]) {
      config[grokKey] = buildProviderId;
      if (config.provider === "agentic") {
        config.provider = "grok";
      }
      await prisma.platformConfig.update({
        where: { key: "build-studio-dispatch" },
        data: { value: config as unknown as Prisma.InputJsonValue },
      });
    } else if (cliEngine === "opencode" && !config[opencodeKey]) {
      config[opencodeKey] = buildProviderId;
      if (config.provider === "agentic") {
        config.provider = "opencode";
      }
      await prisma.platformConfig.update({
        where: { key: "build-studio-dispatch" },
        data: { value: config as unknown as Prisma.InputJsonValue },
      });
    }
  }
}

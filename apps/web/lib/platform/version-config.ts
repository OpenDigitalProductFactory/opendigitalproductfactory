import { loadPlatformVersion, type PlatformVersion } from "./version";

export const PLATFORM_VERSION_CONFIG_KEY = "platform.version";

type PlatformConfigHandle = {
  upsert: (args: {
    where: { key: string };
    update: { value: Record<string, unknown> };
    create: { key: string; value: Record<string, unknown> };
  }) => Promise<unknown>;
};

export async function syncPlatformVersionConfig(deps?: {
  load?: () => Promise<PlatformVersion>;
  platformConfig?: PlatformConfigHandle;
}): Promise<void> {
  const load = deps?.load ?? loadPlatformVersion;
  const platformConfig =
    deps?.platformConfig ?? (await import("@dpf/db")).prisma.platformConfig;
  const version = await load();
  const value = {
    version: version.version,
    publishedAt: version.publishedAt.toISOString(),
    gitSha: version.gitSha,
    note: version.note,
    source: "version.json",
  };

  await platformConfig.upsert({
    where: { key: PLATFORM_VERSION_CONFIG_KEY },
    update: { value },
    create: { key: PLATFORM_VERSION_CONFIG_KEY, value },
  });
}

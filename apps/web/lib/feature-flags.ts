import { prisma } from "@dpf/db";

export async function isUnifiedCoworkerEnabled(): Promise<boolean> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "USE_UNIFIED_COWORKER" },
  });
  const val = config?.value as { enabled?: boolean } | null;
  return val?.enabled === true;
}

export async function isManifestRouterEnabled(): Promise<boolean> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "USE_MANIFEST_ROUTER" },
  });
  const val = config?.value as { enabled?: boolean } | null;
  return val?.enabled === true;
}

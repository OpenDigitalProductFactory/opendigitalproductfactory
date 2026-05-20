import { z } from "zod";

import { prisma } from "@dpf/db";

export const SELF_UPGRADE_CONFIG_KEY = "self_upgrade";

const SAFE_NAME_RE = /^[A-Za-z0-9_.:-]+$/;
const SAFE_PATH_RE = /^[A-Za-z0-9_./:\\-]+$/;

export const SelfUpgradeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  hostInstallPath: z.string().min(1).regex(SAFE_PATH_RE),
  hostSourceMountPath: z.string().min(1).regex(SAFE_PATH_RE).default("/host-source"),
  composeProject: z.string().min(1).regex(SAFE_NAME_RE).default("dpf"),
  portalContainerName: z.string().min(1).regex(SAFE_NAME_RE).default("dpf-portal-1"),
  dbContainerName: z.string().min(1).regex(SAFE_NAME_RE).default("dpf-postgres-1"),
  repositoryRemote: z.string().min(1).regex(SAFE_NAME_RE).default("origin"),
  repositoryBranch: z.string().min(1).regex(SAFE_NAME_RE).default("main"),
  healthUrl: z.string().url().default("http://localhost:3000/api/health"),
  promoterImage: z.string().min(1).regex(SAFE_NAME_RE).default("dpf-promoter"),
});

export type SelfUpgradeConfig = z.infer<typeof SelfUpgradeConfigSchema>;

function envDefaults(): Partial<SelfUpgradeConfig> {
  return {
    enabled: process.env.DPF_SELF_UPGRADE_ENABLED !== "false",
    hostInstallPath: process.env.DPF_HOST_INSTALL_PATH ?? process.env.PROJECT_ROOT,
    hostSourceMountPath: process.env.DPF_SELF_UPGRADE_HOST_SOURCE_MOUNT ?? "/host-source",
    composeProject: process.env.COMPOSE_PROJECT_NAME ?? "dpf",
    portalContainerName: process.env.DPF_PRODUCTION_PORTAL_CONTAINER ?? "dpf-portal-1",
    dbContainerName: process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1",
    repositoryRemote: process.env.DPF_SELF_UPGRADE_REMOTE ?? "origin",
    repositoryBranch: process.env.DPF_SELF_UPGRADE_BRANCH ?? "main",
    healthUrl: process.env.DPF_SELF_UPGRADE_HEALTH_URL ?? "http://localhost:3000/api/health",
    promoterImage: process.env.DPF_PROMOTER_IMAGE ?? "dpf-promoter",
  };
}

export async function loadSelfUpgradeConfig(): Promise<SelfUpgradeConfig> {
  const row = await prisma.platformConfig.findUnique({
    where: { key: SELF_UPGRADE_CONFIG_KEY },
    select: { value: true },
  });

  return SelfUpgradeConfigSchema.parse({
    ...envDefaults(),
    ...(row?.value && typeof row.value === "object" ? row.value : {}),
  });
}

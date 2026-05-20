import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";

import type { SelfUpgradeConfig } from "./config";

const execFile = promisify(execFileCb);

type PromoterConfig = Omit<SelfUpgradeConfig, "promoterImage"> &
  Partial<Pick<SelfUpgradeConfig, "promoterImage">>;

export type PromoterStartResult = {
  containerName: string;
};

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildPromoterDockerArgs(
  config: PromoterConfig,
  runId: string,
  targetSha?: string | null,
): string[] {
  const containerName = `dpf-promoter-self-upgrade-${runId}`;
  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    `${config.hostInstallPath}:${config.hostSourceMountPath}`,
    "-v",
    "dpf_backups:/backups",
    "--network",
    `${config.composeProject}_default`,
    "-e",
    "SELF_UPGRADE=1",
    "-e",
    `SELF_UPGRADE_RUN_ID=${runId}`,
    "-e",
    `DPF_HOST_SOURCE_PATH=${config.hostSourceMountPath}`,
    "-e",
    `DPF_COMPOSE_PROJECT=${config.composeProject}`,
    "-e",
    `DPF_PORTAL_CONTAINER=${config.portalContainerName}`,
    "-e",
    `DPF_PRODUCTION_DB_CONTAINER=${config.dbContainerName}`,
    "-e",
    `DPF_DB_CONTAINER=${config.dbContainerName}`,
    "-e",
    `DPF_SELF_UPGRADE_REMOTE=${config.repositoryRemote}`,
    "-e",
    `DPF_SELF_UPGRADE_BRANCH=${config.repositoryBranch}`,
    "-e",
    `DPF_SELF_UPGRADE_HEALTH_URL=${config.healthUrl}`,
  ];

  if (targetSha) {
    args.push("-e", `SELF_UPGRADE_TARGET_SHA=${targetSha}`);
  }

  args.push(config.promoterImage ?? "dpf-promoter", "--self-upgrade");
  return args;
}

export async function startSelfUpgradePromoter(
  config: PromoterConfig,
  runId: string,
  targetSha?: string | null,
): Promise<PromoterStartResult> {
  const containerName = `dpf-promoter-self-upgrade-${runId}`;
  await execFile("docker", buildPromoterDockerArgs(config, runId, targetSha));
  return { containerName };
}

import { spawn } from "node:child_process";
import { resolve } from "node:path";

// ─── Legacy API ──────────────────────────────────────────────────────────────

export type PromoterStartResult = {
  containerName: string;
};

/** @deprecated */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

type LegacyPromoterConfig = {
  hostInstallPath?: string;
  hostSourceMountPath?: string;
  composeProject?: string;
  portalContainerName?: string;
  dbContainerName?: string;
  repositoryRemote?: string;
  repositoryBranch?: string;
  healthUrl?: string;
  promoterImage?: string;
  [key: string]: unknown;
};

/** @deprecated Use runPromoter instead */
export function buildPromoterDockerArgs(config: LegacyPromoterConfig, runId: string, _targetSha?: string | null): string[] {
  const image = (config.promoterImage as string) ?? "dpf-promoter";
  const hostSource = (config.hostInstallPath as string) ?? "";
  const mountPath = (config.hostSourceMountPath as string) ?? "/host-source";
  return [
    "run",
    "--name", `dpf-promoter-self-upgrade-${runId}`,
    "-v", `${hostSource}:${mountPath}`,
    "-e", "SELF_UPGRADE=1",
    image,
    "--self-upgrade",
  ];
}

/** @deprecated Use runPromoter instead */
export async function startSelfUpgradePromoter(_config: LegacyPromoterConfig, _runId: string, _targetSha?: string | null): Promise<PromoterStartResult> {
  return { containerName: `dpf-promoter-self-upgrade-${_runId}` };
}

export type PromoterParams = {
  sourcePath: string;
  targetSha: string;
  backupPath: string;
  healthUrl: string;
  dryRun?: boolean;
};

export type PromoterResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runPromoter(params: PromoterParams): Promise<PromoterResult> {
  const scriptPath = resolve(process.cwd(), "scripts/promote.sh");
  const args = ["--self-upgrade"];
  if (params.dryRun) args.push("--dry-run");

  return new Promise((done, reject) => {
    const child = spawn("bash", [scriptPath, ...args], {
      env: {
        ...process.env,
        PROMOTE_SOURCE: params.sourcePath,
        PROMOTE_TARGET_SHA: params.targetSha,
        PROMOTE_BACKUP_PATH: params.backupPath,
        PROMOTE_HEALTH_URL: params.healthUrl,
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });

    child.on("close", (code: number | null) => {
      done({ exitCode: code ?? 1, stdout, stderr });
    });

    child.on("error", reject);
  });
}

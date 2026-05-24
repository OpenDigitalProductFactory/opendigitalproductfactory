import { spawn } from "node:child_process";
import { resolve } from "node:path";

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

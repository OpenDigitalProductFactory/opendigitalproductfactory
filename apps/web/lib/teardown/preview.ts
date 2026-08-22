import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { SelfUpgradeConfig } from "@/lib/self-upgrade/config";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { isNestedPath, scopeDeletesSource, scopeDeletesVolumes, type TeardownScope } from "./contract";
import { canonicalJson } from "./signing";

export interface TeardownSalvageReport {
  path: string;
  remoteUrl?: string | null;
  classification?: string;
  dirtyPaths?: number;
  stashes?: number;
  unreachableCommits?: number;
  branches?: Array<{ branch: string; commitsUnreachableFromRemotes: number }>;
  atRisk: boolean;
  error?: string;
}

export interface TeardownPreview {
  runId: string;
  scope: TeardownScope;
  installPath: string;
  backupsPath: string;
  composeProject: string;
  composeFiles: string[];
  sourceEvidenceSafe: boolean;
  recoveryRequired: boolean;
  salvageRequired: boolean;
  salvage: TeardownSalvageReport;
  salvageDigest: string;
  blockers: Array<{ surface: string; kind: string; reason: string }>;
  previewDigest: string;
}

function runtimeRepoRoot(): string {
  if (process.env.DPF_RUNTIME_REPO_ROOT?.trim()) return process.env.DPF_RUNTIME_REPO_ROOT.trim();
  return path.resolve(process.cwd(), "../..");
}

export async function runTeardownSalvageSweep(repositoryPath = "/host-dpf"): Promise<TeardownSalvageReport> {
  const script = path.join(runtimeRepoRoot(), "scripts", "salvage-sweep.mjs");
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--json", repositoryPath], { env: { ...process.env }, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      // Exit 2 is the script's intentional at-risk result, not an execution failure.
      if (code !== 0 && code !== 2) {
        reject(new Error(`teardown_salvage_failed:${code ?? "unknown"}:${stderr.trim().slice(-500)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as { repositories?: TeardownSalvageReport[] };
        const report = parsed.repositories?.[0];
        if (!report) throw new Error("empty salvage report");
        resolve(report);
      } catch (error) {
        reject(new Error(`teardown_salvage_report_invalid:${getErrorMessage(error)}`));
      }
    });
  });
}

export function computeSalvageDigest(report: TeardownSalvageReport): string {
  return createHash("sha256").update(canonicalJson({
    classification: report.classification ?? null,
    dirtyPaths: report.dirtyPaths ?? 0,
    stashes: report.stashes ?? 0,
    unreachableCommits: report.unreachableCommits ?? 0,
    branches: (report.branches ?? []).map(({ branch, commitsUnreachableFromRemotes }) => ({ branch, commitsUnreachableFromRemotes })),
    atRisk: Boolean(report.atRisk),
    error: report.error ?? null,
  })).digest("hex");
}

export function resolveTeardownEnvironment(config: SelfUpgradeConfig): {
  installPath: string;
  backupsPath: string;
  composeProject: string;
  composeFiles: string[];
} {
  const installPath = (config.hostInstallPath ?? process.env.DPF_HOST_INSTALL_PATH ?? "").trim().replace(/[\\/]$/, "");
  if (!installPath) throw new Error("teardown_host_install_path_missing");
  const explicitBackups = process.env.DPF_BACKUPS_HOST_PATH?.trim();
  // Mirrors compose's compatibility default for pre-relocation installs.
  const backupsPath = (explicitBackups || `${installPath}/backups`).replace(/[\\/]$/, "");
  const composeProject = (config.composeProject ?? process.env.COMPOSE_PROJECT_NAME ?? "dpf").trim();
  const envFiles = process.env.DPF_SELF_UPGRADE_COMPOSE_FILES?.trim().split(/\s+/).filter(Boolean);
  const composeFiles = config.composeFiles?.length ? config.composeFiles : envFiles?.length ? envFiles : ["docker-compose.yml"];
  return { installPath, backupsPath, composeProject, composeFiles };
}

export async function buildTeardownPreview(args: {
  scope: TeardownScope;
  config: SelfUpgradeConfig;
  blockers?: TeardownPreview["blockers"];
  runId?: string;
  salvage?: TeardownSalvageReport;
}): Promise<TeardownPreview> {
  const environment = resolveTeardownEnvironment(args.config);
  const salvage = args.salvage ?? await runTeardownSalvageSweep();
  const salvageDigest = computeSalvageDigest(salvage);
  const base = {
    runId: args.runId ?? `TDR-${randomBytes(6).toString("hex").toUpperCase()}`,
    scope: args.scope,
    ...environment,
    sourceEvidenceSafe: !isNestedPath(environment.installPath, environment.backupsPath),
    recoveryRequired: scopeDeletesVolumes(args.scope),
    salvageRequired: scopeDeletesSource(args.scope),
    salvage,
    salvageDigest,
    blockers: args.blockers ?? [],
  };
  const previewDigest = createHash("sha256").update(canonicalJson(base)).digest("hex");
  return { ...base, previewDigest };
}

export interface TeardownEvidenceSummary {
  runId: string;
  scope: string;
  status: string;
  stage: string;
  startedAt?: string;
  completedAt?: string;
  failure?: string;
}

export async function readTeardownEvidenceHistory(root = "/backups/teardown"): Promise<TeardownEvidenceSummary[]> {
  const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
  const rows = await Promise.all(directories.filter((entry) => entry.isDirectory()).slice(0, 50).map(async (entry) => {
    try {
      return JSON.parse(await readFile(path.join(root, entry.name, "evidence.json"), "utf8")) as TeardownEvidenceSummary;
    } catch { return null; }
  }));
  return rows.filter((row): row is TeardownEvidenceSummary => Boolean(row)).sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? ""))).slice(0, 20);
}

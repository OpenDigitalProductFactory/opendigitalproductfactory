// apps/web/lib/sandbox-source-strategy.ts
// Pluggable strategy for copying project source into a sandbox container.

import { exec as execCb } from "child_process";
import { promisify } from "util";
import { execInSandbox } from "@/lib/sandbox";

const exec = promisify(execCb);

// ─── Interface ────────────────────────────────────────────────────────────────

export interface SandboxSourceStrategy {
  initializeWorkspace(containerId: string, buildId: string): Promise<void>;
}

// ─── Tar Exclude Helper ───────────────────────────────────────────────────────

const TAR_EXCLUDES = [
  "node_modules",
  ".next",
  ".git",
  ".env*",
  "docker-compose*.yml",
  "Dockerfile*",
  "backups",
];

export function buildTarExcludeFlags(): string[] {
  return TAR_EXCLUDES.map((p) => `--exclude=${p}`);
}

// ─── LocalSourceStrategy ──────────────────────────────────────────────────────

export class LocalSourceStrategy implements SandboxSourceStrategy {
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  async initializeWorkspace(containerId: string, _buildId: string): Promise<void> {
    // 1. Copy source via tar pipe
    const excludes = buildTarExcludeFlags().join(" ");
    await exec(
      `tar cf - ${excludes} -C "${this.projectRoot}" . | docker exec -i ${containerId} tar xf - -C /workspace`,
    );

    // 2. Git baseline so coding agent can produce a clean diff
    await execInSandbox(
      containerId,
      "cd /workspace && git init && git add -A && git commit -m 'sandbox baseline'",
    );
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function getSourceStrategy(mode: string = "local"): SandboxSourceStrategy {
  switch (mode) {
    case "local":
      return new LocalSourceStrategy();
    default:
      throw new Error(
        `Unknown sandbox source mode: ${mode}. Only "local" is supported.`,
      );
  }
}

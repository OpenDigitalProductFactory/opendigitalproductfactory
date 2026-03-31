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
  async initializeWorkspace(containerId: string, _buildId: string): Promise<void> {
    // Resolve the portal container to copy source from.
    let portalContainer = "dpf-portal-1";
    try {
      const { readFileSync } = await import("fs");
      const hostname = readFileSync("/etc/hostname", "utf-8").trim();
      if (hostname && hostname !== "0.0.0.0") portalContainer = hostname;
    } catch { /* fallback */ }

    // 1. Copy root config files from portal image
    const rootFiles = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.base.json"];
    for (const f of rootFiles) {
      await exec(
        `docker exec ${portalContainer} tar -cf - -C /app ${f} | docker exec -i ${containerId} tar -xf - -C /workspace`,
        { timeout: 10_000 },
      ).catch(() => console.log(`[source-strategy] ${f} not found, skipping`));
    }

    // 2. Copy full source from -src paths (not standalone output)
    await exec(
      `docker exec ${portalContainer} tar -cf - -C /app/packages-src . | docker exec -i ${containerId} sh -c 'mkdir -p /workspace/packages && tar -xf - -C /workspace/packages'`,
      { timeout: 60_000 },
    );
    await exec(
      `docker exec ${portalContainer} tar -cf - -C /app/apps/web-src . | docker exec -i ${containerId} sh -c 'mkdir -p /workspace/apps/web && tar -xf - -C /workspace/apps/web'`,
      { timeout: 60_000 },
    );

    // 3. Git baseline so coding agent can produce a clean diff
    await execInSandbox(
      containerId,
      "cd /workspace && git config user.email sandbox@dpf.local && git config user.name 'DPF Sandbox' && git init && git add -A && git commit -m 'sandbox baseline'",
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

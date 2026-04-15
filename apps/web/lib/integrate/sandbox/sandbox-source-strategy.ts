// apps/web/lib/sandbox-source-strategy.ts
// Pluggable strategy for copying project source into a sandbox container.

import { lazyExec, lazyFs } from "@/lib/shared/lazy-node";
import { execInSandbox } from "@/lib/sandbox";

const exec = lazyExec();

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

type SourcePaths = {
  rootConfigDir: string;
  packagesDir: string;
  webAppDir: string;
};

export function buildSourcePaths(activeRoot: string | null | undefined): SourcePaths {
  const normalizedRoot = activeRoot?.trim();
  if (normalizedRoot) {
    return {
      rootConfigDir: normalizedRoot,
      packagesDir: `${normalizedRoot}/packages`,
      webAppDir: `${normalizedRoot}/apps/web`,
    };
  }

  return {
    rootConfigDir: "/app",
    packagesDir: "/app/packages-src",
    webAppDir: "/app/apps/web-src",
  };
}

export function buildWorkspaceRootProbeCommand(portalContainer: string): string {
  const projectRootVar = "${PROJECT_ROOT}";
  return `docker exec ${portalContainer} sh -lc "if [ -n \\"${projectRootVar}\\" ] && [ -f \\"${projectRootVar}/package.json\\" ]; then printf %s \\"${projectRootVar}\\"; elif [ -f /workspace/package.json ]; then printf %s /workspace; fi"`;
}

// ─── LocalSourceStrategy ──────────────────────────────────────────────────────

export class LocalSourceStrategy implements SandboxSourceStrategy {
  async initializeWorkspace(containerId: string, _buildId: string): Promise<void> {
    // Resolve the portal container to copy source from.
    let portalContainer = "dpf-portal-1";
    try {
      const { readFileSync } = lazyFs();
      const hostname = readFileSync("/etc/hostname", "utf-8").trim();
      if (hostname && hostname !== "0.0.0.0") portalContainer = hostname;
    } catch { /* fallback */ }

    let activeWorkspaceRoot: string | null = null;
    try {
      const { stdout } = await exec(
        buildWorkspaceRootProbeCommand(portalContainer),
        { timeout: 10_000 },
      );
      activeWorkspaceRoot = stdout.trim() || null;
    } catch {
      activeWorkspaceRoot = null;
    }

    const sourcePaths = buildSourcePaths(activeWorkspaceRoot);

    // 1. Copy root config files from the active workspace when available,
    //    otherwise fall back to the image-bundled source.
    const rootFiles = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.base.json"];
    for (const f of rootFiles) {
      await exec(
        `docker exec ${portalContainer} tar -cf - -C ${sourcePaths.rootConfigDir} ${f} | docker exec -i ${containerId} tar -xf - -C /workspace`,
        { timeout: 10_000 },
      ).catch(() => console.log(`[source-strategy] ${f} not found, skipping`));
    }

    // 2. Copy full source from the active shared workspace when present.
    //    If the portal is running from an image-only bootstrap, fall back to -src paths.
    await exec(
      `docker exec ${portalContainer} tar -cf - -C ${sourcePaths.packagesDir} . | docker exec -i ${containerId} sh -c 'mkdir -p /workspace/packages && tar -xf - -C /workspace/packages'`,
      { timeout: 60_000 },
    );
    await exec(
      `docker exec ${portalContainer} tar -cf - -C ${sourcePaths.webAppDir} . | docker exec -i ${containerId} sh -c 'mkdir -p /workspace/apps/web && tar -xf - -C /workspace/apps/web'`,
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

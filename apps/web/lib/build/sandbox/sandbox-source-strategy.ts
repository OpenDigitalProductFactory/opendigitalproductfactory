// apps/web/lib/sandbox-source-strategy.ts
// Pluggable strategy for copying project source into a sandbox container.

import { lazyExec, lazyFs } from "@/lib/shared/lazy-node";
import {
  buildSandboxWorkspaceCleanupCommand,
  execInSandbox,
  quotePosixArg,
} from "@/lib/sandbox";
import { hasPrivateActuatorMount } from "../../../../../scripts/lib/scope-writer-observation.mjs";

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

export function pickSandboxSourceRoot(configured: string | undefined, hardened: boolean, exists: (file: string) => boolean): string | null {
  if (hardened) return null;
  return [configured?.trim(), "/workspace"].find(root => root && exists(`${root}/package.json`)) ?? null;
}

export function buildSandboxGitWorkspaceReadyCommand(workspace: string = "/workspace"): string {
  return `if test -d ${workspace}/.git && git -C ${workspace} rev-parse --verify HEAD >/dev/null 2>&1; then printf yes; else printf no; fi`;
}

export function buildWorkspacePackagesCopyCommand(
  containerId: string,
  packagesDir: string,
): string {
  return `tar -cf - -C ${quotePosixArg(packagesDir)} . | docker exec -i ${quotePosixArg(containerId)} sh -c 'mkdir -p /workspace/packages && tar -xf - -C /workspace/packages'`;
}

export function buildWorkspaceAppsWebCopyCommand(
  containerId: string,
  webAppDir: string,
): string {
  return [
    "tar",
    "--exclude='node_modules'",
    "--exclude='.next'",
    "--exclude='tsconfig.tsbuildinfo'",
    `-cf - -C ${quotePosixArg(webAppDir)} .`,
    `| docker exec -i ${quotePosixArg(containerId)} sh -c 'mkdir -p /workspace/apps/web && tar -xf - -C /workspace/apps/web'`,
  ].join(" ");
}

export function buildWorkspaceScriptsCopyCommand(
  containerId: string,
  rootConfigDir: string,
): string {
  return `tar -cf - -C ${quotePosixArg(rootConfigDir)} scripts | docker exec -i ${quotePosixArg(containerId)} tar -xf - -C /workspace`;
}

// ─── LocalSourceStrategy ──────────────────────────────────────────────────────

export class LocalSourceStrategy implements SandboxSourceStrategy {
  async initializeWorkspace(containerId: string, _buildId: string): Promise<void> {
    const gitWorkspaceReady = await execInSandbox(
      containerId,
      buildSandboxGitWorkspaceReadyCommand(),
    ).then((out) => out.trim() === "yes").catch(() => false);

    if (gitWorkspaceReady) {
      await execInSandbox(
        containerId,
        buildSandboxWorkspaceCleanupCommand(),
      );
      return;
    }

    const { statSync, readFileSync } = lazyFs();
    let hardened = false;
    try { hardened = hasPrivateActuatorMount(readFileSync("/proc/self/mountinfo")); } catch { /* local host */ }
    const sourcePaths = buildSourcePaths(pickSandboxSourceRoot(process.env.PROJECT_ROOT, hardened, path => {
      try { return statSync(path).isFile(); } catch { return false; }
    }));

    // 1. Copy root config files from the active workspace when available,
    //    otherwise fall back to the image-bundled source.
    const rootFiles = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.base.json"];
    for (const f of rootFiles) {
      await exec(
        `tar -cf - -C ${quotePosixArg(sourcePaths.rootConfigDir)} ${f} | docker exec -i ${quotePosixArg(containerId)} tar -xf - -C /workspace`,
        { timeout: 10_000 },
      ).catch(() => console.log(`[source-strategy] ${f} not found, skipping`));
    }

    // 2. Copy full source from the active shared workspace when present.
    //    If the portal is running from an image-only bootstrap, fall back to -src paths.
    //    maxBuffer: 100 MB — tar piping large source trees can produce >1 MB of stderr
    //    (file-modified warnings, etc.) which exhausts Node's default 1 MB buffer.
    const LARGE_COPY_OPTS = { timeout: 60_000, maxBuffer: 100 * 1024 * 1024 };
    await exec(
      buildWorkspacePackagesCopyCommand(containerId, sourcePaths.packagesDir),
      LARGE_COPY_OPTS,
    );
    await exec(
      buildWorkspaceAppsWebCopyCommand(containerId, sourcePaths.webAppDir),
      LARGE_COPY_OPTS,
    );
    await exec(
      buildWorkspaceScriptsCopyCommand(containerId, sourcePaths.rootConfigDir),
      { timeout: 20_000, maxBuffer: 100 * 1024 * 1024 },
    ).catch(() => console.log("[source-strategy] scripts/ not found, skipping"));

    // 3. Remove app-local generated artifacts before later pipeline steps
    //    install dependencies or launch the preview server. The branch
    //    management step owns git state; source copy should not re-init
    //    or re-baseline the sandbox repository.
    await execInSandbox(
      containerId,
      buildSandboxWorkspaceCleanupCommand(),
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

// apps/web/lib/sandbox-workspace.ts
// Granular workspace initialisation functions called by the build pipeline.

import { execInSandbox, startSandboxDevServer } from "@/lib/sandbox";
import { getSourceStrategy } from "@/lib/sandbox-source-strategy";

// ─── Constants ────────────────────────────────────────────────────────────────

const INSTALL_COMMANDS = [
  // CI=true: without a TTY pnpm refuses to purge a stale modules dir (BI-CF281F4D).
  "cd /workspace && CI=true pnpm install",
  "cd /workspace && pnpm --filter @dpf/db exec prisma generate",
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function buildInstallCommands(): string[] {
  return [...INSTALL_COMMANDS];
}

// ─── Granular pipeline steps ──────────────────────────────────────────────────

export async function copySourceAndBaseline(
  containerId: string,
  buildId: string,
  sourceMode: string = "local",
): Promise<void> {
  const strategy = getSourceStrategy(sourceMode);
  await strategy.initializeWorkspace(containerId, buildId);
}

export async function installDepsAndStart(containerId: string): Promise<void> {
  for (const command of buildInstallCommands()) {
    await execInSandbox(containerId, command);
  }
  await startSandboxDevServer(containerId);
}

// ─── Full orchestration (convenience — not used by pipeline directly) ─────────

export async function initializeSandboxWorkspace(
  containerId: string,
  buildId: string,
  sourceMode: string = "local",
): Promise<void> {
  await copySourceAndBaseline(containerId, buildId, sourceMode);
  await installDepsAndStart(containerId);
}

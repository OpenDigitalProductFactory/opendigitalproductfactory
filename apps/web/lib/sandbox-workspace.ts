// apps/web/lib/sandbox-workspace.ts
// Granular workspace initialisation functions called by the build pipeline.

import { execInSandbox } from "@/lib/sandbox";
import { getSourceStrategy } from "@/lib/sandbox-source-strategy";

// ─── Constants ────────────────────────────────────────────────────────────────

const INSTALL_COMMANDS = [
  "pnpm install",
  "pnpm prisma generate",
  "nohup pnpm dev > /tmp/dev.log 2>&1 &",
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
  await execInSandbox(containerId, "cd /workspace && pnpm install");
  await execInSandbox(containerId, "cd /workspace && pnpm prisma generate");
  await execInSandbox(containerId, "cd /workspace && nohup pnpm dev > /tmp/dev.log 2>&1 &");
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

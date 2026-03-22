// apps/web/lib/sandbox.ts
// Sandbox lifecycle management — creates, manages, and destroys Docker containers
// for isolated code generation.

import { exec as execCb } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);

// ─── Constants ───────────────────────────────────────────────────────────────

export const SANDBOX_IMAGE = "dpf-sandbox";

export const SANDBOX_RESOURCE_LIMITS = {
  cpus: 2,
  memoryMb: 4096,
  diskGb: 10,
} as const;

export const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function buildSandboxNetworkName(buildId: string): string {
  return `dpf-sandbox-net-${buildId}`;
}

export function buildSandboxCreateArgs(
  buildId: string,
  hostPort: number,
  options?: {
    networkName?: string;
    envVars?: Record<string, string>;
  },
): string[] {
  // No --network=none: sandbox needs npm registry access for pnpm install.
  // Internal services (postgres, neo4j) are protected by not mounting .env
  // or any credentials. For production, use a custom network with port filtering.
  const args: string[] = [
    "create",
    "--name", `dpf-sandbox-${buildId}`,
    "--cpus=" + String(SANDBOX_RESOURCE_LIMITS.cpus),
    "--memory=" + String(SANDBOX_RESOURCE_LIMITS.memoryMb) + "m",
  ];

  if (options?.networkName) {
    args.push(`--network=${options.networkName}`);
  }

  if (options?.envVars) {
    for (const [key, value] of Object.entries(options.envVars)) {
      args.push("-e", `${key}=${value}`);
    }
  }

  args.push("-p", `${hostPort}:3000`, SANDBOX_IMAGE);

  return args;
}

export function parseSandboxPort(output: string): number | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/:(\d+)$/);
  if (!match?.[1]) return null;
  const port = parseInt(match[1], 10);
  return Number.isFinite(port) ? port : null;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export async function createSandbox(
  buildId: string,
  hostPort: number,
  options?: { networkName?: string; envVars?: Record<string, string> },
): Promise<string> {
  if (process.env.DPF_ENVIRONMENT === "dev") {
    throw new Error("Sandbox creation is disabled in the dev environment");
  }
  const args = buildSandboxCreateArgs(buildId, hostPort, options);
  const { stdout } = await exec(`docker ${args.join(" ")}`);
  return stdout.trim();
}

export async function startSandbox(containerId: string): Promise<void> {
  await exec(`docker start ${containerId}`);
}

export async function execInSandbox(containerId: string, command: string): Promise<string> {
  const { stdout } = await exec(`docker exec ${containerId} sh -c ${JSON.stringify(command)}`);
  return stdout;
}

export async function getSandboxLogs(containerId: string, tail: number = 50): Promise<string> {
  const { stdout } = await exec(`docker logs --tail ${tail} ${containerId}`);
  return stdout;
}

export async function extractDiff(containerId: string): Promise<string> {
  return execInSandbox(containerId, "cd /workspace && git diff");
}

export async function destroySandbox(containerId: string): Promise<void> {
  await exec(`docker rm -f ${containerId}`).catch(() => {
    // Container may already be removed — ignore
  });
}

export async function createSandboxNetwork(buildId: string): Promise<string> {
  const name = buildSandboxNetworkName(buildId);
  await exec(`docker network create ${name}`);
  return name;
}

export async function destroySandboxNetwork(networkName: string): Promise<void> {
  await exec(`docker network rm ${networkName}`).catch(() => {});
}

export async function destroyFullSandboxStack(
  buildId: string,
  state: {
    containerId?: string;
    dbContainerId?: string;
    neo4jContainerId?: string;
    qdrantContainerId?: string;
    networkId?: string;
  },
): Promise<void> {
  const ids = [
    state.containerId,
    state.dbContainerId,
    state.neo4jContainerId,
    state.qdrantContainerId,
  ].filter(Boolean);
  await Promise.all(ids.map((id) => exec(`docker rm -f ${id}`).catch(() => {})));
  if (state.networkId) await destroySandboxNetwork(state.networkId);
}

export async function isSandboxRunning(containerId: string): Promise<boolean> {
  try {
    const { stdout } = await exec(`docker inspect -f "{{.State.Running}}" ${containerId}`);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

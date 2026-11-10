// apps/web/lib/build/sandbox/sandbox-db.ts
// Sandbox database stack management — creates and destroys PostgreSQL for
// isolated sandbox environments. Vectors and the graph mirror live in the same
// Postgres (pgvector, graph_node / graph_edge).

import { lazyExec } from "@/lib/shared/lazy-node";
import { Prisma, prisma } from "@dpf/db";

const exec = lazyExec();

// ─── Resource Limit Constants ─────────────────────────────────────────────────

export const DB_RESOURCE_LIMITS = { memoryMb: 512, cpus: 1 } as const;

// ─── Container Naming Helpers ─────────────────────────────────────────────────

export function buildDbContainerName(buildId: string): string {
  return `dpf-sandbox-db-${buildId}`;
}

// ─── Environment Variable Builder ─────────────────────────────────────────────

/**
 * Env for the sandboxed portal. Only Postgres is provisioned, so DATABASE_URL
 * is the only datastore address it gets.
 */
export function buildSandboxDbEnvVars(buildId: string): Record<string, string> {
  return {
    DATABASE_URL: `postgresql://dpf:dpf_sandbox@${buildDbContainerName(buildId)}:5432/dpf`,
  };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

const POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;

export async function recordSandboxStarted(input: {
  buildId: string;
  providerId: string;
  agentId?: string | null;
  portalInstanceId: string;
  previewUrl?: string | null;
  capabilitiesSnapshot: Prisma.InputJsonValue;
}) {
  return prisma.sandbox.create({
    data: {
      buildId: input.buildId,
      providerId: input.providerId,
      agentId: input.agentId ?? null,
      portalInstanceId: input.portalInstanceId,
      state: "running",
      previewUrl: input.previewUrl ?? null,
      capabilitiesSnapshot: input.capabilitiesSnapshot,
    },
  });
}

export async function recordSandboxDestroyed(id: string) {
  return prisma.sandbox.update({
    where: { id },
    data: {
      state: "destroyed",
      destroyedAt: new Date(),
    },
  });
}

export function buildDockerHealthInspectCommand(containerId: string): string {
  return `docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" ${containerId} | grep -q '^healthy$'`;
}

async function pollUntilReady(
  containerId: string,
  checkCommand: string,
  label: string,
): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await exec(`docker exec ${containerId} ${checkCommand}`);
      return; // success
    } catch {
      // not ready yet — wait and retry
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`${label} did not become ready within ${POLL_TIMEOUT_MS / 1000}s`);
}

// ─── Lifecycle — Create ───────────────────────────────────────────────────────

export async function createSandboxDbStack(
  buildId: string,
  networkName: string,
): Promise<{
  dbContainerId: string;
}> {
  if (process.env.DPF_ENVIRONMENT === "dev") {
    throw new Error("Sandbox database stack creation is disabled in the dev environment");
  }
  const dbName = buildDbContainerName(buildId);

  // PostgreSQL is the only datastore sidecar.
  const { stdout: dbOut } = await exec(
    [
      "docker run -d",
      `--name ${dbName}`,
      `--network=${networkName}`,
      `--cpus=${DB_RESOURCE_LIMITS.cpus}`,
      `--memory=${DB_RESOURCE_LIMITS.memoryMb}m`,
      "-e POSTGRES_USER=dpf",
      "-e POSTGRES_PASSWORD=dpf_sandbox",
      "-e POSTGRES_DB=dpf",
      // BET-5: prisma migrate needs CREATE EXTENSION vector.
      "pgvector/pgvector:pg16",
    ].join(" "),
  );
  const dbContainerId = dbOut.trim();

  return { dbContainerId };
}

// ─── Lifecycle — Health Checks ────────────────────────────────────────────────

export async function waitForSandboxDb(dbContainerId: string): Promise<void> {
  await pollUntilReady(
    dbContainerId,
    "pg_isready -U dpf",
    "PostgreSQL",
  );
}

// ─── Lifecycle — Seed ─────────────────────────────────────────────────────────

export async function seedSandboxDb(
  productionDbContainerName: string,
  sandboxDbContainerId: string,
): Promise<void> {
  await exec(
    `docker exec ${productionDbContainerName} pg_dump --data-only -U dpf dpf | docker exec -i ${sandboxDbContainerId} psql -U dpf dpf`,
    { maxBuffer: 100 * 1024 * 1024 },
  );
}

// ─── Lifecycle — Port Discovery ───────────────────────────────────────────────

export async function findAvailablePort(startPort: number, endPort: number): Promise<number> {
  for (let port = startPort; port <= endPort; port++) {
    const { stdout } = await exec(
      `docker ps --filter "publish=${port}" --format "{{.ID}}"`,
    );
    if (!stdout.trim()) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${startPort}–${endPort}`);
}

// ─── Lifecycle — Destroy ──────────────────────────────────────────────────────

export async function destroySandboxDbStack(
  buildId: string,
  state: { dbContainerId?: string },
): Promise<void> {
  const target = state.dbContainerId ?? buildDbContainerName(buildId);
  await exec(`docker rm -f ${target}`).catch(() => {});
}

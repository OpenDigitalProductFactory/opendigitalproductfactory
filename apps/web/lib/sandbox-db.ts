// apps/web/lib/sandbox-db.ts
// Sandbox database stack management — creates and destroys PostgreSQL, Neo4j,
// and Qdrant containers for isolated sandbox environments.

import { exec as execCb } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);

// ─── Resource Limit Constants ─────────────────────────────────────────────────

export const DB_RESOURCE_LIMITS = { memoryMb: 512, cpus: 1 } as const;
export const NEO4J_RESOURCE_LIMITS = { memoryMb: 512, cpus: 1 } as const;
export const QDRANT_RESOURCE_LIMITS = { memoryMb: 256, cpus: 0.5 } as const;

// ─── Container Naming Helpers ─────────────────────────────────────────────────

export function buildDbContainerName(buildId: string): string {
  return `dpf-sandbox-db-${buildId}`;
}

export function buildNeo4jContainerName(buildId: string): string {
  return `dpf-sandbox-neo4j-${buildId}`;
}

export function buildQdrantContainerName(buildId: string): string {
  return `dpf-sandbox-qdrant-${buildId}`;
}

// ─── Environment Variable Builder ─────────────────────────────────────────────

export function buildSandboxDbEnvVars(buildId: string): Record<string, string> {
  return {
    DATABASE_URL: `postgresql://dpf:dpf_sandbox@${buildDbContainerName(buildId)}:5432/dpf`,
    NEO4J_URI: `bolt://${buildNeo4jContainerName(buildId)}:7687`,
    NEO4J_USER: "neo4j",
    NEO4J_PASSWORD: "dpf_sandbox",
    QDRANT_INTERNAL_URL: `http://${buildQdrantContainerName(buildId)}:6333`,
  };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

const POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;

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
  neo4jContainerId: string;
  qdrantContainerId: string;
}> {
  const dbName = buildDbContainerName(buildId);
  const neo4jName = buildNeo4jContainerName(buildId);
  const qdrantName = buildQdrantContainerName(buildId);

  // PostgreSQL
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
      "postgres:16-alpine",
    ].join(" "),
  );
  const dbContainerId = dbOut.trim();

  // Neo4j
  const { stdout: neo4jOut } = await exec(
    [
      "docker run -d",
      `--name ${neo4jName}`,
      `--network=${networkName}`,
      `--cpus=${NEO4J_RESOURCE_LIMITS.cpus}`,
      `--memory=${NEO4J_RESOURCE_LIMITS.memoryMb}m`,
      "-e NEO4J_AUTH=neo4j/dpf_sandbox",
      "neo4j:5-community",
    ].join(" "),
  );
  const neo4jContainerId = neo4jOut.trim();

  // Qdrant
  const { stdout: qdrantOut } = await exec(
    [
      "docker run -d",
      `--name ${qdrantName}`,
      `--network=${networkName}`,
      `--cpus=${QDRANT_RESOURCE_LIMITS.cpus}`,
      `--memory=${QDRANT_RESOURCE_LIMITS.memoryMb}m`,
      "qdrant/qdrant:latest",
    ].join(" "),
  );
  const qdrantContainerId = qdrantOut.trim();

  return { dbContainerId, neo4jContainerId, qdrantContainerId };
}

// ─── Lifecycle — Health Checks ────────────────────────────────────────────────

export async function waitForSandboxDb(dbContainerId: string): Promise<void> {
  await pollUntilReady(
    dbContainerId,
    "pg_isready -U dpf",
    "PostgreSQL",
  );
}

export async function waitForSandboxNeo4j(neo4jContainerId: string): Promise<void> {
  await pollUntilReady(
    neo4jContainerId,
    "wget -qO /dev/null http://localhost:7474",
    "Neo4j",
  );
}

export async function waitForSandboxQdrant(qdrantContainerId: string): Promise<void> {
  await pollUntilReady(
    qdrantContainerId,
    "wget -qO /dev/null http://localhost:6333/readyz",
    "Qdrant",
  );
}

// ─── Lifecycle — Seed ─────────────────────────────────────────────────────────

export async function seedSandboxDb(
  productionDbContainerName: string,
  sandboxDbContainerId: string,
): Promise<void> {
  await exec(
    `docker exec ${productionDbContainerName} pg_dump --data-only -U dpf dpf | docker exec -i ${sandboxDbContainerId} psql -U dpf dpf`,
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
  state: {
    dbContainerId?: string;
    neo4jContainerId?: string;
    qdrantContainerId?: string;
  },
): Promise<void> {
  // Destroy by stored container ID when available, fall back to well-known name.
  // The app container and network are handled by destroyFullSandboxStack in sandbox.ts.
  const targets = [
    state.dbContainerId ?? buildDbContainerName(buildId),
    state.neo4jContainerId ?? buildNeo4jContainerName(buildId),
    state.qdrantContainerId ?? buildQdrantContainerName(buildId),
  ];

  await Promise.all(
    targets.map((id) => exec(`docker rm -f ${id}`).catch(() => {})),
  );
}

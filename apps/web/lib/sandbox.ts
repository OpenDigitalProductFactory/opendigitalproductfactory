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

/**
 * Initialize the sandbox workspace with the project source.
 * Copies source from the portal container via a shared Docker volume archive,
 * installs dependencies, and generates the Prisma client.
 * This runs AFTER startSandbox and typically takes 60-90 seconds.
 */
export async function initializeSandboxWorkspace(containerId: string): Promise<void> {
  // Resolve the portal container name — HOSTNAME is 0.0.0.0 (Next.js bind),
  // so discover our actual container ID from /etc/hostname (Docker sets this).
  let portalContainer = "dpf-portal-1";
  try {
    const { readFileSync } = await import("fs");
    const hostname = readFileSync("/etc/hostname", "utf-8").trim();
    if (hostname && hostname !== "0.0.0.0") portalContainer = hostname;
  } catch { /* fallback to dpf-portal-1 */ }

  // Start the container first — both docker exec and tar pipe need it running
  console.log(`[sandbox-init] portal=${portalContainer} sandbox=${containerId}`);
  await exec(`docker start ${containerId}`);
  console.log(`[sandbox-init] container started`);

  // Copy project source via tar pipe (docker cp between containers is not supported).
  // Portal exports tar from /app, sandbox imports to /workspace.
  // Copy root config files one at a time (more reliable than multi-file tar which can fail silently)
  const rootFiles = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.base.json"];
  for (const f of rootFiles) {
    await exec(
      `docker exec ${portalContainer} tar -cf - -C /app ${f} | docker exec -i ${containerId} tar -xf - -C /workspace`,
      { timeout: 10_000 },
    ).catch(() => console.log(`[sandbox-init] ${f} not found, skipping`));
  }
  console.log("[sandbox-init] root files done");

  await exec(
    `docker exec ${portalContainer} tar -cf - -C /app packages | docker exec -i ${containerId} tar -xf - -C /workspace`,
    { timeout: 60_000 },
  );
  console.log("[sandbox-init] packages/ copied");

  await exec(
    `docker exec ${portalContainer} tar -cf - -C /app apps/web | docker exec -i ${containerId} sh -c 'mkdir -p /workspace/apps && tar -xf - -C /workspace'`,
    { timeout: 60_000 },
  );
  console.log("[sandbox-init] apps/web/ copied");

  // Install dependencies (sandbox has pnpm via corepack)
  // This can take 3-5 minutes on a cold cache. Use generous timeout.
  console.log("[sandbox-init] starting pnpm install...");
  await exec(
    `docker exec ${containerId} sh -c "cd /workspace && pnpm install --frozen-lockfile 2>&1 || pnpm install 2>&1"`,
    { timeout: 300_000 },
  );
  console.log("[sandbox-init] pnpm install complete");

  // Generate Prisma client
  await exec(
    `docker exec ${containerId} sh -c "cd /workspace && pnpm --filter @dpf/db exec prisma generate 2>&1"`,
    { timeout: 30_000 },
  ).catch((err) => {
    console.log(`[sandbox-init] prisma generate failed (non-fatal): ${err.message?.slice(0, 200)}`);
  });

  // Initialize git repo for diff tracking
  await exec(
    `docker exec ${containerId} sh -c "cd /workspace && git config user.email sandbox@dpf.local && git config user.name sandbox && git init && git add -A && git commit -m 'sandbox baseline' --allow-empty 2>&1"`,
    { timeout: 15_000 },
  ).catch(() => {});
}

export async function execInSandbox(containerId: string, command: string): Promise<string> {
  const { stdout } = await exec(`docker exec ${containerId} sh -c ${JSON.stringify(command)}`);
  return stdout;
}

/**
 * Start the Next.js dev server inside the sandbox.
 * Runs in the background (detached) so it persists across tool calls.
 * The dev server listens on port 3000 inside the container.
 */
export async function startSandboxDevServer(containerId: string): Promise<void> {
  // Check if dev server is already running
  try {
    const { stdout } = await exec(
      `docker exec ${containerId} sh -c "pgrep -f 'next dev' || echo none"`,
    );
    if (stdout.trim() !== "none") {
      console.log("[sandbox] dev server already running");
      return;
    }
  } catch { /* proceed to start */ }

  // Start a lightweight HTTP server for sandbox file preview.
  // Uses Node's built-in http module — no extra deps needed.
  const previewScript = `
const http = require('http');
const fs = require('fs');
const path = require('path');
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  const workspace = '/workspace';
  const files = [];
  function walk(dir, prefix) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f === 'node_modules' || f === '.next' || f === '.git') continue;
        const full = path.join(dir, f);
        const rel = prefix ? prefix + '/' + f : f;
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full, rel);
        else if (rel.endsWith('.ts') || rel.endsWith('.tsx') || rel.endsWith('.prisma')) files.push(rel);
      }
    } catch {}
  }
  walk(workspace, '');
  const newFiles = files.filter(f => {
    try { return fs.statSync(path.join(workspace, f)).mtimeMs > Date.now() - 3600000; } catch { return false; }
  });
  res.end(\`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sandbox Preview</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#1a1a2e;color:#e0e0e0;padding:24px}
h1{color:#7c8cf8;font-size:20px;margin-bottom:16px}h2{color:#aaa;font-size:14px;margin:16px 0 8px}
.file{font-family:monospace;font-size:12px;padding:4px 8px;border-left:2px solid #333;margin:2px 0;color:#ccc}
.new{border-left-color:#7c8cf8;color:#fff}.count{color:#888;font-size:12px}</style></head>
<body><h1>Sandbox: Build Preview</h1>
<p class="count">\${files.length} source files, \${newFiles.length} recently modified</p>
<h2>Recently Modified</h2>\${newFiles.map(f=>'<div class="file new">'+f+'</div>').join('')}
<h2>All Source Files</h2>\${files.slice(0,50).map(f=>'<div class="file">'+f+'</div>').join('')}
\${files.length>50?'<p class="count">...and '+(files.length-50)+' more</p>':''}
</body></html>\`);
});
server.listen(3000, '0.0.0.0', () => console.log('Preview server on :3000'));
`.replace(/\n/g, ' ');

  const encoded = Buffer.from(previewScript).toString("base64");
  await exec(
    `docker exec ${containerId} sh -c "echo ${encoded} | base64 -d > /tmp/preview-server.js"`,
  );
  await exec(
    `docker exec -d ${containerId} sh -c "node /tmp/preview-server.js > /tmp/dev-server.log 2>&1"`,
  );
  console.log("[sandbox] preview server starting on port 3000");

  // Wait briefly for it to bind
  await new Promise(resolve => setTimeout(resolve, 2000));
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

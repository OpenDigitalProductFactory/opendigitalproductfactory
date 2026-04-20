// apps/web/lib/sandbox.ts
// Sandbox lifecycle management — creates, manages, and destroys Docker containers
// for isolated code generation.

import { lazyExec, lazyFs } from "@/lib/shared/lazy-node";

const exec = lazyExec();

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
    const { readFileSync } = lazyFs();
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
  ).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[sandbox-init] prisma generate failed (non-fatal): ${message.slice(0, 200)}`);
  });

  // Initialize git repo for diff tracking
  await exec(
    `docker exec ${containerId} sh -c "cd /workspace && git config user.email sandbox@dpf.local && git config user.name sandbox && git init && git add -A && git commit -m 'sandbox baseline' --allow-empty 2>&1"`,
    { timeout: 15_000 },
  ).catch(() => {});
}

export async function execInSandbox(containerId: string, command: string): Promise<string> {
  const { stdout } = await exec(`docker exec ${containerId} sh -c ${JSON.stringify(command)}`, {
    maxBuffer: 10 * 1024 * 1024, // 10MB — git diffs can be large
  });
  return stdout;
}

/**
 * Start the Next.js dev server inside the sandbox.
 * Runs in the background (detached) so it persists across tool calls.
 * The dev server listens on port 3000 inside the container.
 *
 * Strategy: If the workspace has node_modules and apps/web, start `next dev`
 * so the user sees the real portal with their new feature. Falls back to a
 * lightweight static preview server if deps are not installed yet.
 */
export async function startSandboxDevServer(containerId: string): Promise<void> {
  // Check if something is already listening on port 3000
  try {
    const { stdout } = await exec(
      `docker exec ${containerId} sh -c "ss -tlnp 2>/dev/null | grep ':3000' || echo none"`,
    );
    if (stdout.trim() !== "none") {
      console.log("[sandbox] port 3000 already in use — server running");
      return;
    }
  } catch { /* proceed to start */ }

  // Prefer `next dev` if workspace is fully initialized (has node_modules)
  let useNextDev = false;
  try {
    const { stdout } = await exec(
      `docker exec ${containerId} sh -c "test -d /workspace/apps/web/node_modules && test -f /workspace/apps/web/package.json && echo yes || echo no"`,
    );
    useNextDev = stdout.trim() === "yes";
  } catch { /* fall back to static preview */ }

  if (useNextDev) {
    console.log("[sandbox] starting next dev server...");
    await exec(
      `docker exec -d ${containerId} sh -c "cd /workspace/apps/web && PORT=3000 npx next dev --port 3000 > /tmp/next-dev.log 2>&1"`,
    );
    // Wait for it to be ready (Turbopack is fast, ~2-5s)
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log("[sandbox] next dev server started on port 3000");
    return;
  }

  // Fallback: lightweight static preview server for early build phase
  console.log("[sandbox] deps not ready — starting static preview server");
  const previewScript = `
const http = require('http');
const fs = require('fs');
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  const previewPath = '/workspace/_preview/index.html';
  try {
    if (fs.existsSync(previewPath)) {
      res.end(fs.readFileSync(previewPath, 'utf-8'));
      return;
    }
  } catch {}
  res.end('<!DOCTYPE html><html><head><meta charset=utf-8><title>Preview</title>' +
    '<meta http-equiv="refresh" content="5">' +
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#1a1a2e;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh}' +
    '.card{text-align:center;padding:40px;border:1px solid #333;border-radius:12px;max-width:420px}' +
    'h2{color:#7c8cf8;margin:0 0 12px;font-size:20px}p{font-size:13px;color:#999;line-height:1.6}' +
    '.spinner{width:32px;height:32px;border:3px solid #333;border-top:3px solid #7c8cf8;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}' +
    '@keyframes spin{to{transform:rotate(360deg)}}</style></head>' +
    '<body><div class=card><div class=spinner></div>' +
    '<h2>Building Your Feature</h2>' +
    '<p>Your AI coworker is generating the pages and components. The preview will appear here automatically when ready.</p>' +
    '<p style="margin-top:16px;font-size:11px;color:#555">Auto-refreshing every 5 seconds</p>' +
    '</div></body></html>');
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
  console.log("[sandbox] static preview server starting on port 3000");

  // Wait briefly for it to bind
  await new Promise(resolve => setTimeout(resolve, 2000));
}

export async function getSandboxLogs(containerId: string, tail: number = 50): Promise<string> {
  const { stdout } = await exec(`docker logs --tail ${tail} ${containerId}`);
  return stdout;
}

export async function extractDiff(containerId: string): Promise<string> {
  // Unstage first so a prior extractDiff call's index doesn't leak into this one.
  // Without this, files an earlier (possibly buggy) `git add -A` staged stay in the
  // index forever — the current diff ends up carrying ghosts from past runs.
  await execInSandbox(containerId, "cd /workspace && git reset");

  // Stage ALL changes (including new untracked files) so git diff --cached sees them.
  // Without this, new files created by write_sandbox_file are untracked and invisible.
  //
  // Filter out build artifacts and caches — they produce a 200MB+ diff AND trigger
  // false positives in assess_contribution (e.g. minified bundles in .next/ contain
  // the word "token" thousands of times, which looks like an API-key leak).
  //
  // Pathspec gotcha: `:!node_modules` matches only a top-level `node_modules/`
  // directory, NOT `apps/web/node_modules/`. Same for `:!.next`. Use `:!**/X/**`
  // to match at any depth. pnpm v10 added `.pnpm-store/` at repo root — exclude
  // that too.
  await execInSandbox(containerId,
    "cd /workspace && git add -A -- " +
    "':!**/node_modules/**' ':!node_modules/**' " +
    "':!**/.next/**' ':!.next/**' " +
    "':!.pnpm-store/**' " +
    "':!**/*.tsbuildinfo' " +
    "':!pnpm-lock*'",
  );

  // Get the list of staged source files (defense in depth — the pathspec above
  // should have excluded these, but `grep -v` catches any that slipped through).
  const changedFiles = await execInSandbox(containerId,
    "cd /workspace && git diff --cached --name-only | " +
    "grep -v node_modules | grep -v '.next/' | grep -v '.pnpm-store/' | " +
    "grep -v '.tsbuildinfo' | grep -v 'pnpm-lock'",
  );
  const files = changedFiles.trim().split("\n").filter(Boolean);
  if (files.length === 0) return "";
  // Quote each file path to handle shell metacharacters like (parentheses)
  const quotedFiles = files.map((f) => `'${f}'`).join(" ");
  return execInSandbox(containerId, `cd /workspace && git diff --cached -- ${quotedFiles}`);
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

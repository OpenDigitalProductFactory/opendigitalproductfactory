// apps/web/lib/sandbox.ts
// Sandbox lifecycle management — creates, manages, and destroys Docker containers
// for isolated code generation.

import { lazyChildProcess, lazyExec, lazyFs } from "@/lib/shared/lazy-node";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const exec = lazyExec();

// ─── Constants ───────────────────────────────────────────────────────────────

export const SANDBOX_IMAGE = "dpf-sandbox";

export const SANDBOX_RESOURCE_LIMITS = {
  cpus: 2,
  memoryMb: 4096,
  diskGb: 10,
} as const;

export const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SANDBOX_WORKSPACE = "/workspace";
const SANDBOX_STAGE_EXCLUDES = [
  ":!**/node_modules/**",
  ":!node_modules/**",
  ":!**/.next/**",
  ":!.next/**",
  ":!.pnpm-store/**",
  ":!**/*.tsbuildinfo",
  // Next dev rewrites this tracked generated shim; do not let preview churn
  // enter Build Studio diffs or block deploy readiness.
  ":!apps/web/next-env.d.ts",
  ":!pnpm-lock*",
  // Never include the generated Prisma client — it is regenerated from schema.prisma
  // on every `prisma generate` and would bloat the diff with hundreds of KB of
  // generated type stubs that conflict with main if the sandbox base is stale.
  ":!**/generated/client/**",
  ":!packages/db/generated/**",
] as const;
const SANDBOX_DIFF_EXCLUDES = [
  ":(exclude)**/node_modules/**",
  ":(exclude)node_modules/**",
  ":(exclude)**/.next/**",
  ":(exclude).next/**",
  ":(exclude).pnpm-store/**",
  ":(exclude)**/*.tsbuildinfo",
  ":(exclude)apps/web/next-env.d.ts",
  ":(exclude)pnpm-lock*",
  // Generated Prisma client — see SANDBOX_STAGE_EXCLUDES comment above.
  ":(exclude)**/generated/client/**",
  ":(exclude)packages/db/generated/**",
] as const;

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

export function prefixSafeWorkspaceCommand(command: string): string {
  return [
    `git config --global --add safe.directory "${SANDBOX_WORKSPACE}" >/dev/null 2>&1 || true`,
    command,
  ].join(" && ");
}

function quotePosixArg(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function joinQuotedArgs(args: readonly string[]): string {
  return args.map((arg) => quotePosixArg(arg)).join(" ");
}

export function buildDockerExecSandboxCommand(containerId: string, command: string): string {
  const safeCommand = prefixSafeWorkspaceCommand(command);
  return `docker exec ${quotePosixArg(containerId)} sh -c ${quotePosixArg(safeCommand)}`;
}

export function buildSandboxStageCommand(workspace: string = SANDBOX_WORKSPACE): string {
  // Two-pass staging avoids the exit-code 1 that `git add -A` emits when gitignored
  // untracked directories (.pnpm-store, node_modules, packages/db/generated) are
  // present in the sandbox working tree, even with the exclude pathspecs — which
  // crashes the "Continue to Release" portal action.
  //
  // Pass 1 — git add -u: stages modifications and deletions for already-tracked files.
  //   It never scans gitignored untracked paths, so no spurious exit-code 1.
  // Pass 2 — git ls-files | xargs git add: discovers new non-gitignored source files
  //   (e.g. TopologyGraph.test.tsx created by the coworker) via --exclude-standard,
  //   applies the same pathspec exclusions, then stages them individually.
  //   -z / -0 handles file names that contain spaces.
  const excludes = joinQuotedArgs(SANDBOX_STAGE_EXCLUDES);
  return [
    `cd ${workspace}`,
    `git add -u`,
    `git ls-files -z --others --exclude-standard -- . ${excludes} | xargs -0 -r git add --`,
  ].join(" && ");
}

export function buildSandboxListReleasableFilesCommand(
  workspace: string = SANDBOX_WORKSPACE,
  baseRef?: string,
): string {
  // `git diff --cached` defaults to comparing the index against HEAD, which
  // only surfaces uncommitted staged work. Once the build-phase agent commits
  // its changes onto the build branch (`git commit` from generate_code or
  // direct invocation), HEAD already contains those changes and the cached
  // diff goes empty — even though the branch is N commits ahead of where it
  // forked. Passing `baseRef` (typically the client branch tip) compares the
  // post-stage index against the merge base so committed + uncommitted work
  // both appear.
  const base = baseRef ? ` ${quotePosixArg(baseRef)}` : "";
  return `cd ${workspace} && git diff --cached${base} --name-only -- . ${joinQuotedArgs(SANDBOX_DIFF_EXCLUDES)}`;
}

export function buildSandboxDiffForFilesCommand(
  files: readonly string[],
  workspace: string = SANDBOX_WORKSPACE,
  baseRef?: string,
): string {
  const base = baseRef ? ` ${quotePosixArg(baseRef)}` : "";
  return `cd ${workspace} && git diff --cached${base} -- ${files.map((file) => quotePosixArg(file)).join(" ")}`;
}

export function buildSandboxNextDevReadinessCommand(workspace: string = SANDBOX_WORKSPACE): string {
  return [
    `test -d ${workspace}/node_modules`,
    `test -f ${workspace}/apps/web/package.json`,
    "echo yes || echo no",
  ].join(" && ");
}

export function buildSandboxAppsWebCopyCommand(
  portalContainer: string,
  containerId: string,
): string {
  return [
    `docker exec ${portalContainer} tar`,
    "--exclude='apps/web/node_modules'",
    "--exclude='apps/web/.next'",
    "--exclude='apps/web/tsconfig.tsbuildinfo'",
    "-cf - -C /app apps/web",
    `| docker exec -i ${containerId} sh -c 'mkdir -p /workspace/apps && tar -xf - -C /workspace'`,
  ].join(" ");
}

export function buildSandboxRootScriptsCopyCommand(
  portalContainer: string,
  containerId: string,
): string {
  return `docker exec ${portalContainer} tar -cf - -C /app scripts | docker exec -i ${containerId} tar -xf - -C /workspace`;
}

/**
 * Stop any running Next.js/Turbopack dev server in the sandbox before the
 * workspace is mutated. Deleting apps/web/.next out from under a live turbopack
 * process yanks its persistent cache (.sst files) and wedges it in a retry
 * storm (~485% CPU) that a container restart does NOT clear — the corrupt cache
 * lives on the persistent /workspace volume. Each stanza is best-effort so a
 * container image without a given signal (or with nothing running) is a no-op;
 * the `sleep` lets the process release file handles before the caller deletes
 * the tree. Uses only single-quoted patterns so it is safe both under
 * quotePosixArg (execInSandbox) and under the JSON.stringify exec sites.
 */
export function buildSandboxDevServerStopCommand(): string {
  return [
    "pkill -f 'next dev' 2>/dev/null || true",
    "pkill -f next-server 2>/dev/null || true",
    "pkill -f 'filter web dev' 2>/dev/null || true",
    "sleep 1",
    "true",
  ].join("; ");
}

export function buildSandboxWorkspaceCleanupCommand(workspace: string = SANDBOX_WORKSPACE): string {
  // Stop the dev server FIRST so the rm below never corrupts a live turbopack
  // cache (the 2026-07-06 sandbox CPU-storm root cause).
  return [
    `${buildSandboxDevServerStopCommand()}; rm -rf ${workspace}/apps/web/node_modules`,
    `${workspace}/apps/web/.next`,
    `${workspace}/apps/web/tsconfig.tsbuildinfo`,
  ].join(" ");
}

export function buildSandboxNextDevLaunchCommand(
  containerId: string,
  workspace: string = SANDBOX_WORKSPACE,
): string {
  return [
    `docker exec -d ${containerId} sh -c`,
    JSON.stringify(
      `cd ${workspace} && PORT=3000 pnpm --filter web dev --hostname 0.0.0.0 --port 3000 > /tmp/next-dev.log 2>&1`,
    ),
  ].join(" ");
}

export function parseSandboxChangedFiles(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function resetSandboxGitIndex(containerId: string, workspace: string = SANDBOX_WORKSPACE): Promise<void> {
  await execInSandbox(containerId, `cd ${workspace} && git reset >/dev/null 2>&1 || true`);
}

async function stageSandboxWorkspaceChanges(containerId: string, workspace: string = SANDBOX_WORKSPACE): Promise<void> {
  await resetSandboxGitIndex(containerId, workspace);
  await execInSandbox(containerId, buildSandboxStageCommand(workspace));
}

export async function listReleasableSandboxFiles(
  containerId: string,
  opts?: { baseRef?: string },
): Promise<string[]> {
  await stageSandboxWorkspaceChanges(containerId);
  try {
    const output = await execInSandbox(
      containerId,
      buildSandboxListReleasableFilesCommand(SANDBOX_WORKSPACE, opts?.baseRef),
    );
    return parseSandboxChangedFiles(output);
  } finally {
    await resetSandboxGitIndex(containerId);
  }
}

/**
 * Returns the commit hashes on the sandbox's current HEAD that are ahead of
 * `baseRef` (typically the client branch tip). Excludes merge commits so the
 * list maps cleanly to FeatureBuild.gitCommitHashes.
 *
 * Returns [] if HEAD == baseRef or if the rev-list command errors (e.g. the
 * base ref does not exist yet in the sandbox).
 */
export async function listSandboxCommitsAheadOfBase(
  containerId: string,
  baseRef: string,
  workspace: string = SANDBOX_WORKSPACE,
): Promise<string[]> {
  try {
    const output = await execInSandbox(
      containerId,
      `cd ${workspace} && git rev-list --no-merges ${quotePosixArg(baseRef)}..HEAD`,
    );
    return output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
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
    buildSandboxRootScriptsCopyCommand(portalContainer, containerId),
    { timeout: 20_000 },
  ).catch(() => console.log("[sandbox-init] scripts/ not found, skipping"));
  console.log("[sandbox-init] scripts/ copied");

  await exec(
    buildSandboxAppsWebCopyCommand(portalContainer, containerId),
    { timeout: 60_000 },
  );
  console.log("[sandbox-init] apps/web/ copied");

  await exec(
    `docker exec ${containerId} sh -c ${JSON.stringify(buildSandboxWorkspaceCleanupCommand())}`,
    { timeout: 15_000 },
  );
  console.log("[sandbox-init] stale app-local artifacts cleared");

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
    const message = getErrorMessage(err);
    console.log(`[sandbox-init] prisma generate failed (non-fatal): ${message.slice(0, 200)}`);
  });

  // Initialize git repo for diff tracking
  await exec(
    `docker exec ${containerId} sh -c "cd /workspace && git config user.email sandbox@dpf.local && git config user.name sandbox && git init && git add -A && git commit -m 'sandbox baseline' --allow-empty 2>&1"`,
    { timeout: 15_000 },
  ).catch(() => {});
}

export async function execInSandbox(containerId: string, command: string): Promise<string> {
  const { stdout } = await exec(buildDockerExecSandboxCommand(containerId, command), {
    maxBuffer: 100 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Execute a sandbox command while delivering sensitive input over stdin.
 * The input never appears in the host command line or Docker environment.
 */
export async function execInSandboxWithStdin(
  containerId: string,
  command: string,
  input: string,
): Promise<string> {
  const { spawn } = lazyChildProcess();
  const safeCommand = prefixSafeWorkspaceCommand(command);
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", containerId, "sh", "-c", safeCommand], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let settled = false;
    const collect = (target: Buffer[], chunk: Buffer) => {
      size += chunk.length;
      if (size > 100 * 1024 * 1024 && !settled) {
        settled = true;
        child.kill();
        reject(new Error("Sandbox command output exceeded 100 MiB."));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code === 0) resolve(out);
      else reject(new Error(`Sandbox command exited ${code}: ${err.slice(0, 1000)}`));
    });
    child.stdin.end(input);
  });
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
      // Bound — but a turbopack process wedged on a corrupt cache stays BOUND
      // while erroring on every request (the ~485% CPU storm). Skipping
      // relaunch on "bound" alone is why such a wedge never auto-recovered.
      // Only skip if it is actually SERVING; otherwise kill it and fall
      // through to a clean relaunch.
      const healthy = await exec(
        `docker exec ${containerId} sh -c "wget -qO /dev/null http://127.0.0.1:3000/api/health"`,
      ).then(() => true).catch(() => false);
      if (healthy) {
        console.log("[sandbox] port 3000 already in use — server healthy");
        return;
      }
      console.warn("[sandbox] port 3000 bound but not serving — killing wedged dev server and relaunching");
      await exec(
        `docker exec ${containerId} sh -c ${JSON.stringify(buildSandboxDevServerStopCommand())}`,
      ).catch(() => { /* best-effort; relaunch attempts regardless */ });
    }
  } catch { /* proceed to start */ }

  // Prefer `next dev` if workspace is fully initialized (has node_modules)
  let useNextDev = false;
  try {
    const { stdout } = await exec(
      `docker exec ${containerId} sh -c ${JSON.stringify(buildSandboxNextDevReadinessCommand())}`,
    );
    useNextDev = stdout.trim() === "yes";
  } catch { /* fall back to static preview */ }

  if (useNextDev) {
    console.log("[sandbox] starting next dev server...");
    await exec(buildSandboxNextDevLaunchCommand(containerId));
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

export async function extractDiff(
  containerId: string,
  opts?: { baseRef?: string; workspace?: string },
): Promise<string> {
  // Per-build working dir: the build's worktree when isolation is on, else
  // /workspace (default — byte-identical). The diff is `--cached`, i.e. the
  // per-worktree index, so it must run in the build's own tree. BI-98B723C0 2c.
  const workspace = opts?.workspace ?? SANDBOX_WORKSPACE;
  await stageSandboxWorkspaceChanges(containerId, workspace);
  try {
    const changedFiles = await execInSandbox(
      containerId,
      buildSandboxListReleasableFilesCommand(workspace, opts?.baseRef),
    );
    const files = parseSandboxChangedFiles(changedFiles);
    if (files.length === 0) return "";
    return execInSandbox(
      containerId,
      buildSandboxDiffForFilesCommand(files, workspace, opts?.baseRef),
    );
  } finally {
    await resetSandboxGitIndex(containerId, workspace);
  }
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

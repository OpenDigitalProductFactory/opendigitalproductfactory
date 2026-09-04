import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveHostCommandInvocation } from "./host-command-invocation.mjs";

export function integrationBranchName(candidateBranch, slotKey = "") {
  const prefix = slotKey ? `local-integration/${slotKey}` : "local-integration";
  return `${prefix}/${
    candidateBranch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }`;
}

export function defaultBuildStrategy(hostPlatform = process.platform) {
  return hostPlatform === "win32" ? "docker-build" : "host-next";
}

export function dockerBuildTag(candidateBranch, slotKey = "") {
  return `dpf-${integrationBranchName(candidateBranch, slotKey).replace(/\//g, "-")}-build`;
}

// V8 heap headroom for the host-next production build (BI-B5011ACE). With the
// node 24 default heap, the Next build worker intermittently dies with SIGABRT
// during the TypeScript phase — an exit that is indistinguishable from a red
// product build, so it poisons gate evidence exactly like sandbox staleness
// did (and the freshness gate correctly stays green, so nothing else catches
// it). Re-verified 2026-08-01 after the stock coverage routes landed: 12 GiB
// still aborts during the Next TypeScript phase; 16 GiB completes cleanly.
export const HOST_BUILD_NODE_OPTIONS = "NODE_OPTIONS=--max-old-space-size=16384";
export const HOST_BUILD_NODE_ENV = "NODE_ENV=production";

// Node 26 exposes experimental host localStorage/sessionStorage accessors even
// when no backing file is configured. Those undefined host values shadow the
// web storage that jsdom installs in Vitest fork workers. Disable only Node's
// host implementation at process start so jsdom remains the environment owner.
export const HOST_TEST_NODE_OPTIONS = "NODE_OPTIONS=--no-experimental-webstorage";
export const HOST_TEST_INITIAL_WORKERS = "4";
export const HOST_TEST_RETRY_WORKERS = "2";

export function resolveCommandInvocation(command, baseEnv = process.env) {
  if (command[0] !== "env") {
    return { command: command[0], args: command.slice(1), env: baseEnv };
  }

  const env = { ...baseEnv };
  let commandIndex = 1;
  while (commandIndex < command.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(command[commandIndex])) {
    const assignment = command[commandIndex];
    const separator = assignment.indexOf("=");
    env[assignment.slice(0, separator)] = assignment.slice(separator + 1);
    commandIndex += 1;
  }
  if (commandIndex < command.length && command[commandIndex].includes("=")) {
    throw new Error(`invalid environment assignment in local-CI command: ${command[commandIndex]}`);
  }
  if (commandIndex >= command.length) {
    throw new Error("environment-prefixed local-CI command is missing an executable");
  }
  return {
    command: command[commandIndex],
    args: command.slice(commandIndex + 1),
    env,
  };
}

const SENSITIVE_COMMAND_ARG = /(?:token|secret|password|authorization|api[-_]?key|database[-_]?url)/i;

function redactCommandArgs(args) {
  let redactNext = false;
  return args.map((arg) => {
    if (redactNext) {
      redactNext = false;
      return "[REDACTED]";
    }
    const separator = arg.indexOf("=");
    if (separator > 0 && SENSITIVE_COMMAND_ARG.test(arg.slice(0, separator))) {
      return `${arg.slice(0, separator)}=[REDACTED]`;
    }
    if (arg.startsWith("-") && SENSITIVE_COMMAND_ARG.test(arg)) {
      redactNext = true;
    }
    return arg;
  });
}

export function createCommandFailureDiagnostics({ invocation, result, elapsedMs }) {
  const error = result.error
    ? {
        name: result.error.name ?? "Error",
        code: result.error.code ?? null,
        message: result.error.message ?? String(result.error),
      }
    : null;
  return {
    command: invocation.command,
    args: redactCommandArgs(invocation.args),
    elapsedMs,
    status: result.status ?? null,
    signal: result.signal ?? null,
    error,
  };
}

export function executeLocalIntegrationPlan(plan, {
  spawnSyncImpl = spawnSync,
  baseEnv = process.env,
  platform = process.platform,
  now = Date.now,
  log = console.log,
  error = console.error,
} = {}) {
  let completedCommandCount = 0;
  for (const command of plan.commands) {
    log(`[local-integration-ci] ${command.join(" ")}`);
    const logicalInvocation = resolveCommandInvocation(command, baseEnv);
    const hostInvocation = resolveHostCommandInvocation(
      logicalInvocation.command,
      logicalInvocation.args,
      { platform, env: logicalInvocation.env },
    );
    const invocation = {
      ...logicalInvocation,
      ...hostInvocation,
    };
    const commandStartedAt = now();
    const result = spawnSyncImpl(invocation.command, invocation.args, {
      stdio: "inherit",
      shell: false,
      env: invocation.env,
    });
    if (result.status !== 0) {
      const diagnostics = createCommandFailureDiagnostics({
        invocation,
        result,
        elapsedMs: now() - commandStartedAt,
      });
      error(`[local-integration-ci] command-failure ${JSON.stringify(diagnostics)}`);
      return {
        status: result.status ?? 1,
        completedCommandCount,
        failedCommand: [...command],
        diagnostics,
      };
    }
    completedCommandCount += 1;
  }
  return {
    status: 0,
    completedCommandCount,
    failedCommand: null,
    diagnostics: null,
  };
}

export function resolveGitRevision(ref, { spawnSyncImpl = spawnSync, cwd } = {}) {
  const result = spawnSyncImpl("git", ["rev-parse", "--verify", ref], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`failed to resolve ${ref}: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function stableJson(value) {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createToolchainFingerprint(input) {
  const toolchain = {
    buildStrategy: input.buildStrategy ?? "unknown",
    nodeVersion: input.nodeVersion ?? "unknown",
    pnpmVersion: input.pnpmVersion ?? "unknown",
    gitVersion: input.gitVersion ?? "unknown",
    platform: input.platform ?? "unknown",
    arch: input.arch ?? "unknown",
    lockfileSha256: input.lockfileSha256 ?? "unknown",
    nodeEnv: input.nodeEnv ?? "",
    nodeOptions: input.nodeOptions ?? "",
    testNodeOptions: input.testNodeOptions ?? "",
  };
  return {
    toolchain,
    toolchainFingerprint: createHash("sha256").update(stableJson(toolchain)).digest("hex"),
  };
}

export function createProductionArtifactIdentity(input) {
  if (input.buildStrategy === "docker-build") {
    return {
      kind: "docker-image",
      integrationTreeSha: input.integrationTreeSha,
      identity: input.dockerImageId || "unresolved",
      locator: input.dockerImageTag || "unresolved",
    };
  }
  return {
    kind: "next-build",
    integrationTreeSha: input.integrationTreeSha,
    identity: input.nextBuildId || "unresolved",
    locator: "apps/web/.next",
  };
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) return "unavailable";
  return (result.stdout || result.stderr).trim();
}

function fileSha256(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return "unavailable";
  }
}

export function collectToolchainFingerprint({ buildStrategy, cwd = process.cwd() } = {}) {
  return createToolchainFingerprint({
    buildStrategy,
    nodeVersion: process.version,
    pnpmVersion: commandOutput("pnpm", ["--version"]),
    gitVersion: commandOutput("git", ["--version"]),
    platform: process.platform,
    arch: process.arch,
    lockfileSha256: fileSha256(`${cwd}/pnpm-lock.yaml`),
    nodeEnv: HOST_BUILD_NODE_ENV,
    nodeOptions: HOST_BUILD_NODE_OPTIONS,
    testNodeOptions: HOST_TEST_NODE_OPTIONS,
  });
}

export function createLocalIntegrationPlan(input) {
  const branch = integrationBranchName(input.candidateBranch, input.slotKey);
  const baseRef = input.baseRef ?? "origin/main";
  const buildStrategy = input.buildStrategy ?? defaultBuildStrategy(input.hostPlatform);
  const productionBuildCommand = buildStrategy === "docker-build"
    ? [
        "node",
        "scripts/local-ci-bounded-build.mjs",
        "--tag",
        dockerBuildTag(input.candidateBranch, input.slotKey),
        "--slot-key",
        input.slotKey || "slot-0",
        "--candidate",
        input.candidateBranch,
      ]
    // `env VAR=… cmd` keeps the plan a plain argv (no shell) — host-next is
    // POSIX-only by construction (Windows defaults to docker-build above).
    // The shared sandbox can inherit NODE_ENV from a prior test/dev process.
    // Next requires a production build to run with the canonical production
    // environment; otherwise the same source can fail in framework internals.
    : ["env", HOST_BUILD_NODE_ENV, HOST_BUILD_NODE_OPTIONS, "pnpm", "--filter", "web", "exec", "next", "build"];
  const evidencePlanCommand = [
    "node",
    "scripts/ci-evidence-plan.mjs",
    "--event",
    "local-ci",
    "--base",
    baseRef,
    "--head",
    "HEAD",
    ...(input.evidencePlanOutput ? ["--output", input.evidencePlanOutput] : []),
  ];
  const setupCommands = [
    ...(input.fetchBase ? [["git", "fetch", "origin", "main"]] : []),
    ["git", "checkout", "-B", branch, baseRef],
    // BI-4820A197: sign the merge at creation so the gated HEAD is the HEAD
    // the pre-push DCO hook will accept. BI-E3044AEC: merge the invoking
    // worktree's SHA when supplied, not a branch name that may resolve to
    // origin's (behind) tip inside the shared runner workspace.
    ["git", "merge", "--no-ff", "--no-edit", "--signoff", input.candidateSha || input.candidateBranch],
    ...input.siblingBranches.map((sibling) => ["git", "merge", "--no-ff", "--no-edit", "--signoff", sibling]),
    // Generate the same versioned, digest-bound evidence plan used by GitHub
    // after the exact integration tree exists. Documentation plans are
    // authoritative; other local lanes remain exhaustive during rollout.
    evidencePlanCommand,
  ];
  const guardCommands = [
    ["node", "scripts/gen-doc-index.mjs", "--check"],
    ["node", "scripts/check-doc-links.mjs"],
    ["node", "scripts/check-guards.mjs"],
  ];
  const executionLane = input.evidencePlan?.executionLane ?? "exhaustive";
  const exhaustiveCommands = [
    // Step-zero sandbox freshness gate (BI-ECDF9520): after the merge changes
    // pnpm-lock.yaml, node_modules must be proven to match it before any
    // test/build result counts as product evidence. Exits 3/4 (sandbox drift /
    // not ready) instead of letting a stale install masquerade as a red build.
    [
      "node",
      "scripts/sandbox-freshness-preflight.mjs",
      "--converge",
      "--branch",
      branch,
      ...(input.slotKey ? ["--slot-key", input.slotKey] : []),
    ],
    // CI parity: the workflow runs `prisma generate` explicitly before every
    // typecheck/build (ci.yml). The freshness preflight only converges when the
    // LOCKFILE drifts — a merge that changes schema.prisma without touching
    // dependencies leaves the generated client stale, and tsc then floods with
    // false "Property X does not exist" errors (observed live 2026-07-06 right
    // after #2636 landed a schema change on main). Cheap and idempotent.
    ["pnpm", "--filter", "@dpf/db", "exec", "prisma", "generate"],
    // CI parity (BI-157DC9B2): the Unit Tests job applies migrations before the
    // suite — a handful of web tests exercise real Prisma reads. Callers that
    // resolved a test DATABASE_URL opt in via includeMigrateDeploy.
    ...(input.includeMigrateDeploy
      ? [["pnpm", "--filter", "@dpf/db", "exec", "prisma", "migrate", "deploy"]]
      : []),
    // Fast PR guard parity runs before the expensive test/build gates.
    ...guardCommands,
    // Fail fast on the definitive compile/type-generation proof before spending
    // the shared sandbox on the exhaustive suite. A red typecheck cannot become
    // green after tests, while successful candidates still execute every gate.
    // Typecheck needs the same heap headroom as the host-next build: with the
    // node 24 default heap, `tsc --noEmit` over apps/web SIGABRTs (exit 134)
    // exactly like the build worker did (BI-B5011ACE) — observed live on the
    // first BI-157DC9B2 gate run, 2026-07-06. The runner interprets the `env`
    // prefix itself, so this heap contract is identical on every host.
    [
      "env",
      HOST_BUILD_NODE_OPTIONS,
      "node",
      "scripts/local-ci-typecheck-runner.mjs",
    ],
    [
      "env",
      HOST_TEST_NODE_OPTIONS,
      "node",
      "scripts/local-ci-vitest-runner.mjs",
      "--initial-workers",
      HOST_TEST_INITIAL_WORKERS,
      "--retry-workers",
      HOST_TEST_RETRY_WORKERS,
      // The integration base, so the stage can narrow to the tests this
      // candidate can reach (BI-2227C37C). Absent or unreadable => exhaustive.
      "--base",
      baseRef,
    ],
    productionBuildCommand,
  ];
  const commands = executionLane === "documentation"
    ? [...setupCommands, ...guardCommands]
    : [...setupCommands, ...exhaustiveCommands];
  return {
    mode: input.mode,
    integrationBranch: branch,
    slotKey: input.slotKey ?? "",
    baseRef,
    buildStrategy,
    executionLane,
    commands,
  };
}

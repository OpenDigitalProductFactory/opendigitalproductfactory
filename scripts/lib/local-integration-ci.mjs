import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function integrationBranchName(candidateBranch) {
  return `local-integration/${
    candidateBranch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }`;
}

export function defaultBuildStrategy(hostPlatform = process.platform) {
  return hostPlatform === "win32" ? "docker-build" : "host-next";
}

export function dockerBuildTag(candidateBranch) {
  return `dpf-${integrationBranchName(candidateBranch).replace(/\//g, "-")}-build`;
}

// V8 heap headroom for the host-next production build (BI-B5011ACE). With the
// node 24 default heap, the Next build worker intermittently dies with SIGABRT
// during the TypeScript phase — an exit that is indistinguishable from a red
// product build, so it poisons gate evidence exactly like sandbox staleness
// did (and the freshness gate correctly stays green, so nothing else catches
// it). Verified 2026-07-05: default heap SIGABRT; 8 GiB completes cleanly.
export const BUILD_NODE_MAX_OLD_SPACE_SIZE = "--max-old-space-size=8192";
export const HOST_BUILD_NODE_OPTIONS = `NODE_OPTIONS=${BUILD_NODE_MAX_OLD_SPACE_SIZE}`;

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
    nodeOptions: input.nodeOptions ?? "",
  };
  return {
    toolchain,
    toolchainFingerprint: createHash("sha256").update(stableJson(toolchain)).digest("hex"),
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
    nodeOptions: buildStrategy === "host-next" ? HOST_BUILD_NODE_OPTIONS : "",
  });
}

export function createLocalIntegrationPlan(input) {
  const branch = integrationBranchName(input.candidateBranch);
  const baseRef = input.baseRef ?? "origin/main";
  const buildStrategy = input.buildStrategy ?? defaultBuildStrategy(input.hostPlatform);
  const productionBuildCommand = buildStrategy === "docker-build"
    ? ["docker", "build", "--target", "build", "-t", dockerBuildTag(input.candidateBranch), "."]
    // `env VAR=… cmd` keeps the plan a plain argv (no shell) — host-next is
    // POSIX-only by construction (Windows defaults to docker-build above).
    : ["env", HOST_BUILD_NODE_OPTIONS, "pnpm", "--filter", "web", "exec", "next", "build"];
  const commands = [
    ...(input.fetchBase ? [["git", "fetch", "origin", "main"]] : []),
    ["git", "checkout", "-B", branch, baseRef],
    ["git", "merge", "--no-ff", "--no-edit", input.candidateBranch],
    ...input.siblingBranches.map((sibling) => ["git", "merge", "--no-ff", "--no-edit", sibling]),
    // Step-zero sandbox freshness gate (BI-ECDF9520): after the merge changes
    // pnpm-lock.yaml, node_modules must be proven to match it before any
    // test/build result counts as product evidence. Exits 3/4 (sandbox drift /
    // not ready) instead of letting a stale install masquerade as a red build.
    ["node", "scripts/sandbox-freshness-preflight.mjs", "--converge", "--branch", branch],
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
    ["pnpm", "--filter", "web", "exec", "vitest", "run"],
    // typecheck needs the same heap headroom as the host-next build: with the
    // node 24 default heap, `tsc --noEmit` over apps/web SIGABRTs (exit 134).
    // Windows uses a tiny Node wrapper instead of POSIX `env` so the existing
    // `pnpm --filter web typecheck` script still runs with NODE_OPTIONS set.
    buildStrategy === "docker-build"
      ? ["node", "scripts/run-with-node-options.mjs", BUILD_NODE_MAX_OLD_SPACE_SIZE, "--", "pnpm", "--filter", "web", "typecheck"]
      : ["env", HOST_BUILD_NODE_OPTIONS, "pnpm", "--filter", "web", "typecheck"],
    productionBuildCommand,
  ];
  return {
    mode: input.mode,
    integrationBranch: branch,
    baseRef,
    buildStrategy,
    commands,
  };
}

#!/usr/bin/env node
// local-ci-runner.mjs — Node-native port of scripts/local-ci-runner.sh
// (BI-2272D840). Same non-mutating scratch-worktree contract, but built out
// of Node primitives (spawnSync git/docker, net.connect for the DB port
// probe) instead of POSIX sh + awk/sed/nc, so it runs on hosts where a
// working native `sh` is not available (e.g. a Windows worktree with no
// Git-for-Windows shell and a WSL install that cannot cleanly read the
// worktree's `.git` indirection).
//
// This file is the canonical implementation on every host.
// scripts/local-ci-runner.sh is a compatibility entry point that delegates
// here so the lease/resource contract has one implementation source.

import { spawnSync } from "node:child_process";
import { X_OK } from "node:constants";
import { accessSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { delimiter, dirname, join } from "node:path";
import {
  assertLocalCiCleanupTarget,
  createLocalCiSlotManifest,
  localCiSlotEnvironment,
  resolveLocalCiRootClone,
} from "./lib/local-ci-slot-manifest.mjs";
import {
  LOCAL_CI_BASE_FRESHNESS,
  refreshAcceptedBase,
  resolveBaseFreshnessPolicy,
} from "./lib/local-ci-base-freshness.mjs";
import { ensureFullHistory } from "./lib/git-shallow-preflight.mjs";
import { EXIT_CHILD_SIGNAL_DEATH } from "./lib/sandbox-freshness.mjs";
import { parseRepositoryPnpmVersion, resolvePinnedPnpmInvocation } from "./lib/pinned-pnpm.mjs";
import { isEntryModule } from "./lib/entry-module.mjs";
import { resolveHostCommandInvocation } from "./lib/host-command-invocation.mjs";

function die(message) {
  // BI-8304AB09: write BOTH streams so gate-worktree log capture cannot drop the cause.
  const line = `local-ci-runner: ${message}\n`;
  process.stdout.write(line);
  process.stderr.write(line);
  process.exit(1);
}

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function gitOrEmpty(args, cwd) {
  const result = git(args, cwd);
  return result.status === 0 ? result.stdout.trim() : "";
}

function gitOutput(args, cwd) {
  const result = git(args, cwd);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result.stdout;
}

function redactUrl(url) {
  return url.replace(/\/\/.*@/, "//***@");
}

function environmentValue(env, name) {
  const target = name.toLowerCase();
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === target);
  return entry?.[1] ?? "";
}

function withCanonicalPath(env, pathValue, platform) {
  if (platform !== "win32") return { ...env, PATH: pathValue };
  return Object.fromEntries([
    ...Object.entries(env).filter(([key]) => key.toLowerCase() !== "path"),
    ["PATH", pathValue],
  ]);
}

export function executableOnPath(command, { env = process.env, platform = process.platform } = {}) {
  const extensions = platform === "win32"
    ? (environmentValue(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const entry of environmentValue(env, "PATH").split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(entry, `${command}${extension}`);
      try {
        accessSync(candidate, platform === "win32" ? undefined : X_OK);
        return candidate;
      } catch {
        // Continue through the admitted PATH.
      }
    }
  }
  return "";
}

export function resolveLocalCiPnpmInvocation(
  hostPnpm,
  args,
  { env = process.env, platform = process.platform } = {},
) {
  return platform === "win32"
    ? resolveHostCommandInvocation("pnpm", args, { env, platform })
    : { command: hostPnpm, args };
}

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function preparePinnedPnpmEnvironment({
  packageManager,
  toolchainDir,
  env = process.env,
  platform = process.platform,
  spawnSyncImpl = spawnSync,
}) {
  const expectedVersion = parseRepositoryPnpmVersion(packageManager);
  if (!expectedVersion) throw new Error(`local CI requires packageManager=pnpm@<version>; received ${packageManager || "missing"}`);
  const hostPnpm = executableOnPath("pnpm", { env, platform });
  if (!hostPnpm) throw new Error("local CI could not resolve pnpm on the admitted PATH");
  const runOptions = { encoding: "utf8", env };
  const observedInvocation = resolveLocalCiPnpmInvocation(
    hostPnpm,
    ["--version"],
    { env, platform },
  );
  const observed = spawnSyncImpl(
    observedInvocation.command,
    observedInvocation.args,
    runOptions,
  );
  if (observed.status !== 0) {
    throw new Error(`local CI could not inspect host pnpm: ${(observed.stderr || observed.stdout || "unknown error").trim()}`);
  }
  const actualVersion = observed.stdout.trim();
  if (actualVersion === expectedVersion) {
    return {
      mode: "host-match",
      expectedVersion,
      actualVersion,
      hostPnpm,
      env: withCanonicalPath(env, environmentValue(env, "PATH"), platform),
    };
  }

  const pinnedInvocation = resolvePinnedPnpmInvocation(hostPnpm, actualVersion, expectedVersion, []);
  const pinnedPrefix = pinnedInvocation.args;
  const bootstrapInvocation = resolveLocalCiPnpmInvocation(
    pinnedInvocation.command,
    [...pinnedPrefix, "--version"],
    { env, platform },
  );
  const bootstrap = spawnSyncImpl(
    bootstrapInvocation.command,
    bootstrapInvocation.args,
    runOptions,
  );
  if (bootstrap.status !== 0 || bootstrap.stdout.trim() !== expectedVersion) {
    throw new Error(
      `local CI could not provision repository-pinned pnpm ${expectedVersion}: ` +
      `${(bootstrap.stderr || bootstrap.stdout || "version mismatch").trim()}`,
    );
  }

  mkdirSync(toolchainDir, { recursive: true });
  if (platform === "win32") {
    writeFileSync(
      join(toolchainDir, "pnpm.cmd"),
      `@echo off\r\n"${hostPnpm.replaceAll('"', '""')}" ${pinnedPrefix.join(" ")} %*\r\n`,
    );
  } else {
    const shimPath = join(toolchainDir, "pnpm");
    writeFileSync(
      shimPath,
      `#!/bin/sh\nexec ${shellSingleQuote(hostPnpm)} ${pinnedPrefix.map(shellSingleQuote).join(" ")} "$@"\n`,
    );
    chmodSync(shimPath, 0o755);
  }
  return {
    mode: "pinned-shim",
    expectedVersion,
    actualVersion,
    hostPnpm,
    env: {
      ...withCanonicalPath(
        env,
        `${toolchainDir}${delimiter}${environmentValue(env, "PATH")}`,
        platform,
      ),
      DPF_LOCAL_CI_PINNED_PNPM_VERSION: expectedVersion,
    },
  };
}

async function tcpReachable(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function dockerAvailable() {
  const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
  return result.status === 0;
}

export function planPostgresOwnership({
  hasDocker,
  manifestContainerExists,
  manifestContainerUsesPgvector,
  assignedPortReachable,
}) {
  if (!hasDocker) return "unavailable";
  if (manifestContainerExists && !manifestContainerUsesPgvector) return "replace";
  if (manifestContainerExists) return "reuse";
  if (assignedPortReachable) return "foreign-port-conflict";
  return "provision";
}

/**
 * Recreate the admitted slot's disposable database before each exact candidate.
 * The container and database identities are derived from the slot manifest; the
 * strict shape check keeps this recovery path away from developer/production DBs.
 */
export function resetOwnedSlotDatabase({
  container,
  database,
  run = spawnSync,
}) {
  if (!/^dpf-local-ci-postgres-\d+$/.test(container) || !/^dpf_local_ci_\d+$/.test(database)) {
    throw new Error(`refusing non-slot Postgres reset: ${container}/${database}`);
  }
  const commands = [
    ["exec", container, "dropdb", "--if-exists", "--force", "-U", "dpf", database],
    ["exec", container, "createdb", "-U", "dpf", "-O", "dpf", database],
  ];
  for (const args of commands) {
    const result = run("docker", args, { encoding: "utf8" });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "unknown Docker error").trim();
      throw new Error(`could not reset disposable slot database ${database}: ${detail}`);
    }
  }
}

async function resolveDatabaseUrl(env, manifest) {
  if (env.DPF_LOCAL_CI_ALLOW_EXPLICIT_DATABASE_URL === "1") {
    if (env.DPF_LOCAL_CI_TEST_DATABASE_URL) return env.DPF_LOCAL_CI_TEST_DATABASE_URL;
    if (env.DATABASE_URL) return env.DATABASE_URL;
  }

  const hasDocker = dockerAvailable();
  if (!hasDocker) return "";

  // BET-5 (BI-032B49EB): the provisioned Postgres must ship pgvector — recreate
  // a pre-BET-5 alpine-image container onto pgvector rather than reuse it.
  // A listener on the assigned port is not ownership evidence: only the exact
  // manifest container may satisfy this slot.
  let inspect = spawnSync("docker", ["inspect", manifest.postgres.container], { encoding: "utf8" });
  let manifestContainerExists = inspect.status === 0;
  let manifestContainerUsesPgvector = false;
  if (manifestContainerExists) {
    const image = spawnSync("docker", ["inspect", manifest.postgres.container, "--format", "{{.Config.Image}}"], { encoding: "utf8" });
    manifestContainerUsesPgvector = (image.stdout || "").includes("pgvector");
    if (!manifestContainerUsesPgvector) {
      spawnSync("docker", ["rm", "-f", manifest.postgres.container], { encoding: "utf8" });
      manifestContainerExists = false;
    }
  }

  const ownershipPlan = planPostgresOwnership({
    hasDocker,
    manifestContainerExists,
    manifestContainerUsesPgvector,
    assignedPortReachable: await tcpReachable("127.0.0.1", manifest.postgres.hostPort),
  });
  if (ownershipPlan === "foreign-port-conflict") {
    die(
      `${manifest.slotKey} Postgres port ${manifest.postgres.hostPort} is occupied, ` +
      `but manifest container ${manifest.postgres.container} does not exist; refusing foreign database reuse`,
    );
  }
  if (ownershipPlan === "provision") {
    const run = spawnSync("docker", [
      "run", "-d", "--name", manifest.postgres.container,
      "-p", `${manifest.postgres.hostPort}:5432`,
      "-v", `${manifest.postgres.volume}:/var/lib/postgresql/data`,
      "-e", "POSTGRES_USER=dpf", "-e", "POSTGRES_PASSWORD=dpf_dev",
      "-e", `POSTGRES_DB=${manifest.postgres.database}`,
      "pgvector/pgvector:pg16",
    ], { encoding: "utf8" });
    if (run.status !== 0) {
      die(`could not provision ${manifest.postgres.container}: ${(run.stderr || run.stdout || "").trim()}`);
    }
  } else {
    const start = spawnSync("docker", ["start", manifest.postgres.container], { encoding: "utf8" });
    if (start.status !== 0) {
      die(`could not start ${manifest.postgres.container}: ${(start.stderr || start.stdout || "").trim()}`);
    }
  }

  for (let tries = 0; tries < 30; tries += 1) {
    const ready = spawnSync("docker", ["exec", manifest.postgres.container, "pg_isready", "-U", "dpf", "-d", manifest.postgres.database], { encoding: "utf8" });
    if (ready.status === 0) {
      resetOwnedSlotDatabase({
        container: manifest.postgres.container,
        database: manifest.postgres.database,
      });
      return manifest.postgres.url;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return "";
}

export const LOCAL_CI_MISSING_DATABASE_URL = "postgresql://dpf:dpf_dev@127.0.0.1:1/dpf_local_ci_missing_database";

/**
 * Turn a spawnSync result into an exit code that says what happened
 * (BI-F22B4EEE).
 *
 * `result.status ?? 1` was the whole bug. A child killed by a signal reports
 * `status: null`, so the `?? 1` collapsed SIGKILL into exit 1 — the same code a
 * failing test suite produces — and the signal was never read. classifyGateOutcome
 * then recorded "local-CI lease gate failed.", a PRODUCT verdict, for a host that
 * had run out of memory.
 *
 * That is the failure mode the blocked_* statuses exist to prevent, and it is the
 * one that had no code. Observed live: the child died at the vitest ->
 * production-build boundary after 25,447 tests passed, leaving no build receipt
 * and no error text, on a box carrying ten concurrent gate claims.
 *
 * The signal name goes to stderr because the child's own output is inherited and
 * ends mid-stream — without this line there is nothing anywhere saying a signal
 * occurred, which is exactly how five gate runs produced no diagnosable reason.
 */
export function resolveChildExit(result) {
  if (result?.signal) {
    process.stderr.write(
      `local-ci-runner: the build child was killed by ${result.signal} rather than exiting. ` +
      "This is infrastructure evidence, not a product build failure — most often the host " +
      "running out of memory under concurrent gate load. Re-run when the box is quieter.\n",
    );
    return EXIT_CHILD_SIGNAL_DEATH;
  }
  if (typeof result?.status === "number") return result.status;
  // No status and no signal: spawn itself failed. Still not a product verdict,
  // but we cannot claim a signal we did not observe.
  if (result?.error) {
    process.stderr.write(`local-ci-runner: could not run the build child: ${result.error.message}\n`);
  }
  return 1;
}

/**
 * Clear the previous run's per-stage receipts before this run starts
 * (BI-F22B4EEE).
 *
 * `local-integration-ci` reads `${metadataOut}.vitest.json`,
 * `.typecheck.json` and `.build.json` back when it assembles evidence. They
 * were never cleared between runs, so a run could find a PREVIOUS run's
 * receipts and treat their stages as satisfied. Observed live: a "gate" that
 * ran for 32 seconds — guard loop only, no typecheck, no vitest — and still
 * emitted a verdict, with receipts beside it from a different tree saying
 * `passed`.
 *
 * A stage that did not run in THIS run must not be able to leave evidence in
 * it. Removal is best-effort: an absent file is the desired state, and failing
 * the gate because a stale receipt could not be deleted would trade one wrong
 * verdict for another.
 */
export function clearStaleStageReceipts(metadataFile, { rm = rmSync } = {}) {
  const cleared = [];
  for (const suffix of [".vitest.json", ".typecheck.json", ".build.json"]) {
    const path = `${metadataFile}${suffix}`;
    try {
      rm(path, { force: true });
      cleared.push(path);
    } catch {
      // Best-effort by design — see above.
    }
  }
  return cleared;
}

export function createLocalIntegrationChildInvocation({
  repoTop,
  candidate,
  baseRef,
  candidateSha,
  baseSha,
  baseFreshness,
  slotKey,
  metadataFile,
  testDatabaseUrl,
  env = process.env,
}) {
  const childEnv = { ...env };
  const args = [
    join(repoTop, "scripts", "local-integration-ci.mjs"),
    "--candidate", candidate,
    "--base-ref", baseRef,
    "--candidate-sha", candidateSha,
    "--base-sha", baseSha,
    "--base-freshness-status", baseFreshness.status,
    "--base-resolved-at", baseFreshness.resolvedAt || "",
    "--base-fetch-mode", baseFreshness.fetchMode || "",
    "--slot-key", slotKey,
    "--metadata-out", metadataFile,
  ];
  if (testDatabaseUrl) {
    args.push("--migrate-deploy");
    childEnv.DATABASE_URL = testDatabaseUrl;
  } else {
    // Do not let a host env var or preserved scratch .env silently become the
    // gate database when the runner did not prove ownership of the slot DB.
    childEnv.DATABASE_URL = LOCAL_CI_MISSING_DATABASE_URL;
  }
  return { args, env: childEnv };
}

function ensureScratchWorkspace(root, workspace) {
  if (existsSync(join(workspace, ".git"))) return;
  mkdirSync(dirname(workspace), { recursive: true });
  const add = spawnSync("git", ["-C", root, "worktree", "add", "--detach", workspace], { encoding: "utf8" });
  if (add.status !== 0) {
    const forced = spawnSync("git", ["-C", root, "worktree", "add", "--force", "--detach", workspace], { encoding: "utf8" });
    if (forced.status !== 0) die(`could not create scratch workspace ${workspace}: ${forced.stderr}`);
  }
}

function cleanScratchWorkspace(workspace, manifest) {
  assertLocalCiCleanupTarget(manifest, workspace);
  spawnSync("git", ["-C", workspace, "merge", "--abort"], { encoding: "utf8" });
  spawnSync("git", ["-C", workspace, "reset", "--hard", "--quiet"], { encoding: "utf8" });
  spawnSync("git", ["-C", workspace, "clean", "-fd", "--quiet", "-e", "node_modules", "-e", ".env"], { encoding: "utf8" });
}

async function main() {
  const argv = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : "";
  };

  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      "Usage: node scripts/local-ci-runner.mjs [options]\n\n" +
      "Options:\n" +
      "  --candidate BRANCH   Branch to gate (default: current branch)\n" +
      "  --base-ref REF       Locally available accepted-base ref (default: origin/main)\n" +
      "  --fetch-base         Compatibility alias for the default required online refresh\n" +
      "  --offline-accepted-base  Explicitly use the locally available base without network proof\n" +
      "  --slot-key SLOT      Admitted physical slot (default: DPF_LOCAL_CI_SLOT_KEY or slot-0)\n" +
      "  --workspace PATH     Explicit scratch workspace override (default: admitted manifest)\n" +
      "  --dry-run            Print the resolved workspace + plan; run nothing\n" +
      "  --help               Show this help\n",
    );
    process.exit(0);
  }

  const env = process.env;
  let candidate = valueAfter("--candidate");
  const baseRef = valueAfter("--base-ref") || env.DPF_LOCAL_CI_BASE_REF || "origin/main";
  let baseFreshnessPolicy;
  try {
    baseFreshnessPolicy = resolveBaseFreshnessPolicy({ argv, env, baseRef });
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
  const slotKey = valueAfter("--slot-key") || env.DPF_LOCAL_CI_SLOT_KEY || "slot-0";
  let workspace = valueAfter("--workspace") || env.DPF_LOCAL_CI_WORKSPACE || "";
  const dryRun = argv.includes("--dry-run");

  if (!candidate) candidate = gitOrEmpty(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (candidate === "HEAD") die("cannot gate a detached HEAD — pass --candidate BRANCH");
  if (candidate === "main") die("gate topic branches, not main");
  if (!baseRef) die("--base-ref cannot be empty");

  const repoTop = gitOrEmpty(["rev-parse", "--show-toplevel"]);
  const gitCommonDir = gitOrEmpty(["rev-parse", "--path-format=absolute", "--git-common-dir"], repoTop);
  const root = resolveLocalCiRootClone(gitCommonDir);
  const candidateGitDir = gitOrEmpty(["rev-parse", "--absolute-git-dir"], repoTop);
  const manifest = createLocalCiSlotManifest({
    slotKey,
    rootClone: root,
    gitCommonDir,
    candidateGitDir,
  });
  if (!workspace) workspace = manifest.scratch.workspace;

  // BI-8304AB09 / BI-AA2201B0: fail loud on shallow clones + clear stale shallow.lock.
  if (!dryRun) {
    const shallow = ensureFullHistory({
      cwd: root,
      fetch: true,
      log: (line) => {
        process.stdout.write(`${line}\n`);
        process.stderr.write(`${line}\n`);
      },
    });
    if (!shallow.ok) {
      die(shallow.message);
    }
  }

  const candidateSha = gitOrEmpty(["-C", repoTop, "rev-parse", "--verify", candidate]);
  const plannedFreshnessStatus = baseFreshnessPolicy.fetchRequired
    ? "pending-admission-refresh"
    : LOCAL_CI_BASE_FRESHNESS.offlineAccepted;
  const localBaseSha = gitOrEmpty(["-C", repoTop, "rev-parse", "--verify", baseRef]);
  let baseFreshness = {
    status: plannedFreshnessStatus,
    baseSha: localBaseSha || null,
    resolvedAt: null,
    fetchMode: null,
    error: null,
  };
  if (!dryRun) {
    baseFreshness = refreshAcceptedBase({
      policy: baseFreshnessPolicy,
      baseRef,
      cwd: repoTop,
      runGit: gitOutput,
      now: () => new Date(),
    });
  }
  const baseSha = baseFreshness.baseSha || "";
  const baseCommitDate = baseSha ? gitOrEmpty(["-C", repoTop, "show", "-s", "--format=%cI", baseSha]) : "";
  const metadataFile = env.DPF_LOCAL_CI_METADATA_FILE || manifest.evidence.metadata;
  // BI-F22B4EEE: a stage that does not run in THIS run must not inherit the
  // previous run's receipt and be counted as satisfied.
  clearStaleStageReceipts(metadataFile);

  if (dryRun) {
    process.stdout.write("local-ci-runner dry-run\n");
    process.stdout.write(
      `candidate=${candidate}\ncandidateSha=${candidateSha || "unresolved"}\nbaseRef=${baseRef}\nbaseSha=${baseSha || "unresolved"}\nbaseCommitDate=${baseCommitDate}\nfetchBase=${baseFreshnessPolicy.fetchRequired ? "1" : "0"}\nslotKey=${manifest.slotKey}\nmanifestVersion=${manifest.schemaVersion}\nroot=${root}\nworkspace=${workspace}\ncomposeProject=${manifest.compose.project}\nportalUrl=${manifest.portal.url}\npostgresContainer=${manifest.postgres.container}\npostgresDatabase=${manifest.postgres.database}\nmetadataFile=${metadataFile}\n`,
    );
    process.stdout.write(`baseFreshnessPolicy=${baseFreshnessPolicy.mode}\nbaseFreshnessStatus=${baseFreshness.status}\n`);
    process.stdout.write(
      `plan=node scripts/local-integration-ci.mjs --candidate ${candidate} --base-ref ${baseRef} --candidate-sha ${candidateSha} --base-sha ${baseSha} --slot-key ${manifest.slotKey} --metadata-out ${metadataFile} --base-freshness-status ${baseFreshness.status} (in workspace)\n`,
    );
    process.exit(0);
  }

  if (!candidateSha) die(`candidate ref not found locally: ${candidate}`);
  if (baseFreshness.status === LOCAL_CI_BASE_FRESHNESS.fetchFailed) {
    mkdirSync(dirname(metadataFile), { recursive: true });
    writeFileSync(metadataFile, `${JSON.stringify({
      schemaVersion: 2,
      candidateRef: candidate,
      candidateSha,
      baseRef,
      fetchBase: true,
      baseFreshness,
      completedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    die(`required origin/main refresh failed: ${baseFreshness.error}`);
  }
  if (!baseSha) die(`accepted base ref not found locally: ${baseRef} (fetch or set DPF_LOCAL_CI_BASE_REF to a local ref)`);

  process.stdout.write(`local-ci-runner: candidate ${candidate} @ ${candidateSha}\n`);
  process.stdout.write(`local-ci-runner: accepted base ${baseRef} @ ${baseSha}${baseCommitDate ? ` (commit date ${baseCommitDate})` : ""}\n`);
  if (baseFreshness.status === LOCAL_CI_BASE_FRESHNESS.offlineAccepted) {
    process.stdout.write("local-ci-runner: explicit offline mode accepted the locally available base ref\n");
  } else {
    process.stdout.write(`local-ci-runner: origin/main refreshed at admission (${baseFreshness.fetchMode})\n`);
  }

  ensureScratchWorkspace(root, workspace);
  cleanScratchWorkspace(workspace, manifest);

  const slotEnv = localCiSlotEnvironment(manifest);
  const packageManager = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")).packageManager;
  let pnpmToolchain;
  try {
    pnpmToolchain = preparePinnedPnpmEnvironment({
      packageManager,
      toolchainDir: join(workspace, ".dpf-local-ci-toolchain", "bin"),
      env: { ...env, ...slotEnv },
    });
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
  process.stdout.write(
    `local-ci-runner: pnpm ${pnpmToolchain.expectedVersion} ` +
    `(${pnpmToolchain.mode}${pnpmToolchain.mode === "pinned-shim" ? `; host was ${pnpmToolchain.actualVersion}` : ""})\n`,
  );
  const testDatabaseUrl = await resolveDatabaseUrl(env, manifest);
  const invocation = createLocalIntegrationChildInvocation({
    repoTop,
    candidate,
    baseRef,
    candidateSha,
    baseSha,
    baseFreshness,
    slotKey: manifest.slotKey,
    metadataFile,
    testDatabaseUrl,
    env: pnpmToolchain.env,
  });
  if (testDatabaseUrl) {
    process.stdout.write(`local-ci-runner: test database ${redactUrl(testDatabaseUrl)}\n`);
  } else {
    process.stderr.write("local-ci-runner: WARNING no test database resolved — running without migrate deploy; Prisma-touching tests will fail loud\n");
  }

  const result = spawnSync(process.execPath, invocation.args, { cwd: workspace, stdio: "inherit", env: invocation.env });
  process.exit(resolveChildExit(result));
}

if (isEntryModule(import.meta.url)) main();

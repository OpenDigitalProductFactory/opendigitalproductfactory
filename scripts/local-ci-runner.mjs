#!/usr/bin/env node
// local-ci-runner.mjs — Node-native port of scripts/local-ci-runner.sh
// (BI-2272D840). Same non-mutating scratch-worktree contract, but built out
// of Node primitives (spawnSync git/docker, net.connect for the DB port
// probe) instead of POSIX sh + awk/sed/nc, so it runs on hosts where a
// working native `sh` is not available (e.g. a Windows worktree with no
// Git-for-Windows shell and a WSL install that cannot cleanly read the
// worktree's `.git` indirection).
//
// scripts/local-ci-runner.sh remains the canonical entry point wherever a
// native sh works — see scripts/pregate.mjs for the detection/routing layer.
// This file is a straight behavioral port: same flags, same dry-run output
// shape, same scratch-workspace location, same DB-resolution order, so
// evidence produced on either path is equivalent.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { connect } from "node:net";
import { dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);

function die(message) {
  process.stderr.write(`local-ci-runner: ${message}\n`);
  process.exit(1);
}

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function gitOrEmpty(args, cwd) {
  const result = git(args, cwd);
  return result.status === 0 ? result.stdout.trim() : "";
}

function redactUrl(url) {
  return url.replace(/\/\/.*@/, "//***@");
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

async function resolveDatabaseUrl(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.DPF_LOCAL_CI_TEST_DATABASE_URL) return env.DPF_LOCAL_CI_TEST_DATABASE_URL;

  if (await tcpReachable("127.0.0.1", 5433)) {
    return "postgresql://dpf:dpf_dev@127.0.0.1:5433/dpf";
  }

  if (!dockerAvailable()) return "";

  // BET-5 (BI-032B49EB): the provisioned Postgres must ship pgvector — recreate
  // a pre-BET-5 alpine-image container onto pgvector rather than reuse it. The
  // sandbox DB is ephemeral (no volume), so recreating loses nothing.
  const inspect = spawnSync("docker", ["inspect", "dpf-local-ci-postgres"], { encoding: "utf8" });
  if (inspect.status === 0) {
    const image = spawnSync("docker", ["inspect", "dpf-local-ci-postgres", "--format", "{{.Config.Image}}"], { encoding: "utf8" });
    if (!(image.stdout || "").includes("pgvector")) {
      spawnSync("docker", ["rm", "-f", "dpf-local-ci-postgres"], { encoding: "utf8" });
    }
  }
  const stillMissing = spawnSync("docker", ["inspect", "dpf-local-ci-postgres"], { encoding: "utf8" }).status !== 0;
  if (stillMissing) {
    const run = spawnSync("docker", [
      "run", "-d", "--name", "dpf-local-ci-postgres", "-p", "54329:5432",
      "-e", "POSTGRES_USER=dpf", "-e", "POSTGRES_PASSWORD=dpf_dev", "-e", "POSTGRES_DB=dpf",
      "pgvector/pgvector:pg16",
    ], { encoding: "utf8" });
    if (run.status !== 0) return "";
  } else {
    spawnSync("docker", ["start", "dpf-local-ci-postgres"], { encoding: "utf8" });
  }

  for (let tries = 0; tries < 30; tries += 1) {
    const ready = spawnSync("docker", ["exec", "dpf-local-ci-postgres", "pg_isready", "-U", "dpf"], { encoding: "utf8" });
    if (ready.status === 0) return "postgresql://dpf:dpf_dev@127.0.0.1:54329/dpf";
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return "";
}

function resolveRootClone(repoTop) {
  const result = git(["worktree", "list", "--porcelain"], repoTop);
  if (result.status !== 0) die(`could not list worktrees: ${result.stderr}`);
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) return line.slice("worktree ".length).trim();
  }
  return "";
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

function cleanScratchWorkspace(workspace) {
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
      "  --fetch-base         Fetch origin/main before checkout (explicit network mode)\n" +
      "  --workspace PATH     Scratch merge workspace (default: <root>-worktrees/.local-ci-runner)\n" +
      "  --dry-run            Print the resolved workspace + plan; run nothing\n" +
      "  --help               Show this help\n",
    );
    process.exit(0);
  }

  const env = process.env;
  let candidate = valueAfter("--candidate");
  const baseRef = valueAfter("--base-ref") || env.DPF_LOCAL_CI_BASE_REF || "origin/main";
  const fetchBase = argv.includes("--fetch-base") || env.DPF_LOCAL_CI_FETCH_BASE === "1";
  let workspace = valueAfter("--workspace") || env.DPF_LOCAL_CI_WORKSPACE || "";
  const dryRun = argv.includes("--dry-run");

  if (!candidate) candidate = gitOrEmpty(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (candidate === "HEAD") die("cannot gate a detached HEAD — pass --candidate BRANCH");
  if (candidate === "main") die("gate topic branches, not main");
  if (!baseRef) die("--base-ref cannot be empty");

  const repoTop = gitOrEmpty(["rev-parse", "--show-toplevel"]);
  const root = resolveRootClone(repoTop);
  if (!root) die("could not resolve the root clone");

  if (!workspace) {
    workspace = join(`${dirname(root)}/${basename(root)}-worktrees`, ".local-ci-runner");
  }

  const candidateSha = gitOrEmpty(["-C", repoTop, "rev-parse", "--verify", candidate]);
  const baseSha = gitOrEmpty(["-C", repoTop, "rev-parse", "--verify", baseRef]);
  const baseCommitDate = baseSha ? gitOrEmpty(["-C", repoTop, "show", "-s", "--format=%cI", baseSha]) : "";
  const metadataFile = env.DPF_LOCAL_CI_METADATA_FILE || gitOrEmpty(["-C", repoTop, "rev-parse", "--git-path", "dpf-local-ci-metadata.json"]);

  if (dryRun) {
    process.stdout.write("local-ci-runner dry-run\n");
    process.stdout.write(
      `candidate=${candidate}\ncandidateSha=${candidateSha || "unresolved"}\nbaseRef=${baseRef}\nbaseSha=${baseSha || "unresolved"}\nbaseCommitDate=${baseCommitDate}\nfetchBase=${fetchBase ? "1" : "0"}\nroot=${root}\nworkspace=${workspace}\nmetadataFile=${metadataFile}\n`,
    );
    const fetchFlag = fetchBase ? " --fetch-base" : "";
    process.stdout.write(
      `plan=node scripts/local-integration-ci.mjs --candidate ${candidate} --base-ref ${baseRef} --candidate-sha ${candidateSha} --base-sha ${baseSha} --metadata-out ${metadataFile}${fetchFlag} (in workspace)\n`,
    );
    process.exit(0);
  }

  if (!candidateSha) die(`candidate ref not found locally: ${candidate}`);
  if (!baseSha) die(`accepted base ref not found locally: ${baseRef} (fetch or set DPF_LOCAL_CI_BASE_REF to a local ref)`);

  process.stdout.write(`local-ci-runner: candidate ${candidate} @ ${candidateSha}\n`);
  process.stdout.write(`local-ci-runner: accepted base ${baseRef} @ ${baseSha}${baseCommitDate ? ` (commit date ${baseCommitDate})` : ""}\n`);
  if (!fetchBase) {
    process.stdout.write("local-ci-runner: using locally available base ref without fetch (BI-76551B2D)\n");
  }

  ensureScratchWorkspace(root, workspace);
  cleanScratchWorkspace(workspace);

  const testDatabaseUrl = await resolveDatabaseUrl(env);
  const childEnv = { ...env };
  const args = [
    join(repoTop, "scripts", "local-integration-ci.mjs"),
    "--candidate", candidate,
    "--base-ref", baseRef,
    "--candidate-sha", candidateSha,
    "--base-sha", baseSha,
    "--metadata-out", metadataFile,
  ];
  if (fetchBase) args.push("--fetch-base");
  if (testDatabaseUrl) {
    args.push("--migrate-deploy");
    childEnv.DATABASE_URL = testDatabaseUrl;
    process.stdout.write(`local-ci-runner: test database ${redactUrl(testDatabaseUrl)}\n`);
  } else {
    process.stderr.write("local-ci-runner: WARNING no test database resolved — running without migrate deploy; Prisma-touching tests will fail loud\n");
  }

  const result = spawnSync(process.execPath, args, { cwd: workspace, stdio: "inherit", env: childEnv });
  process.exit(result.status ?? 1);
}

if (process.argv[1] === THIS_FILE) main();

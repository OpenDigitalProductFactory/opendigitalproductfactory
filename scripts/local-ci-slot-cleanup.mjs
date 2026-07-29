#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertLocalCiCleanupTarget,
  createLocalCiSlotManifest,
  localCiSlotEnvironment,
} from "./lib/local-ci-slot-manifest.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);

export function createLocalCiCleanupPlan(manifest, composeFile) {
  assertLocalCiCleanupTarget(manifest, manifest.output.build);
  return {
    schemaVersion: 1,
    slotKey: manifest.slotKey,
    scratchBoundary: manifest.cleanup.scratchBoundary,
    buildOutput: manifest.output.build,
    commands: [
      {
        command: "docker",
        env: {
          ...localCiSlotEnvironment(manifest),
          // `compose down` still interpolates the whole file. These values are
          // never used to start a service; they only keep cleanup independent
          // from root-install secrets that are intentionally absent in a
          // source worktree.
          AUTH_SECRET: "local-ci-cleanup-not-used",
          CREDENTIAL_ENCRYPTION_KEY: "0".repeat(64),
        },
        args: [
          "compose",
          "-p",
          manifest.cleanup.composeProject,
          "-f",
          resolve(composeFile),
          "--profile",
          "local-ci",
          "down",
        ],
      },
      {
        command: "docker",
        args: ["rm", "-f", manifest.cleanup.postgresContainer],
        allowMissing: true,
      },
      {
        command: "docker",
        args: ["volume", "rm", manifest.cleanup.postgresVolume],
        allowMissing: true,
      },
    ],
  };
}

function git(args, cwd = process.cwd()) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function rootCloneFor(repoTop) {
  const listing = git(["worktree", "list", "--porcelain"], repoTop);
  const first = listing.split(/\r?\n/).find((line) => line.startsWith("worktree "));
  if (!first) throw new Error("could not resolve root clone for local-CI cleanup");
  return first.slice("worktree ".length).trim();
}

function runCleanup(plan) {
  for (const step of plan.commands) {
    const result = spawnSync(step.command, step.args, {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, ...(step.env || {}) },
    });
    if (result.status !== 0) {
      const detail = `${result.stderr || ""}\n${result.stdout || ""}`;
      if (step.allowMissing && /no such|not found|does not exist/i.test(detail)) continue;
      throw new Error(
        `${step.command} ${step.args.join(" ")} failed: ${detail.trim()}`,
      );
    }
  }
  rmSync(plan.buildOutput, { recursive: true, force: true });
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

function main() {
  const args = process.argv.slice(2);
  const slotKey = valueAfter(args, "--slot-key") || process.env.DPF_LOCAL_CI_SLOT_KEY;
  if (!slotKey) {
    throw new Error("usage: local-ci-slot-cleanup.mjs --slot-key slot-0|slot-1 [--dry-run]");
  }
  const repoTop = git(["rev-parse", "--show-toplevel"]);
  const rootClone = rootCloneFor(repoTop);
  const gitCommonDir = resolve(
    repoTop,
    git(["rev-parse", "--git-common-dir"], repoTop),
  );
  const candidateGitDir = git(["rev-parse", "--absolute-git-dir"], repoTop);
  const manifest = createLocalCiSlotManifest({
    slotKey,
    rootClone,
    gitCommonDir,
    candidateGitDir,
  });
  const plan = createLocalCiCleanupPlan(
    manifest,
    join(repoTop, "docker-compose.local-ci.yml"),
  );
  if (args.includes("--dry-run")) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  runCleanup(plan);
  process.stdout.write(`local-ci-slot-cleanup: released ${manifest.slotKey} resources\n`);
}

if (process.argv[1] === THIS_FILE) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`local-ci-slot-cleanup: ${error?.stack || error}\n`);
    process.exitCode = 1;
  }
}

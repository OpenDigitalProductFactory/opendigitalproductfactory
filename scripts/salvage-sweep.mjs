#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPOSITORY_CLASS = Object.freeze({
  LOCAL_ONLY: "LOCAL-ONLY",
  OPERATOR_REMOTE: "OPERATOR-REMOTE",
  UPSTREAM_CACHE: "UPSTREAM-CACHE",
});

function remoteOwner(remoteUrl) {
  if (!remoteUrl) return null;
  const normalized = remoteUrl
    .replace(/^git@[^:]+:/, "")
    .replace(/^[a-z]+:\/\/[^/]+\//i, "")
    .replace(/^ssh:\/\/git@[^/]+\//i, "")
    .replace(/\.git$/i, "");
  return normalized.split("/").filter(Boolean)[0] ?? null;
}

export function classifyRepository({ remoteUrl, operatorOwners = [] }) {
  if (!remoteUrl) return REPOSITORY_CLASS.LOCAL_ONLY;
  const owner = remoteOwner(remoteUrl)?.toLowerCase();
  const governedOwners = new Set(operatorOwners.map((value) => value.toLowerCase()));
  return owner && governedOwners.has(owner)
    ? REPOSITORY_CLASS.OPERATOR_REMOTE
    : REPOSITORY_CLASS.UPSTREAM_CACHE;
}

export function unreachableCommitArgs(branch) {
  return ["rev-list", "--count", branch, "--not", "--remotes"];
}

function git(repositoryPath, args, fallback = null) {
  try {
    return execFileSync("git", ["-C", repositoryPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

export function inspectRepository(repositoryPath, operatorOwners = []) {
  const absolutePath = resolve(repositoryPath);
  if (git(absolutePath, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return { path: absolutePath, error: "not_a_git_worktree", atRisk: false };
  }

  const remoteUrl = git(absolutePath, ["remote", "get-url", "origin"]);
  const classification = classifyRepository({ remoteUrl, operatorOwners });
  const branchNames = (git(absolutePath, ["for-each-ref", "--format=%(refname)", "refs/heads"], "") || "")
    .split(/\r?\n/)
    .filter(Boolean);
  const branches = branchNames.map((branch) => ({
    branch,
    commitsUnreachableFromRemotes: Number(git(absolutePath, unreachableCommitArgs(branch), "0")) || 0,
  }));
  const dirtyPaths = (git(absolutePath, ["status", "--porcelain"], "") || "").split(/\r?\n/).filter(Boolean).length;
  const stashes = Number(git(absolutePath, ["rev-list", "--count", "refs/stash"], "0")) || 0;
  const unreachableCommits = branches.reduce((sum, branch) => sum + branch.commitsUnreachableFromRemotes, 0);
  const atRisk = dirtyPaths > 0 || stashes > 0 || unreachableCommits > 0;
  return { path: absolutePath, remoteUrl, classification, dirtyPaths, stashes, unreachableCommits, branches, atRisk };
}

function parseArguments(argv) {
  const paths = [];
  const operatorOwners = [];
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--operator-owner") {
      const owner = argv[index + 1];
      if (!owner) throw new Error("missing_operator_owner");
      operatorOwners.push(owner);
      index += 1;
    } else if (value === "--json") {
      json = true;
    } else if (value === "--help" || value === "-h") {
      return { help: true, paths, operatorOwners, json };
    } else if (value.startsWith("-")) {
      throw new Error(`unknown_argument:${value}`);
    } else {
      paths.push(value);
    }
  }
  return { help: false, paths, operatorOwners, json };
}

function printUsage() {
  process.stdout.write(`Usage: node scripts/salvage-sweep.mjs [--operator-owner OWNER] [--json] <repo>...\n\n` +
    `Inspects only explicitly named repositories. LOCAL-ONLY and operator remotes are kept\n` +
    `distinct from third-party UPSTREAM-CACHE clones; risk counts use commits unreachable\n` +
    `from every remote, plus dirty paths and stashes.\n`);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { printUsage(); return; }
  if (options.paths.length === 0) throw new Error("at_least_one_repository_path_required");
  const results = options.paths.map((repositoryPath) => inspectRepository(repositoryPath, options.operatorOwners));
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ repositories: results }, null, 2)}\n`);
  } else {
    for (const result of results) {
      if (result.error) {
        process.stdout.write(`${result.path}: ${result.error}\n`);
      } else {
        process.stdout.write(`${result.classification} ${result.path} ` +
          `unreachable=${result.unreachableCommits} dirty=${result.dirtyPaths} stashes=${result.stashes}` +
          `${result.atRisk ? " AT-RISK" : ""}\n`);
      }
    }
  }
  if (results.some((result) => result.atRisk)) process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

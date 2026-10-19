#!/usr/bin/env node

import { parseArgs as utilParseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gitTextOrNull } from "./lib/git.mjs";

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

const git = (repositoryPath, args, fallback = null) =>
  gitTextOrNull(["-C", repositoryPath, ...args], { cwd: process.cwd() }) ?? fallback;

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
  const options = { "operator-owner": { type: "string", multiple: true }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } };
  // strict: false plus the token check below keeps the old error codes, and lets a
  // repository path follow the flags as a positional.
  const { values, positionals, tokens } = utilParseArgs({ args: argv, options, strict: false, allowPositionals: true, tokens: true });
  const unknown = tokens.find((token) => token.kind === "option-terminator" || (token.kind === "option" && !Object.hasOwn(options, token.name)));
  const help = values.help === true;
  if (!help && unknown) throw new Error(`unknown_argument:${unknown.rawName ?? "--"}`);
  const operatorOwners = values["operator-owner"] ?? [];
  if (!help && operatorOwners.some((owner) => typeof owner !== "string" || !owner)) throw new Error("missing_operator_owner");
  return { help, paths: positionals, operatorOwners, json: values.json === true };
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

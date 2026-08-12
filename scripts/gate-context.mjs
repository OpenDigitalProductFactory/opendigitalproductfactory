#!/usr/bin/env node
// scripts/gate-context.mjs — CLI for the gate-context pack (BI-2677A465).
//
//   pnpm gate:context              # markdown pack for the current worktree diff
//   node scripts/gate-context.mjs --json          # machine-readable
//   node scripts/gate-context.mjs --base origin/main
//
// Diff scope: everything this worktree would ship — committed, staged, AND
// unstaged changes plus untracked files — measured against the merge base
// with `--base` (default origin/main). Run it BEFORE writing code (empty diff
// still prints the verification path) and again before pushing.
//
// `--stdin-json` bypasses git entirely: read `{"changedFiles":[{"path","status"}]}`
// from stdin and emit the pack for those PLANNED changes. This is how Build
// Studio injects prospective constraints at prompt-assembly time, before any
// code exists (the plan's fileStructure is the intended diff).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildGateContext, formatGateContextMarkdown } from "./lib/gate-context.mjs";

// Same conservative ref/path pinning as the gate checkers
// (js/indirect-command-line-injection): execFile arg arrays, no shell, and a
// leading-dash guard so nothing is reinterpreted as an option.
const REF_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
const PATH_RE = /^[A-Za-z0-9._\-/()[\]@]+$/;

function assertSafeRef(ref) {
  if (!REF_RE.test(ref) || ref.startsWith("-")) {
    throw new Error(`[gate-context] refusing unsafe ref: ${JSON.stringify(ref)}`);
  }
  return ref;
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function safePath(path) {
  const normalized = String(path ?? "").trim().replace(/\\/g, "/");
  if (
    !normalized ||
    !PATH_RE.test(normalized) ||
    normalized.startsWith("-") ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) return null;
  return normalized;
}

export function collectWorktreeDiff({ base = "origin/main", cwd = process.cwd() } = {}) {
  assertSafeRef(base);
  const mergeBase = git(["merge-base", base, "HEAD"], cwd).trim();
  assertSafeRef(mergeBase);

  const changedFiles = [];
  const addedLinesByFile = new Map();

  for (const line of git(["diff", "--name-status", "--diff-filter=ACMRD", mergeBase], cwd).split(/\r?\n/)) {
    // Renames arrive as "R<score>\told\tnew" — the new path is the live one.
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const status = parts[0][0];
    const path = safePath(parts[parts.length - 1]);
    if (!path) continue;
    changedFiles.push({ path, status: status === "C" || status === "R" ? "A" : status });
  }

  for (const line of git(["diff", "--numstat", mergeBase], cwd).split(/\r?\n/)) {
    const match = line.match(/^(\d+)\t\d+\t(.+)$/);
    if (!match) continue;
    const path = safePath(match[2]);
    if (path) addedLinesByFile.set(path, Number(match[1]));
  }

  for (const line of git(["ls-files", "--others", "--exclude-standard"], cwd).split(/\r?\n/)) {
    const path = safePath(line);
    if (path) changedFiles.push({ path, status: "A" });
  }

  return { base, mergeBase, changedFiles, addedLinesByFile };
}

export function parseStdinChanges(text) {
  const payload = JSON.parse(text);
  const entries = Array.isArray(payload?.changedFiles) ? payload.changedFiles : [];
  return entries
    .map((entry) => ({
      path: safePath(entry?.path),
      status: entry?.status === "A" || entry?.status === "D" || entry?.status === "P" ? entry.status : "M",
    }))
    .filter((entry) => entry.path);
}

export async function main() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : "origin/main";

  let changedFiles;
  let addedLinesByFile = new Map();
  let provenance = {};
  if (args.includes("--stdin-json")) {
    changedFiles = parseStdinChanges(readFileSync(0, "utf8"));
    const unresolvedPaths = [];
    changedFiles = changedFiles.map((entry) => {
      if (entry.status !== "P") return entry;
      const absolute = join(process.cwd(), entry.path);
      if (entry.path.endsWith("/") || (existsSync(absolute) && statSync(absolute).isDirectory())) {
        unresolvedPaths.push(entry.path);
      }
      return { ...entry, status: existsSync(absolute) ? "M" : "A" };
    });
    provenance = { source: "stdin-json", unresolvedPaths };
  } else {
    const diff = collectWorktreeDiff({ base });
    changedFiles = diff.changedFiles;
    addedLinesByFile = diff.addedLinesByFile;
    provenance = { base: diff.base, mergeBase: diff.mergeBase };
  }

  const context = buildGateContext({ changedFiles, addedLinesByFile });

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ ...provenance, ...context }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${formatGateContextMarkdown(context)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

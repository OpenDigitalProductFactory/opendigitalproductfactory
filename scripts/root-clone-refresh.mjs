#!/usr/bin/env node
// scripts/root-clone-refresh.mjs
//
// EP-PROCESS-SPINE (plan 2026-08-11-worktree-lifecycle-hygiene) — fast-forward the
// root clone to origin/main so junctioned worktrees never inherit a stale root
// (BI-A900EA3F remedy). Fast-forward ONLY; refuses when the root is off-main,
// detached, or dirty.
//
// USAGE
//   node scripts/root-clone-refresh.mjs [--root PATH] [--no-fetch] [--json]
//
// Exits 0 whenever it ran cleanly (including "skip"/"refuse" — those are correct,
// safe outcomes, not failures). Exits 1 only when it could not resolve the root or
// a ff-only merge it attempted actually failed.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveRootClonePath } from "./lib/stale-root-clone.mjs";
import { refreshRootClone } from "./lib/root-clone-refresh.mjs";

function parseArgs(argv) {
  let root = process.env.DPF_REPO_ROOT || process.env.PROJECT_ROOT || "";
  let json = false;
  let doFetch = true;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--no-fetch") doFetch = false;
    else if (a === "--root") root = argv[++i];
    else if (a.startsWith("--root=")) root = a.split("=")[1];
    else if (a === "-h" || a === "--help") {
      console.log("usage: node scripts/root-clone-refresh.mjs [--root PATH] [--no-fetch] [--json]");
      process.exit(0);
    }
  }
  return { root, json, doFetch };
}

function resolveRoot(explicit) {
  if (explicit && existsSync(explicit)) return explicit;
  // Resolve the owning root clone from the current directory (works from a worktree).
  const fromCwd = resolveRootClonePath(process.cwd(), {});
  if (fromCwd && existsSync(fromCwd)) return fromCwd;
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  if (existsSync("/host-dpf")) return "/host-dpf";
  return null;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = resolveRoot(args.root);
  if (!root) {
    const err = { ok: false, error: "could not resolve root clone (pass --root or set DPF_REPO_ROOT)" };
    if (args.json) console.log(JSON.stringify(err, null, 2));
    else console.error(`  [fail]  ${err.error}`);
    process.exit(1);
  }

  const result = refreshRootClone({ rootClonePath: root, doFetch: args.doFetch });
  const report = { ok: result.action !== "failed", root, ...result };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  const tag =
    result.action === "ff" ? "[ff]  " :
    result.action === "skip" ? "[ok]  " :
    result.action === "refuse" ? "[skip]" : "[fail]";
  console.log(`${tag} root clone ${root} — ${result.reason}`);
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}

export { main };

#!/usr/bin/env node
// Regenerate pnpm-lock.yaml the RIGHT way, and prove the result is scoped + stable.
//
// Why this exists: editing the `overrides:` block of pnpm-workspace.yaml makes pnpm
// re-resolve the WHOLE tree. On a developer box with a populated pnpm store, pnpm
// resolves that re-resolution OFFLINE from the stale store (`downloaded 0` is the
// tell) and silently produces invalid downgrades — e.g. `@vitest/expect@4.1.9`
// against a `^4.1.10` range. The fix is to force fresh registry metadata by pointing
// pnpm at a fresh, EMPTY store+cache. An empty cache alone is not enough — pnpm falls
// back to the populated store. This script encapsulates that so no one rediscovers it.
//
// Usage:
//   node scripts/regen-lockfile.mjs [--expect pkgA,pkgB,...]
//   pnpm regen:lockfile -- --expect fast-uri,hono,sharp
//
//   --expect  comma-separated package names allowed to change. Any changed package
//             outside this set is reported as DRIFT (non-zero exit). Omit to just
//             report the changed set without failing.
//
// It regenerates pnpm-lock.yaml IN PLACE (that is the point — you edited overrides,
// now regenerate), then: (1) reports the packages whose resolved version changed,
// (2) checks that set against --expect, and (3) proves a second resolve is a no-op
// (so `--frozen-lockfile` CI will pass). It never touches your real pnpm store.
//
// Spec: docs/superpowers/specs/2026-07-21-agent-process-efficiency-hardening-design.md

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const LOCKFILE = "pnpm-lock.yaml";

function parseArgs(argv) {
  const args = { expect: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
    else if (argv[i] === "--expect") args.expect = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

function runPnpm(extraArgs) {
  const res = spawnSync(
    "pnpm",
    ["install", "--lockfile-only", "--config.confirmModulesPurge=false", ...extraArgs],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: true },
  );
  return res;
}

function lockHash() {
  return createHash("sha256").update(readFileSync(LOCKFILE)).digest("hex");
}

// Extract the set of `name@version` package definitions from the lockfile diff.
function changedPackages() {
  const diff = spawnSync("git", ["diff", "--unified=0", "--", LOCKFILE], { encoding: "utf8" }).stdout || "";
  const re = /^([+-])  '?(@?[a-z0-9][^' @]*)@([0-9][^:'()]*)/i;
  const added = new Map();
  const removed = new Map();
  for (const line of diff.split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    const [, sign, name, ver] = m;
    const target = sign === "+" ? added : removed;
    if (!target.has(name)) target.set(name, new Set());
    target.get(name).add(ver);
  }
  const names = new Set([...added.keys(), ...removed.keys()]);
  const changed = [];
  for (const name of names) {
    const oldV = [...(removed.get(name) || [])].filter((v) => !(added.get(name) || new Set()).has(v));
    const newV = [...(added.get(name) || [])].filter((v) => !(removed.get(name) || new Set()).has(v));
    if (oldV.length || newV.length) changed.push({ name, from: oldV, to: newV });
  }
  return changed.sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split("\n").slice(1, 20).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    return 0;
  }

  const store = mkdtempSync(join(tmpdir(), "dpf-regen-store-"));
  const cache = mkdtempSync(join(tmpdir(), "dpf-regen-cache-"));
  try {
    console.log("[regen] resolving against a fresh empty store (forces fresh registry metadata)…");
    const first = runPnpm([`--config.storeDir=${store}`, `--config.cacheDir=${cache}`]);
    if (first.status !== 0) {
      console.error("[regen] pnpm install failed:\n" + (first.stderr || first.stdout));
      return 1;
    }
    const afterFirst = lockHash();

    const changed = changedPackages();
    if (changed.length === 0) {
      console.log("[regen] lockfile already current — no package versions changed.");
    } else {
      console.log(`[regen] ${changed.length} package(s) changed:`);
      for (const c of changed) {
        console.log(`   ${c.name}: ${c.from.join(",") || "∅"} -> ${c.to.join(",") || "∅"}`);
      }
    }

    // Scope check
    let drift = [];
    if (args.expect) {
      drift = changed.filter((c) => !args.expect.includes(c.name));
      if (drift.length) {
        console.error(`[regen] DRIFT — ${drift.length} changed package(s) outside --expect:`);
        for (const c of drift) console.error(`   ${c.name}`);
      } else {
        console.log(`[regen] SCOPED — all changes within --expect (${args.expect.join(", ")}).`);
      }
    }

    // Stability check: a second resolve against the SAME fresh store must be a no-op.
    const second = runPnpm([`--config.storeDir=${store}`, `--config.cacheDir=${cache}`]);
    if (second.status !== 0) {
      console.error("[regen] stability re-resolve failed:\n" + (second.stderr || second.stdout));
      return 1;
    }
    const stable = lockHash() === afterFirst;
    console.log(stable ? "[regen] STABLE — second resolve was a no-op (frozen-lockfile CI will pass)." : "[regen] UNSTABLE — second resolve changed the lockfile again.");

    return drift.length || !stable ? 2 : 0;
  } finally {
    rmSync(store, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
}

process.exit(main());

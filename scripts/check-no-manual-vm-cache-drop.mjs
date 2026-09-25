#!/usr/bin/env node
// Ratchet guard — BI-903FB5F9.
//
// Forbids any checked-in script, runbook, skill or doc from carrying a recipe
// that drops the Linux page cache by hand (a write to the kernel's drop-caches
// knob, usually preceded by `sync`).
//
// Why: when local-CI closed on host memory, agent sessions ran such a recipe in
// the Docker Desktop VM. It could not help: admission reads MemAvailable, which
// already counts page cache as available. On WSL the `sync` also blocked
// forever on a dead virtiofs share. By 2026-09-25, 14 processes sat in
// uninterruptible sleep, and only a VM restart cleared them. The platform owns
// host memory (measured builder reserve, honest closure); a session never
// does it by hand. The kernel documents the knob as a testing and debugging aid.
//
// Design history under docs/superpowers/specs may quote the recipe it
// forbids, as may this guard's own files.
//
// Contract: exit 0 = clean, non-zero = violation (see check-guards.mjs).

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KNOB = ["drop", "caches"].join("_");
const EXEMPT_PREFIXES = ["docs/superpowers/specs/"];
const EXEMPT_FILES = new Set([
  "scripts/check-no-manual-vm-cache-drop.mjs",
  "scripts/check-no-manual-vm-cache-drop.test.mjs",
]);

export function isExemptPath(path) {
  const normalized = path.replace(/\\/g, "/");
  return EXEMPT_FILES.has(normalized)
    || EXEMPT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Lines that write the drop-caches knob, or pair it with `sync`. */
export function findManualCacheDrops(text) {
  const writes = new RegExp(
    `(>\\s*\\S*${KNOB})|(tee\\s+\\S*${KNOB})|(vm\\.${KNOB}\\s*=)`,
  );
  const violations = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.includes(KNOB)) return;
    // `sync` counts only as a command (`sync;` / `sync &&`), so prose that
    // warns against the recipe is not itself a recipe.
    if (writes.test(line) || /\bsync\s*(;|&&)/.test(line)) {
      violations.push({ line: index + 1, text: line.trim() });
    }
  });
  return violations;
}

function trackedFilesMentioningKnob(repoRoot) {
  try {
    return execFileSync("git", ["grep", "-l", "-I", "-F", KNOB], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).split(/\r?\n/).filter(Boolean);
  } catch (error) {
    // git grep exits 1 when nothing matches.
    if (error && error.status === 1) return [];
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { readFileSync } = await import("node:fs");
  const violations = [];
  for (const path of trackedFilesMentioningKnob(repoRoot)) {
    if (isExemptPath(path)) continue;
    for (const hit of findManualCacheDrops(readFileSync(join(repoRoot, path), "utf8"))) {
      violations.push(`${path}:${hit.line}: ${hit.text}`);
    }
  }
  if (violations.length > 0) {
    console.error("Manual page-cache drop recipe(s) found (BI-903FB5F9):");
    for (const violation of violations) console.error(`  ${violation}`);
    console.error(
      "Local-CI admission already counts page cache as available, and `sync` can wedge the Docker VM. "
        + "The platform owns host memory; see docs/superpowers/specs/2026-09-25-platform-owned-local-ci-memory-design.md.",
    );
    process.exit(1);
  }
  console.log("No manual page-cache drop recipes in tracked files.");
}

#!/usr/bin/env node
// check-no-retired-lib-namespaces.mjs — Simplify & Strengthen W10 ratchet
// (BI-AB17E1A8, pass §3.1-b move #7).
//
// The W10 seam dissolved eight apps/web/lib namespaces by moving their
// contents to the ONE home each concern already had:
//
//   lib/integrate/        -> lib/integrations/ (connectors + intake) and
//                            lib/build/ (Build Studio orchestration)
//   lib/ops/              -> lib/operate/
//   lib/operations/       -> lib/operate/
//   lib/operations-run/   -> lib/operate/
//   lib/workspace/        -> lib/workspace-home/
//   lib/edge/             -> lib/edge-node/
//   lib/platform-config/  -> lib/platform/
//   lib/release/storefront-*.ts -> lib/storefront/ (file pattern, not a dir —
//                            lib/release itself stays as the branding home)
//
// This guard is the ratchet that keeps them dissolved: a retired directory
// that reappears with ANY file in it (a stale branch merge, a generator with
// a hardcoded path, muscle memory) fails CI, as does a new storefront-* module
// under lib/release. Without the ratchet the near-synonym collision the pass
// calls out ("same concern in two homes") regrows silently.
//
// Contract (scripts/check-guards.mjs loop): exit 0 clean, non-zero violation;
// the sibling .test.mjs proves the guard logic before the loop runs it.
//
// Run: node scripts/check-no-retired-lib-namespaces.mjs

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isEntryModule } from "./lib/entry-module.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");

/** Directories dissolved by W10 — must not exist (or must be empty). */
export const RETIRED_DIRECTORIES = Object.freeze([
  "apps/web/lib/integrate",
  "apps/web/lib/ops",
  "apps/web/lib/operations",
  "apps/web/lib/operations-run",
  "apps/web/lib/workspace",
  "apps/web/lib/edge",
  "apps/web/lib/platform-config",
]);

/** New home per retired namespace — used in the failure message. */
export const RETIRED_DIRECTORY_HOMES = Object.freeze({
  "apps/web/lib/integrate":
    "apps/web/lib/integrations (connectors/intake) or apps/web/lib/build (Build Studio orchestration)",
  "apps/web/lib/ops": "apps/web/lib/operate",
  "apps/web/lib/operations": "apps/web/lib/operate",
  "apps/web/lib/operations-run": "apps/web/lib/operate",
  "apps/web/lib/workspace": "apps/web/lib/workspace-home",
  "apps/web/lib/edge": "apps/web/lib/edge-node",
  "apps/web/lib/platform-config": "apps/web/lib/platform",
});

/** File pattern retired in a directory that itself remains. */
export const RETIRED_FILE_PATTERNS = Object.freeze([
  {
    directory: "apps/web/lib/release",
    pattern: /^storefront-/,
    home: "apps/web/lib/storefront",
  },
]);

/**
 * Pure evaluator so the self-test can exercise the policy without touching
 * the real tree. `listDirectory(relDir)` returns entry names or null when the
 * directory does not exist.
 */
export function findRetiredNamespaceViolations(listDirectory) {
  const violations = [];
  for (const dir of RETIRED_DIRECTORIES) {
    const entries = listDirectory(dir);
    if (entries === null) continue; // gone — the desired end state
    if (entries.length === 0) continue; // empty husk; git cannot track it
    violations.push({
      kind: "retired-directory",
      directory: dir,
      entries: [...entries].sort(),
      home: RETIRED_DIRECTORY_HOMES[dir],
    });
  }
  for (const { directory, pattern, home } of RETIRED_FILE_PATTERNS) {
    const entries = listDirectory(directory);
    if (entries === null) continue;
    const offenders = entries.filter((name) => pattern.test(name)).sort();
    if (offenders.length) {
      violations.push({
        kind: "retired-file-pattern",
        directory,
        entries: offenders,
        home,
      });
    }
  }
  return violations;
}

function listRealDirectory(relDir) {
  const abs = join(REPO_ROOT, relDir);
  if (!existsSync(abs)) return null;
  try {
    return readdirSync(abs);
  } catch {
    return null;
  }
}

function main() {
  const violations = findRetiredNamespaceViolations(listRealDirectory);
  if (violations.length) {
    console.error("Retired lib namespaces regrew (W10 ratchet, BI-AB17E1A8):");
    for (const v of violations) {
      if (v.kind === "retired-directory") {
        console.error(`  - ${v.directory}/ is retired but contains: ${v.entries.join(", ")}`);
      } else {
        console.error(`  - ${v.directory}/ may not gain storefront-* modules; found: ${v.entries.join(", ")}`);
      }
      console.error(`    Move the file(s) to ${v.home}.`);
    }
    console.error("");
    console.error("These namespaces were dissolved by the Simplify & Strengthen W10 seam");
    console.error("(docs/architecture/2026-08-16-simplify-and-strengthen-architecture-pass.md");
    console.error("§3.1-b). Each concern has ONE home now — add new modules there.");
    process.exit(1);
  }
  console.log(
    `✓ No files in retired lib namespaces (${RETIRED_DIRECTORIES.length} dirs + ${RETIRED_FILE_PATTERNS.length} file pattern held down).`,
  );
}

if (isEntryModule(import.meta.url)) {
  main();
}

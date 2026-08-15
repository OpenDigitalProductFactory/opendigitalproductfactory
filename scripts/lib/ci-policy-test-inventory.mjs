/**
 * Conformance for hand-enumerated policy-guard test inventory (BI-812C676D).
 *
 * `scripts/lib/ci-policy-guards.mjs` lists every `node --test` path by hand.
 * A new `*.test.mjs` under the covered roots that is not on that list (and not
 * on the deliberate allowlist) never runs in CI while the PR still goes green.
 *
 * This module discovers on-disk tests and compares them to the inventory plus
 * a shrink-only allowlist of intentionally CI-unlisted files.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { POLICY_GUARD_PROFILES } from "./ci-policy-guards.mjs";

/** Roots whose `*.test.mjs` files must be inventory-reachable or allowlisted. */
export const COVERED_TEST_ROOTS = Object.freeze([
  "scripts",
  "packages/dpf-skill-pack/hooks",
  "tests/release",
]);

export const DEFAULT_ALLOWLIST_PATH =
  "scripts/ci-policy-test-inventory-allowlist.txt";

export function normalizeRepoPath(p) {
  return String(p).split("\\").join("/");
}

/**
 * Collect every `*.test.mjs` path (repo-relative, forward slashes) under the
 * covered roots. Skips node_modules / dist / .git.
 */
export function discoverTestMjsFiles(repoRoot, roots = COVERED_TEST_ROOTS) {
  const acc = [];
  function walk(absDir) {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === ".git"
        ) {
          continue;
        }
        walk(abs);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
        acc.push(normalizeRepoPath(relative(repoRoot, abs)));
      }
    }
  }
  for (const root of roots) {
    walk(join(repoRoot, root));
  }
  acc.sort((a, b) => a.localeCompare(b));
  return acc;
}

/**
 * Paths named as `node --test <path>` arguments across all policy-guard profiles.
 */
export function collectInventoryTestPaths(profiles = POLICY_GUARD_PROFILES) {
  const listed = new Set();
  for (const profile of Object.values(profiles)) {
    for (const guard of profile) {
      for (const command of guard.commands) {
        const [bin, args] = command;
        if (bin !== "node" || !Array.isArray(args) || args[0] !== "--test") {
          continue;
        }
        for (const arg of args.slice(1)) {
          if (typeof arg === "string" && arg.endsWith(".test.mjs")) {
            listed.add(normalizeRepoPath(arg));
          }
        }
      }
    }
  }
  return listed;
}

/**
 * Parse allowlist file: one repo-relative path per line; `#` comments and blank
 * lines ignored.
 */
export function parseAllowlist(text) {
  const paths = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    paths.add(normalizeRepoPath(line));
  }
  return paths;
}

export function loadAllowlistFile(absPath) {
  return parseAllowlist(readFileSync(absPath, "utf8"));
}

/**
 * Pure evaluator.
 *
 * @returns {{
 *   ok: boolean,
 *   discovered: string[],
 *   inventory: string[],
 *   allowlisted: string[],
 *   missing: string[],
 *   staleAllowlist: string[],
 *   messages: string[],
 * }}
 */
export function evaluateTestInventoryCoverage({
  discovered,
  inventory,
  allowlist,
}) {
  const inv = inventory instanceof Set ? inventory : new Set(inventory);
  const allow = allowlist instanceof Set ? allowlist : new Set(allowlist);
  const disc = [...discovered].map(normalizeRepoPath).sort();

  const missing = disc.filter((p) => !inv.has(p) && !allow.has(p));
  // Allowlist entries that are now in inventory (should be removed) or gone.
  const staleAllowlist = [...allow]
    .filter((p) => inv.has(p) || !disc.includes(p))
    .sort((a, b) => a.localeCompare(b));

  const messages = [];
  if (missing.length > 0) {
    messages.push(
      `Unlisted ${missing.length} *.test.mjs file(s) under covered roots — ` +
        `CI will not run them. Add each path to scripts/lib/ci-policy-guards.mjs ` +
        `(a node --test argument) or, if deliberately excluded, to ` +
        `${DEFAULT_ALLOWLIST_PATH}:`,
    );
    for (const p of missing) {
      messages.push(`  - ${p}`);
    }
  }
  if (staleAllowlist.length > 0) {
    messages.push(
      `Allowlist has ${staleAllowlist.length} stale path(s) (now inventory-listed or deleted) — remove them so the allowlist only shrinks:`,
    );
    for (const p of staleAllowlist) {
      messages.push(`  - ${p}`);
    }
  }

  return {
    ok: missing.length === 0 && staleAllowlist.length === 0,
    discovered: disc,
    inventory: [...inv].sort((a, b) => a.localeCompare(b)),
    allowlisted: [...allow].sort((a, b) => a.localeCompare(b)),
    missing,
    staleAllowlist,
    messages,
  };
}

/**
 * Full check against the live tree + registry + allowlist file.
 */
export function checkTestInventoryCoverage(repoRoot, {
  allowlistPath = join(repoRoot, DEFAULT_ALLOWLIST_PATH),
  profiles = POLICY_GUARD_PROFILES,
} = {}) {
  const discovered = discoverTestMjsFiles(repoRoot);
  const inventory = collectInventoryTestPaths(profiles);
  const allowlist = loadAllowlistFile(allowlistPath);
  return evaluateTestInventoryCoverage({ discovered, inventory, allowlist });
}

#!/usr/bin/env node
// Package boundary guard — BI-ARCH-PACKAGES first enforcement.
//
// The portable contract/client layer shared with the mobile app must not depend
// on server persistence. This check fails if any portable package declares or
// imports `@dpf/db` / Prisma. It is the executable form of the invariant in
// docs/architecture/package-boundaries.md ("Portable contract layer").
//
// Run directly:   node scripts/check-package-boundaries.mjs
// Or as a test:   apps/web/lib/contracts/package-boundaries.test.ts imports
//                 `checkPackageBoundaries()` so it runs in the Unit Tests CI job.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Packages that MUST stay free of server persistence (Prisma / @dpf/db). */
export const PORTABLE_PACKAGES = ["packages/types", "packages/validators", "packages/api-client"];

/** Module specifiers that couple a package to server persistence. */
const FORBIDDEN_IMPORTS = ["@dpf/db", "@prisma/client", ".prisma/client"];

/** package.json dependency names that couple a package to server persistence. */
const FORBIDDEN_DEPS = ["@dpf/db", "@prisma/client", "prisma"];

const FROM_RE = /\bfrom\s*["']([^"']+)["']/g;
const REQUIRE_RE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

function listSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) out.push(full);
  }
  return out;
}

function isForbidden(spec) {
  return FORBIDDEN_IMPORTS.some((f) => spec === f || spec.startsWith(`${f}/`));
}

/** Returns a list of human-readable boundary violations (empty when clean). */
export function checkPackageBoundaries() {
  const violations = [];
  for (const pkgDir of PORTABLE_PACKAGES) {
    const abs = join(REPO_ROOT, pkgDir);

    // 1) package.json must not declare a forbidden dependency.
    const pkg = JSON.parse(readFileSync(join(abs, "package.json"), "utf8"));
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const dep of Object.keys(pkg[field] || {})) {
        if (FORBIDDEN_DEPS.includes(dep)) {
          violations.push(`${pkgDir}/package.json declares forbidden dependency "${dep}" (${field})`);
        }
      }
    }

    // 2) no source file may import a forbidden module.
    for (const file of listSourceFiles(join(abs, "src"))) {
      const text = readFileSync(file, "utf8");
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      for (const re of [FROM_RE, REQUIRE_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          if (isForbidden(m[1])) {
            violations.push(`${rel} imports forbidden module "${m[1]}"`);
          }
        }
      }
    }
  }
  return violations;
}

// CLI entry — only when executed directly, not when imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const violations = checkPackageBoundaries();
  if (violations.length > 0) {
    console.error("Package boundary violations — portable packages must not depend on @dpf/db / Prisma:");
    for (const v of violations) console.error(`  - ${v}`);
    console.error("\nSee docs/architecture/package-boundaries.md");
    process.exit(1);
  }
  console.log(
    `Package boundaries OK — ${PORTABLE_PACKAGES.length} portable packages are free of @dpf/db / Prisma.`,
  );
}

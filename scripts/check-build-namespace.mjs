#!/usr/bin/env node
// Build Studio namespace freeze guard — BI-ARCH-BUILDSTUDIO-NS.
//
// `apps/web/components/build` is the single PRODUCTION Build Studio namespace —
// where builds, build plans, and agent-generated file paths all land.
// `apps/web/components/build-studio` is a stale (last touched 2026-05-10),
// quarantined V2 chat-shell prototype, reachable only via `/build?v=2`. To stop
// the "two production-adjacent namespaces" divergence the spec flags (§3.4), this
// guard freezes the prototype's production footprint: no NEW production code may
// import `@/components/build-studio` beyond the known wiring below. New Build
// Studio UI belongs in `components/build`. See
// docs/architecture/build-studio-namespace.md.
//
// Run: node scripts/check-build-namespace.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(REPO_ROOT, "apps", "web");
const SCAN_DIRS = ["app", "components", "lib", "hooks"].map((d) => join(WEB, d));

// The quarantined prototype's known production wiring. Removing an entry is fine
// (the set only tightens); ADDING a new importer must be a deliberate decision.
const ALLOWED_IMPORTERS = new Set([
  "apps/web/app/(shell)/build/page.tsx",
  "apps/web/lib/build-studio-demo.ts",
]);

const QUARANTINED = "components/build-studio";
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
    if (entry === "node_modules" || entry === ".next" || entry === "dist" || entry === ".turbo") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function importsQuarantined(text) {
  for (const re of [FROM_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1].includes(QUARANTINED)) return true;
    }
  }
  return false;
}

const violations = [];
for (const dir of SCAN_DIRS) {
  for (const file of listSourceFiles(dir)) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
    // Files inside the prototype may import their own siblings.
    if (rel.startsWith("apps/web/components/build-studio/")) continue;
    if (!importsQuarantined(readFileSync(file, "utf8"))) continue;
    if (!ALLOWED_IMPORTERS.has(rel)) {
      violations.push(rel);
    }
  }
}

if (violations.length > 0) {
  console.error("Build Studio namespace violations — new production imports of the quarantined");
  console.error("`components/build-studio` prototype. New Build Studio UI belongs in `components/build`:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("\nSee docs/architecture/build-studio-namespace.md");
  process.exit(1);
}

console.log(
  `Build Studio namespace OK — components/build is the sole production namespace; the build-studio prototype has ${ALLOWED_IMPORTERS.size} known (frozen) importers.`,
);

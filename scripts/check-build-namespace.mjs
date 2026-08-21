#!/usr/bin/env node
// Build Studio namespace freeze guard — BI-ARCH-BUILDSTUDIO-NS.
//
// `apps/web/components/build` is the single PRODUCTION Build Studio namespace —
// where builds, build plans, and agent-generated file paths all land.
// `apps/web/components/build-studio` WAS a quarantined V2 chat-shell prototype
// reachable via `/build?v=2`. It is now RETIRED (BI-101C107C): the directory,
// the `?v=2` route branch and `lib/build-studio-demo.ts` are deleted.
//
// This guard was originally a freeze — it capped the prototype's production
// footprint at two known importers but had no mechanism to require its eventual
// removal, so the prototype survived four months past the 2026-07-31 plan that
// scheduled its deletion (Phase C). That is the absence-is-invisible pattern:
// the guard checked that nothing NEW imported the prototype, never that the
// prototype should still exist.
//
// It is now a RETIREMENT guard: zero importers, and the namespace must stay
// gone. New Build Studio UI belongs in `components/build`. See
// docs/architecture/build-studio-namespace.md.
//
// Run: node scripts/check-build-namespace.mjs

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(REPO_ROOT, "apps", "web");
const SCAN_DIRS = ["app", "components", "lib", "hooks"].map((d) => join(WEB, d));

// The prototype is retired (BI-101C107C). No importer is allowed — this set is
// empty and must stay empty. Re-introducing the namespace requires deleting the
// surface it replaces, not adding an exemption here.
const ALLOWED_IMPORTERS = new Set([]);

const QUARANTINED = "components/build-studio";
const RETIRED_DIR = join(WEB, "components", "build-studio");
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

if (existsSync(RETIRED_DIR)) {
  console.error("`apps/web/components/build-studio` is RETIRED (BI-101C107C) but has reappeared.");
  console.error("Build Studio UI belongs in `components/build`. A second production-adjacent");
  console.error("namespace is how /build ended up rendering two shells at once.");
  console.error("\nSee docs/architecture/build-studio-namespace.md");
  process.exit(1);
}

if (violations.length > 0) {
  console.error("Build Studio namespace violations — production imports of the RETIRED");
  console.error("`components/build-studio` prototype. Build Studio UI belongs in `components/build`:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("\nSee docs/architecture/build-studio-namespace.md");
  process.exit(1);
}

console.log(
  "Build Studio namespace OK — components/build is the sole production namespace; the build-studio prototype is retired with zero importers.",
);

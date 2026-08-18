#!/usr/bin/env node
// scripts/check-endpoint-classification.mjs
//
// Simplify & Strengthen W17 (BI-810BEC9C, pass §5; edge reachability plan
// docs/superpowers/plans/2026-08-11-edge-reachability-topology.md EP-8B03CB06)
// — endpoint exposure classification at birth.
//
// THE PROBLEM: apps/web/app/api has 260+ route handlers and NOTHING that says,
// per endpoint, who is allowed to reach it. Reachability policy lives only in
// the proxy's path-segmentation (lib/release/storefront-middleware.ts) plus
// per-handler auth() calls, so "is this endpoint supposed to be public?" is
// unanswerable from source — the exact gap the edge-reachability plan needs
// closed before endpoints ride a public relay.
//
// THE CONTRACT: every route handler under apps/web/app/api declares its
// exposure class at birth via a colocated pragma comment
//
//   // @exposure public | authenticated | private-mesh
//
// MECHANISM CHOICE (documented per the W17 brief): the preferred shape was
// `export const exposure = "…"` per route file, but Next.js 16's generated
// route type-guards (next-types-plugin `checkFields<Diff<…>>`) reject any
// non-standard export from a route.ts entry, so the per-file declaration is a
// structured pragma instead. It stays colocated (no central conflict-magnet
// map — the same merge-cascade reasoning as scripts/check-guards.mjs), and the
// EXISTING route-manifest codegen (apps/web/scripts/build-route-manifest.ts →
// apps/web/lib/ea/route-manifest.json, registered in the derived-artifacts
// chain with its own freshness gate) collects it into each manifest row's
// `exposure` field. This guard consumes the committed manifest rather than
// re-walking the filesystem — one scanner, not two; manifest staleness is the
// derived-artifacts gate's job, and an INVALID pragma hard-fails generation
// there, so it can never demote a route to "unclassified" here.
//
// WHAT FAILS:
//   - a route handler under apps/web/app/api with no exposure class and no
//     grandfather baseline entry (NEW routes are born classified);
//   - a baseline entry whose file is gone or now classified (shrink-only);
//   - any /api/a2a/* route in the baseline or unclassified — the A2A surface
//     is the first governed cohort and may never be grandfathered;
//   - a route classified "public" whose path is NOT inside the proxy's public
//     path-segmentation allowlist (RouteClass.PublicApi prefixes), or a route
//     inside that allowlist classified anything OTHER than "public" — the
//     path-segmentation and the per-endpoint declarations must agree, both ways.
//
// Baseline: scripts/endpoint-classification-baseline.txt (owned expiring
// budget per scripts/lib/baseline-budget.mjs — enforced born-budgeted by
// check-no-expired-baseline-budgets.mjs). Shrink it by classifying routes.
//
//   node scripts/check-endpoint-classification.mjs            # check (CI)
//   node scripts/check-endpoint-classification.mjs --update   # rewrite baseline
//                                                             # (preserves budget header)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { formatTxtBudgetHeader, parseTxtBudgetHeader } from "./lib/baseline-budget.mjs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_DIR, "..");

export const MANIFEST_REL = "apps/web/lib/ea/route-manifest.json";
export const PROXY_CLASSIFIER_REL = "apps/web/lib/release/storefront-middleware.ts";
export const BASELINE_REL = "scripts/endpoint-classification-baseline.txt";

/** Route-handler files this guard governs (manifest `file` prefix). */
export const GOVERNED_FILE_PREFIX = "apps/web/app/api/";

/** Closed set of exposure classes (mirror of ROUTE_EXPOSURES in
 *  apps/web/lib/ea/route-extract.ts — values only; extraction lives there). */
export const EXPOSURE_CLASSES = Object.freeze(["public", "authenticated", "private-mesh"]);

/**
 * Governed cohorts: file prefixes that must ALWAYS be classified — never
 * grandfathered. First cohort (W17): the A2A surface, whose reachability is
 * exactly what the edge plan segments.
 */
export const GOVERNED_COHORT_PREFIXES = Object.freeze(["apps/web/app/api/a2a/"]);

const BUDGET_NOTE_LINES = [
  "Grandfathered route handlers with no @exposure declaration yet (W17, BI-810BEC9C).",
  "Shrink-only: classify a route (// @exposure <class> pragma + regenerate the",
  "route manifest) and remove its line here — never add a new route to this file.",
  "Regenerate with: node scripts/check-endpoint-classification.mjs --update",
];

/**
 * Extract the proxy's public path-segmentation allowlist from the classifier
 * source: every string literal `pathname` is tested against on a line that
 * returns RouteClass.PublicApi. startsWith-vs-exact distinction is preserved
 * by classifyRoute itself using startsWith for every PublicApi rule; we mirror
 * that (prefix match). Zero extracted prefixes = the classifier moved/changed
 * shape — fail loudly rather than silently passing every "public" claim.
 */
export function extractPublicApiPrefixes(source) {
  const prefixes = [];
  for (const line of String(source).split(/\r?\n/)) {
    if (!line.includes("RouteClass.PublicApi")) continue;
    const m = line.match(/pathname(?:\.startsWith\(|\s*===\s*)\s*"([^"]+)"/);
    if (m) prefixes.push(m[1]);
  }
  return prefixes;
}

/** Parse baseline text → route-file paths (comment/blank lines skipped). */
export function parseBaseline(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/**
 * Pure check core.
 * @param manifestRoutes rows from route-manifest.json
 * @param baselineFiles  grandfathered route-file paths
 * @param publicPrefixes proxy PublicApi path prefixes
 * Returns { failures, governed, classified, unclassified } — counts for reporting.
 */
export function checkEndpointClassification({ manifestRoutes, baselineFiles, publicPrefixes }) {
  const failures = [];
  const governed = manifestRoutes.filter(
    (row) => row.kind === "route" && row.file.startsWith(GOVERNED_FILE_PREFIX),
  );
  const governedByFile = new Map(governed.map((row) => [row.file, row]));
  const baselineSet = new Set(baselineFiles);

  if (publicPrefixes.length === 0) {
    failures.push(
      `${PROXY_CLASSIFIER_REL}: could not extract any RouteClass.PublicApi path prefix — ` +
        `the proxy classifier moved or changed shape; update extractPublicApiPrefixes().`,
    );
  }

  for (const file of baselineFiles) {
    const row = governedByFile.get(file);
    if (!row) {
      failures.push(`${BASELINE_REL}: stale entry ${file} — route no longer exists; remove the line (shrink-only).`);
      continue;
    }
    if (row.exposure) {
      failures.push(
        `${BASELINE_REL}: stale entry ${file} — route is now classified ("${row.exposure}"); remove the line (shrink-only).`,
      );
    }
    const cohort = GOVERNED_COHORT_PREFIXES.find((p) => file.startsWith(p));
    if (cohort) {
      failures.push(
        `${BASELINE_REL}: ${file} is in the governed cohort ${cohort} and may NEVER be grandfathered — classify it.`,
      );
    }
  }

  for (const row of governed) {
    if (row.exposure && !EXPOSURE_CLASSES.includes(row.exposure)) {
      // Defense in depth — the manifest generator already hard-fails invalid pragmas.
      failures.push(`${row.file}: manifest carries unknown exposure class "${row.exposure}".`);
      continue;
    }
    if (!row.exposure) {
      const cohort = GOVERNED_COHORT_PREFIXES.find((p) => row.file.startsWith(p));
      if (cohort) {
        failures.push(
          `${row.file}: governed cohort ${cohort} route has no exposure class — add a ` +
            `"// @exposure <public|authenticated|private-mesh>" pragma and regenerate the route manifest.`,
        );
      } else if (!baselineSet.has(row.file)) {
        failures.push(
          `${row.file}: NEW route handler has no exposure class — routes are born classified. Add a ` +
            `"// @exposure <public|authenticated|private-mesh>" pragma (see apps/web/app/api/a2a/tasks/[taskId]/route.ts) ` +
            `and regenerate the route manifest (pnpm --filter web run build:route-manifest). Do not extend the baseline.`,
        );
      }
      continue;
    }

    // Cross-check vs the proxy's path-segmentation allowlist, both directions.
    const underPublicPrefix = publicPrefixes.some((p) => row.routePath.startsWith(p));
    if (row.exposure === "public" && !underPublicPrefix) {
      failures.push(
        `${row.file}: classified "public" but ${row.routePath} is outside the proxy public ` +
          `path-segmentation allowlist (${PROXY_CLASSIFIER_REL} RouteClass.PublicApi) — ` +
          `either the classification or the segmentation is wrong; reconcile them.`,
      );
    }
    if (row.exposure !== "public" && underPublicPrefix) {
      failures.push(
        `${row.file}: classified "${row.exposure}" but ${row.routePath} sits inside the proxy public ` +
          `path-segmentation allowlist (${PROXY_CLASSIFIER_REL} RouteClass.PublicApi) — a non-public ` +
          `endpoint must not live under a publicly-segmented path prefix; reconcile them.`,
      );
    }
  }

  const classified = governed.filter((row) => row.exposure).length;
  return {
    failures,
    governed: governed.length,
    classified,
    unclassified: governed.length - classified,
  };
}

function loadInputs() {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST_REL), "utf8"));
  const proxySource = readFileSync(join(REPO_ROOT, PROXY_CLASSIFIER_REL), "utf8");
  const baselinePath = join(REPO_ROOT, BASELINE_REL);
  const baselineText = existsSync(baselinePath) ? readFileSync(baselinePath, "utf8") : "";
  return { manifest, proxySource, baselineText, baselinePath };
}

export function main() {
  const { manifest, proxySource, baselineText, baselinePath } = loadInputs();
  const manifestRoutes = manifest.routes ?? [];
  const publicPrefixes = extractPublicApiPrefixes(proxySource);

  if (process.argv.includes("--update")) {
    // Regenerate the grandfather list: every currently-unclassified governed
    // route OUTSIDE the governed cohorts. Preserves the existing budget header
    // verbatim — extending an expiry is a deliberate owner act, never an
    // --update side effect. (A missing header is left missing; the baseline-
    // budget guard will demand one.)
    const files = manifestRoutes
      .filter(
        (row) =>
          row.kind === "route" &&
          row.file.startsWith(GOVERNED_FILE_PREFIX) &&
          !row.exposure &&
          !GOVERNED_COHORT_PREFIXES.some((p) => row.file.startsWith(p)),
      )
      .map((row) => row.file)
      .sort();
    const existing = parseTxtBudgetHeader(baselineText);
    const header =
      existing.owner && existing.expiry
        ? formatTxtBudgetHeader({ owner: existing.owner, expiry: existing.expiry, noteLines: BUDGET_NOTE_LINES })
        : "";
    writeFileSync(baselinePath, `${header}${files.join("\n")}${files.length ? "\n" : ""}`, "utf8");
    console.log(`[endpoint-classification] wrote ${BASELINE_REL} (${files.length} grandfathered routes).`);
    return;
  }

  const result = checkEndpointClassification({
    manifestRoutes,
    baselineFiles: parseBaseline(baselineText),
    publicPrefixes,
  });

  if (result.failures.length > 0) {
    console.error("Endpoint classification guard failed (W17, BI-810BEC9C):");
    for (const f of result.failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `Endpoint classification OK — ${result.governed} governed route handlers: ` +
      `${result.classified} classified, ${result.unclassified} grandfathered (budgeted, shrink-only).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

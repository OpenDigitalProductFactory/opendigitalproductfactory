#!/usr/bin/env node
// Web import-cycle ratchet — dependency-diet plan M11 step 2
// (docs/superpowers/plans/2026-09-08-dependency-diet-and-vertical-integration-plan.md).
//
// TypeScript project references need an acyclic graph between projects, and
// that graph counts EVERY import: `import type`, `export ... from`, dynamic
// `import()` and inline `import("x").T` type queries alike. apps/web's largest
// strongly connected component under that "all imports" graph was 678 files
// by this guard's count; moving the MCP tool contract types to a leaf module
// (apps/web/lib/mcp-tool-types.ts) cut it to 134. This guard stops it growing
// back while the remaining hubs are cut one move at a time.
//
// What it measures: production apps/web sources — the set apps/web/tsconfig.json
// type-checks (tests, scripts, e2e and test-support excluded, .d.ts excluded).
// Imports resolve through the `@/` alias and relative paths; package imports
// are outside the graph. The largest cycle's size may only shrink.
//
// Auto-discovered by scripts/check-guards.mjs (the check-no-* loop). Uses the
// pinned guard TypeScript from @dpf/repo-guard-runtime, so it runs in the
// lightweight source guard job without a workspace install.
//
//   node scripts/check-no-web-import-cycle-growth.mjs            # check (CI)
//   node scripts/check-no-web-import-cycle-growth.mjs --update   # retighten

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateBudget, readJsonBudget } from "./lib/baseline-budget.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const WEB_ROOT = join(REPO_ROOT, "apps", "web");
export const BASELINE_PATH = join(SCRIPT_DIR, "web-import-cycle-baseline.json");
const BASELINE_NOTE =
  "apps/web largest import cycle (all imports, type-only included) — the blocker for TypeScript project references (dependency-diet plan M11 step 2). Shrink-only: cut a hub, then retighten. Regenerate with: node scripts/check-no-web-import-cycle-growth.mjs --update";

// Directory names never walked (mirrors apps/web/tsconfig.json "exclude").
const SKIP_DIRS = new Set(["node_modules", ".next", "scripts", "e2e", "tests", "test-support", "coverage"]);

export function isProductionSource(relPath) {
  return /\.(ts|tsx)$/.test(relPath)
    && !/\.d\.ts$/.test(relPath)
    && !/\.(test|spec)\.tsx?$/.test(relPath);
}

function listWebSources() {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
      } else if (entry.isFile()) {
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (isProductionSource(path)) out.push(path);
      }
    }
  };
  walk(WEB_ROOT, "");
  return out.sort();
}

/** Resolve an import specifier from `from` to a file in `known`, or null. */
export function resolveSpecifier(from, specifier, known) {
  let base;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), specifier));
  else return null;
  const candidates = [
    base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`,
    base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"),
  ];
  for (const candidate of candidates) if (known.has(candidate)) return candidate;
  return null;
}

/**
 * Build the all-imports graph. `files` is [{ path, source }] with paths
 * relative to apps/web; `ts` is a TypeScript module (preProcessFile).
 */
export function buildImportGraph(files, ts) {
  const known = new Set(files.map((f) => f.path));
  const graph = new Map();
  for (const { path, source } of files) {
    const edges = new Set();
    const { importedFiles } = ts.preProcessFile(source, true, true);
    for (const { fileName } of importedFiles) {
      const target = resolveSpecifier(path, fileName, known);
      if (target && target !== path) edges.add(target);
    }
    graph.set(path, edges);
  }
  return graph;
}

/** Largest strongly connected component (iterative Tarjan), sorted. */
export function largestCycle(graph) {
  let counter = 0;
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  let best = [];
  for (const root of graph.keys()) {
    if (index.has(root)) continue;
    const work = [[root, [...graph.get(root)], 0]];
    index.set(root, counter); low.set(root, counter); counter++;
    stack.push(root); onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const [node, next] = frame;
      if (frame[2] < next.length) {
        const w = next[frame[2]++];
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter); counter++;
          stack.push(w); onStack.add(w);
          work.push([w, [...(graph.get(w) ?? [])], 0]);
        } else if (onStack.has(w)) {
          low.set(node, Math.min(low.get(node), index.get(w)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
      if (low.get(node) === index.get(node)) {
        const component = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); component.push(w); } while (w !== node);
        if (component.length > best.length) best = component;
      }
    }
  }
  // A single file is only a cycle if it imports itself, which the graph drops.
  return best.length > 1 ? best.sort() : [];
}

export function validateBaseline(baseline) {
  const failures = validateBudget(readJsonBudget(baseline), { label: "web-import-cycle-baseline.json" });
  if (!Number.isInteger(baseline?.largestCycle) || baseline.largestCycle < 0) {
    failures.push("web-import-cycle-baseline.json: largestCycle must be a non-negative integer.");
  }
  if (!Array.isArray(baseline?.members)) {
    failures.push("web-import-cycle-baseline.json: members must be an array of apps/web paths.");
  }
  return failures;
}

export function runCheck({ cycle, baseline }) {
  const baselineFailures = validateBaseline(baseline);
  if (baselineFailures.length) return { ok: false, baselineFailures, entrants: [], size: cycle.length };
  const recorded = new Set(baseline.members);
  const entrants = cycle.filter((file) => !recorded.has(file));
  return {
    ok: cycle.length <= baseline.largestCycle,
    baselineFailures: [],
    entrants,
    size: cycle.length,
    shrunk: baseline.largestCycle - cycle.length,
  };
}

async function main() {
  const { loadPinnedGuardTypeScript } = await import("./lib/load-pinned-guard-typescript.mjs");
  const ts = loadPinnedGuardTypeScript({ repoRoot: REPO_ROOT });
  const files = listWebSources().map((path) => ({ path, source: readFileSync(join(WEB_ROOT, path), "utf8") }));
  const cycle = largestCycle(buildImportGraph(files, ts));

  if (process.argv.includes("--update")) {
    let owner = "platform-architecture";
    let expiry = "2026-12-31";
    try {
      const existing = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
      owner = existing.owner ?? owner;
      expiry = existing.expiry ?? expiry;
    } catch {
      // first write — defaults above
    }
    const baseline = { version: 1, owner, expiry, note: BASELINE_NOTE, largestCycle: cycle.length, members: cycle };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Wrote web import-cycle baseline: largest cycle ${cycle.length} file(s) of ${files.length}.`);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error("Missing/unreadable scripts/web-import-cycle-baseline.json — run: node scripts/check-no-web-import-cycle-growth.mjs --update");
    process.exit(1);
  }
  const result = runCheck({ cycle, baseline });
  if (result.baselineFailures.length) {
    console.error("web-import-cycle baseline is invalid:");
    for (const failure of result.baselineFailures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  if (!result.ok) {
    console.error(`apps/web import cycle grew: ${baseline.largestCycle} -> ${result.size} file(s).`);
    console.error("TypeScript project references need this graph acyclic (M11 step 2), and every");
    console.error("import counts, `import type` included. Files now in the cycle that were not before:");
    for (const file of result.entrants) console.error(`  - apps/web/${file}`);
    console.error("Usual fix: import a type from its leaf contract module (e.g. @/lib/mcp-tool-types)");
    console.error("instead of from a runtime hub, or move the type into a types-only module.");
    console.error("Do not raise the baseline without an owned platform-architecture decision.");
    process.exit(1);
  }
  if (result.shrunk > 0) {
    console.warn(`apps/web import cycle shrank by ${result.shrunk} — retighten with --update in this PR.`);
  }
  console.log(
    `Web import cycle OK — largest ${result.size} file(s) (budget ${baseline.largestCycle}), ` +
      `owner ${baseline.owner}, review by ${baseline.expiry}.`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}

#!/usr/bin/env node
// Touched-route UX sweep — BI-25EF1456.
//
// CI's UX Route Budget Sweep drives every static page route against a served
// portal and ratchets each one against its frozen baseline. It is the right
// safety net and the wrong feedback loop: an author learns that a new details
// panel put a route over its field budget twenty-five minutes after the push.
//
// This command answers "which routes does MY change render?" from the route
// manifest plus a forward walk of value imports from each page file (the same
// walk the client/server boundary guard uses), then hands exactly those routes
// to `pnpm --filter web ux:sweep`, which measures them against a running
// portal in seconds. The verdict is the same ratchet CI applies.
//
//   node scripts/ux-sweep-touched.mjs                      # list the touched routes
//   node scripts/ux-sweep-touched.mjs --run                # sweep them (UX_SWEEP_BASE_URL or :3000)
//   node scripts/ux-sweep-touched.mjs --run --base-url http://localhost:3001
//   pnpm ux:sweep-touched -- --run
//
// A layout change touches every route beneath it; the command says so and
// still sweeps them, capped by --max-routes (default 40) so a shell layout
// edit points you at CI rather than sweeping 600 routes locally.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveLocalImport, valueImportSpecifiers } from "./check-no-server-imports-in-client.mjs";
import { exitUnresolvable, listChangedFiles } from "./lib/git-changed-files.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_REL = "apps/web/lib/ea/route-manifest.json";

/** Ancestor `layout.tsx` / `template.tsx` files of a page file, nearest first. */
export function ancestorLayouts(pageFile, exists = (p) => existsSync(join(REPO_ROOT, p))) {
  const out = [];
  let dir = dirname(pageFile);
  while (dir.startsWith("apps/web/app")) {
    for (const name of ["layout.tsx", "layout.ts", "template.tsx"]) {
      const candidate = `${dir}/${name}`;
      if (exists(candidate)) out.push(candidate);
    }
    if (dir === "apps/web/app") break;
    dir = dirname(dir);
  }
  return out;
}

/** Every module a page renders: the page, its ancestor layouts, and their transitive value imports. */
export function reachableFrom(files, { read, resolveImport = resolveLocalImport, maxDepth = 10, cache = new Map() }) {
  const reachable = new Set();
  const stack = files.map((file) => ({ file, depth: 0 }));
  while (stack.length) {
    const { file, depth } = stack.pop();
    if (reachable.has(file) || depth > maxDepth) continue;
    reachable.add(file);
    const source = read(file);
    if (source == null) continue;
    if (!cache.has(file)) cache.set(file, valueImportSpecifiers(source).map((s) => resolveImport(file, s)).filter(Boolean));
    for (const next of cache.get(file)) stack.push({ file: next, depth: depth + 1 });
  }
  return reachable;
}

/** Map changed files to the page routes that render them. */
export function touchedRoutes(changed, manifestRoutes, { read, resolveImport = resolveLocalImport, exists }) {
  const changedSet = new Set(changed);
  const cache = new Map();
  const hits = [];
  for (const route of manifestRoutes) {
    if (route.kind !== "page" || !route.file) continue;
    const roots = [route.file, ...ancestorLayouts(route.file, exists)];
    const reachable = reachableFrom(roots, { read, resolveImport, cache });
    const via = [...reachable].filter((f) => changedSet.has(f));
    if (via.length) hits.push({ routePath: route.routePath, dynamic: (route.dynamicParams ?? []).length > 0, via });
  }
  return hits.sort((a, b) => a.routePath.localeCompare(b.routePath));
}

function parseArgs(argv) {
  const out = { run: false, baseUrl: process.env.UX_SWEEP_BASE_URL ?? "http://localhost:3000", maxRoutes: 40 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--run") out.run = true;
    else if (argv[i] === "--base-url") out.baseUrl = argv[++i] ?? out.baseUrl;
    else if (argv[i] === "--max-routes") out.maxRoutes = Number(argv[++i]) || out.maxRoutes;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = process.env.BASE_SHA || process.env.DPF_PREPUSH_BASE_REF || "origin/main";
  const listed = listChangedFiles(base);
  if (listed.status === "unresolvable") exitUnresolvable("ux-sweep-touched", base, listed.detail);
  const changed = listed.files.filter((f) => f.startsWith("apps/web/") && /\.(ts|tsx|mts|cts|css)$/.test(f));
  if (changed.length === 0) {
    console.log("[ux-sweep-touched] no apps/web source changed; nothing to sweep.");
    return;
  }
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST_REL), "utf8"));
  const sources = new Map();
  const read = (file) => {
    if (!sources.has(file)) {
      try {
        sources.set(file, readFileSync(join(REPO_ROOT, file), "utf8"));
      } catch {
        sources.set(file, null);
      }
    }
    return sources.get(file);
  };
  const hits = touchedRoutes(changed, manifest.routes, { read });
  if (hits.length === 0) {
    console.log(`[ux-sweep-touched] ${changed.length} changed file(s) are rendered by no page route in ${MANIFEST_REL}.`);
    return;
  }
  const staticHits = hits.filter((h) => !h.dynamic);
  console.log(`[ux-sweep-touched] ${hits.length} route(s) render the ${changed.length} changed file(s) (${staticHits.length} static, ${hits.length - staticHits.length} dynamic):`);
  for (const hit of hits) console.log(`  ${hit.routePath}${hit.dynamic ? "  (dynamic)" : ""}   via ${hit.via[0]}${hit.via.length > 1 ? ` +${hit.via.length - 1}` : ""}`);
  if (!args.run) {
    console.log(`\n[ux-sweep-touched] add --run to sweep them against ${args.baseUrl} (a served portal; the ratchet is CI's).`);
    return;
  }
  if (staticHits.length === 0) {
    console.log("[ux-sweep-touched] only dynamic routes are touched; the sweep needs fixture params, so CI owns these.");
    return;
  }
  if (staticHits.length > args.maxRoutes) {
    console.error(`[ux-sweep-touched] ${staticHits.length} static routes exceed --max-routes ${args.maxRoutes}; this looks like a shared layout change. Let CI's exhaustive sweep judge it, or raise --max-routes.`);
    process.exitCode = 7;
    return;
  }
  const routes = staticHits.map((h) => h.routePath).join(",");
  console.log(`\n[ux-sweep-touched] pnpm --filter web ux:sweep -- --routes ${routes} --base-url ${args.baseUrl}`);
  const result = spawnSync("pnpm", ["--filter", "web", "ux:sweep", "--", "--routes", routes, "--base-url", args.baseUrl], { cwd: REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" });
  process.exitCode = result.status ?? 7;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

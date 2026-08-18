/**
 * Build-time route manifest walker — Design–Implementation Parity Engine, domain 4
 * (docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md).
 *
 * THE WRINKLE this solves: there is no runtime-importable route source — the Next.js
 * `app/` dir is compiled away in a standalone build and there is no nav-config module.
 * So this script walks `apps/web/app/**\/{page,route}.{ts,tsx}` at build time and emits a
 * deterministic, sorted JSON manifest (route path, segment hierarchy, dynamic params).
 * The reconcile shell (apps/web/lib/ea/reconcile-routes.ts) statically imports that
 * committed JSON and projects it into the live SysML route view.
 *
 * Deterministic by construction: stable walk + byte-stable sort + no timestamps, so a
 * regeneration with no route changes produces identical bytes (no spurious diffs).
 *
 * Static — no DB. Output is the committed manifest.
 *
 * Usage (local):
 *   pnpm --filter web exec tsx scripts/build-route-manifest.ts
 *   pnpm --filter web exec tsx scripts/build-route-manifest.ts --check   # fail if stale
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectRedirectTarget, detectRouteExposure, type RouteManifestRow } from "../lib/ea/route-extract";

// ─── Repo root (same ascent as audit-architecture-parity.ts) ─────────────────

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}
const ROOT = repoRoot();
const APP_REL = "apps/web/app";
const OUT_REL = "apps/web/lib/ea/route-manifest.json";

// ─── Walk app/ for page/route endpoint files ─────────────────────────────────

const ENDPOINT_RE = /^(page|route)\.(ts|tsx)$/;

/** Collect endpoint files as app-relative POSIX paths (e.g. "(shell)/admin/page.tsx"). */
function walk(absDir: string, rel: string, out: string[]): void {
  const entries = readdirSync(absDir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(join(absDir, entry.name), childRel, out);
    } else if (ENDPOINT_RE.test(entry.name)) {
      out.push(childRel);
    }
  }
}

// ─── Derive a manifest row from an app-relative file path ────────────────────

const GROUP_RE = /^\(.+\)$/; // route group: stripped from the URL
const CATCHALL_RE = /^\[\[?\.\.\.([^\]]+?)\]\]?$/; // [...x] or [[...x]]
const DYNAMIC_RE = /^\[([^\].]+)\]$/; // [x]

function toRow(relFile: string): RouteManifestRow {
  const parts = relFile.split("/");
  const filename = parts[parts.length - 1]!;
  const kind: RouteManifestRow["kind"] = filename.startsWith("page") ? "page" : "route";
  const dirSegments = parts.slice(0, -1);
  const segments = dirSegments.filter((s) => !GROUP_RE.test(s));

  const dynamicParams: string[] = [];
  for (const s of segments) {
    const catchAll = s.match(CATCHALL_RE);
    if (catchAll) {
      dynamicParams.push(catchAll[1]!);
      continue;
    }
    const dynamic = s.match(DYNAMIC_RE);
    if (dynamic) dynamicParams.push(dynamic[1]!);
  }

  return {
    routePath: segments.length ? `/${segments.join("/")}` : "/",
    kind,
    segments,
    dynamicParams,
    file: `${APP_REL}/${relFile}`,
  };
}

// ─── Build + emit ────────────────────────────────────────────────────────────

function buildManifest(): { generator: string; routeCount: number; routes: RouteManifestRow[] } {
  const appDir = join(ROOT, APP_REL);
  const files: string[] = [];
  if (existsSync(appDir)) walk(appDir, "", files);

  const detectRow = (relFile: string): RouteManifestRow => {
    const row = toRow(relFile);
    // Page files only: peek inside to detect a pure redirect shim and record its
    // destination (conditional auth-guard redirects render a real page and are skipped by
    // the detector). Unreadable files degrade gracefully to "no redirect".
    if (row.kind === "page") {
      try {
        const target = detectRedirectTarget(readFileSync(join(appDir, relFile), "utf8"));
        if (target) row.redirectTo = target;
      } catch {
        /* unreadable — leave as a normal page */
      }
    }
    // Route handlers only: collect the `// @exposure <class>` declaration (W17,
    // BI-810BEC9C). An INVALID pragma is a hard generation failure — a typo must
    // never silently demote a route to "unclassified" (which the grandfather
    // baseline would then mask). Absent pragma stays absent; the endpoint-
    // classification guard decides whether that is allowed (baseline) or not (new file).
    if (row.kind === "route") {
      try {
        const scan = detectRouteExposure(readFileSync(join(appDir, relFile), "utf8"));
        if (scan.kind === "invalid") {
          console.error(
            `[route-manifest] INVALID @exposure pragma in ${row.file}: "${scan.raw}" — ` +
              `must be one of public | authenticated | private-mesh (exactly one).`,
          );
          process.exit(1);
        }
        if (scan.kind === "exposure") row.exposure = scan.exposure;
      } catch {
        /* unreadable — leave unclassified; the guard governs it */
      }
    }
    return row;
  };

  const routes = files.map(detectRow).sort((a, b) => {
    const ka = `${a.routePath} ${a.kind} ${a.file}`;
    const kb = `${b.routePath} ${b.kind} ${b.file}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return {
    generator: "apps/web/scripts/build-route-manifest.ts",
    routeCount: routes.length,
    routes,
  };
}

function main(): void {
  const check = process.argv.includes("--check");
  const outPath = join(ROOT, OUT_REL);
  const serialized = `${JSON.stringify(buildManifest(), null, 2)}\n`;

  if (check) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
    if (current !== serialized) {
      console.error(`[route-manifest] STALE — ${OUT_REL} is out of date. Run: pnpm --filter web exec tsx scripts/build-route-manifest.ts`);
      process.exit(1);
    }
    console.error(`[route-manifest] up to date (${JSON.parse(serialized).routeCount} routes)`);
    return;
  }

  writeFileSync(outPath, serialized, "utf8");
  console.error(`[route-manifest] wrote ${OUT_REL} (${JSON.parse(serialized).routeCount} routes)`);
}

main();

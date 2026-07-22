/**
 * Build-time route AUDIENCE registry (BI-8C0F219A, EP-UX-COGLOAD).
 *
 * Reads the route-inventory single source of truth
 * (`apps/web/lib/ea/route-manifest.json`, produced by build-route-manifest.ts),
 * classifies every PAGE route by audience + destination kind
 * (`apps/web/lib/navigation/route-audience.ts`), and emits a deterministic committed
 * registry (`apps/web/lib/navigation/route-audience.generated.json`).
 *
 * Deterministic by construction: stable input order + byte-stable sort + no timestamps,
 * so a regeneration with no route changes produces identical bytes (no spurious diffs).
 *
 * Usage (local):
 *   pnpm --filter web exec tsx scripts/build-route-audience.ts
 *   pnpm --filter web exec tsx scripts/build-route-audience.ts --check   # fail if stale
 *
 * The `--check` mode is the CI gate: a new page route makes the committed registry
 * stale, forcing a regeneration whose diff shows the route's classification. Routes the
 * heuristic can only classify with LOW confidence (and that carry no explicit override)
 * are listed in `summary.lowConfidencePaths` and printed as a non-fatal warning, so a
 * reviewer can pin an override in ROUTE_AUDIENCE_OVERRIDES.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  classifyRoute,
  type ClassifiableRoute,
  type RouteAudience,
  type RouteDestinationKind,
} from "../lib/navigation/route-audience";

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}
const ROOT = repoRoot();
const MANIFEST_REL = "apps/web/lib/ea/route-manifest.json";
const OUT_REL = "apps/web/lib/navigation/route-audience.generated.json";

interface ManifestRow {
  routePath: string;
  kind: "page" | "route";
  segments: string[];
  dynamicParams: string[];
  redirectTo?: string;
}

interface RegistryRow {
  routePath: string;
  audience: RouteAudience;
  destinationKind: RouteDestinationKind;
  confidence: "high" | "low";
  source: "heuristic" | "override";
}

function tally<T extends string>(rows: RegistryRow[], key: (r: RegistryRow) => T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  // Deterministic key order.
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function buildRegistry() {
  const manifestPath = join(ROOT, MANIFEST_REL);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { routes: ManifestRow[] };

  const pages = manifest.routes.filter((r) => r.kind === "page");
  const rows: RegistryRow[] = pages
    .map((p) => {
      const route: ClassifiableRoute = {
        routePath: p.routePath,
        segments: p.segments,
        dynamicParams: p.dynamicParams,
        ...(p.redirectTo ? { redirectTo: p.redirectTo } : {}),
      };
      const c = classifyRoute(route);
      return {
        routePath: p.routePath,
        audience: c.audience,
        destinationKind: c.destinationKind,
        confidence: c.confidence,
        source: c.source,
      };
    })
    .sort((a, b) => (a.routePath < b.routePath ? -1 : a.routePath > b.routePath ? 1 : 0));

  const lowConfidencePaths = rows
    .filter((r) => r.confidence === "low")
    .map((r) => r.routePath);

  return {
    generator: "apps/web/scripts/build-route-audience.ts",
    pageRouteCount: rows.length,
    summary: {
      byAudience: tally(rows, (r) => r.audience),
      byDestinationKind: tally(rows, (r) => r.destinationKind),
      overrideCount: rows.filter((r) => r.source === "override").length,
      lowConfidenceCount: lowConfidencePaths.length,
      lowConfidencePaths,
    },
    routes: rows,
  };
}

function main(): void {
  const check = process.argv.includes("--check");
  const outPath = join(ROOT, OUT_REL);
  const registry = buildRegistry();
  const serialized = `${JSON.stringify(registry, null, 2)}\n`;

  const warnLowConfidence = () => {
    if (registry.summary.lowConfidenceCount > 0) {
      console.error(
        `[route-audience] WARNING: ${registry.summary.lowConfidenceCount} page route(s) are low-confidence and unclassified by override. ` +
          `Pin them in ROUTE_AUDIENCE_OVERRIDES (apps/web/lib/navigation/route-audience.ts):`,
      );
      for (const p of registry.summary.lowConfidencePaths) console.error(`  - ${p}`);
    }
  };

  if (check) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
    if (current !== serialized) {
      console.error(
        `[route-audience] STALE — ${OUT_REL} is out of date. Run: pnpm --filter web exec tsx scripts/build-route-audience.ts`,
      );
      process.exit(1);
    }
    warnLowConfidence();
    console.error(`[route-audience] up to date (${registry.pageRouteCount} page routes)`);
    return;
  }

  writeFileSync(outPath, serialized, "utf8");
  warnLowConfidence();
  console.error(`[route-audience] wrote ${OUT_REL} (${registry.pageRouteCount} page routes)`);
}

main();

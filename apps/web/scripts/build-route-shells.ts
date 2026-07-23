/**
 * Route → intended page shell registry — EP-UX-SYSTEM spec §6 L2 / §7.1 (BI-B9BE9A29).
 *
 * Emits the committed classification source the route budget sweep (BI-BD81682A), the
 * migration league table (§7.1) and the Phase-4 cohort plan all read.
 *
 * Layers on the existing inventory rather than forking it: routes come from
 * lib/ea/route-manifest.json, audience/destination-kind from lib/navigation/route-audience.ts,
 * and shell is DERIVED from those (lib/ux-budget/route-shells.ts). Nothing here
 * re-walks the filesystem or re-classifies a route.
 *
 * Deterministic by construction: manifest order is already byte-stable and no
 * timestamps are emitted, so a regeneration with no route change is identical.
 *
 * Usage (local):
 *   pnpm --filter web build:route-shells
 *   pnpm --filter web check:route-shells   # fail if stale
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyRoute, type ClassifiableRoute } from "../lib/navigation/route-audience";
import { shellPolicyFor, type RouteShellPolicy } from "../lib/ux-budget/route-shells";
import { UX_SHELLS, type UxShell } from "../lib/ux-budget/budgets";

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
const OUT_REL = "apps/web/lib/ux-budget/route-shells.generated.json";

type ManifestRow = ClassifiableRoute & { kind: "page" | "route" };

type Registry = {
  generator: string;
  pageRouteCount: number;
  migratedCount: number;
  summary: Record<UxShell, number>;
  routes: (RouteShellPolicy & { confidence: "high" | "low" })[];
};

function build(): Registry {
  const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST_REL), "utf8")) as {
    routes: ManifestRow[];
  };

  // Page routes only, and never redirect shims — a shim renders no surface to budget.
  const pages = manifest.routes.filter((r) => r.kind === "page" && !r.redirectTo);

  const routes = pages.map((route) => {
    const classification = classifyRoute(route);
    return {
      ...shellPolicyFor(route.routePath, classification),
      confidence: classification.confidence,
    };
  });

  const summary = Object.fromEntries(UX_SHELLS.map((s) => [s, 0])) as Record<UxShell, number>;
  for (const r of routes) summary[r.shell] += 1;

  return {
    generator: "apps/web/scripts/build-route-shells.ts",
    pageRouteCount: routes.length,
    migratedCount: routes.filter((r) => r.migrated).length,
    summary,
    routes,
  };
}

function main(): void {
  const check = process.argv.includes("--check");
  const outPath = join(ROOT, OUT_REL);
  const registry = build();
  const serialized = `${JSON.stringify(registry, null, 2)}\n`;

  if (check) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
    if (current !== serialized) {
      console.error(
        `[route-shells] STALE — ${OUT_REL} is out of date. Run: pnpm --filter web build:route-shells`,
      );
      process.exit(1);
    }
    console.error(`[route-shells] up to date (${registry.pageRouteCount} page routes)`);
    return;
  }

  writeFileSync(outPath, serialized, "utf8");
  console.error(
    `[route-shells] wrote ${OUT_REL} (${registry.pageRouteCount} page routes, ${registry.migratedCount} migrated)`,
  );
  const unclassified = registry.summary.unclassified;
  if (unclassified > 0) {
    // Not a failure: pre-migration debt is recorded, not hidden (spec §7.1).
    console.error(`[route-shells] note: ${unclassified} route(s) have no intended shell yet`);
  }
}

if (process.argv[1] && /build-route-shells\.[cm]?ts$/.test(process.argv[1])) main();

export { build };

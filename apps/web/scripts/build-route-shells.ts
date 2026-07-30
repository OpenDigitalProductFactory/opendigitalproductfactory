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

import {
  buildRoutePolicies,
} from "../lib/ux-budget/route-policy";
import type { RouteShellPolicy } from "../lib/ux-budget/route-shells";
import { UX_SHELLS, type UxShell } from "../lib/ux-budget/budgets";
import {
  findRepoRoot,
  readRouteManifestRows,
  writeOrCheckGeneratedJson,
} from "./registry-generator-support";

const ROOT = findRepoRoot();
const OUT_REL = "apps/web/lib/ux-budget/route-shells.generated.json";

type Registry = {
  generator: string;
  pageRouteCount: number;
  migratedCount: number;
  summary: Record<UxShell, number>;
  routes: (RouteShellPolicy & { confidence: "high" | "low" })[];
};

function build(): Registry {
  const routes = buildRoutePolicies(readRouteManifestRows(ROOT)).map((policy) => {
    const {
      audience: _audience,
      destinationKind: _destinationKind,
      classificationSource: _classificationSource,
      ...shellPolicy
    } = policy;
    return {
      ...shellPolicy,
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
  const registry = build();

  if (check) {
    writeOrCheckGeneratedJson({
      root: ROOT,
      relativePath: OUT_REL,
      value: registry,
      check: true,
      label: "route-shells",
      buildCommand: "pnpm --filter web build:route-shells",
    });
    console.error(`[route-shells] up to date (${registry.pageRouteCount} page routes)`);
    return;
  }

  writeOrCheckGeneratedJson({
    root: ROOT,
    relativePath: OUT_REL,
    value: registry,
    check: false,
    label: "route-shells",
    buildCommand: "pnpm --filter web build:route-shells",
  });
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

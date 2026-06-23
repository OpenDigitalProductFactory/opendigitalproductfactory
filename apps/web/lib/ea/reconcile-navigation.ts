// apps/web/lib/ea/reconcile-navigation.ts
//
// Reconcile the canonical navigation model into the Navigation SysML projection
// (Parity Engine, living-graph — EP-NAV-COHERENCE / EP-PARITY-ENGINE). Thin IO shell:
// normalize the canonical portal-navigation-model records (and the build-time route
// manifest) into pure NavSourceEntry rows, build the desired model via the pure
// extractor, and apply it through the shared idempotent seeder. Re-derives from source
// every run, so the projection cannot drift.
//
// Runs AFTER reconcileRoutes in the orchestrator so the route surface exists and the
// cross-layer `traces` (navigates-to) edges resolve on the same pass.
//
// v1 source is the canonical model only. The per-domain nav components (finance-nav,
// ComplianceTabNav, EaTabNav, …) are the parallel taxonomies EP-NAV-COHERENCE P3
// converges into the canonical model; until then their routes show as
// "route-not-in-canonical-nav" conformance findings — exactly the convergence backlog.

import routeManifestData from "./route-manifest.json";
import { prisma } from "@dpf/db";
import { buildNavigationModel } from "./navigation-extract";
import { getAllNavEntries } from "./domain-nav-sources";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";
import type { RouteManifestRow } from "./route-extract";

interface RouteManifest {
  routes?: RouteManifestRow[];
}

const manifest = routeManifestData as RouteManifest;

export async function reconcileNavigation(
  opts: { manifest?: RouteManifest; db?: typeof prisma } = {},
): Promise<SysmlSeedResult> {
  const routes = (opts.manifest ?? manifest).routes ?? [];
  // Redirect shims (route path → destination) from the build-time manifest. Passed into
  // the nav projection so each entry's EFFECTIVE destination domain is resolved by
  // following redirects — catching teleports whose href looks in-domain but bounces out.
  const redirectMap = new Map<string, string>(
    routes.flatMap((r) => (r.redirectTo ? [[r.routePath, r.redirectTo] as [string, string]] : [])),
  );
  // Page routes only (API route handlers never carry navigation), AND not redirect shims:
  // a shim is not a real destination that needs its own nav entry, so it must not count
  // as a route-not-in-canonical-nav orphan.
  const routePaths = routes
    .filter((r) => r.kind === "page" && !r.redirectTo)
    .map((r) => r.routePath);
  const entries = getAllNavEntries(redirectMap);

  const result = await applySysmlModel(
    buildNavigationModel({ entries, routePaths }),
    { db: opts.db },
  );
  console.info(
    `[navigation] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed} crossLayerLinked=${result.crossLayerLinked ?? 0} (entries=${entries.length}, routes=${routePaths.length})`,
  );
  return result;
}

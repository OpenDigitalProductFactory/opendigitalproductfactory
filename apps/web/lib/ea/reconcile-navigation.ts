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
import { buildNavigationModel, toNavEntries } from "./navigation-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";
import { PORTAL_NAV_ROUTES } from "../navigation/portal-navigation-model";
import type { RouteManifestRow } from "./route-extract";

interface RouteManifest {
  routes?: RouteManifestRow[];
}

const manifest = routeManifestData as RouteManifest;

export async function reconcileNavigation(
  opts: { manifest?: RouteManifest; db?: typeof prisma } = {},
): Promise<SysmlSeedResult> {
  // Page routes only — API route handlers never carry navigation, so they must not
  // count as orphans in the route-not-in-canonical-nav finding.
  const routePaths = ((opts.manifest ?? manifest).routes ?? [])
    .filter((r) => r.kind === "page")
    .map((r) => r.routePath);
  const entries = toNavEntries(PORTAL_NAV_ROUTES);

  const result = await applySysmlModel(
    buildNavigationModel({ entries, routePaths }),
    { db: opts.db },
  );
  console.info(
    `[navigation] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed} crossLayerLinked=${result.crossLayerLinked ?? 0} (entries=${entries.length}, routes=${routePaths.length})`,
  );
  return result;
}

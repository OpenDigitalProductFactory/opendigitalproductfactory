// apps/web/lib/ea/reconcile-routes.ts
//
// Reconcile the Next.js route tree into a live SysML projection (Parity Engine,
// domain 4). Thin IO shell: read the build-time route manifest (a committed JSON,
// statically imported so it is bundled and runtime-safe in the Next standalone build —
// the same pattern reconcile-coworker-authority.ts uses for agent_registry.json), build
// the desired model via the pure extractor, and apply it through the shared idempotent
// seeder. Re-derives from the manifest every run, so it cannot drift.
//
// The manifest source is injectable for tests; db is injectable too. Skips cleanly when
// the manifest is absent/empty (no routes to project), without touching the seeder.
//
// Not run at install; intended for the scheduled/on-demand reconcile path like the
// data-model mirror and the other Parity-Engine reconciles.

import routeManifestData from "./route-manifest.json";
import { prisma } from "@dpf/db";
import { buildRouteModel, type RouteManifestRow } from "./route-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

interface RouteManifest {
  routes?: RouteManifestRow[];
}

const manifest = routeManifestData as RouteManifest;

export async function reconcileRoutes(
  opts: { manifest?: RouteManifest; db?: typeof prisma } = {},
): Promise<SysmlSeedResult> {
  const routes = (opts.manifest ?? manifest).routes ?? [];
  if (routes.length === 0) {
    console.warn(`[routes] route manifest absent or empty — skipping`);
    return { status: "skipped", created: 0, updated: 0, removed: 0 };
  }

  const result = await applySysmlModel(buildRouteModel(routes), { db: opts.db });
  console.info(
    `[routes] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed} (routes=${routes.length})`,
  );
  return result;
}

// apps/web/lib/ea/route-extract.ts
//
// Pure extractor for the Next.js route-tree SysML projection (Parity Engine, Slice/
// domain 4 — docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md).
// Projects the app's URL/navigation surface into the SysML notation so the UX/
// navigation architecture is auto-derived from source and cannot drift.
//
// THE WRINKLE: there is no runtime-importable route source — the Next.js `app/` dir is
// compiled away in a standalone build and there is no nav-config module. So a build-time
// walker (apps/web/scripts/build-route-manifest.ts) emits a deterministic JSON manifest
// of every page/route file; this module is the PURE half that turns those manifest rows
// into a SysML model. The reconcile shell (reconcile-routes.ts) reads the bundled
// manifest and hands the rows here, then applies via the shared idempotent seeder.
//
// SysML mapping (task §2):
//   - leaf route (no children)      → part_definition  (a terminal navigable destination)
//   - segment with children (layout)→ package          (a structural grouping)
//   - one synthetic root package contains the top-level routes
//   - nesting is `contains`, parent ← child by URL segment
//   - stable keys `route:<routePath>`; softRemovePrefix "route:"

import type { SysmlDesiredModel } from "./sysml-model-seed";

/** Synthetic root container — holds every top-level route (mirrors VALUE_STREAM_PACKAGE_KEY). */
export const ROUTE_PACKAGE_KEY = "route:pkg";

/** One navigable endpoint discovered by the build-time manifest walker. */
export interface RouteManifestRow {
  /** URL path with route groups stripped, leading slash, e.g. "/admin/storefront/items" or "/". */
  routePath: string;
  /** "page" (UI page.{ts,tsx}) | "route" (route handler route.{ts,tsx}). */
  kind: "page" | "route";
  /** URL segments (route groups already stripped), e.g. ["admin","storefront","items"]; [] for "/". */
  segments: string[];
  /** Names of dynamic params in segment order: "id" for [id]; "slug" for [...slug]/[[...slug]]. */
  dynamicParams: string[];
  /** Source file path relative to repo root (for provenance). */
  file: string;
}

interface RouteNode {
  routePath: string;
  segments: string[];
  files: string[];
  kinds: Set<string>;
  dynamicParams: Set<string>;
}

/** Parent key for a node: the synthetic root for "/" and top-level routes, else the parent segment. */
function parentKeyOf(segments: string[]): string {
  if (segments.length <= 1) return ROUTE_PACKAGE_KEY;
  return `route:/${segments.slice(0, -1).join("/")}`;
}

export function buildRouteModel(rows: RouteManifestRow[]): SysmlDesiredModel {
  const elements: SysmlDesiredModel["elements"] = [];
  const relationships: SysmlDesiredModel["relationships"] = [];

  elements.push({
    sysmlKey: ROUTE_PACKAGE_KEY,
    typeSlug: "package",
    name: "Application Routes",
    description:
      "Live SysML projection of the Next.js App Router route tree, derived from the build-time route manifest (apps/web/scripts/build-route-manifest.ts) so the UX/navigation architecture cannot drift from source.",
    properties: { sourceKey: "apps/web/app", routeCount: rows.length },
  });

  // Aggregate rows by routePath and synthesize every ancestor segment (pure layout
  // segments that have no file of their own still need a node to nest under).
  const nodes = new Map<string, RouteNode>();
  const ensure = (routePath: string, segments: string[]): RouteNode => {
    let n = nodes.get(routePath);
    if (!n) {
      n = { routePath, segments, files: [], kinds: new Set(), dynamicParams: new Set() };
      nodes.set(routePath, n);
    }
    return n;
  };

  for (const row of rows) {
    const node = ensure(row.routePath, row.segments);
    node.files.push(row.file);
    node.kinds.add(row.kind);
    for (const p of row.dynamicParams) node.dynamicParams.add(p);
    // Synthesize ancestor segments down to (but not including) the top level.
    for (let i = row.segments.length - 1; i >= 1; i--) {
      const ancSeg = row.segments.slice(0, i);
      ensure(`/${ancSeg.join("/")}`, ancSeg);
    }
  }

  // A node is a `package` iff some other node nests under it (a structural/layout
  // segment); otherwise it is a leaf `part_definition`.
  const childCount = new Map<string, number>();
  for (const n of nodes.values()) {
    const pk = parentKeyOf(n.segments);
    childCount.set(pk, (childCount.get(pk) ?? 0) + 1);
  }

  // Emit deterministically: root package first (above), then nodes by routePath.
  const sorted = [...nodes.values()].sort((a, b) =>
    a.routePath < b.routePath ? -1 : a.routePath > b.routePath ? 1 : 0,
  );
  for (const n of sorted) {
    const key = `route:${n.routePath}`;
    const children = childCount.get(key) ?? 0;
    const isPackage = children > 0;
    const kinds = [...n.kinds].sort();
    const dynamicParams = [...n.dynamicParams].sort();
    const files = [...n.files].sort();
    const lastSeg = n.segments.length ? n.segments[n.segments.length - 1]! : "/";
    const sourceKey = files.length ? files[0]! : `next-route:${n.routePath}`;
    elements.push({
      sysmlKey: key,
      typeSlug: isPackage ? "package" : "part_definition",
      name: lastSeg,
      description: isPackage
        ? `Route segment "${n.routePath}" — groups ${children} child route(s).`
        : `Route "${n.routePath}"${kinds.length ? ` (${kinds.join("+")})` : ""}.`,
      properties: {
        sourceKey,
        routePath: n.routePath,
        kinds,
        dynamicParams,
        segmentDepth: n.segments.length,
        files,
      },
    });
    relationships.push({ fromKey: parentKeyOf(n.segments), toKey: key, relSlug: "contains" });
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "part_definition"],
    relTypeSlugs: ["contains"],
    view: {
      name: "Application Routes — Live Projection",
      description:
        "Live, system-maintained projection of the Next.js App Router route tree, auto-derived from the build-time route manifest.",
      viewpointName: "System Decomposition & Interfaces",
      scopeRef: "routes",
    },
    softRemovePrefix: "route:",
  };
}

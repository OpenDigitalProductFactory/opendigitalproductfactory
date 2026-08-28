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

/**
 * Endpoint exposure classes (Simplify & Strengthen W17, BI-810BEC9C; edge
 * reachability plan EP-8B03CB06). Every API route handler declares WHO may
 * reach it, at birth:
 *   - "public"        — anonymously reachable by design (must also sit inside the
 *                       proxy's public path-segmentation allowlist, see
 *                       lib/storefront/storefront-middleware.ts RouteClass.PublicApi);
 *   - "authenticated" — requires a session (or an equivalent scope/contract gate
 *                       enforced inside the handler);
 *   - "private-mesh"  — reachable only over the private install-to-install mesh
 *                       (never exposed through the public edge).
 */
export const ROUTE_EXPOSURES = ["public", "authenticated", "private-mesh"] as const;
export type RouteExposure = (typeof ROUTE_EXPOSURES)[number];

/** Result of scanning a route handler's source for its exposure declaration. */
export type RouteExposureScan =
  | { kind: "none" }
  | { kind: "exposure"; exposure: RouteExposure }
  | { kind: "invalid"; raw: string };

/**
 * Extract the per-file exposure declaration from a route handler's source.
 *
 * MECHANISM NOTE: the preferred shape was `export const exposure = "…"`, but
 * Next.js 16's generated route type-guards (next-types-plugin `checkFields<
 * Diff<…>>`) reject any non-standard export from a route.ts entry, so the
 * declaration is a structured pragma comment instead — colocated in the route
 * file (no central conflict-magnet map) and collected by the build-time
 * manifest walker (apps/web/scripts/build-route-manifest.ts) into
 * route-manifest.json, where scripts/check-endpoint-classification.mjs reads it.
 *
 *   // @exposure authenticated — session required; see route handler auth()
 *
 * First pragma wins unless a second one disagrees (conflict = invalid). An
 * unknown class value is invalid, never silently unclassified — the walker
 * hard-fails so a typo cannot demote a route to "unclassified/grandfathered".
 * Pure + dependency-free (mirrors detectRedirectTarget) for plain-Node reuse.
 */
export function detectRouteExposure(src: string): RouteExposureScan {
  const matches = [...String(src).matchAll(/@exposure[ \t]+([A-Za-z-]+)/g)].map((m) => m[1]!);
  if (matches.length === 0) return { kind: "none" };
  const distinct = [...new Set(matches)];
  if (distinct.length > 1) return { kind: "invalid", raw: distinct.join(" vs ") };
  const value = distinct[0]!;
  if ((ROUTE_EXPOSURES as readonly string[]).includes(value)) {
    return { kind: "exposure", exposure: value as RouteExposure };
  }
  return { kind: "invalid", raw: value };
}

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
  /** Route handlers (kind "route") only: the endpoint's declared exposure class,
   *  collected from the file's `// @exposure <class>` pragma (see
   *  detectRouteExposure). Absent while a route is still grandfathered in
   *  scripts/endpoint-classification-baseline.txt; the endpoint-classification
   *  guard hard-fails any NEW route handler under apps/web/app/api without one. */
  exposure?: RouteExposure;
  /** If this page is a PURE redirect shim (its only behavior is `redirect("/x")`, no
   *  UI render), the destination route path (query/hash stripped). Absent for normal
   *  pages and for conditional auth-guard redirects (which render a real page). Lets the
   *  model draw a `redirects_to` edge and the nav teleport check follow the redirect to
   *  its EFFECTIVE destination — so a nav entry whose href looks in-domain but bounces to
   *  another domain is caught as a cross-domain teleport. */
  redirectTo?: string;
}

/** Detect a PURE redirect shim from a page's source. Returns the destination route path
 *  (leading slash, query/hash stripped) iff the page's sole behavior is to redirect, or
 *  undefined otherwise. Pure + dependency-free so the build-time walker (which runs under
 *  plain Node) can import it and it stays unit-testable.
 *
 *  Discriminator — a pure shim has an unconditional `redirect("/literal")` and renders NO
 *  JSX; an auth/conditional guard (e.g. `if (!user) redirect("/login")`) renders the real
 *  page after the guard, so it carries JSX (a closing tag, fragment, or self-close) and is
 *  intentionally NOT treated as a shim (it is a normal destination, not a teleport). */
export function detectRedirectTarget(src: string): string | undefined {
  // Strip block + whole-line comments so a commented-out redirect / JSX example can't
  // trip the heuristic (leaves `://` and inline code intact).
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const m = code.match(/\b(?:redirect|permanentRedirect)\s*\(\s*["'`]([^"'`]+)["'`]/);
  if (!m) return undefined;
  const raw = m[1]!;
  // Resolve simple route-parameter interpolations to their canonical App Router
  // segment. Expression-driven targets remain unmodelled because their destination
  // cannot be proven statically.
  if (!raw.startsWith("/")) return undefined;
  let unresolvedInterpolation = false;
  const normalized = raw.replace(/\$\{([^}]+)\}/g, (_match, expression: string) => {
    const identifier = expression.match(/^(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)$/);
    if (!identifier) {
      unresolvedInterpolation = true;
      return _match;
    }
    return `[${identifier[1]}]`;
  });
  if (unresolvedInterpolation || normalized.includes("${")) return undefined;
  // Any JSX render ⇒ the page shows UI ⇒ the redirect is a conditional guard, not a shim.
  if (/\/>|<\/[A-Za-z]|<>/.test(code)) return undefined;
  return normalized.split(/[?#]/)[0]!;
}

interface RouteNode {
  routePath: string;
  segments: string[];
  files: string[];
  kinds: Set<string>;
  dynamicParams: Set<string>;
  /** Destination of a pure redirect shim (see RouteManifestRow.redirectTo). */
  redirectTo?: string;
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
    if (row.redirectTo) node.redirectTo = row.redirectTo;
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
    const redirectTo = n.redirectTo;
    elements.push({
      sysmlKey: key,
      typeSlug: isPackage ? "package" : "part_definition",
      name: lastSeg,
      description: redirectTo
        ? `Route "${n.routePath}" — redirect shim → "${redirectTo}".`
        : isPackage
          ? `Route segment "${n.routePath}" — groups ${children} child route(s).`
          : `Route "${n.routePath}"${kinds.length ? ` (${kinds.join("+")})` : ""}.`,
      properties: {
        sourceKey,
        routePath: n.routePath,
        kinds,
        dynamicParams,
        segmentDepth: n.segments.length,
        files,
        ...(redirectTo ? { redirectTo } : {}),
      },
    });
    relationships.push({ fromKey: parentKeyOf(n.segments), toKey: key, relSlug: "contains" });
    // A pure redirect shim points at its real destination — a first-class `redirects_to`
    // edge makes the bounce visible on the route canvas and lets the nav teleport check
    // follow it. Guarded so the edge never dangles (dest must be a known route node).
    if (redirectTo && nodes.has(redirectTo) && redirectTo !== n.routePath) {
      relationships.push({ fromKey: key, toKey: `route:${redirectTo}`, relSlug: "redirects_to" });
    }
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "part_definition"],
    relTypeSlugs: ["contains", "redirects_to"],
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

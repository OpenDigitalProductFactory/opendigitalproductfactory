import { describe, expect, it } from "vitest";
import { buildRouteModel, ROUTE_PACKAGE_KEY, type RouteManifestRow } from "./route-extract";

// Intentionally OMIT the "/build", "/build/work", and "/api" rows so the builder must
// SYNTHESIZE those intermediate layout segments from their descendants' paths.
const ROWS: RouteManifestRow[] = [
  { routePath: "/", kind: "page", segments: [], dynamicParams: [], file: "apps/web/app/page.tsx" },
  { routePath: "/admin", kind: "page", segments: ["admin"], dynamicParams: [], file: "apps/web/app/(shell)/admin/page.tsx" },
  { routePath: "/admin/storefront", kind: "page", segments: ["admin", "storefront"], dynamicParams: [], file: "apps/web/app/(shell)/admin/storefront/page.tsx" },
  { routePath: "/admin/storefront/items", kind: "page", segments: ["admin", "storefront", "items"], dynamicParams: [], file: "apps/web/app/(shell)/admin/storefront/items/page.tsx" },
  { routePath: "/build/work/[capsuleId]", kind: "page", segments: ["build", "work", "[capsuleId]"], dynamicParams: ["capsuleId"], file: "apps/web/app/(shell)/build/work/[capsuleId]/page.tsx" },
  { routePath: "/api/health", kind: "route", segments: ["api", "health"], dynamicParams: [], file: "apps/web/app/api/health/route.ts" },
];

describe("buildRouteModel", () => {
  const model = buildRouteModel(ROWS);
  const byKey = new Map(model.elements.map((e) => [e.sysmlKey, e]));

  it("maps leaf routes to part_definitions and segments-with-children to packages", () => {
    expect(byKey.get(ROUTE_PACKAGE_KEY)?.typeSlug).toBe("package");
    expect(byKey.get("route:/admin")?.typeSlug).toBe("package"); // has /admin/storefront under it
    expect(byKey.get("route:/admin/storefront")?.typeSlug).toBe("package");
    expect(byKey.get("route:/admin/storefront/items")?.typeSlug).toBe("part_definition"); // leaf
    expect(byKey.get("route:/api/health")?.typeSlug).toBe("part_definition"); // leaf route handler
  });

  it("treats the root landing route as a leaf part_definition (siblings live under the package, not under '/')", () => {
    expect(byKey.get("route:/")?.typeSlug).toBe("part_definition");
    expect(byKey.get("route:/")?.name).toBe("/");
  });

  it("synthesizes intermediate layout segments that have no file of their own", () => {
    // "/build" and "/build/work" have no row, but exist as ancestors of /build/work/[capsuleId].
    expect(byKey.get("route:/build")?.typeSlug).toBe("package");
    expect(byKey.get("route:/build/work")?.typeSlug).toBe("package");
    expect(byKey.get("route:/build")?.properties?.kinds).toEqual([]); // pure layout — no endpoint file
    expect(byKey.get("route:/api")?.typeSlug).toBe("package");
  });

  it("counts every node exactly once (root pkg + 9 distinct paths incl. 3 synthesized)", () => {
    // / /admin /admin/storefront /admin/storefront/items /build /build/work
    // /build/work/[capsuleId] /api /api/health  →  9 nodes + 1 root package = 10
    expect(model.elements).toHaveLength(10);
  });

  it("nests each route under its parent segment via `contains`", () => {
    expect(model.relationships).toContainEqual({
      fromKey: "route:/admin/storefront",
      toKey: "route:/admin/storefront/items",
      relSlug: "contains",
    });
    expect(model.relationships).toContainEqual({
      fromKey: "route:/build/work",
      toKey: "route:/build/work/[capsuleId]",
      relSlug: "contains",
    });
  });

  it("nests top-level routes (and the root) directly under the package", () => {
    expect(model.relationships).toContainEqual({ fromKey: ROUTE_PACKAGE_KEY, toKey: "route:/", relSlug: "contains" });
    expect(model.relationships).toContainEqual({ fromKey: ROUTE_PACKAGE_KEY, toKey: "route:/admin", relSlug: "contains" });
    expect(model.relationships).toContainEqual({ fromKey: ROUTE_PACKAGE_KEY, toKey: "route:/build", relSlug: "contains" });
  });

  it("carries dynamic params and route kind in element properties", () => {
    expect(byKey.get("route:/build/work/[capsuleId]")?.properties?.dynamicParams).toEqual(["capsuleId"]);
    expect(byKey.get("route:/api/health")?.properties?.kinds).toEqual(["route"]);
    expect(byKey.get("route:/admin/storefront/items")?.properties?.kinds).toEqual(["page"]);
  });

  it("uses stable route:<path> keys for every element", () => {
    for (const el of model.elements) expect(el.sysmlKey.startsWith("route:")).toBe(true);
  });

  it("declares the element/relationship types and soft-remove prefix it needs", () => {
    expect(model.elementTypeSlugs).toEqual(["package", "part_definition"]);
    expect(model.relTypeSlugs).toEqual(["contains"]);
    expect(model.softRemovePrefix).toBe("route:");
    expect(model.view.viewpointName).toBe("System Decomposition & Interfaces");
    expect(model.view.scopeRef).toBe("routes");
  });
});

import { describe, expect, it } from "vitest";
import {
  buildRouteModel,
  detectRedirectTarget,
  detectRouteExposure,
  ROUTE_EXPOSURES,
  ROUTE_PACKAGE_KEY,
  type RouteManifestRow,
} from "./route-extract";

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
    expect(model.relTypeSlugs).toEqual(["contains", "redirects_to"]);
    expect(model.softRemovePrefix).toBe("route:");
    expect(model.view.viewpointName).toBe("System Decomposition & Interfaces");
    expect(model.view.scopeRef).toBe("routes");
  });
});

describe("buildRouteModel — redirect shims", () => {
  it("emits a redirects_to edge from a shim to its destination and annotates the shim node", () => {
    const m = buildRouteModel([
      { routePath: "/platform/ai/capability-needs", kind: "page", segments: ["platform", "ai", "capability-needs"], dynamicParams: [], file: "a", redirectTo: "/ops" },
      { routePath: "/ops", kind: "page", segments: ["ops"], dynamicParams: [], file: "b" },
    ]);
    expect(m.relationships).toContainEqual({
      fromKey: "route:/platform/ai/capability-needs",
      toKey: "route:/ops",
      relSlug: "redirects_to",
    });
    const shim = m.elements.find((e) => e.sysmlKey === "route:/platform/ai/capability-needs");
    expect(shim?.properties?.redirectTo).toBe("/ops");
    expect(shim?.description).toContain("redirect shim");
    expect(m.relTypeSlugs).toContain("redirects_to");
  });

  it("does not emit a dangling redirects_to edge when the destination route is unknown", () => {
    const m = buildRouteModel([
      { routePath: "/x", kind: "page", segments: ["x"], dynamicParams: [], file: "a", redirectTo: "/not-a-modeled-route" },
    ]);
    expect(m.relationships.some((r) => r.relSlug === "redirects_to")).toBe(false);
  });
});

describe("detectRedirectTarget", () => {
  it("detects a pure redirect shim's destination, stripping the query", () => {
    const src = `import { redirect } from "next/navigation";\nexport default function P() {\n  redirect("/ops?origin=capability-need");\n}`;
    expect(detectRedirectTarget(src)).toBe("/ops");
  });

  it("ignores a conditional auth guard that renders a real page (has JSX)", () => {
    const src = `export default async function P() {\n  if (!user) redirect("/login");\n  return <Home data={x} />;\n}`;
    expect(detectRedirectTarget(src)).toBeUndefined();
  });

  it("normalizes parameterized compatibility redirects to canonical route paths", () => {
    expect(detectRedirectTarget("redirect(`/portfolio/product/${id}/inventory#software-composition`)")).toBe(
      "/portfolio/product/[id]/inventory",
    );
    expect(detectRedirectTarget("redirect(`/portfolio/product/${platformProduct.id}/inventory`)")).toBe(
      "/portfolio/product/[id]/inventory",
    );
  });

  it("ignores external, expression-driven, and commented-out redirects", () => {
    expect(detectRedirectTarget("redirect(`/x/${resolveTarget()}`)")).toBeUndefined();
    expect(detectRedirectTarget('redirect("https://example.com")')).toBeUndefined();
    expect(detectRedirectTarget('// redirect("/ops")')).toBeUndefined();
    expect(detectRedirectTarget("/* redirect(\"/ops\") */")).toBeUndefined();
  });

  it("returns undefined for a normal page with no redirect", () => {
    expect(detectRedirectTarget('export default function P() { return <div className="x" />; }')).toBeUndefined();
  });
});

describe("detectRouteExposure", () => {
  it("detects each valid exposure class from a pragma line (W17, BI-810BEC9C)", () => {
    for (const exposure of ROUTE_EXPOSURES) {
      const src = `// @exposure ${exposure} — rationale\nexport async function GET() { return new Response("ok"); }`;
      expect(detectRouteExposure(src)).toEqual({ kind: "exposure", exposure });
    }
  });

  it("returns none when the file carries no pragma (grandfather-baseline territory)", () => {
    expect(detectRouteExposure('export async function GET() { return new Response("ok"); }')).toEqual({ kind: "none" });
  });

  it("flags an unknown class as invalid — a typo must never demote a route to unclassified", () => {
    expect(detectRouteExposure("// @exposure internal\n")).toEqual({ kind: "invalid", raw: "internal" });
  });

  it("tolerates repeated agreeing pragmas but flags conflicting ones", () => {
    expect(detectRouteExposure("// @exposure public\n// @exposure public\n")).toEqual({
      kind: "exposure",
      exposure: "public",
    });
    expect(detectRouteExposure("// @exposure public\n// @exposure authenticated\n")).toEqual({
      kind: "invalid",
      raw: "public vs authenticated",
    });
  });
});

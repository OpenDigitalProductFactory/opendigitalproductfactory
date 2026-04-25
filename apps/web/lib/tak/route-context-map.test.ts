import { describe, it, expect } from "vitest";
import {
  ROUTE_CONTEXT_MAP,
  FALLBACK_ROUTE_CONTEXT,
  resolveRouteContext,
} from "./route-context-map";

describe("resolveRouteContext", () => {
  it("matches exact route prefix", () => {
    const ctx = resolveRouteContext("/portfolio");
    expect(ctx.domain).toBe("Portfolio Management");
    expect(ctx.routePrefix).toBe("/portfolio");
  });

  it("matches nested routes (e.g., /build/FB-123 -> Build Studio)", () => {
    const ctx = resolveRouteContext("/build/FB-123");
    expect(ctx.domain).toBe("Build Studio");
    expect(ctx.routePrefix).toBe("/build");
  });

  it("matches nested EA routes", () => {
    const ctx = resolveRouteContext("/ea/views/123");
    expect(ctx.domain).toBe("Enterprise Architecture");
  });

  it("matches discovery operations routes ahead of the generic platform context", () => {
    const ctx = resolveRouteContext("/platform/tools/discovery");
    expect(ctx.domain).toBe("Discovery Operations");
    expect(ctx.routePrefix).toBe("/platform/tools/discovery");
    expect(ctx.domainTools).toContain("summarize_estate_posture");
  });

  it("matches product estate routes ahead of the broader portfolio context", () => {
    const ctx = resolveRouteContext("/portfolio/product/prod-123/inventory");
    expect(ctx.domain).toBe("Digital Product Estate");
    expect(ctx.routePrefix).toBe("/portfolio/product");
    expect(ctx.domainTools).toContain("review_estate_identity");
    expect(ctx.domainTools).toContain("explain_blast_radius");
  });

  it("falls back to workspace for unknown routes", () => {
    const ctx = resolveRouteContext("/unknown/path");
    expect(ctx.domain).toBe("Workspace");
    expect(ctx.routePrefix).toBe(FALLBACK_ROUTE_CONTEXT.routePrefix);
    expect(ctx.sensitivity).toBe(FALLBACK_ROUTE_CONTEXT.sensitivity);
  });

  it("falls back to workspace for root path", () => {
    const ctx = resolveRouteContext("/");
    expect(ctx.domain).toBe("Workspace");
  });

  it("returns correct sensitivity for /admin (restricted)", () => {
    const ctx = resolveRouteContext("/admin");
    expect(ctx.sensitivity).toBe("restricted");
  });

  it("returns correct sensitivity for /employee (confidential)", () => {
    const ctx = resolveRouteContext("/employee");
    expect(ctx.sensitivity).toBe("confidential");
  });

  it("returns correct sensitivity for /portfolio (internal)", () => {
    const ctx = resolveRouteContext("/portfolio");
    expect(ctx.sensitivity).toBe("internal");
  });

  it("returns correct sensitivity for /customer (confidential)", () => {
    const ctx = resolveRouteContext("/customer");
    expect(ctx.sensitivity).toBe("confidential");
  });

  it("matches customer marketing routes ahead of the broader customer context", () => {
    const ctx = resolveRouteContext("/customer/marketing/strategy");
    expect(ctx.domain).toBe("Customer Marketing");
    expect(ctx.routePrefix).toBe("/customer/marketing");
    expect(ctx.domainTools).toContain("get_marketing_summary");
    expect(ctx.domainTools).toContain("suggest_campaign_ideas");
  });

  it("returns correct sensitivity for /platform (confidential)", () => {
    const ctx = resolveRouteContext("/platform");
    expect(ctx.sensitivity).toBe("confidential");
  });
});

describe("ROUTE_CONTEXT_MAP", () => {
  const allRoutes = Object.keys(ROUTE_CONTEXT_MAP);

  it("has entries for all expected routes", () => {
    const expected = [
      "/portfolio",
      "/portfolio/product",
      "/inventory",
      "/platform/tools/discovery",
      "/ea",
      "/employee",
      "/customer",
      "/customer/marketing",
      "/storefront",
      "/ops",
      "/build",
      "/platform",
      "/admin",
      "/workspace",
    ];
    for (const route of expected) {
      expect(ROUTE_CONTEXT_MAP[route]).toBeDefined();
    }
  });

  it("every entry has a non-empty domainContext", () => {
    for (const route of allRoutes) {
      const def = ROUTE_CONTEXT_MAP[route]!;
      expect(def.domainContext.length).toBeGreaterThan(0);
    }
  });

  it('every entry includes a "Report an issue" skill with capability null', () => {
    for (const route of allRoutes) {
      const def = ROUTE_CONTEXT_MAP[route]!;
      const reportSkill = def.skills.find((s) => s.label === "Report an issue");
      expect(reportSkill).toBeDefined();
      expect(reportSkill!.capability).toBeNull();
    }
  });

  it("sensitive routes mention data classification in domainContext", () => {
    const sensitiveRoutes = [
      "/employee",
      "/customer",
      "/platform",
      "/admin",
      "/workspace",
    ];
    for (const route of sensitiveRoutes) {
      const def = ROUTE_CONTEXT_MAP[route]!;
      expect(def.domainContext).toMatch(/classified as (confidential|restricted)/);
    }
  });

  it("routePrefix matches the map key for every entry", () => {
    for (const [key, def] of Object.entries(ROUTE_CONTEXT_MAP)) {
      expect(def.routePrefix).toBe(key);
    }
  });

  it("keeps discovery sweep gated behind provider-management capability", () => {
    const aliasRoute = ROUTE_CONTEXT_MAP["/inventory"]!;
    const discoveryRoute = ROUTE_CONTEXT_MAP["/platform/tools/discovery"]!;
    const aliasSkill = aliasRoute.skills.find((skill) => skill.label === "Run discovery sweep");
    const discoverySkill = discoveryRoute.skills.find((skill) => skill.label === "Run discovery sweep");

    expect(aliasRoute.domain).toBe("Discovery Operations");
    expect(aliasSkill?.capability).toBe("manage_provider_connections");
    expect(discoverySkill?.capability).toBe("manage_provider_connections");
  });

  it("exposes identity review skills on estate routes", () => {
    const productRoute = ROUTE_CONTEXT_MAP["/portfolio/product"]!;
    const discoveryRoute = ROUTE_CONTEXT_MAP["/platform/tools/discovery"]!;

    expect(productRoute.domainTools).toContain("review_estate_identity");
    expect(discoveryRoute.domainTools).toContain("review_estate_identity");
    expect(productRoute.skills.some((skill) => skill.label === "Review item identity")).toBe(true);
    expect(discoveryRoute.skills.some((skill) => skill.label === "Review item identity")).toBe(true);
  });

  it("keeps the storefront context focused on portal operations instead of marketing strategy", () => {
    const storefrontRoute = ROUTE_CONTEXT_MAP["/storefront"]!;
    expect(storefrontRoute.domain).toBe("Storefront Operations");
    expect(storefrontRoute.domainTools).not.toContain("get_marketing_summary");
    expect(storefrontRoute.domainTools).not.toContain("suggest_campaign_ideas");
  });
});

describe("FALLBACK_ROUTE_CONTEXT", () => {
  it("is the /workspace entry", () => {
    expect(FALLBACK_ROUTE_CONTEXT).toBe(ROUTE_CONTEXT_MAP["/workspace"]);
    expect(FALLBACK_ROUTE_CONTEXT.domain).toBe("Workspace");
  });
});

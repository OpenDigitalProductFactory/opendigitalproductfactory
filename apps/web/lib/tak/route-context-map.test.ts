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
      "/inventory",
      "/ea",
      "/employee",
      "/customer",
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
});

describe("FALLBACK_ROUTE_CONTEXT", () => {
  it("is the /workspace entry", () => {
    expect(FALLBACK_ROUTE_CONTEXT).toBe(ROUTE_CONTEXT_MAP["/workspace"]);
    expect(FALLBACK_ROUTE_CONTEXT.domain).toBe("Workspace");
  });
});

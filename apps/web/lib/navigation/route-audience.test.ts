import { describe, expect, it } from "vitest";
import {
  classifyRoute,
  isAdvancedRoute,
  isSectionHome,
  ROUTE_AUDIENCE_OVERRIDES,
  type ClassifiableRoute,
} from "./route-audience";

function route(routePath: string, extra: Partial<ClassifiableRoute> = {}): ClassifiableRoute {
  const segments = routePath === "/" ? [] : routePath.replace(/^\//, "").split("/");
  return { routePath, segments, dynamicParams: [], ...extra };
}

describe("classifyRoute — audience", () => {
  it("maps builder / admin technical first segments", () => {
    expect(classifyRoute(route("/build")).audience).toBe("builder");
    expect(classifyRoute(route("/platform")).audience).toBe("admin");
    expect(classifyRoute(route("/ops")).audience).toBe("admin");
    expect(classifyRoute(route("/ea")).audience).toBe("admin");
  });

  it("maps owner/operator business first segments", () => {
    expect(classifyRoute(route("/finance")).audience).toBe("owner");
    expect(classifyRoute(route("/compliance")).audience).toBe("owner");
    expect(classifyRoute(route("/customer")).audience).toBe("owner");
  });

  it("maps customer + public first segments", () => {
    expect(classifyRoute(route("/portal")).audience).toBe("customer");
    expect(classifyRoute(route("/s/abc")).audience).toBe("public");
  });

  it("maps auth/setup entry segments", () => {
    expect(classifyRoute(route("/login")).audience).toBe("auth-setup");
    expect(classifyRoute(route("/setup")).audience).toBe("auth-setup");
    expect(classifyRoute(route("/reset-password")).audience).toBe("auth-setup");
  });

  it("defaults an unknown first segment to admin/low-confidence", () => {
    const c = classifyRoute(route("/totally-new-thing"));
    expect(c.audience).toBe("admin");
    expect(c.confidence).toBe("low"); // surfaced by the CI unclassified warning
  });
});

describe("classifyRoute — destination kind", () => {
  it("flags redirect shims as legacy-internal", () => {
    expect(classifyRoute(route("/admin", { redirectTo: "/admin/storefront" })).destinationKind).toBe(
      "legacy-internal",
    );
  });

  it("flags settings/config surfaces", () => {
    expect(classifyRoute(route("/finance/settings")).destinationKind).toBe("settings-config");
    expect(classifyRoute(route("/platform/configuration")).destinationKind).toBe("settings-config");
  });

  it("flags create/edit workflow steps", () => {
    expect(classifyRoute(route("/finance/invoices/new")).destinationKind).toBe("workflow-step");
    expect(classifyRoute(route("/customer/edit")).destinationKind).toBe("workflow-step");
  });

  it("flags dynamic pages as detail", () => {
    expect(
      classifyRoute(route("/finance/invoices/[id]", { dynamicParams: ["id"] })).destinationKind,
    ).toBe("detail");
  });

  it("flags top-level section roots as section-home", () => {
    expect(classifyRoute(route("/finance")).destinationKind).toBe("section-home");
  });

  it("flags deep technical pages as advanced-diagnostic", () => {
    const c = classifyRoute(route("/platform/ai/runtime-health"));
    expect(c.destinationKind).toBe("advanced-diagnostic");
    expect(c.audience).toBe("admin");
  });
});

describe("classifyRoute — overrides", () => {
  it("an override wins over the heuristic and is high-confidence", () => {
    const c = classifyRoute(route("/workspace/my-queue"));
    expect(c.source).toBe("override");
    expect(c.audience).toBe("worker");
    expect(c.confidence).toBe("high");
  });

  it("every override key is a well-formed absolute path", () => {
    for (const key of Object.keys(ROUTE_AUDIENCE_OVERRIDES)) {
      expect(key.startsWith("/")).toBe(true);
    }
  });
});

describe("registry query helpers", () => {
  it("isAdvancedRoute is true for admin/builder/advanced-diagnostic", () => {
    expect(isAdvancedRoute({ audience: "admin", destinationKind: "detail" })).toBe(true);
    expect(isAdvancedRoute({ audience: "builder", destinationKind: "detail" })).toBe(true);
    expect(isAdvancedRoute({ audience: "owner", destinationKind: "advanced-diagnostic" })).toBe(true);
    expect(isAdvancedRoute({ audience: "owner", destinationKind: "section-home" })).toBe(false);
  });

  it("isSectionHome is true only for section homes", () => {
    expect(isSectionHome({ destinationKind: "section-home" })).toBe(true);
    expect(isSectionHome({ destinationKind: "detail" })).toBe(false);
  });
});

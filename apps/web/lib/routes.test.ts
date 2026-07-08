import { describe, it, expect } from "vitest";

import { ROUTES, type RoutePath } from "./routes";

describe("ROUTES", () => {
  it("maps the high-frequency section roots to absolute paths", () => {
    expect(ROUTES.compliance).toBe("/compliance");
    expect(ROUTES.employee).toBe("/employee");
    expect(ROUTES.ops).toBe("/ops");
    expect(ROUTES.portfolio).toBe("/portfolio");
  });

  it("every value is a rooted path with no trailing slash", () => {
    for (const path of Object.values(ROUTES)) {
      expect(path.startsWith("/")).toBe(true);
      expect(path.length).toBeGreaterThan(1);
      expect(path.endsWith("/")).toBe(false);
    }
  });

  it("has no duplicate path values (each constant is distinct)", () => {
    const values = Object.values(ROUTES);
    expect(new Set(values).size).toBe(values.length);
  });

  it("exposes a RoutePath union usable as a typed argument", () => {
    const p: RoutePath = ROUTES.finance;
    expect(p).toBe("/finance");
  });
});

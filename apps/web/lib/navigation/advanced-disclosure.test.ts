import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getShellNavSections } from "@/lib/govern/permissions";

import { PORTAL_NAV_ROUTES } from "./portal-navigation-model";
import { DIAGNOSTIC_ROUTE_PATHS, isDiagnosticHref } from "./route-audience";

// BI-E8D91AF6: only named diagnostic surfaces go behind "More tools". Daily and
// setup destinations must never be tucked away, or the disclosure hides the work.

const superuser = { platformRole: null, isSuperuser: true } as const;

describe("advanced-route disclosure (BI-E8D91AF6)", () => {
  it("never classifies a rail entry as diagnostic", () => {
    const railHrefs = getShellNavSections(superuser).flatMap((section) => section.items.map((item) => item.href));
    expect(railHrefs.length).toBeGreaterThan(0);
    expect(railHrefs.filter(isDiagnosticHref)).toEqual([]);
  });

  it("never classifies an area Setup destination as diagnostic", () => {
    const setupPaths = PORTAL_NAV_ROUTES.filter((record) => record.setupFor).map((record) => record.path);
    expect(setupPaths.length).toBeGreaterThan(0);
    expect(setupPaths.filter(isDiagnosticHref)).toEqual([]);
  });

  it("names only routes the registry knows", () => {
    const registry = JSON.parse(
      readFileSync(join(__dirname, "route-audience.generated.json"), "utf8"),
    ) as { routes: { routePath: string; destinationKind: string }[] };
    const advanced = registry.routes.filter((route) => route.destinationKind === "advanced-diagnostic");
    expect(advanced.map((route) => route.routePath).sort()).toEqual([...DIAGNOSTIC_ROUTE_PATHS].sort());
  });
});

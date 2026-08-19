import { describe, expect, it } from "vitest";
import { blastRadiusFromChangeImpact } from "./blast-radius-from-change-impact";
import type { ChangeImpactReport } from "@/lib/build/change-impact";

function report(overrides: Omit<Partial<ChangeImpactReport>, "blastRadius"> & {
  blastRadius?: Partial<ChangeImpactReport["blastRadius"]>;
} = {}): ChangeImpactReport {
  return {
    routes: { new: [], modified: [], deleted: [] },
    schemaChanges: [],
    impactedRoles: [],
    blastRadius: {
      newRoutes: 0,
      modifiedRoutes: 0,
      deletedRoutes: 0,
      schemaChanges: 0,
      totalFilesChanged: 0,
      ...(overrides.blastRadius ?? {}),
    },
    riskLevel: "low",
    rollbackComplexity: "simple",
    summary: "",
    ...overrides,
  } as ChangeImpactReport;
}

describe("blastRadiusFromChangeImpact", () => {
  it("a trivial diff yields a low, leaf-shaped blast radius", () => {
    const br = blastRadiusFromChangeImpact(report({ blastRadius: { totalFilesChanged: 2 } }));
    expect(br).toEqual({ downstreamCount: 2, touchesCoreContract: false, riskLevel: "low" });
  });

  it("counts impacted roles as downstream reach alongside files", () => {
    const br = blastRadiusFromChangeImpact(
      report({
        blastRadius: { totalFilesChanged: 5 },
        impactedRoles: [{ role: "operator" }, { role: "customer" }] as ChangeImpactReport["impactedRoles"],
      }),
    );
    expect(br.downstreamCount).toBe(7);
  });

  it("a schema change is a core-contract touch", () => {
    const br = blastRadiusFromChangeImpact(report({ blastRadius: { schemaChanges: 1, totalFilesChanged: 3 } }));
    expect(br.touchesCoreContract).toBe(true);
  });

  it("a DELETED route is a core-contract touch (breaks existing consumers)", () => {
    const br = blastRadiusFromChangeImpact(report({ blastRadius: { deletedRoutes: 1, totalFilesChanged: 1 } }));
    expect(br.touchesCoreContract).toBe(true);
  });

  it("new/modified routes alone are additive — NOT a core-contract touch", () => {
    const br = blastRadiusFromChangeImpact(
      report({ blastRadius: { newRoutes: 3, modifiedRoutes: 2, totalFilesChanged: 5 } }),
    );
    expect(br.touchesCoreContract).toBe(false);
  });

  it("passes riskLevel through unchanged (shared union)", () => {
    for (const riskLevel of ["low", "medium", "high", "critical"] as const) {
      expect(blastRadiusFromChangeImpact(report({ riskLevel })).riskLevel).toBe(riskLevel);
    }
  });
});

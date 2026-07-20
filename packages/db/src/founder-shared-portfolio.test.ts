import { describe, expect, it } from "vitest";

import {
  FOUNDER_CLUSTER_STATUSES,
  FOUNDER_DEMAND_ENVIRONMENTS,
  buildFounderClusterSummary,
  canEnterFounderProductionPortfolio,
  mergeFounderDemandRoutes,
  resolveFounderDemandEnvironment,
} from "./founder-shared-portfolio";

describe("founder shared portfolio contracts", () => {
  it("keeps the lifecycle and environment axes closed", () => {
    expect(FOUNDER_CLUSTER_STATUSES).toEqual(["proposed", "accepted", "rejected", "archived"]);
    expect(FOUNDER_DEMAND_ENVIRONMENTS).toEqual(["production", "development", "test"]);
  });

  it("counts one immutable origin once across direct and reseller routes", () => {
    const merged = mergeFounderDemandRoutes([
      {
        originInstallationId: "inst_customer",
        envelopeId: "dem_opaque",
        mirrorId: "FM-DIRECT",
        environmentClass: "production",
        routeAttestations: [{ route: "direct" }],
      },
      {
        originInstallationId: "inst_customer",
        envelopeId: "dem_opaque",
        mirrorId: "FM-RESELLER",
        environmentClass: "production",
        routeAttestations: [{ route: "reseller" }],
      },
      {
        originInstallationId: "inst_other",
        envelopeId: "dem_other",
        mirrorId: "FM-OTHER",
        environmentClass: "production",
        routeAttestations: [],
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      originKey: "inst_customer:dem_opaque",
      mirrorRefs: ["FM-DIRECT", "FM-RESELLER"],
    });
    expect(merged[0]?.routeAttestations).toEqual([{ route: "direct" }, { route: "reseller" }]);
  });

  it("requires explicit promotion before non-production demand enters production", () => {
    expect(canEnterFounderProductionPortfolio("production", null)).toBe(true);
    expect(canEnterFounderProductionPortfolio("development", null)).toBe(false);
    expect(canEnterFounderProductionPortfolio("test", new Date("2026-07-20T00:00:00Z"))).toBe(true);
  });

  it("fails unclassified links safely into development", () => {
    expect(resolveFounderDemandEnvironment(null)).toBe("development");
    expect(resolveFounderDemandEnvironment({ environmentClass: "production" })).toBe("production");
    expect(resolveFounderDemandEnvironment({ federation: { environmentClass: "test" } })).toBe("test");
    expect(resolveFounderDemandEnvironment({ environmentClass: "staging" })).toBe("development");
  });

  it("summarizes distinct reach without adding reseller hops", () => {
    const summary = buildFounderClusterSummary({
      status: "accepted",
      canonicalBacklogItemId: "BI-FOUNDER-1",
      members: mergeFounderDemandRoutes([
        {
          originInstallationId: "inst_customer",
          envelopeId: "dem_opaque",
          mirrorId: "FM-DIRECT",
          environmentClass: "production",
          routeAttestations: [],
        },
        {
          originInstallationId: "inst_customer",
          envelopeId: "dem_opaque",
          mirrorId: "FM-RESELLER",
          environmentClass: "production",
          routeAttestations: [],
        },
      ]),
    });

    expect(summary).toEqual({
      status: "accepted",
      distinctOriginReach: 1,
      routeCount: 2,
      productionEligibleOrigins: 1,
      canonicalBacklogItemId: "BI-FOUNDER-1",
    });
  });
});

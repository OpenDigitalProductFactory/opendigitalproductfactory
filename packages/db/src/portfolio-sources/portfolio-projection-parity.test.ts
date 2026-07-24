// Source ↔ portfolio projection parity guard (BI-PORTCOV-P7; spec §7 P7).
//
// Mirrors the EP-SCHEDULING-SURFACE catalog↔registry parity guard: a new
// capability / integration / licensed dependency added without a valid portfolio
// placement, coverage status, source kind, or with a colliding productId fails
// CI — re-creating exactly the "sparsely populated, more than what's showing"
// gap this epic closes. Covers the static manifests (the drift surface); the
// live-DB "every projected row traces to a real source row" check is integration
// -level and runs via the projectors' own tests.

import { describe, expect, it } from "vitest";

import { ARCHETYPE_SUPPLY_MANIFEST } from "./archetype-supply-manifest";
import { LICENSED_DEPENDENCIES } from "./licensed-dependencies-manifest";
import { PLATFORM_CAPABILITY_MANIFEST } from "./platform-capability-manifest";
import { platformCapabilityProjector } from "./project-portfolio-source";
import { licensedDependencyEntries } from "./project-sbom";
import { SUPPORTED_INTEGRATIONS } from "./supported-integrations-manifest";
import {
  isPortfolioCoverageStatus,
  isPortfolioSlug,
  isPortfolioSourceKind,
  PORTFOLIO_COVERAGE_STATUSES,
  PORTFOLIO_SOURCE_KINDS,
  type ProjectedPortfolioEntry,
} from "./types";

function assertWellFormed(entries: ProjectedPortfolioEntry[], expectedPrefix: string): void {
  for (const e of entries) {
    expect(e.productId.startsWith(expectedPrefix)).toBe(true);
    expect(e.name.trim().length).toBeGreaterThan(0);
    expect(e.description.trim().length).toBeGreaterThan(0);
    expect(isPortfolioSlug(e.portfolioSlug)).toBe(true);
    expect(isPortfolioCoverageStatus(e.coverageStatus)).toBe(true);
    expect(isPortfolioSourceKind(e.sourceKind)).toBe(true);
  }
}

describe("portfolio projection parity (BI-PORTCOV-P7)", () => {
  it("platform-capability projector yields one valid entry per manifest item", () => {
    const entries = platformCapabilityProjector.project() as ProjectedPortfolioEntry[];
    expect(entries.length).toBe(PLATFORM_CAPABILITY_MANIFEST.length);
    assertWellFormed(entries, "cap-");
  });

  it("licensed-dependency entries are valid and complete", () => {
    const entries = licensedDependencyEntries();
    expect(entries.length).toBe(LICENSED_DEPENDENCIES.length);
    assertWellFormed(entries, "dep-");
  });

  it("supported integrations have unique slugs, valid portfolios, and pricing", () => {
    const slugs = SUPPORTED_INTEGRATIONS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const i of SUPPORTED_INTEGRATIONS) {
      expect(isPortfolioSlug(i.portfolioSlug)).toBe(true);
      expect(i.credentialProvider.trim().length).toBeGreaterThan(0);
      expect(["free", "freemium", "paid"]).toContain(i.pricingModel);
    }
  });

  it("archetype supply starters all have non-empty names", () => {
    for (const starter of Object.values(ARCHETYPE_SUPPLY_MANIFEST)) {
      for (const item of [...starter!.suppliers, ...starter!.goods]) {
        expect(item.name.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("global productIds do not collide across sources", () => {
    const ids = [
      ...(platformCapabilityProjector.project() as ProjectedPortfolioEntry[]).map((e) => e.productId),
      ...licensedDependencyEntries().map((e) => e.productId),
      ...SUPPORTED_INTEGRATIONS.map((i) => `int-${i.slug}`),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  // BI-5B2F5447 (D0): the incumbent-application coverage lane extends both closed
  // enums. These lock the new values in so a later refactor cannot quietly drop
  // them, and a well-formed incumbent entry round-trips through assertWellFormed.
  it("recognizes the incumbent coverage status and incumbent_intake source kind", () => {
    expect(PORTFOLIO_COVERAGE_STATUSES).toContain("incumbent");
    expect(isPortfolioCoverageStatus("incumbent")).toBe(true);
    expect(PORTFOLIO_SOURCE_KINDS).toContain("incumbent_intake");
    expect(isPortfolioSourceKind("incumbent_intake")).toBe(true);
  });

  it("a projected incumbent entry is well-formed", () => {
    const entry: ProjectedPortfolioEntry = {
      productId: "incumbent-acme-scheduler",
      name: "Acme Scheduler",
      description: "Third-party scheduling app the customer runs today.",
      portfolioSlug: "for_employees",
      taxonomyNodeId: null,
      coverageStatus: "incumbent",
      sourceKind: "incumbent_intake",
    };
    assertWellFormed([entry], "incumbent-");
  });

  it("each global source uses a distinct productId prefix", () => {
    const prefixes = ["cap-", "prov-", "int-", "dep-", "sbom-", "sup-", "good-"];
    expect(new Set(prefixes).size).toBe(prefixes.length);
    // platform capabilities own cap-, licensed deps own dep-, integrations own int-
    expect((platformCapabilityProjector.project() as ProjectedPortfolioEntry[]).every((e) => e.productId.startsWith("cap-"))).toBe(true);
    expect(licensedDependencyEntries().every((e) => e.productId.startsWith("dep-"))).toBe(true);
  });
});

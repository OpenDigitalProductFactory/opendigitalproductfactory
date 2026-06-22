import { describe, it, expect } from "vitest";

import { PLATFORM_CAPABILITY_MANIFEST } from "./platform-capability-manifest";
import { platformCapabilityProjector } from "./project-portfolio-source";
import {
  isPortfolioCoverageStatus,
  isPortfolioSlug,
  type ProjectedPortfolioEntry,
} from "./types";

describe("platform capability manifest", () => {
  it("has unique cap-* productIds and valid portfolios/coverage", () => {
    const ids = PLATFORM_CAPABILITY_MANIFEST.map((e) => e.productId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of PLATFORM_CAPABILITY_MANIFEST) {
      expect(e.productId.startsWith("cap-")).toBe(true);
      expect(isPortfolioSlug(e.portfolioSlug)).toBe(true);
      expect(isPortfolioCoverageStatus(e.coverageStatus)).toBe(true);
    }
  });

  it("populates Manufacturing & Delivery with the platform's delivery machinery", () => {
    const md = PLATFORM_CAPABILITY_MANIFEST.filter(
      (e) => e.portfolioSlug === "manufacturing_and_delivery",
    ).map((e) => e.productId);
    expect(md).toContain("cap-build-studio");
    expect(md).toContain("cap-github-delivery");
    expect(md).toContain("cap-scheduling");
    expect(md.length).toBeGreaterThanOrEqual(5);
  });

  it("places foundational subsystems under an existing taxonomy node", () => {
    const foundational = PLATFORM_CAPABILITY_MANIFEST.filter(
      (e) => e.portfolioSlug === "foundational",
    );
    expect(foundational.length).toBeGreaterThan(0);
    for (const e of foundational) {
      expect(e.taxonomyNodeId).toBe("foundational/platform_services");
    }
  });

  it("projector tags every entry with the platform_capability source", () => {
    expect(platformCapabilityProjector.source).toBe("platform_capability");
    const entries = platformCapabilityProjector.project() as ProjectedPortfolioEntry[];
    expect(entries.length).toBe(PLATFORM_CAPABILITY_MANIFEST.length);
    for (const e of entries) {
      expect(e.sourceKind).toBe("platform_capability");
      expect(e.coverageStatus).toBe("used");
    }
  });
});

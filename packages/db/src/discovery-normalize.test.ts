import { describe, expect, it } from "vitest";

import { normalizeDiscoveredFacts } from "./discovery-normalize";

describe("normalizeDiscoveredFacts", () => {
  it("defaults discovered host infrastructure into the Foundational portfolio", () => {
    const result = normalizeDiscoveredFacts({
      items: [
        {
          sourceKind: "dpf_bootstrap",
          itemType: "host",
          name: "dpf-dev",
          externalRef: "hostname:dpf-dev",
          attributes: { hostname: "dpf-dev" },
        },
      ],
      relationships: [],
    });

    expect(result.inventoryEntities[0]?.portfolioSlug).toBe("foundational");
    expect(result.inventoryEntities[0]?.attributionStatus).toBe("attributed");
  });
});

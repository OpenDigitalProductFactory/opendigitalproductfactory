import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProductOperatingContext } from "./product-operating-context";
import { projectProductRoadmapFromOperatingContext } from "./product-roadmap-operating-context";
import { readCanonicalPrismaSchema } from "@dpf/db/schema-source";

const NOW = new Date("2026-07-28T12:00:00.000Z");

function slice<T extends { id: string; sourceKind: string; asOf: Date }>(
  sourceKind: string,
  items: T[],
) {
  return {
    availability: "available" as const,
    freshness: "fresh" as const,
    asOf: NOW,
    sourceKind,
    items,
    reason: null,
  };
}

describe("product roadmap operating-context adapter", () => {
  it("keeps DigitalProduct dependencies as coordination evidence rather than work-item edges", () => {
    const context = {
      requestedAt: NOW,
      scope: { kind: "product", id: "product-1" },
      provider: {
        id: "org-1",
        name: "Harbor Hotel",
        sourceKind: "organization",
        asOf: NOW,
        derivedFromOrganization: true,
      },
      productLine: null,
      productLines: [],
      products: [
        {
          id: "product-1",
          productId: "ROOM-STAY",
          productLineId: "line-1",
          name: "Guest stays",
          sourceKind: "business-product",
          asOf: NOW,
        },
      ],
      demand: slice("backlog-item", []),
      objectives: slice("product-objective", []),
      deliveryChanges: slice("change-item", []),
      architecture: slice("ea-element-and-product-dependency", [
        {
          id: "dependency-1",
          sourceKind: "product-dependency",
          asOf: NOW,
          title: "Booking portal depends_on identity",
          status: "active",
          coordinationKind: "architecture",
          fromProductId: "digital-booking",
          toProductId: "digital-identity",
          relationType: "depends_on",
        },
      ]),
    } as unknown as ProductOperatingContext;

    const workspace = projectProductRoadmapFromOperatingContext(context);

    expect(workspace.roadmap.dependencies).toEqual([]);
    expect(workspace.roadmap.coordinationEvidence).toEqual([
      expect.objectContaining({
        id: "dependency-1",
        kind: "architecture",
        fromProductId: "digital-booking",
        toProductId: "digital-identity",
      }),
    ]);
  });

  it("guards against a persisted roadmap authority", () => {
    const schema = readCanonicalPrismaSchema();

    expect(schema).not.toMatch(/^model Roadmap(?:Item)?\s*\{/m);
  });
});

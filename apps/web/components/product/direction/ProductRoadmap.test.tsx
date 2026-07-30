// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  projectProductRoadmap,
  type ProductRoadmapProjection,
} from "@/lib/product-management/product-roadmap";
import type { ProductRoadmapWorkspace } from "@/lib/product-management/product-roadmap-operating-context";
import { ProductRoadmap } from "./ProductRoadmap";

afterEach(() => cleanup());

function workspace(
  roadmapOverrides: Partial<ProductRoadmapProjection> = {},
): ProductRoadmapWorkspace {
  const roadmap = projectProductRoadmap({
    requestedAt: new Date("2026-07-28T12:00:00.000Z"),
    scope: { kind: "product", id: "product-1", name: "Salon appointments" },
    demand: [
      {
        id: "BI-READY",
        title: "Shorter booking form",
        status: "open",
        demandStage: "ready",
        score: 72,
        investmentBucket: "grow",
        evidenceCount: 2,
        asOf: new Date("2026-07-27T12:00:00.000Z"),
        lastEvidenceChange: {
          kind: "demand_funding_decision",
          summary: "Funding approved",
          at: new Date("2026-07-27T12:00:00.000Z"),
        },
        delivery: null,
      },
      {
        id: "BI-LEGACY",
        title: "Legacy request",
        status: "open",
        demandStage: null,
        score: null,
        investmentBucket: null,
        evidenceCount: 0,
        asOf: new Date("2026-07-26T12:00:00.000Z"),
        lastEvidenceChange: null,
        delivery: null,
      },
    ],
    objectives: [
      {
        id: "OBJ-1",
        title: "Increase completed bookings",
        status: "active",
        workItemIds: ["BI-READY"],
        asOf: new Date("2026-07-25T12:00:00.000Z"),
      },
    ],
    dependencies: [],
    architectureConstraints: [],
    coordinationEvidence: [],
  });
  return {
    roadmap: { ...roadmap, ...roadmapOverrides },
    sources: {
      demand: {
        availability: "available",
        freshness: "fresh",
        reason: null,
        count: 2,
      },
      objectives: {
        availability: "available",
        freshness: "fresh",
        reason: null,
        count: 1,
      },
      delivery: {
        availability: "available",
        freshness: "unknown",
        reason: null,
        count: 0,
      },
      architecture: {
        availability: "available",
        freshness: "unknown",
        reason: null,
        count: 0,
      },
    },
  };
}

describe("ProductRoadmap", () => {
  it("renders a responsive semantic sequence and keeps incomplete work outside lanes", () => {
    render(
      <ProductRoadmap
        scopeId="product-1"
        scopeHref="/portfolio/product/product-1/direction/roadmap"
        workspace={workspace()}
        view="sequence"
        audience="owner-operator"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Salon appointments roadmap" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Now/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Next/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Later/ })).toBeInTheDocument();
    expect(screen.getByText("Shorter booking form")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Needs evidence before commitment" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Legacy request")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Classify demand" }),
    ).toHaveAttribute("href", "/delivery/demand?item=BI-LEGACY");
    expect(
      screen.queryByText("Source posture and projection boundary"),
    ).not.toBeInTheDocument();
  });

  it("states that timeline dates are unsupported instead of inventing them", () => {
    render(
      <ProductRoadmap
        scopeId="product-1"
        scopeHref="/portfolio/product/product-1/direction/roadmap"
        workspace={workspace()}
        view="timeline"
        audience="stakeholder"
      />,
    );

    expect(screen.getByText("No supported roadmap dates")).toBeInTheDocument();
    expect(
      screen.getByText(/only after a linked delivery or release record/),
    ).toBeInTheDocument();
  });

  it("discloses source posture and the non-authoritative boundary to professional users", () => {
    render(
      <ProductRoadmap
        scopeId="product-1"
        scopeHref="/portfolio/product/product-1/direction/roadmap"
        workspace={workspace()}
        view="dependencies"
        audience="product-manager"
      />,
    );

    expect(
      screen.getByText("No canonical work dependency links"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Source posture and projection boundary"),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot be imported/)).toBeInTheDocument();
  });
});

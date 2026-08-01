// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AttributedEstateGrid,
  type AttributedEstateProduct,
} from "./AttributedEstateGrid";

// This grid was 381 cards on the live install — 20,572px, two thirds of an Estate
// Discovery page that stood 34 screens tall. `docs/platform-usability-standards.md`
// names progressive disclosure as the sanctioned fix for a surface over budget,
// and the measurement excises what is not rendered on arrival.

function product(index: number): AttributedEstateProduct {
  return {
    id: `p-${index}`,
    name: `Product ${index}`,
    lifecycleStatus: "active",
    portfolio: { slug: "foundational", name: "Foundational" },
    taxonomyNodeId: "foundational/compute/servers",
  };
}

describe("AttributedEstateGrid", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders only the preview slice for a large estate", () => {
    render(<AttributedEstateGrid products={Array.from({ length: 381 }, (_, i) => product(i))} />);

    expect(screen.getAllByText(/^Product \d+$/)).toHaveLength(12);
    // The toggle states the true total — containment must not disguise size.
    expect(screen.getByRole("button", { name: "Show all 381" })).toBeTruthy();
  });

  it("expands to the full estate and collapses again", () => {
    render(<AttributedEstateGrid products={Array.from({ length: 20 }, (_, i) => product(i))} />);
    expect(screen.getAllByText(/^Product \d+$/)).toHaveLength(12);

    fireEvent.click(screen.getByRole("button", { name: "Show all 20" }));
    expect(screen.getAllByText(/^Product \d+$/)).toHaveLength(20);

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.getAllByText(/^Product \d+$/)).toHaveLength(12);
  });

  it("shows no toggle when the estate already fits", () => {
    render(<AttributedEstateGrid products={Array.from({ length: 5 }, (_, i) => product(i))} />);

    expect(screen.getAllByText(/^Product \d+$/)).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("states the shared guidance once rather than per card", () => {
    // The old markup repeated an identical 15-word sentence on every card; at 381
    // cards that alone was ~5,700 words of duplicated UI copy.
    render(<AttributedEstateGrid products={Array.from({ length: 30 }, (_, i) => product(i))} />);

    expect(screen.getAllByText(/Open a product to review dependencies/)).toHaveLength(1);
  });

  it("renders the empty state when nothing has discovery evidence", () => {
    render(<AttributedEstateGrid products={[]} />);

    expect(
      screen.getByText("No products are linked to discovered estate evidence yet."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("still links each visible card to its product estate view", () => {
    render(<AttributedEstateGrid products={[product(1)]} />);

    const link = screen.getByRole("link", { name: /Product 1/ });
    expect(link.getAttribute("href")).toBe("/portfolio/product/p-1/inventory");
  });
});

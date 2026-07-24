// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdvancedServiceLinesSection } from "./AdvancedServiceLinesSection";
import type {
  StorefrontCompositionView,
  StorefrontServiceLineView,
} from "@/lib/storefront/composition-view";

vi.mock("@/lib/storefront/service-line-actions", () => ({
  addStorefrontServiceLine: vi.fn(),
  removeStorefrontServiceLine: vi.fn(),
}));
vi.mock("@/components/ui/Dialog", () => ({ confirmDialog: vi.fn() }));

function line(overrides: Partial<StorefrontServiceLineView> = {}): StorefrontServiceLineView {
  return {
    compositionId: "comp-primary",
    role: "primary",
    archetypeSlug: "restaurant",
    name: "Restaurant",
    category: "food-hospitality",
    operatorLabel: "Restaurant",
    visualPattern: "service-readiness-board",
    status: "good",
    statusLabel: "Compatible",
    statusIntent: "success",
    statusIconName: "check",
    contributedModules: [],
    contributedServiceCategories: [],
    contributedItemCount: 0,
    contributedSectionCount: 0,
    warnings: [],
    ...overrides,
  } as unknown as StorefrontServiceLineView;
}

const view = {
  storefrontId: "sf-1",
  primary: line(),
  secondaries: [],
  compatibilitySummary: { status: "good", label: "All compatible", reasons: [] },
} as StorefrontCompositionView;

// The 101-option cross-industry list from the live UX audit — a handful here
// is enough to prove the select is gated, not enumerated.
const availableArchetypes = [
  { archetypeSlug: "third-party-logistics", name: "3PL Contract Warehousing", category: "warehousing-fulfilment", itemCount: 4, sectionCount: 3 },
  { archetypeSlug: "software-platform", name: "Software Platform", category: "software-platform", itemCount: 2, sectionCount: 2 },
];

describe("AdvancedServiceLinesSection (BI-6F9D487C)", () => {
  afterEach(cleanup);

  it("keeps the cross-industry add/remove select collapsed behind disclosure by default", () => {
    render(
      <AdvancedServiceLinesSection storefrontId="sf-1" view={view} availableArchetypes={availableArchetypes} />,
    );

    expect(screen.getByRole("button", { name: /Advanced: service lines/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // No cross-archetype select on the page until the owner explicitly opens it.
    expect(screen.queryByText("3PL Contract Warehousing")).not.toBeInTheDocument();
    expect(screen.queryByText("Software Platform")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add service line" })).not.toBeInTheDocument();
  });

  it("reveals the service-lines panel only after the owner opens the disclosure", () => {
    render(
      <AdvancedServiceLinesSection storefrontId="sf-1" view={view} availableArchetypes={availableArchetypes} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Advanced: service lines/ }));

    expect(screen.getByRole("button", { name: /Advanced: service lines/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Add service line" })).toBeInTheDocument();
  });
});

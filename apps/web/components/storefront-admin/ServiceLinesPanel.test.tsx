// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceLinesPanel } from "./ServiceLinesPanel";
import type {
  StorefrontCompositionView,
  StorefrontServiceLineView,
} from "@/lib/storefront/composition-view";

const { addMock, removeMock, confirmMock } = vi.hoisted(() => ({
  addMock: vi.fn(),
  removeMock: vi.fn(),
  confirmMock: vi.fn(),
}));

vi.mock("@/lib/storefront/service-line-actions", () => ({
  addStorefrontServiceLine: addMock,
  removeStorefrontServiceLine: removeMock,
}));

vi.mock("@/components/ui/Dialog", () => ({
  confirmDialog: confirmMock,
}));

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

const secondary = line({
  compositionId: "comp-3pl",
  role: "secondary",
  archetypeSlug: "third-party-logistics",
  name: "3PL Contract Warehousing",
  category: "warehousing-fulfilment",
  operatorLabel: "3PL Contract Warehousing",
  contributedModules: [{ key: "warehouse" }] as never,
});

const view = {
  storefrontId: "sf-1",
  primary: line(),
  secondaries: [secondary],
  compatibilitySummary: { status: "good", label: "All compatible", reasons: [] },
} as StorefrontCompositionView;

const availableArchetypes = [
  {
    archetypeSlug: "third-party-logistics",
    name: "3PL Contract Warehousing",
    category: "warehousing-fulfilment",
    itemCount: 4,
    sectionCount: 3,
  },
];

describe("ServiceLinesPanel action safety (BI-7D7EE150)", () => {
  beforeEach(() => {
    addMock.mockResolvedValue({ success: true });
    removeMock.mockResolvedValue({ success: true });
    confirmMock.mockReset();
  });

  afterEach(cleanup);

  it("never adds a cross-archetype service line on a single unconfirmed click", async () => {
    confirmMock.mockResolvedValueOnce(false);
    const { container } = render(
      <ServiceLinesPanel
        storefrontId="sf-1"
        view={view}
        availableArchetypes={availableArchetypes}
      />,
    );

    expect(container.querySelectorAll("option")).toHaveLength(0);
    expect(screen.queryByRole("option", { name: /3PL Contract Warehousing/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add service line" }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    // The confirmation names the exact mutation and its scope.
    expect(confirmMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        title: expect.stringContaining("3PL Contract Warehousing"),
        message: expect.stringContaining("4 items"),
      }),
    );
    // Cancelled → the durable mutation never runs.
    expect(addMock).not.toHaveBeenCalled();
  });

  it("adds the service line only after the owner confirms", async () => {
    confirmMock.mockResolvedValueOnce(true);
    render(
      <ServiceLinesPanel
        storefrontId="sf-1"
        view={view}
        availableArchetypes={availableArchetypes}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add service line" }));

    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith("sf-1", "third-party-logistics"),
    );
  });

  it("searches the service-line catalog before adding a non-default option", async () => {
    confirmMock.mockResolvedValueOnce(true);
    render(
      <ServiceLinesPanel
        storefrontId="sf-1"
        view={view}
        availableArchetypes={[
          ...availableArchetypes,
          {
            archetypeSlug: "software-platform",
            name: "Software Platform",
            category: "software-platform",
            itemCount: 2,
            sectionCount: 2,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Service line to add" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search service lines" }), {
      target: { value: "software" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Software Platform/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add service line" }));

    await waitFor(() =>
      expect(addMock).toHaveBeenCalledWith("sf-1", "software-platform"),
    );
  });

  it("requires a danger-toned confirmation before removing a service line", async () => {
    confirmMock.mockResolvedValueOnce(false);
    render(
      <ServiceLinesPanel
        storefrontId="sf-1"
        view={view}
        availableArchetypes={availableArchetypes}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove 3PL Contract Warehousing" }),
    );

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ tone: "danger" }),
    );
    expect(removeMock).not.toHaveBeenCalled();
  });
});

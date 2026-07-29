// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock(
  "@/lib/product-management/current-product-operating-context.server",
  () => ({
    loadCurrentProductOperatingContextByKey: mocks.load,
    ProductManagementAccessError: class extends Error {},
    ProductManagementOrganizationNotFoundError: class extends Error {},
  }),
);
vi.mock(
  "@/lib/product-management/product-operating-context-query",
  () => ({
    ProductOperatingContextNotFoundError: class extends Error {},
  }),
);
vi.mock("@/components/product/direction/ProductOutcomes", () => ({
  ProductOutcomes: ({
    product,
    objectives,
  }: {
    product: { name: string };
    objectives: unknown[];
  }) => (
    <div>
      {product.name} outcomes · {objectives.length}
    </div>
  ),
}));

import ProductOutcomesPage from "./page";

describe("ProductOutcomesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the canonical product operating context and renders its objectives", async () => {
    mocks.load.mockResolvedValue({
      requestedAt: new Date("2026-07-28T12:00:00.000Z"),
      products: [{ id: "product-1", name: "Salon services" }],
      objectives: { items: [{ objectiveId: "OBJ-ONE" }] },
    });
    render(
      await ProductOutcomesPage({
        params: Promise.resolve({ id: "product-1" }),
      }),
    );
    expect(mocks.load).toHaveBeenCalledWith("product", "product-1");
    expect(screen.getByText("Salon services outcomes · 1")).toBeTruthy();
  });

  it("fails closed when the context does not contain the requested product", async () => {
    mocks.load.mockResolvedValue({
      requestedAt: new Date("2026-07-28T12:00:00.000Z"),
      products: [],
      objectives: { items: [] },
    });
    await expect(
      ProductOutcomesPage({
        params: Promise.resolve({ id: "product-1" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

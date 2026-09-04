import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((target: string) => {
  throw new Error(`redirect:${target}`);
}));

vi.mock("next/navigation", () => ({ redirect }));

import ProductSupplyChainPage from "./page";

describe("legacy product Supply Chain route", () => {
  it("redirects to the product's canonical software composition section", async () => {
    await expect(ProductSupplyChainPage({ params: Promise.resolve({ id: "product-1" }) })).rejects.toThrow(
      "redirect:/portfolio/product/product-1/inventory#software-composition",
    );
  });
});

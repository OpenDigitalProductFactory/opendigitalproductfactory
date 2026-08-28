import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("@dpf/db", () => ({
  prisma: { digitalProduct: { findUnique: mocks.findUnique } },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

import StackCurrencyPage from "./page";

describe("legacy Stack Currency route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the platform product and redirects to canonical software composition", async () => {
    mocks.findUnique.mockResolvedValue({ id: "platform-id" });

    await expect(StackCurrencyPage()).rejects.toThrow(
      "redirect:/portfolio/product/platform-id/inventory#software-composition",
    );
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { productId: "dpf-portal" },
      select: { id: true },
    });
  });

  it("fails closed when the platform product is missing", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(StackCurrencyPage()).rejects.toThrow("not-found");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

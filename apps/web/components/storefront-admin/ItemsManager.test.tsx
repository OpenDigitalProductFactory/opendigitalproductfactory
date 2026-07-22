// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ItemsManager } from "./ItemsManager";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const vocabulary = getVocabulary("food-hospitality");

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "itm_1",
    itemId: "ITM-1",
    name: "Table for 2",
    description: null,
    category: null,
    priceAmount: null,
    priceCurrency: "USD",
    priceType: null,
    ctaType: "booking",
    ctaLabel: null,
    imageUrl: null,
    isActive: true,
    sortOrder: 0,
    bookingConfig: null,
  };
}

function renderManager() {
  return render(
    <ItemsManager
      storefrontId="sf_1"
      items={[item()]}
      vocabulary={vocabulary}
      categorySuggestions={[]}
      defaultCtaType="booking"
    />,
  );
}

describe("ItemsManager owner action feedback", () => {
  it("confirms success in plain language after hiding an item", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
    renderManager();

    fireEvent.click(screen.getByRole("button", { name: /hide table for 2 from your public page/i }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/hidden from your public page/i));
  });

  it("keeps the item visible and offers Retry when the change fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "nope" }) }));
    renderManager();

    fireEvent.click(screen.getByRole("button", { name: /hide table for 2 from your public page/i }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/nope|couldn't update/i));
    // Still labelled "hide" — the item did not actually get hidden.
    expect(screen.getByRole("button", { name: /hide table for 2 from your public page/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });
});

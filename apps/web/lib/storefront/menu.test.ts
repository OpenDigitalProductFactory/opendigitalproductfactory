import { describe, it, expect } from "vitest";
import { groupMenu, type PublicItemInput } from "./menu";

function item(over: Partial<PublicItemInput> & { id: string }): PublicItemInput {
  return {
    name: "Item",
    description: null,
    category: null,
    priceAmount: null,
    priceCurrency: "USD",
    imageUrl: null,
    ...over,
  };
}

describe("groupMenu", () => {
  it("groups items by category in first-seen order", () => {
    const out = groupMenu([
      item({ id: "1", category: "Starters", name: "Soup" }),
      item({ id: "2", category: "Mains", name: "Pizza" }),
      item({ id: "3", category: "Starters", name: "Salad" }),
    ]);
    expect(out.map((c) => c.category)).toEqual(["Starters", "Mains"]);
    expect(out[0].items.map((i) => i.name)).toEqual(["Soup", "Salad"]);
    expect(out[1].items.map((i) => i.name)).toEqual(["Pizza"]);
  });

  it("parses stringified prices to numbers and keeps currency", () => {
    const out = groupMenu([
      item({ id: "1", category: "Mains", priceAmount: "14.50", priceCurrency: "USD" }),
    ]);
    expect(out[0].items[0].price).toBe(14.5);
    expect(out[0].items[0].currency).toBe("USD");
  });

  it("null / non-numeric price → null price, never NaN", () => {
    const out = groupMenu([
      item({ id: "1", category: "X", priceAmount: null }),
      item({ id: "2", category: "X", priceAmount: "market" }),
    ]);
    expect(out[0].items[0].price).toBeNull();
    expect(out[0].items[1].price).toBeNull();
  });

  it("collects uncategorised items under a trailing null group", () => {
    const out = groupMenu([
      item({ id: "1", category: null, name: "Misc" }),
      item({ id: "2", category: "Mains", name: "Pizza" }),
      item({ id: "3", category: "   ", name: "Blank cat" }),
    ]);
    expect(out.map((c) => c.category)).toEqual(["Mains", null]);
    expect(out[1].items.map((i) => i.name)).toEqual(["Misc", "Blank cat"]);
  });

  it("returns an empty array for no items", () => {
    expect(groupMenu([])).toEqual([]);
  });
});

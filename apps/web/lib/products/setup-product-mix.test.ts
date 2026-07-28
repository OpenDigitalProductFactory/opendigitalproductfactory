import { describe, expect, it } from "vitest";

import {
  resolveSetupProductLines,
  type ProductLineSelection,
} from "./setup-product-mix";

const mix = {
  primary: {
    key: "dining",
    label: "Dining",
    products: [{ key: "table-dining", label: "Table dining" }],
  },
  adjacent: [
    {
      key: "private-events",
      label: "Private events",
      archetypeId: "catering",
      products: [{ key: "event-catering", label: "Event catering" }],
    },
  ],
};

describe("resolveSetupProductLines", () => {
  it("defaults to the required primary line", () => {
    expect(
      resolveSetupProductLines({
        productMix: mix,
        selections: [{ suggestionKey: "dining", label: "Dining" }],
      }),
    ).toEqual([mix.primary]);
  });

  it("allows rename, adjacent selection, and one custom line", () => {
    const selections: ProductLineSelection[] = [
      { suggestionKey: "dining", label: "Restaurant dining" },
      { suggestionKey: "private-events", label: "Private events" },
      { suggestionKey: null, label: "Cookery classes" },
    ];

    expect(resolveSetupProductLines({ productMix: mix, selections })).toEqual([
      { ...mix.primary, label: "Restaurant dining" },
      mix.adjacent[0],
      {
        key: "cookery-classes",
        label: "Cookery classes",
        products: [],
      },
    ]);
  });

  it("rejects missing primary, unknown suggestions, duplicates, and blank labels", () => {
    expect(() =>
      resolveSetupProductLines({ productMix: mix, selections: [] }),
    ).toThrow("primary");
    expect(() =>
      resolveSetupProductLines({
        productMix: mix,
        selections: [{ suggestionKey: "unknown", label: "Unknown" }],
      }),
    ).toThrow("Unknown");
    expect(() =>
      resolveSetupProductLines({
        productMix: mix,
        selections: [
          { suggestionKey: "dining", label: "Dining" },
          { suggestionKey: null, label: "Dining" },
        ],
      }),
    ).toThrow("unique");
    expect(() =>
      resolveSetupProductLines({
        productMix: mix,
        selections: [{ suggestionKey: "dining", label: " " }],
      }),
    ).toThrow("label");
  });

  it("supports the hotel acceptance fixture without a new archetype", () => {
    const hotelMix = {
      primary: {
        key: "independent-hotel",
        label: "Independent Hotel",
        products: [{ key: "overnight-stay", label: "Overnight stay" }],
      },
      adjacent: [],
    };

    expect(
      resolveSetupProductLines({
        productMix: hotelMix,
        selections: [
          { suggestionKey: "independent-hotel", label: "Rooms" },
          { suggestionKey: null, label: "Conferences and events" },
        ],
      }),
    ).toEqual([
      { ...hotelMix.primary, label: "Rooms" },
      {
        key: "conferences-and-events",
        label: "Conferences and events",
        products: [],
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";

import type { ArchetypeDefinition } from "./types";
import {
  parseProductMix,
  resolveProductMix,
  type ProductMixDefinition,
} from "./product-mix";
import { ALL_ARCHETYPES } from "./archetypes";

function fixture(overrides: Partial<ArchetypeDefinition> = {}): ArchetypeDefinition {
  return {
    archetypeId: "one-line-business",
    name: "One Line Business",
    category: "professional-services",
    ctaType: "inquiry",
    itemTemplates: [
      {
        name: "Advisory session",
        description: "A focused advisory session.",
        priceType: "quote",
      },
    ],
    sectionTemplates: [],
    formSchema: [],
    tags: [],
    ...overrides,
  };
}

describe("resolveProductMix", () => {
  it("derives one primary line for an archetype without explicit metadata", () => {
    const mix = resolveProductMix(fixture());

    expect(mix.primary).toMatchObject({
      key: "one-line-business",
      label: "One Line Business",
      archetypeId: "one-line-business",
    });
    expect(mix.primary.products).toEqual([
      {
        key: "advisory-session",
        label: "Advisory session",
        description: "A focused advisory session.",
      },
    ]);
    expect(mix.adjacent).toEqual([]);
  });

  it("models salon services with optional retail goods", () => {
    const salon = ALL_ARCHETYPES.find((item) => item.archetypeId === "hair-salon");
    expect(salon).toBeDefined();

    const mix = resolveProductMix(salon!);

    expect(mix.primary.label).toBe("Salon services");
    expect(mix.adjacent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "retail-goods",
          label: "Hair-care products",
          archetypeId: "retail-goods",
        }),
      ]),
    );
  });

  it("models restaurant dining with optional private events", () => {
    const restaurant = ALL_ARCHETYPES.find((item) => item.archetypeId === "restaurant");
    expect(restaurant).toBeDefined();

    const mix = resolveProductMix(restaurant!);

    expect(mix.primary.label).toBe("Dining");
    expect(mix.adjacent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "private-events",
          label: "Private events",
        }),
      ]),
    );
  });

  it("supports hotel rooms and conferences through the custom-archetype shape", () => {
    const hotel = fixture({
      archetypeId: "independent-hotel",
      name: "Independent Hotel",
      productMix: {
        primary: {
          key: "rooms",
          label: "Rooms",
          products: [{ key: "overnight-stays", label: "Overnight stays" }],
        },
        adjacent: [
          {
            key: "conferences-events",
            label: "Conferences and events",
            archetypeId: "event-venue",
            products: [{ key: "conference-hire", label: "Conference hire" }],
          },
        ],
      },
    });

    expect(resolveProductMix(hotel)).toEqual(hotel.productMix);
  });
});

describe("parseProductMix", () => {
  const valid: ProductMixDefinition = {
    primary: {
      key: "services",
      label: "Services",
      products: [{ key: "consulting", label: "Consulting" }],
    },
    adjacent: [{ key: "goods", label: "Goods", products: [] }],
  };

  it("accepts the shared persisted shape", () => {
    expect(parseProductMix(valid)).toEqual(valid);
  });

  it.each([
    [{ primary: { key: "", label: "Services", products: [] } }, "key"],
    [{ primary: { key: "services", label: " ", products: [] } }, "label"],
    [
      {
        primary: { key: "services", label: "Services", products: [] },
        adjacent: [{ key: "services", label: "Duplicate", products: [] }],
      },
      "unique",
    ],
  ])("rejects invalid or duplicate line metadata", (value, expected) => {
    expect(() => parseProductMix(value)).toThrow(expected);
  });
});

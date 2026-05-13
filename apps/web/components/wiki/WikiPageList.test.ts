import { describe, expect, it } from "vitest";
import {
  groupPrinciplesByTier,
  type WikiPageListItem,
} from "./WikiPageList";

function makeItem(
  id: string,
  tier: string | null | undefined,
): WikiPageListItem {
  return {
    id,
    slug: `principles/${id}`,
    title: id,
    pageKind: "principle",
    status: "published",
    isKernel: true,
    abstract: null,
    principleTier: tier,
  };
}

describe("groupPrinciplesByTier", () => {
  it("groups items in Commandments -> Core -> Contextual order", () => {
    const groups = groupPrinciplesByTier([
      makeItem("a", "core"),
      makeItem("b", "commandment"),
      makeItem("c", "contextual"),
      makeItem("d", "commandment"),
      makeItem("e", "core"),
    ]);

    expect(groups.map((g) => g.tier)).toEqual([
      "commandment",
      "core",
      "contextual",
    ]);
    expect(groups[0].label).toBe("Commandments");
    expect(groups[1].label).toBe("Core");
    expect(groups[2].label).toBe("Contextual");
    expect(groups[0].items.map((i) => i.id)).toEqual(["b", "d"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["a", "e"]);
    expect(groups[2].items.map((i) => i.id)).toEqual(["c"]);
  });

  it("drops empty tiers from the output", () => {
    const groups = groupPrinciplesByTier([makeItem("a", "core")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tier).toBe("core");
  });

  it("collects untiered drafts into a trailing Untiered group", () => {
    const groups = groupPrinciplesByTier([
      makeItem("a", "commandment"),
      makeItem("b", null),
      makeItem("c", undefined),
    ]);

    expect(groups.map((g) => g.tier)).toEqual(["commandment", "untiered"]);
    expect(groups[1].label).toBe("Untiered");
    expect(groups[1].items.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("preserves input order within each tier (callers sort upstream)", () => {
    const groups = groupPrinciplesByTier([
      makeItem("first", "core"),
      makeItem("second", "core"),
      makeItem("third", "core"),
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("returns an empty array when given no items", () => {
    expect(groupPrinciplesByTier([])).toEqual([]);
  });

  it("places unknown tier values into the Untiered bucket so misconfigured rows stay visible", () => {
    // Defense in depth: schema/lint should prevent unrecognized tier values
    // from reaching the UI, but if one does, surfacing it as Untiered keeps
    // it visible for the admin to fix rather than hiding it.
    const groups = groupPrinciplesByTier([
      makeItem("a", "imaginary_tier"),
      makeItem("b", "commandment"),
    ]);
    expect(groups.map((g) => g.tier)).toEqual(["commandment", "untiered"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["a"]);
  });
});

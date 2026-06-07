import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  groupPrinciplesByConsumerArchetype,
  groupPrinciplesByTier,
  WikiPageList,
  type WikiPageListItem,
} from "./WikiPageList";

function makeItem(
  id: string,
  tier: string | null | undefined,
  archetype?: string | null,
  contexts?: string[],
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
    principleConsumerArchetype: archetype,
    principleConsumerContexts: contexts,
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

describe("groupPrinciplesByConsumerArchetype", () => {
  it("groups principles by consumer archetype first and tier second", () => {
    const groups = groupPrinciplesByConsumerArchetype([
      makeItem("specialist-core", "core", "specialist"),
      makeItem("universal-commandment", "commandment", "universal"),
      makeItem("build-studio-contextual", "contextual", "route-domain-specific", [
        "build-studio",
      ]),
      makeItem("coworker-core", "core", "ai-coworker-universal"),
      makeItem("generalist-core", "core", "generalist"),
      makeItem("unknown", "core", undefined),
    ]);

    expect(groups.map((group) => group.archetype)).toEqual([
      "universal",
      "ai-coworker-universal",
      "generalist",
      "specialist",
      "route-domain-specific",
      "uncategorized",
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Universal",
      "AI Coworker Universal",
      "Generalist / COO",
      "Specialists",
      "Route / Domain Specific",
      "Uncategorized",
    ]);
    expect(groups[0].tierGroups[0].tier).toBe("commandment");
    expect(groups[4].contextGroups).toEqual([
      {
        context: "build-studio",
        label: "Build Studio",
        tierGroups: [
          {
            tier: "contextual",
            label: "Contextual",
            items: [expect.objectContaining({ id: "build-studio-contextual" })],
          },
        ],
      },
    ]);
  });

  it("keeps route-specific principles without contexts visible", () => {
    const groups = groupPrinciplesByConsumerArchetype([
      makeItem("missing-context", "core", "route-domain-specific", []),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].contextGroups).toEqual([
      {
        context: "unscoped",
        label: "Unscoped",
        tierGroups: [
          {
            tier: "core",
            label: "Core",
            items: [expect.objectContaining({ id: "missing-context" })],
          },
        ],
      },
    ]);
  });
});

describe("WikiPageList", () => {
  it("renders top-level kind groups as native disclosure sections", () => {
    const html = renderToStaticMarkup(
      WikiPageList({
        pages: [
          makeItem("principle-a", "core", "universal"),
          {
            id: "entity-a",
            slug: "entities/entity-a",
            title: "Entity A",
            pageKind: "entity",
            status: "published",
            isKernel: true,
            abstract: null,
          },
        ],
      }),
    );

    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Principles");
    expect(html).toContain("Entities");
  });
});

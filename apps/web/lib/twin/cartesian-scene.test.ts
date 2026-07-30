import { describe, expect, it } from "vitest";

import type {
  CartesianSceneLayout,
  CartesianScenePlacement,
} from "@dpf/storefront-templates";

import {
  findContainingZoneId,
  nudgeCartesianPlacement,
  resolveCartesianResourceNodeType,
  sceneToCartesianNodeDescriptors,
  validateCartesianSceneLayout,
} from "./cartesian-scene";

function scene(
  overrides: Partial<CartesianSceneLayout> = {},
): CartesianSceneLayout {
  return {
    schemaVersion: 1,
    spaceKind: "cartesian-interior",
    viewport: { x: 0, y: 0, zoom: 1 },
    zones: [
      {
        id: "dining",
        label: "Dining room",
        geometry: {
          kind: "rectangle",
          x: 20,
          y: 30,
          width: 500,
          height: 320,
        },
      },
      {
        id: "window",
        label: "Window",
        geometry: {
          kind: "polygon",
          points: [
            { x: 40, y: 50 },
            { x: 240, y: 50 },
            { x: 240, y: 180 },
            { x: 40, y: 180 },
          ],
        },
      },
    ],
    placements: [
      {
        id: "table-1",
        label: "Table 1",
        entityRef: { kind: "table", id: "resource-1" },
        geometry: {
          x: 80,
          y: 90,
          width: 72,
          height: 72,
          rotation: 0,
          shapeKind: "round-table",
        },
      },
      {
        id: "chair-1",
        label: "Chair 1",
        entityRef: { kind: "care-resource", id: "resource-2" },
        geometry: {
          x: 380,
          y: 220,
          width: 56,
          height: 56,
          rotation: 0,
          shapeKind: "chair",
        },
      },
    ],
    ...overrides,
  };
}

describe("validateCartesianSceneLayout", () => {
  it("accepts and defensively copies a bounded cartesian scene", () => {
    const input = scene();
    const result = validateCartesianSceneLayout(input);

    expect(result).toEqual({ ok: true, value: input });
    if (!result.ok) throw new Error(result.error);
    expect(result.value).not.toBe(input);
    expect(result.value.placements).not.toBe(input.placements);
  });

  it("rejects the wrong coordinate space and non-finite geometry", () => {
    expect(
      validateCartesianSceneLayout({
        ...scene(),
        spaceKind: "geographic",
      }),
    ).toEqual({
      ok: false,
      error: "The layout is not a cartesian operational scene.",
    });

    const bad = scene({
      placements: [
        {
          ...scene().placements[0]!,
          geometry: {
            ...scene().placements[0]!.geometry,
            x: Number.NaN,
          },
        },
      ],
    });
    expect(validateCartesianSceneLayout(bad)).toEqual({
      ok: false,
      error: "Placement table-1 has invalid geometry.",
    });
  });

  it("rejects duplicate ids, invalid entity references, and over-dense scenes", () => {
    const duplicate = scene({
      placements: [
        scene().placements[0]!,
        {
          ...scene().placements[1]!,
          id: "table-1",
        },
      ],
    });
    expect(validateCartesianSceneLayout(duplicate)).toEqual({
      ok: false,
      error: "Placement ids must be unique.",
    });

    const missingRef = scene({
      placements: [
        {
          ...scene().placements[0]!,
          entityRef: { kind: "table", id: " " },
        },
      ],
    });
    expect(validateCartesianSceneLayout(missingRef)).toEqual({
      ok: false,
      error: "Placement table-1 has an invalid entity reference.",
    });

    expect(
      validateCartesianSceneLayout(
        scene({
          zones: Array.from({ length: 7 }, (_, index) => ({
            id: `zone-${index}`,
            label: `Zone ${index}`,
            geometry: {
              kind: "rectangle" as const,
              x: index * 100,
              y: 0,
              width: 80,
              height: 80,
            },
          })),
        }),
      ),
    ).toEqual({
      ok: false,
      error: "A cartesian scene can show at most 6 zones.",
    });
  });
});

describe("cartesian group membership and descriptors", () => {
  it("chooses the smallest containing zone and converts absolute coordinates to parent-relative", () => {
    const layout = scene();
    const table = layout.placements[0]!;

    expect(findContainingZoneId(layout.zones, table)).toBe("window");

    const descriptors = sceneToCartesianNodeDescriptors(layout, {
      mode: "configure",
    });
    const tableNode = descriptors.find(
      (descriptor) => descriptor.id === "scene-placement:table-1",
    );

    expect(tableNode).toMatchObject({
      kind: "placement",
      nodeType: "table",
      parentId: "scene-zone:window",
      position: { x: 40, y: 40 },
      absolutePosition: { x: 80, y: 90 },
      draggable: true,
      selectable: true,
    });
  });

  it("locks geometry outside configure mode and keeps visible live-state data", () => {
    const descriptors = sceneToCartesianNodeDescriptors(scene(), {
      mode: "operate",
      bindings: {
        "table:resource-1": {
          label: "Table 1",
          statusLabel: "Turning soon",
          sublabel: "Free in 8 min",
          intent: "warning",
          cogSuggested: true,
        },
      },
    });
    const tableNode = descriptors.find(
      (descriptor) => descriptor.id === "scene-placement:table-1",
    );

    expect(tableNode).toMatchObject({
      draggable: false,
      selectable: true,
      data: {
        label: "Table 1",
        statusLabel: "Turning soon",
        sublabel: "Free in 8 min",
        intent: "warning",
        cogSuggested: true,
        interactive: true,
      },
    });

    const readOnly = sceneToCartesianNodeDescriptors(scene(), {
      mode: "read-only",
    });
    expect(
      readOnly.find(
        (descriptor) => descriptor.id === "scene-placement:table-1",
      ),
    ).toMatchObject({
      draggable: false,
      selectable: false,
      data: { interactive: false },
    });
  });
});

describe("cartesian placement updates", () => {
  it("immutably nudges one placement using absolute scene coordinates", () => {
    const input = scene();
    const before = input.placements[0]!;
    const result = nudgeCartesianPlacement(input, "table-1", {
      x: 144,
      y: 168,
    });

    expect(result).not.toBe(input);
    expect(result.placements[0]).not.toBe(before);
    expect(result.placements[0]!.geometry).toMatchObject({ x: 144, y: 168 });
    expect(result.placements[1]).toBe(input.placements[1]);
    expect(input.placements[0]!.geometry).toMatchObject({ x: 80, y: 90 });
  });

  it("returns the original scene for a missing placement", () => {
    const input = scene();
    expect(
      nudgeCartesianPlacement(input, "missing", { x: 1, y: 2 }),
    ).toBe(input);
  });
});

describe("resolveCartesianResourceNodeType", () => {
  it.each([
    ["round-table", "table"],
    ["salon-chair", "chair"],
    ["service-bay", "bay"],
    ["storage-rack", "rack"],
    ["venue-seat", "seat"],
    ["work-station", "station"],
    ["unknown-future-shape", "resource"],
  ] as const)("%s resolves to %s", (shapeKind, expected) => {
    expect(resolveCartesianResourceNodeType(shapeKind)).toBe(expected);
  });

  it("keeps placement typing compatible with the canonical contract", () => {
    const placement: CartesianScenePlacement = scene().placements[0]!;
    expect(placement.entityRef.kind).toBe("table");
  });
});

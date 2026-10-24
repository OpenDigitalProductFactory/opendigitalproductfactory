import type { GeographicCoordinate, GeographicPolygonGeometry, GeographicSceneZone } from "@dpf/storefront-templates";
import { describe, expect, it } from "vitest";

import { coverageForSites, pointInGeographicPolygon } from "./geographic-coverage";

function ring(points: [number, number][]): GeographicCoordinate[] {
  const coordinates = points.map(([longitude, latitude]) => ({ longitude, latitude }));
  return [...coordinates, coordinates[0]!];
}

const square: GeographicPolygonGeometry = { kind: "polygon", rings: [ring([[0, 0], [10, 0], [10, 10], [0, 10]])] };
const squareWithHole: GeographicPolygonGeometry = {
  kind: "polygon",
  rings: [ring([[0, 0], [10, 0], [10, 10], [0, 10]]), ring([[4, 4], [6, 4], [6, 6], [4, 6]])],
};
// A "C" opening to the east: the notch between x 3..10, y 3..7 is outside.
const concave: GeographicPolygonGeometry = {
  kind: "polygon",
  rings: [ring([[0, 0], [10, 0], [10, 3], [3, 3], [3, 7], [10, 7], [10, 10], [0, 10]])],
};

const at = (longitude: number, latitude: number) => ({ longitude, latitude });

describe("pointInGeographicPolygon (AC-COV-PIP-1)", () => {
  it("finds points inside and outside", () => {
    expect(pointInGeographicPolygon(at(5, 5), square)).toBe(true);
    expect(pointInGeographicPolygon(at(15, 5), square)).toBe(false);
    expect(pointInGeographicPolygon(at(-0.5, 5), square)).toBe(false);
  });

  it("treats a hole as outside", () => {
    expect(pointInGeographicPolygon(at(5, 5), squareWithHole)).toBe(false);
    expect(pointInGeographicPolygon(at(2, 2), squareWithHole)).toBe(true);
  });

  it("handles concave shapes", () => {
    expect(pointInGeographicPolygon(at(6, 5), concave)).toBe(false);
    expect(pointInGeographicPolygon(at(1, 5), concave)).toBe(true);
    expect(pointInGeographicPolygon(at(6, 1), concave)).toBe(true);
  });

  it("uses real-world longitude/latitude", () => {
    const austin: GeographicPolygonGeometry = {
      kind: "polygon",
      rings: [ring([[-97.9, 30.1], [-97.5, 30.1], [-97.5, 30.5], [-97.9, 30.5]])],
    };
    expect(pointInGeographicPolygon(at(-97.74, 30.27), austin)).toBe(true);
    expect(pointInGeographicPolygon(at(-96.8, 32.78), austin)).toBe(false);
  });
});

describe("coverageForSites (AC-COV-ANSWER-1, AC-COV-ANSWER-2)", () => {
  const zones: GeographicSceneZone[] = [
    { id: "west", label: "West", geometry: { kind: "polygon", rings: [ring([[0, 0], [6, 0], [6, 10], [0, 10]])] } },
    { id: "east", label: "East", geometry: { kind: "polygon", rings: [ring([[4, 0], [10, 0], [10, 10], [4, 10]])] } },
  ];

  it("splits sites into covered, outside and overlapping", () => {
    const result = coverageForSites(
      [
        { siteId: "a", longitude: 1, latitude: 5 },
        { siteId: "b", longitude: 5, latitude: 5 },
        { siteId: "c", longitude: 20, latitude: 5 },
      ],
      zones,
    );
    expect(result.bySite.get("a")).toEqual(["west"]);
    expect(result.bySite.get("b")).toEqual(["west", "east"]);
    expect(result.outside).toEqual(["c"]);
    expect(result.overlaps).toEqual([{ siteId: "b", zoneIds: ["west", "east"] }]);
  });

  it("reports every site as outside when there are no zones", () => {
    expect(coverageForSites([{ siteId: "a", longitude: 1, latitude: 1 }], []).outside).toEqual(["a"]);
  });
});

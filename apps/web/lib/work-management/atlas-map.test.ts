import { describe, expect, it } from "vitest";

import type { AtlasRoom } from "./atlas-projection";
import {
  ATLAS_UNSHAPED,
  atlasHref,
  atlasQuestionAnswer,
  atlasTriageCounts,
  groupAtlas,
  parseAtlasFilters,
  parseAtlasGroup,
} from "./atlas-map";

function room(id: string, overrides: Partial<AtlasRoom> = {}): AtlasRoom {
  return {
    capsuleId: id, title: `Room ${id}`, portfolio: "manufactureAndDeliver", health: "working",
    label: "inventory.status.working", shape: "delivery-small",
    ...overrides,
  };
}

describe("Work Atlas map grouping", () => {
  it("groups by portfolio then shape, with Manufacturing and Delivery first and Not yet placed last", () => {
    const groups = groupAtlas([
      room("a", { portfolio: "unplaced" }),
      room("b", { portfolio: "foundational" }),
      room("c"),
      room("d", { portfolio: "somethingElse" }),
    ]);
    expect(groups.map((group) => group.portfolio)).toEqual(["manufactureAndDeliver", "foundational", "unplaced"]);
    expect(groups.at(-1)?.total).toBe(2);
  });

  it("orders each shape worst first so rooms that need a look gather at the left", () => {
    const [group] = groupAtlas([
      room("w1", { health: "waiting" }), room("f1", { health: "finished" }), room("n1", { health: "needs-person" }),
      room("s1", { health: "stuck" }), room("x1", { health: "no-signal" }), room("k1", { health: "working" }),
    ]);
    expect(group!.shapes[0]!.rooms.map((r) => r.health)).toEqual(["stuck", "needs-person", "no-signal", "working", "waiting", "finished"]);
    expect(group).toMatchObject({ total: 6, needPerson: 1, stuck: 1 });
  });

  it("puts rooms with no declared shape in an Unshaped bucket after the shaped ones", () => {
    const [group] = groupAtlas([room("u", { shape: undefined }), room("u2", { shape: undefined }), room("m", { shape: "delivery-medium" })]);
    expect(group!.shapes.map((shape) => shape.shape)).toEqual(["delivery-medium", ATLAS_UNSHAPED]);
  });

  it("filters by portfolio and shape; the state filter is counted, not hidden", () => {
    const rooms = [room("a"), room("b", { portfolio: "foundational" }), room("c", { health: "stuck" }), room("d", { shape: "delivery-large" })];
    expect(groupAtlas(rooms, { portfolio: "foundational" }).map((g) => g.portfolio)).toEqual(["foundational"]);
    expect(groupAtlas(rooms, { shape: "delivery-large" })[0]!.total).toBe(1);
    expect(groupAtlas(rooms, { state: "stuck" })[0]!.total).toBe(3);
    expect(atlasTriageCounts(rooms, { portfolio: "manufactureAndDeliver" })).toMatchObject({ working: 2, stuck: 1 });
  });
});

describe("Work Atlas URL filters", () => {
  it("reads known filters and drops anything it does not recognise", () => {
    expect(parseAtlasFilters({ portfolio: "forEmployees", state: "stuck", shape: "delivery-small" }))
      .toEqual({ portfolio: "forEmployees", state: "stuck", shape: "delivery-small" });
    expect(parseAtlasFilters({ portfolio: "nope", state: "on-fire", shape: "<script>" })).toEqual({});
    expect(parseAtlasGroup({ group: "foundational/delivery-small" })).toBe("foundational/delivery-small");
    expect(parseAtlasGroup({ group: "../etc" })).toBeUndefined();
  });

  it("builds links that keep the other filters and clear one on request", () => {
    const view = { portfolio: "foundational" as const, state: "stuck" as const };
    expect(atlasHref("/ops/workrooms", view, { shape: "delivery-small" }))
      .toBe("/ops/workrooms?portfolio=foundational&state=stuck&shape=delivery-small");
    expect(atlasHref("/ops/workrooms", view, { state: null, portfolio: null })).toBe("/ops/workrooms");
  });
});

describe("Today's question", () => {
  it("counts rooms waiting on a person and names the one quiet longest", () => {
    const answer = atlasQuestionAnswer([
      room("a", { health: "needs-person", lastSignalAt: "2026-11-10T00:00:00.000Z" }),
      room("b", { health: "needs-person", lastSignalAt: "2026-11-08T00:00:00.000Z" }),
      room("c", { health: "needs-person" }),
      room("d", { health: "stuck", lastSignalAt: "2026-11-01T00:00:00.000Z" }),
    ]);
    expect(answer).toEqual({ waiting: 3, oldest: { capsuleId: "b", title: "Room b", lastSignalAt: "2026-11-08T00:00:00.000Z" } });
  });

  it("names no room when none is waiting on a person", () => {
    expect(atlasQuestionAnswer([room("a")])).toEqual({ waiting: 0, oldest: null });
  });
});

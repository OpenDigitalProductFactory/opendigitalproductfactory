import { describe, expect, it } from "vitest";

import {
  buildRoomsScene,
  buildRoomsSceneBindings,
  rankRoomExceptions,
  summarizeRooms,
} from "./rooms-operations";
import { buildDemoRoomsOperationalView } from "./rooms-operations-demo";

describe("rooms operations projection", () => {
  it("keeps occupancy, readiness, inventory, and privacy as independent axes", () => {
    const view = buildDemoRoomsOperationalView({
      domain: "lodging",
      roomCount: 40,
    });
    const room = view.rooms.find((candidate) => candidate.id === "room-106");

    expect(room).toMatchObject({
      occupancy: "occupied",
      readiness: "dirty",
      inventory: "sellable",
      privacy: "do-not-enter",
    });
    expect(summarizeRooms(view)).toMatchObject({
      total: 40,
      arriving: expect.any(Number),
      departing: expect.any(Number),
      ready: expect.any(Number),
      unassigned: expect.any(Number),
    });
  });

  it("ranks check-in blockers before informational work", () => {
    const view = buildDemoRoomsOperationalView({ domain: "lodging" });
    const ranked = rankRoomExceptions(view);

    expect(ranked[0]).toMatchObject({ severity: "critical" });
    expect(ranked.map((item) => item.kind)).toContain("arrival-risk");
    expect(ranked.at(-1)?.severity).not.toBe("critical");
  });

  it("builds one scene and binding map without exposing sensitive identity", () => {
    const view = buildDemoRoomsOperationalView({ domain: "care" });
    const scene = buildRoomsScene(view);
    const bindings = buildRoomsSceneBindings(view);

    expect(scene.placements).toHaveLength(view.rooms.length);
    expect(scene.zones.map((zone) => zone.label)).toEqual(["North wing", "South wing"]);
    expect(JSON.stringify({ scene, bindings })).not.toMatch(
      /patient|diagnosis|guest name/i,
    );
    expect(bindings["room:room-101"]).toMatchObject({
      label: "Room 101",
      statusLabel: expect.any(String),
    });
  });

  it("adapts the same grammar to boarding vocabulary", () => {
    const view = buildDemoRoomsOperationalView({ domain: "boarding" });

    expect(view.vocabulary).toMatchObject({
      roomSingular: "kennel",
      occupantSingular: "animal",
      arrivalSingular: "drop-off",
    });
    expect(view.rooms[0]?.label).toMatch(/^Kennel /);
  });
});

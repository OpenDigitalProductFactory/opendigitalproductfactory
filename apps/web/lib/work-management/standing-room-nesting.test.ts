// Materializing the nesting (BI-AEAA90A9).
//
// standing-rooms.ts declares a tree: every sub-room carries a parentKey. On this
// install the tree exists only in that declaration —
//
//   SELECT relation, count(*) FROM "WorkCapsuleRelation";  -- (0 rows)
//
// Zero relations of any kind, while 18 standing rooms sit in the database with
// idempotency keys matching the derivation's own format. deriveStandingRooms has
// no consumer anywhere, so whatever created those rooms never wrote the
// containment, and the five parent rooms float unlinked from their children.
//
// Nesting is the core of the operating model: rooms decompose into more discrete
// specialists, communicating upward and ordering downward. None of it is true
// until these rows exist.

import { describe, expect, it } from "vitest";

import { planContainmentRelations, standingRoomKeyOf } from "./standing-room-nesting";

const parents = {
  "issue-triage": "contribution-flow",
  "pull-request-flow": "contribution-flow",
  "contribution-flow": null,
};

function room(capsuleId: string, key: string, version = "v1") {
  return { capsuleId, idempotencyKey: `standing-room:${key}:${version}` };
}

describe("standingRoomKeyOf", () => {
  it("reads the room key out of the idempotency key", () => {
    expect(standingRoomKeyOf("standing-room:issue-triage:v1")).toBe("issue-triage");
  });

  it("is version-agnostic — v2 of a room is the same room", () => {
    // WC-A69BCABB is :v2 of a room whose :v1 still exists. Containment is a
    // property of the room's purpose, not its revision.
    expect(standingRoomKeyOf("standing-room:dependency-advisory-watch:v2")).toBe(
      "dependency-advisory-watch",
    );
  });

  it("ignores rooms that are not standing rooms", () => {
    expect(standingRoomKeyOf("build:FB-1234")).toBeNull();
    expect(standingRoomKeyOf(null)).toBeNull();
    expect(standingRoomKeyOf("standing-room:")).toBeNull();
  });
});

describe("planContainmentRelations", () => {
  it("links a child to its declared parent", () => {
    const plan = planContainmentRelations(
      [room("WC-PARENT", "contribution-flow"), room("WC-CHILD", "issue-triage")],
      parents,
    );
    expect(plan).toEqual([
      { fromCapsuleId: "WC-PARENT", toCapsuleId: "WC-CHILD", relation: "contains" },
    ]);
  });

  it("points the relation parent → child, not child → parent", () => {
    // `contains` reads from the container. Reversing it would invert every
    // delegation tree and every escalation walk built on top of it.
    const [rel] = planContainmentRelations(
      [room("WC-PARENT", "contribution-flow"), room("WC-CHILD", "issue-triage")],
      parents,
    );
    expect(rel?.fromCapsuleId).toBe("WC-PARENT");
    expect(rel?.toCapsuleId).toBe("WC-CHILD");
  });

  it("plans nothing for a top room", () => {
    expect(planContainmentRelations([room("WC-PARENT", "contribution-flow")], parents)).toEqual([]);
  });

  it("skips a child whose parent room does not exist on this install", () => {
    // An archetype may include a sub-room whose parent was never materialized.
    // A relation to a missing room is a dangling row, not a tree.
    expect(planContainmentRelations([room("WC-CHILD", "issue-triage")], parents)).toEqual([]);
  });

  it("ignores rooms that are not standing rooms at all", () => {
    const plan = planContainmentRelations(
      [
        { capsuleId: "WC-BUILD", idempotencyKey: "build:FB-1" },
        { capsuleId: "WC-NONE", idempotencyKey: null },
      ],
      parents,
    );
    expect(plan).toEqual([]);
  });

  it("ignores a standing room whose key is not in the declaration", () => {
    // A room left behind by a retired declaration must not acquire a parent by
    // guesswork.
    expect(planContainmentRelations([room("WC-OLD", "retired-room")], parents)).toEqual([]);
  });

  it("links both children of a shared parent", () => {
    const plan = planContainmentRelations(
      [
        room("WC-PARENT", "contribution-flow"),
        room("WC-A", "issue-triage"),
        room("WC-B", "pull-request-flow"),
      ],
      parents,
    );
    expect(plan).toHaveLength(2);
    expect(plan.every((r) => r.fromCapsuleId === "WC-PARENT")).toBe(true);
  });

  it("handles a duplicated room key deterministically rather than at random", () => {
    // BI-CFB3FDB7: dependency-advisory-watch exists as both :v1 and :v2. Both are
    // real rooms and both belong under the parent; neither may be dropped
    // silently, and the order must not depend on map iteration luck.
    const dupParents = { "dependency-advisory-watch": "source-custody", "source-custody": null };
    const plan = planContainmentRelations(
      [
        room("WC-P", "source-custody"),
        room("WC-V2", "dependency-advisory-watch", "v2"),
        room("WC-V1", "dependency-advisory-watch", "v1"),
      ],
      dupParents,
    );
    expect(plan.map((r) => r.toCapsuleId)).toEqual(["WC-V1", "WC-V2"]);
  });

  it("is a pure plan — it returns rows and writes nothing", () => {
    const rooms = [room("WC-PARENT", "contribution-flow"), room("WC-CHILD", "issue-triage")];
    const snapshot = JSON.stringify(rooms);
    planContainmentRelations(rooms, parents);
    expect(JSON.stringify(rooms)).toBe(snapshot);
  });
});

// Materializing standing-room nesting (BI-AEAA90A9).
//
// `standing-rooms.ts` declares the tree — every sub-room carries a `parentKey` —
// and until now that declaration had no consumer, so the tree existed nowhere
// else. `WorkCapsuleRelation` held zero rows on this install while eighteen
// standing rooms sat in the database, the five parents unlinked from their
// children.
//
// Nesting is not decoration: delegation downward and escalation upward are both
// walks over these rows. Nothing built on the hierarchy can be true before they
// exist.
//
// Pure module: plans rows, writes none.

import { STANDING_ROOM_PARENT_BY_KEY } from "@dpf/storefront-templates";

/** A room as the reconciler sees it — identity and how it was keyed. */
export type StandingRoomRow = {
  capsuleId: string;
  idempotencyKey: string | null;
};

export type ContainmentRelationPlan = {
  /** The CONTAINER. `contains` reads from the parent; reversing it would invert
   *  every delegation tree and escalation walk built on top. */
  fromCapsuleId: string;
  toCapsuleId: string;
  relation: "contains";
};

const STANDING_ROOM_PREFIX = "standing-room:";

/**
 * The room key inside a standing-room idempotency key, or null when the row is
 * not a standing room.
 *
 * Deliberately version-agnostic: `standing-room:<key>:v1` and `:v2` are the same
 * room. Containment is a property of the room's PURPOSE, not its revision — which
 * matters concretely here, because `dependency-advisory-watch` currently exists
 * as both (BI-CFB3FDB7).
 */
export function standingRoomKeyOf(idempotencyKey: string | null | undefined): string | null {
  if (!idempotencyKey || !idempotencyKey.startsWith(STANDING_ROOM_PREFIX)) return null;
  const rest = idempotencyKey.slice(STANDING_ROOM_PREFIX.length);
  const key = rest.split(":")[0] ?? "";
  return key.length > 0 ? key : null;
}

/**
 * The `contains` rows implied by the rooms present and the declared tree.
 *
 * Plans nothing it cannot ground: a child whose parent room was never
 * materialized on this install is skipped rather than pointed at a missing row,
 * and a room whose key is absent from the declaration never acquires a parent by
 * guesswork.
 *
 * Output order is deterministic (by container, then contained) so a duplicated
 * room key cannot make the plan depend on iteration luck.
 */
export function planContainmentRelations(
  rooms: readonly StandingRoomRow[],
  parentByKey: Readonly<Record<string, string | null>> = STANDING_ROOM_PARENT_BY_KEY,
): ContainmentRelationPlan[] {
  // A key may map to more than one room while a superseded duplicate lives on;
  // both are real rooms and both belong under the parent.
  const roomsByKey = new Map<string, string[]>();
  for (const room of rooms) {
    const key = standingRoomKeyOf(room.idempotencyKey);
    if (!key) continue;
    const bucket = roomsByKey.get(key);
    if (bucket) bucket.push(room.capsuleId);
    else roomsByKey.set(key, [room.capsuleId]);
  }

  const plans: ContainmentRelationPlan[] = [];
  for (const [key, capsuleIds] of roomsByKey) {
    const parentKey = parentByKey[key];
    if (!parentKey) continue; // top room, or a key this declaration does not know
    const parents = roomsByKey.get(parentKey);
    if (!parents || parents.length === 0) continue; // parent not on this install
    for (const parentId of parents) {
      for (const childId of capsuleIds) {
        if (parentId === childId) continue;
        plans.push({ fromCapsuleId: parentId, toCapsuleId: childId, relation: "contains" });
      }
    }
  }

  return plans.sort(
    (a, b) =>
      a.fromCapsuleId.localeCompare(b.fromCapsuleId) || a.toCapsuleId.localeCompare(b.toCapsuleId),
  );
}

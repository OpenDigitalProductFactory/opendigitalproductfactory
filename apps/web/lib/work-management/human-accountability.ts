/**
 * Effective human accountability for a Workroom.
 *
 * Who answers for the outcome is a different question from who coordinates the
 * work, who executes it, who asked for it, or who holds the lease. The design
 * (PWA-04, PWA-05) keeps them separate on purpose: an AI coordinator can be
 * absent while a human remains accountable, and resolving accountability grants
 * no capability to anyone.
 *
 * Accountability is inherited down explicit containment, never derived from a
 * dependency. `depends-on`, `blocks` and `contributes-to` describe execution
 * order; treating one as an ownership edge would make whoever a room waits on
 * answerable for it. Only `contains` and `spawned-from` carry responsibility.
 *
 * When nothing resolves, this returns a setup state naming what is missing. It
 * never falls back to the room's creator, requester, lease holder or the first
 * administrator: a guessed accountable is worse than a visible gap, because it
 * reads as a decision somebody made.
 */

import { WORKROOM_RELATION_KINDS, type WorkroomRelationKind } from "./room-relations";

/** Relations that carry responsibility downward. */
export const RESPONSIBILITY_RELATION_KINDS = ["contains", "spawned-from"] as const satisfies readonly WorkroomRelationKind[];

export type ResponsibilityRelationKind = (typeof RESPONSIBILITY_RELATION_KINDS)[number];

export function isResponsibilityRelation(kind: string): kind is ResponsibilityRelationKind {
  return (RESPONSIBILITY_RELATION_KINDS as readonly string[]).includes(kind);
}

export type AccountabilityEdge = {
  /** The containing (parent) room. */
  fromWorkroomId: string;
  /** The contained (child) room. */
  toWorkroomId: string;
  relation: string;
};

export type AccountabilityRoomInput = {
  workroomId: string;
  /**
   * Principals persisted on this room with the `accountable` role. More than one
   * is a conflict to correct, not a precedence puzzle to solve.
   */
  accountablePrincipalIds: readonly string[];
};

export type EffectiveHumanAccountability =
  | {
      state: "resolved";
      principalId: string;
      /** Where the answer came from. */
      source: "explicit-room" | "inherited-room" | "organization-owner";
      /**
       * Rooms walked from the subject to the room that decided it, subject
       * first. Empty when the organization owner decided it.
       */
      inheritedFrom: string[];
    }
  | {
      state: "setup-required";
      reason:
        | "no-organization-owner-recorded"
        | "conflicting-accountable-principals"
        | "responsibility-cycle";
      message: string;
      /** The room the problem was found on, when it is a specific room. */
      atWorkroomId: string | null;
    };

function parentOf(edges: readonly AccountabilityEdge[], childId: string): string | null {
  const parents = edges
    .filter((edge) => isResponsibilityRelation(edge.relation) && edge.toWorkroomId === childId)
    .map((edge) => edge.fromWorkroomId);
  const unique = [...new Set(parents)];
  // Two containers is an ambiguity in the graph, not a precedence question. The
  // walk stops rather than picking one, so the estate reports a correctable
  // structure instead of an arbitrary owner.
  return unique.length === 1 ? unique[0]! : null;
}

function accountableOn(room: AccountabilityRoomInput | undefined): { principalId: string | null; conflict: boolean } {
  const ids = [...new Set((room?.accountablePrincipalIds ?? []).filter((id) => id.trim().length > 0))];
  if (ids.length > 1) return { principalId: null, conflict: true };
  return { principalId: ids[0] ?? null, conflict: false };
}

/**
 * Resolve who is accountable for `workroomId`.
 *
 * Order: an explicit assignment on the room itself, then the nearest ancestor
 * with one along containment, then the organization's recorded top accountable.
 * A solo founder is the ordinary case of the last step, not a special case.
 */
export function resolveEffectiveHumanAccountability(input: {
  workroomId: string;
  rooms: readonly AccountabilityRoomInput[];
  edges: readonly AccountabilityEdge[];
  /** The organization's recorded top accountable principal, or null when unset. */
  organizationTopAccountablePrincipalId: string | null;
}): EffectiveHumanAccountability {
  const byId = new Map(input.rooms.map((room) => [room.workroomId, room]));
  const walked: string[] = [];
  const seen = new Set<string>();
  let current: string | null = input.workroomId;

  while (current) {
    if (seen.has(current)) {
      return {
        state: "setup-required",
        reason: "responsibility-cycle",
        message: `Responsibility lineage revisits ${current}, so it cannot be resolved. Break the containment cycle.`,
        atWorkroomId: current,
      };
    }
    seen.add(current);
    walked.push(current);

    const { principalId, conflict } = accountableOn(byId.get(current));
    if (conflict) {
      return {
        state: "setup-required",
        reason: "conflicting-accountable-principals",
        message: `${current} records more than one accountable principal. Leave exactly one.`,
        atWorkroomId: current,
      };
    }
    if (principalId) {
      return {
        state: "resolved",
        principalId,
        source: walked.length === 1 ? "explicit-room" : "inherited-room",
        inheritedFrom: walked,
      };
    }
    current = parentOf(input.edges, current);
  }

  if (input.organizationTopAccountablePrincipalId?.trim()) {
    return {
      state: "resolved",
      principalId: input.organizationTopAccountablePrincipalId.trim(),
      source: "organization-owner",
      inheritedFrom: [],
    };
  }

  return {
    state: "setup-required",
    reason: "no-organization-owner-recorded",
    message:
      "No accountable human is assigned and the organization has recorded no owner. "
      + "Record the organization's accountable owner, or assign one to this room.",
    atWorkroomId: null,
  };
}

/**
 * A one-line provenance statement for display, e.g. "Alex · inherited from Finance".
 * Naming the source is the point: an inherited answer must not look like a decision
 * taken on this room.
 */
export function describeAccountabilityProvenance(
  result: EffectiveHumanAccountability,
  displayNameOf: (principalId: string) => string,
  roomLabelOf: (workroomId: string) => string,
): string {
  if (result.state === "setup-required") return result.message;
  const who = displayNameOf(result.principalId);
  if (result.source === "explicit-room") return `${who} · assigned here`;
  if (result.source === "organization-owner") return `${who} · organization owner`;
  const decidedAt = result.inheritedFrom[result.inheritedFrom.length - 1]!;
  return `${who} · inherited from ${roomLabelOf(decidedAt)}`;
}

/** Guard: the relation vocabulary this module depends on has not drifted. */
export const RESPONSIBILITY_RELATIONS_ARE_KNOWN = RESPONSIBILITY_RELATION_KINDS.every(
  (kind) => (WORKROOM_RELATION_KINDS as readonly string[]).includes(kind),
);

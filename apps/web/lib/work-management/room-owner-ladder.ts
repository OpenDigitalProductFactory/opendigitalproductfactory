// The ownership ladder — who answers for a room, resolved rather than appointed
// (BI-24E7D59F, Coordinated Workrooms plan Phase B).
//
// `deriveRoomCoordinator` promotes the single accountable PARTICIPANT, which
// works for a room somebody staffed. The standing rooms are created by derivation
// and staffed by nobody: all twelve on this install carry participantCount 0, so
// every one refused on missing_explicit_coordinator. The rung that resolves them
// is the work shape, which already names who answers for each stage.
//
// Pure module: no DB. The caller supplies each rung's input.

import type { WorkShapeStage } from "./work-shapes";

/** Which rung answered. Recorded so a derived owner is never mistaken for an
 *  appointed one — conformance admits an EXPLICIT overseer for autonomous
 *  execution, and a derived owner explains a room without qualifying it. */
export type RoomOwnerSource = "explicit" | "shape" | "archetype";

export type RoomOwner = {
  principalRef: string;
  source: RoomOwnerSource;
};

/** Just enough of a shape to resolve its driver; keeps this module free of the
 *  full definition and of the registry it lives in. */
export type RoomOwnerShape = {
  key: string;
  stages: ReadonlyArray<Pick<WorkShapeStage, "key" | "accountablePrincipalRef" | "advance">>;
};

export type RoomOwnerInputs = {
  /** A persisted coordinator assignment, when one exists. Wins outright. */
  explicitPrincipalRef: string | null;
  /** The room's work shape, when it claims one. */
  shape: RoomOwnerShape | null;
  /** The archetype's default owner for rooms of this kind, when declared. */
  archetypePrincipalRef: string | null;
};

/**
 * The principal who DRIVES the shape, as distinct from the one who approves it.
 *
 * Stages that advance by `governed-decision` are the approval stages; their
 * principal is the room's approver. Deriving that principal as coordinator would
 * trip `coordinator_approver_overlap` — swapping one refusal for another while
 * looking like progress — so they are excluded before the candidates are counted.
 *
 * Returns null when the executing stages name more than one principal. That is
 * not a tie to break: it is a shape that has not said who drives, and a wrong
 * derived owner is worse than none, because the room then looks owned and still
 * refuses.
 */
function resolveShapeDriver(shape: RoomOwnerShape): string | null {
  const drivers = new Set(
    shape.stages
      .filter((stage) => stage.advance.kind !== "governed-decision")
      .map((stage) => stage.accountablePrincipalRef)
      .filter((ref): ref is string => typeof ref === "string" && ref.length > 0),
  );
  return drivers.size === 1 ? [...drivers][0] : null;
}

/**
 * Resolve the room's owner by descending the ladder, or null when no rung
 * answers. Null is a reportable state (the unowned set), never a licence to
 * assign a plausible-looking coworker.
 */
export function resolveRoomOwner(inputs: RoomOwnerInputs): RoomOwner | null {
  if (inputs.explicitPrincipalRef) {
    return { principalRef: inputs.explicitPrincipalRef, source: "explicit" };
  }

  if (inputs.shape) {
    const driver = resolveShapeDriver(inputs.shape);
    if (driver) return { principalRef: driver, source: "shape" };
  }

  if (inputs.archetypePrincipalRef) {
    return { principalRef: inputs.archetypePrincipalRef, source: "archetype" };
  }

  return null;
}

/** Rooms the ladder could not answer for. The COO surface reports these rather
 *  than the platform inventing an owner for them. */
export function unownedRooms<T extends { inputs: RoomOwnerInputs }>(rooms: readonly T[]): T[] {
  return rooms.filter((room) => resolveRoomOwner(room.inputs) === null);
}

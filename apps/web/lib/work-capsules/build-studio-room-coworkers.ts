import { admitRoomAssistant, type RoomOwnershipDb } from "./room-ownership";

/**
 * The coworkers that act inside a Build Studio room on the build's behalf:
 * the phase guide that records research receipts, the orchestrator that saves
 * build evidence and advances phases, and the specialists it delegates to.
 *
 * A room that records participants narrows every coworker it does not list to
 * the read baseline (deriveRoomTurnAuthority, BI-F114354D). Build Studio rooms
 * recorded only their humans, so each of these coworkers was a non-member in
 * its own room and every lifecycle write was refused room-authority-denied
 * (BI-00588B51). Admission is explicit, as a contributor, and never re-admits
 * a coworker the owner removed.
 */
export const BUILD_STUDIO_ROOM_COWORKERS: readonly string[] = [
  "AGT-WS-BUILD",
  "AGT-ORCH-300",
  "AGT-BUILD-DA",
  "AGT-BUILD-SE",
  "AGT-BUILD-FE",
  "AGT-BUILD-QA",
];

export type BuildStudioRoomCoworkerDb = RoomOwnershipDb & {
  principalAlias: {
    findFirst(args: unknown): Promise<{ principalId: string } | null>;
  };
};

export type BuildStudioRoomCoworkerOutcome = {
  admitted: string[];
  alreadyPresent: string[];
  skipped: string[];
  /** Coworkers with no principal alias on this install — nothing to admit. */
  unresolved: string[];
};

export function hasBuildStudioRoomCoworkerDb(db: unknown): db is BuildStudioRoomCoworkerDb {
  const candidate = db as { principalAlias?: { findFirst?: unknown }; workroomParticipant?: { create?: unknown } } | null;
  return typeof candidate?.principalAlias?.findFirst === "function"
    && typeof candidate?.workroomParticipant?.create === "function";
}

/** Admit the Build Studio coworkers to a build's room. Idempotent. */
export async function admitBuildStudioRoomCoworkers(args: {
  db: BuildStudioRoomCoworkerDb;
  /** Workroom row id. */
  workroomId: string;
  coworkers?: readonly string[];
}): Promise<BuildStudioRoomCoworkerOutcome> {
  const outcome: BuildStudioRoomCoworkerOutcome = { admitted: [], alreadyPresent: [], skipped: [], unresolved: [] };
  for (const agentId of args.coworkers ?? BUILD_STUDIO_ROOM_COWORKERS) {
    const alias = await args.db.principalAlias.findFirst({
      where: { aliasType: "agent", aliasValue: agentId, issuer: "" },
      select: { principalId: true },
    });
    if (!alias) {
      outcome.unresolved.push(agentId);
      continue;
    }
    const admission = await admitRoomAssistant(args.db, args.workroomId, alias.principalId);
    if (admission.admitted) outcome.admitted.push(agentId);
    else if (admission.skipped) outcome.skipped.push(`${agentId}: ${admission.skipped}`);
    else outcome.alreadyPresent.push(agentId);
  }
  return outcome;
}

/** One sentence for the trail, or null when nothing changed. */
export function describeBuildStudioRoomCoworkers(outcome: BuildStudioRoomCoworkerOutcome): string | null {
  const parts: string[] = [];
  if (outcome.admitted.length) parts.push(`Admitted the Build Studio coworkers ${outcome.admitted.join(", ")} to the room.`);
  if (outcome.skipped.length) parts.push(...outcome.skipped);
  return parts.length ? parts.join(" ") : null;
}

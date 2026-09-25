// How long a Workroom has been held in the same place (BI-E8C78E80).
//
// The drive wrote one activity row every 15-minute tick even when nothing had
// changed: about 11,000 identical rows a day across 134 rooms on 2026-09-24.
// They filled each room's 25-row feed with six hours of one line, and they were
// also the only record of how long a room had been stuck, because the snapshot
// held just the latest tick. The snapshot now carries that record itself, so
// the room's trail gets a row only when the hold changes, the stall surfaces
// read the snapshot, and a room stuck for an hour reaches its owner once.

import { isRecord } from "@/lib/shared/coerce";

/** Consecutive stuck ticks before a pause is a stall: one hour at the 15-minute cadence. */
export const WORKROOM_DRIVE_STALL_TICKS = 4;

const STUCK_ACTIONS: ReadonlySet<string> = new Set(["pause", "escalate"]);

export type WorkroomDriveHold = {
  /** action|reason|stage|deviation codes: what a reader of the trail would call "the same". */
  key: string;
  /** When the room first reached this exact hold. */
  since: string;
  /** Ticks spent in this exact hold, this one included. */
  ticks: number;
  /** When the room last stopped advancing (pause or escalate, any reason); null while it advances. */
  stuckSince: string | null;
  /** Consecutive ticks without advancing, whatever the reason. */
  stuckTicks: number;
  /** When the owner was told about this stuck spell; one notice per spell. */
  notifiedAt: string | null;
};

export function isStuckDriveAction(action: string | null | undefined): boolean {
  return typeof action === "string" && STUCK_ACTIONS.has(action);
}

/** Deviation codes the conformance check recorded, sorted so order never reads as change. */
export function driveDeviationCodes(conformance: unknown): string[] {
  const raw = isRecord(conformance) ? conformance.deviations : null;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (isRecord(entry) ? entry.code : null))
    .filter((code): code is string => typeof code === "string" && code.length > 0)
    .sort();
}

export function driveHoldKey(input: {
  action: string; reason: string; stageKey: string | null; conformance: unknown;
}): string {
  return [input.action, input.reason, input.stageKey ?? "", ...driveDeviationCodes(input.conformance)].join("|");
}

export function readDriveHold(workspaceState: unknown): WorkroomDriveHold | null {
  const drive = isRecord(workspaceState) && isRecord(workspaceState.workroomDrive)
    ? workspaceState.workroomDrive : null;
  const hold = isRecord(drive?.hold) ? drive.hold : null;
  if (!hold || typeof hold.key !== "string" || typeof hold.since !== "string") return null;
  return {
    key: hold.key,
    since: hold.since,
    ticks: typeof hold.ticks === "number" && hold.ticks > 0 ? hold.ticks : 1,
    stuckSince: typeof hold.stuckSince === "string" ? hold.stuckSince : null,
    stuckTicks: typeof hold.stuckTicks === "number" && hold.stuckTicks > 0 ? hold.stuckTicks : 0,
    notifiedAt: typeof hold.notifiedAt === "string" ? hold.notifiedAt : null,
  };
}

/** The hold after this tick. Pure: the drive stores it in the snapshot it already writes. */
export function nextDriveHold(
  prior: WorkroomDriveHold | null,
  tick: { action: string; reason: string; stageKey: string | null; conformance: unknown },
  now: Date,
): WorkroomDriveHold {
  const key = driveHoldKey(tick);
  const at = now.toISOString();
  const same = prior?.key === key;
  const stuck = isStuckDriveAction(tick.action);
  const stillStuck = stuck && prior?.stuckSince != null;
  return {
    key,
    since: same && prior ? prior.since : at,
    ticks: same && prior ? prior.ticks + 1 : 1,
    stuckSince: stuck ? (stillStuck && prior ? prior.stuckSince : at) : null,
    stuckTicks: stuck ? (stillStuck && prior ? prior.stuckTicks + 1 : 1) : 0,
    notifiedAt: stillStuck && prior ? prior.notifiedAt : null,
  };
}

/** Whether this tick earns a row on the room's trail: a change of hold, or any dispatch. */
export function driveTickIsNews(prior: WorkroomDriveHold | null, next: WorkroomDriveHold, action: string): boolean {
  return action === "dispatch_agent" || prior?.key !== next.key;
}

/** A stuck spell that has lasted an hour and nobody has been told about yet. */
export function stallNoticeDue(hold: WorkroomDriveHold): boolean {
  return hold.stuckSince !== null && hold.stuckTicks >= WORKROOM_DRIVE_STALL_TICKS && hold.notifiedAt === null;
}

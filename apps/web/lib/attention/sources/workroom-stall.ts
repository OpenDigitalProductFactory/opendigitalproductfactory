// Workroom-stall source — a room whose drive keeps refusing reaches a human
// (BI-03E94B5B, Coordinated Workrooms plan Phase C).
//
// The drive already writes why it refused, on every tick, to
// workspaceState.workroomDrive and to a WorkroomActivity row. Until this source
// existed nothing read either, so a room could refuse hundreds of consecutive
// wakes in silence. Reading state that is already written is the whole slice —
// no new table, no new writer, no new tick.

import type { prisma } from "@dpf/db";

import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import { WORKROOM_DRIVE_STALL_TICKS } from "@/lib/work-management/workroom-drive-hold";
import { resolveRoomOwner, type RoomOwner } from "@/lib/work-management/room-owner-ladder";
import { STANDING_SHAPES } from "@/lib/work-management/standing-operations-shapes";
import { readDeclaredWorkShapeKey } from "@/lib/work-management/work-shapes";

import type { AttentionItem, AttentionPortfolio } from "../types";

type Db = typeof prisma;

/** Consecutive refusals before a pause is a stall. The drive cron is every 15
 *  minutes, so this is one hour — long enough that a room between cycles or
 *  behind a quiescent gate stays quiet, short enough that a genuinely stuck room
 *  is reported the same working day. One constant with the drive's own notice. */
export const STALL_TICK_THRESHOLD = WORKROOM_DRIVE_STALL_TICKS;

/** Drive actions that mean the room is NOT advancing.
 *
 *  `escalate` belongs here and its absence was a live defect (BI-2A5F1E77):
 *  escalate writes no pendingAttention, so watching only `pause` handed a room
 *  from a state this source covered into a state nothing read — it stopped being
 *  reported at the exact moment it started needing a human. An escalation with no
 *  channel is a stall with extra steps. */
const STUCK_ACTIONS: ReadonlySet<string> = new Set(["pause", "escalate"]);

/** How many rooms one load will project. Bounded like every other source. */
export const ROOM_STALL_SCAN_LIMIT = 100;

export type RoomStallRow = {
  capsuleId: string;
  title: string;
  portfolioRole: string | null;
  updatedAt: Date;
  /** workspaceState.workroomDrive — untyped JSON written by the queue function. */
  drive: unknown;
  consecutivePauses: number;
  /** When the room last stopped advancing, from the drive's hold (BI-E8C78E80). */
  stuckSince?: string | null;
  /** What the ownership ladder resolves for this room, when it resolves anything.
   *  A SUGGESTION only: it names who should be appointed, and never routes the
   *  item to them — conformance still requires an explicit appointment, and an
   *  item addressed to a derived owner would make the room look owned to the very
   *  surface reporting that it is not. */
  ladderOwner?: RoomOwner | null;
};

/** Portfolio role as stored on the Workroom → the cockpit's portfolio key. */
const PORTFOLIO_BY_ROLE: Record<string, AttentionPortfolio> = {
  foundational: "foundational",
  manufactureAndDeliver: "manufacturing-and-delivery",
  forEmployees: "for-employees",
  productsAndServicesSold: "products-and-services-sold",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Deviation codes the conformance checker recorded, if any are readable. */
function readDeviationCodes(drive: Record<string, unknown>): string[] {
  const conformance = asRecord(drive.conformance);
  const raw = conformance?.deviations;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => asRecord(entry)?.code)
    .filter((code): code is string => typeof code === "string" && code.length > 0);
}

function readOverseerPrincipalRef(drive: Record<string, unknown>): string | undefined {
  const ref = asRecord(drive.conformance)?.processOverseerPrincipalRef;
  return typeof ref === "string" && ref.length > 0 ? ref : undefined;
}

/**
 * Pure projection of one room's drive state into an attention item, or null when
 * the room is healthy. Null is the answer for the overwhelmingly common case; a
 * source that fires on advancing rooms is one operators learn to ignore.
 */
export function projectRoomStall(row: RoomStallRow): AttentionItem | null {
  const drive = asRecord(row.drive);
  if (!drive) return null;
  if (!STUCK_ACTIONS.has(drive.action as string)) return null;
  if (row.consecutivePauses < STALL_TICK_THRESHOLD) return null;

  const codes = readDeviationCodes(drive);
  const reason = typeof drive.reason === "string" ? drive.reason : "unknown";
  // The named deviations are the actionable part; the drive's own reason code is
  // the fallback when conformance recorded none (a budget or stop-condition halt).
  const why = codes.length > 0 ? codes.join(", ") : reason;

  // An unowned room must NOT be assigned to a principal — the missing principal
  // is the finding. It goes to the operator, who can appoint one.
  const overseer = readOverseerPrincipalRef(drive);

  // The room's address is composed, never hand-built: a path spelled out here is
  // a path nothing keeps honest, and the operator finds out by clicking (BI-6F2CC21B).
  const roomHref = `/workspace/cases/${encodeWorkCaseKey({
    sourceType: "work-capsule",
    sourceId: row.capsuleId,
  })}`;

  // Naming who should drive turns a diagnosis into a one-step instruction.
  const suggestion =
    row.ladderOwner === undefined
      ? ""
      : row.ladderOwner
        ? ` Its work shape says ${row.ladderOwner.principalRef} should drive it (resolved from the ${row.ladderOwner.source}) — appoint them to unblock it.`
        : " No owner can be derived from its shape or archetype, so someone must be named.";

  return {
    id: `workroom-stall:${row.capsuleId}`,
    source: "workroom-stall",
    title: `${row.title} — stalled`,
    context:
      `${row.title} (${row.capsuleId}) has refused ${row.consecutivePauses} consecutive wakes: ` +
      `${why}. It will keep refusing until this is resolved.${suggestion}`,
    decisionClass: { scorability: "unscorable" },
    riskClass: "read",
    triage: {
      timeToAct: "none",
      residueReason: "room-stalled",
      blastRadius: overseer
        ? "this room's outcome, and anything nested under it"
        : "this room's outcome — and it has no owner to escalate to",
      // Appointing an owner or clearing a stop condition is a judgment call about
      // who is accountable, not a one-tap acknowledgement.
      decideEffort: "judgment",
      irreversible: false,
    },
    // The age of the stall, not of the last tick: every tick bumps updatedAt, so
    // reading it made a room stuck for a week sort as minutes old.
    createdAtIso: row.stuckSince ?? row.updatedAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "Open room", href: roomHref }],
    deepLink: roomHref,
    audience: { operator: true, ...(overseer ? { assigneePrincipalId: overseer } : {}) },
    ...(row.portfolioRole && PORTFOLIO_BY_ROLE[row.portfolioRole]
      ? { portfolio: PORTFOLIO_BY_ROLE[row.portfolioRole] }
      : {}),
  };
}


/** What the ladder resolves for a room, from its shape. Explicit appointments are
 *  not consulted here: a room that HAS an explicit coordinator is not refusing on
 *  missing_explicit_coordinator, so it never reaches this projection unowned. */
function resolveLadderOwner(scopeClaims: unknown): RoomOwner | null {
  const key = readDeclaredWorkShapeKey(scopeClaims);
  const shape = key ? STANDING_SHAPES[key] : undefined;
  if (!shape) return null;
  return resolveRoomOwner({
    explicitPrincipalRef: null,
    shape: { key: shape.key, stages: shape.stages },
    archetypePrincipalRef: null,
  });
}

type StallScanRow = {
  capsuleId: string;
  title: string;
  portfolioRole: string | null;
  updatedAt: Date;
  drive: unknown;
  consecutivePauses: bigint | number;
  stuckSince: string | null;
  /** scopeClaims, from which the room's workShape ref is read. */
  scopeClaims: unknown;
};

/**
 * Rooms currently refusing, with the length of the current refusal streak.
 *
 * The streak is the drive's own count, `workroomDrive.hold.stuckTicks` in the
 * snapshot it writes every tick (BI-E8C78E80). It used to be counted from the
 * WorkroomActivity trail, which only worked because the drive wrote an
 * identical row every tick; the trail now gets a row only when the hold
 * changes, so counting rows would under-report every stuck room. The snapshot
 * resets the count when the room advances, so a room that recovered and stalled
 * again reports the NEW streak, not its lifetime total. One indexed read of
 * each room row; no scan of the activity history (BI-70B2ED84).
 */
export async function loadRoomStallRows(db: Db): Promise<RoomStallRow[]> {
  const rows = await db.$queryRaw<StallScanRow[]>`
    SELECT
      w."capsuleId"      AS "capsuleId",
      w."title"          AS "title",
      w."portfolioRole"::text AS "portfolioRole",
      w."updatedAt"      AS "updatedAt",
      w."workspaceState" -> 'workroomDrive' AS "drive",
      w."scopeClaims"    AS "scopeClaims",
      COALESCE((w."workspaceState" #>> '{workroomDrive,hold,stuckTicks}')::int, 0) AS "consecutivePauses",
      w."workspaceState" #>> '{workroomDrive,hold,stuckSince}' AS "stuckSince"
    FROM "WorkCapsule" w
    WHERE w."archivedAt" IS NULL
      AND w."status" NOT IN ('abandoned', 'archived', 'complete')
      AND w."workspaceState" #>> '{workroomDrive,action}' IN ('pause', 'escalate')
      AND COALESCE((w."workspaceState" #>> '{workroomDrive,hold,stuckTicks}')::int, 0) >= ${STALL_TICK_THRESHOLD}
    ORDER BY "consecutivePauses" DESC, w."updatedAt" ASC
    LIMIT ${ROOM_STALL_SCAN_LIMIT}
  `;
  return rows.map((r) => ({
    capsuleId: r.capsuleId,
    title: r.title,
    portfolioRole: r.portfolioRole,
    updatedAt: r.updatedAt,
    drive: r.drive,
    consecutivePauses: Number(r.consecutivePauses),
    stuckSince: r.stuckSince,
    ladderOwner: resolveLadderOwner(r.scopeClaims),
  }));
}

export async function loadWorkroomStallItems(db: Db): Promise<AttentionItem[]> {
  const rows = await loadRoomStallRows(db);
  return rows
    .map(projectRoomStall)
    .filter((item): item is AttentionItem => item !== null);
}

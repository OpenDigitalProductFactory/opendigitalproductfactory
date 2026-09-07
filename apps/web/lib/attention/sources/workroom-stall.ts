// Workroom-stall source — a room whose drive keeps refusing reaches a human
// (BI-03E94B5B, Coordinated Workrooms plan Phase C).
//
// The drive already writes why it refused, on every tick, to
// workspaceState.workroomDrive and to a WorkroomActivity row. Until this source
// existed nothing read either, so a room could refuse hundreds of consecutive
// wakes in silence. Reading state that is already written is the whole slice —
// no new table, no new writer, no new tick.

import type { prisma } from "@dpf/db";

import { resolveRoomOwner, type RoomOwner } from "@/lib/work-management/room-owner-ladder";
import { STANDING_SHAPES } from "@/lib/work-management/standing-operations-shapes";

import type { AttentionItem, AttentionPortfolio } from "../types";

type Db = typeof prisma;

/** Consecutive refusals before a pause is a stall. The drive cron is every 15
 *  minutes, so this is one hour — long enough that a room between cycles or
 *  behind a quiescent gate stays quiet, short enough that a genuinely stuck room
 *  is reported the same working day. */
export const STALL_TICK_THRESHOLD = 4;

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
    createdAtIso: row.updatedAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "Open room", href: `/ea/workrooms/${row.capsuleId}` }],
    deepLink: `/ea/workrooms/${row.capsuleId}`,
    audience: { operator: true, ...(overseer ? { assigneePrincipalId: overseer } : {}) },
    ...(row.portfolioRole && PORTFOLIO_BY_ROLE[row.portfolioRole]
      ? { portfolio: PORTFOLIO_BY_ROLE[row.portfolioRole] }
      : {}),
  };
}

/** The room's declared work shape key, e.g. "dependency-advisory-watch@1.0.0".
 *  scopeClaims is an untyped JSON array written by several writers; read it
 *  defensively rather than assuming a shape. */
function readWorkShapeKey(scopeClaims: unknown): string | null {
  if (!Array.isArray(scopeClaims)) return null;
  for (const claim of scopeClaims) {
    const ref = asRecord(claim)?.workShape;
    if (typeof ref === "string" && ref.length > 0) return ref.split("@")[0] ?? null;
  }
  return null;
}

/** What the ladder resolves for a room, from its shape. Explicit appointments are
 *  not consulted here: a room that HAS an explicit coordinator is not refusing on
 *  missing_explicit_coordinator, so it never reaches this projection unowned. */
function resolveLadderOwner(scopeClaims: unknown): RoomOwner | null {
  const key = readWorkShapeKey(scopeClaims);
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
  /** scopeClaims, from which the room's workShape ref is read. */
  scopeClaims: unknown;
};

/**
 * Rooms currently refusing, with the length of the current refusal streak.
 *
 * The streak is counted from the WorkroomActivity model — the drive's own
 * append-only trail — because workspaceState holds only the latest tick. Raw SQL
 * must use its PHYSICAL table name, "WorkCapsuleActivity" (@@map), exactly as
 * Workroom maps to "WorkCapsule"; the model name compiles fine and fails only at
 * runtime. Counting stops at
 * the most recent non-pause activity, so a room that recovered and stalled again
 * reports the NEW streak, not its lifetime total.
 */
export async function loadRoomStallRows(db: Db): Promise<RoomStallRow[]> {
  const rows = await db.$queryRaw<StallScanRow[]>`
    WITH drive_activity AS (
      SELECT
        a."workCapsuleId",
        a."recordedAt",
        a."payload" ->> 'action' AS action,
        ROW_NUMBER() OVER (PARTITION BY a."workCapsuleId" ORDER BY a."recordedAt" DESC) AS rn
      FROM "WorkCapsuleActivity" a
      WHERE a."kind" = 'workroom-drive'
    ),
    streak AS (
      SELECT
        d."workCapsuleId",
        COUNT(*) AS consecutive_pauses
      FROM drive_activity d
      WHERE d.rn <= COALESCE(
        (
          SELECT MIN(n.rn) - 1
          FROM drive_activity n
          WHERE n."workCapsuleId" = d."workCapsuleId"
            AND (n.action IS NULL OR n.action NOT IN ('pause', 'escalate'))
        ),
        d.rn
      )
      AND d.action IN ('pause', 'escalate')
      GROUP BY d."workCapsuleId"
    )
    SELECT
      w."capsuleId"      AS "capsuleId",
      w."title"          AS "title",
      w."portfolioRole"::text AS "portfolioRole",
      w."updatedAt"      AS "updatedAt",
      w."workspaceState" -> 'workroomDrive' AS "drive",
      w."scopeClaims"    AS "scopeClaims",
      s.consecutive_pauses AS "consecutivePauses"
    FROM "WorkCapsule" w
    JOIN streak s ON s."workCapsuleId" = w."id"
    WHERE w."archivedAt" IS NULL
      AND w."status" NOT IN ('abandoned', 'archived', 'complete')
      AND s.consecutive_pauses >= ${STALL_TICK_THRESHOLD}
    ORDER BY s.consecutive_pauses DESC, w."updatedAt" ASC
    LIMIT ${ROOM_STALL_SCAN_LIMIT}
  `;
  return rows.map((r) => ({
    capsuleId: r.capsuleId,
    title: r.title,
    portfolioRole: r.portfolioRole,
    updatedAt: r.updatedAt,
    drive: r.drive,
    consecutivePauses: Number(r.consecutivePauses),
    ladderOwner: resolveLadderOwner(r.scopeClaims),
  }));
}

export async function loadWorkroomStallItems(db: Db): Promise<AttentionItem[]> {
  const rows = await loadRoomStallRows(db);
  return rows
    .map(projectRoomStall)
    .filter((item): item is AttentionItem => item !== null);
}

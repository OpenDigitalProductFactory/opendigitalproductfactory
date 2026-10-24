/**
 * Bounded portfolio activity projection (PWA-02, PWA-06, PWA-07).
 *
 * Turns rooms already placed on the portfolio axis into compact branch rows that
 * say what is actually happening, without fanning out to every room or inventing
 * certainty the evidence does not support.
 *
 * Three rules shape it.
 *
 * A count is not an answer. "12 rooms" tells an operator nothing they can act
 * on, so every branch carries a bounded set of concrete statements — what is
 * being done, or what is waiting — chosen attention-first.
 *
 * A symbol must be earned. Motion means fresh evidence of execution right now.
 * A held lease, a claimed shape or a completed task are not that: a room whose
 * last evidence is an hour old is stale, and a room with no evidence at all is
 * unknown. Both say so rather than spinning.
 *
 * Reads are bounded and ordered deterministically, so paging is stable and a
 * truncated page is labelled partial instead of being presented as a total.
 *
 * Pure and DB-free on purpose, following work-item-presence.ts: the server
 * action reads rows and applies authorization, then calls this. Authorization
 * must happen BEFORE projection, so hidden work cannot leak through a count or a
 * representative summary.
 */

import type { WorkCapsulePortfolioRole } from "@/lib/work-capsules";

/** Evidence is fresh enough to claim execution is happening now. */
export const EXECUTION_FRESH_WINDOW_MS = 120_000;

/** Beyond this, evidence is old enough that the room is reported stale. */
export const EVIDENCE_STALE_WINDOW_MS = 900_000;

/**
 * What a row's symbol is allowed to say. `executing` is the only animated state
 * and the only one that requires fresh evidence.
 */
export const ACTIVITY_SIGNAL_STATES = [
  "executing",
  "waiting-on-person",
  "queued",
  "blocked",
  "completed",
  "stale",
  "unknown",
] as const;

export type ActivitySignalState = (typeof ACTIVITY_SIGNAL_STATES)[number];

export type ActivitySignal = {
  state: ActivitySignalState;
  /** Only ever true for `executing`; drives motion, and reduced-motion still overrides in the UI. */
  animate: boolean;
  /** Accessible name; colour and motion never carry meaning alone. */
  label: string;
  /** When the deciding evidence was observed, or null when there is none. */
  evidenceAt: string | null;
};

export type RoomActivityInput = {
  roomId: string;
  title: string;
  portfolioRole: WorkCapsulePortfolioRole | null;
  /** Deepest taxonomy node this room sits under, for branch grouping. */
  branchId: string;
  /** Canonical destination; every rendered row must have one (PWA-02). */
  href: string;
  status: string;
  /** Latest concrete statement of what is happening, from source evidence. */
  latestAction: string | null;
  /** What is stopping it, when something is. */
  blocker: string | null;
  /** When the latest source evidence was observed. Null means no evidence. */
  evidenceAt: Date | string | null;
  /** True only when a governed receipt says the work is verified complete. */
  verifiedComplete?: boolean;
  /** True when the room is waiting on a human decision. */
  awaitingPerson?: boolean;
  /** True when the room is queued but not started. */
  queued?: boolean;
};

const SIGNAL_LABELS: Record<ActivitySignalState, string> = {
  executing: "Working now",
  "waiting-on-person": "Waiting for a person",
  queued: "Queued",
  blocked: "Blocked",
  completed: "Verified complete",
  stale: "No recent signal",
  unknown: "Unknown",
};

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function iso(value: Date | string | null | undefined): string | null {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * Decide what a room's symbol may claim.
 *
 * Order matters: a verified receipt and a blocker are statements about the work
 * that stay true regardless of how recently anything was observed. Only after
 * those does freshness decide between executing, stale and unknown.
 */
export function deriveActivitySignal(room: RoomActivityInput, now: Date | number): ActivitySignal {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const evidenceMs = toMs(room.evidenceAt);
  const evidenceAt = iso(room.evidenceAt);
  const signal = (state: ActivitySignalState): ActivitySignal => ({
    state,
    animate: state === "executing",
    label: SIGNAL_LABELS[state],
    evidenceAt,
  });

  if (room.verifiedComplete) return signal("completed");
  if (room.blocker) return signal("blocked");
  if (room.awaitingPerson) return signal("waiting-on-person");
  if (room.queued) return signal("queued");
  // No evidence is not the same as old evidence, and neither is execution.
  if (evidenceMs === null) return signal("unknown");
  const age = nowMs - evidenceMs;
  if (age <= EXECUTION_FRESH_WINDOW_MS) return signal("executing");
  if (age >= EVIDENCE_STALE_WINDOW_MS) return signal("stale");
  return signal("queued");
}

/** Attention first, then live execution, then everything else. */
const SIGNAL_PRIORITY: Record<ActivitySignalState, number> = {
  blocked: 0,
  "waiting-on-person": 1,
  executing: 2,
  queued: 3,
  stale: 4,
  unknown: 5,
  completed: 6,
};

export type RepresentativeActivity = {
  roomId: string;
  /** A concrete statement, never a bare count. */
  statement: string;
  href: string;
  signal: ActivitySignal;
};

function statementFor(room: RoomActivityInput, signal: ActivitySignal): string {
  // Every statement names its room. Measured at 1,001 rooms, blockers and
  // actions are frequently identical across rooms — several rooms blocked on
  // the same generic liveness reason rendered as three indistinguishable
  // "Blocked: ..." lines, so the operator could not tell which room each line
  // was about or that they were different rooms at all. The room is the thing
  // being acted on; it belongs in the sentence.
  if (room.blocker) return `${room.title} · blocked: ${room.blocker}`;
  if (room.latestAction) return `${room.title} · ${room.latestAction}`;
  // No concrete action recorded — say that, rather than manufacturing one.
  return `${room.title} · ${signal.label.toLocaleLowerCase("en-US")}`;
}

/**
 * Choose the few activities that represent a collapsed branch.
 *
 * Unresolved attention first, then recent execution, then verified completion.
 * Ties break on the room id so the choice is deterministic across reads: a
 * branch must not reshuffle its summary just because two rooms are equally
 * urgent.
 */
export function selectRepresentativeActivities(
  rooms: readonly RoomActivityInput[],
  now: Date | number,
  limit = 3,
): RepresentativeActivity[] {
  if (limit <= 0) return [];
  const scored = rooms.map((room) => {
    const signal = deriveActivitySignal(room, now);
    return { room, signal, priority: SIGNAL_PRIORITY[signal.state], at: toMs(room.evidenceAt) ?? -1 };
  });
  scored.sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority
      : a.at !== b.at ? b.at - a.at
        : a.room.roomId.localeCompare(b.room.roomId, "en-US"),
  );
  return scored.slice(0, limit).map(({ room, signal }) => ({
    roomId: room.roomId,
    statement: statementFor(room, signal),
    href: room.href,
    signal,
  }));
}

/**
 * How many rooms one expanded branch discloses at most.
 *
 * Expansion has to stay bounded independently of how many rooms exist: the
 * whole point of the tree is that a portfolio with a thousand rooms is still
 * readable. Beyond this, the branch says how many it is not showing.
 */
export const DEFAULT_DISCLOSURE_LIMIT = 25;

export type BranchRow = {
  branchId: string;
  portfolioRole: WorkCapsulePortfolioRole | null;
  /** Unique rooms in this branch on this page. Rooms are counted once. */
  roomCount: number;
  /** Rooms needing attention: blocked or waiting on a person. */
  attentionCount: number;
  representative: RepresentativeActivity[];
  /**
   * The rooms a branch discloses when it is expanded, in the same order the
   * summary uses. Bounded: a portfolio holding a thousand rooms must not empty
   * all of them into the document the moment someone opens the chevron, so this
   * carries at most `disclosureLimit` and reports the remainder instead.
   */
  disclosed: RepresentativeActivity[];
  /** True when the branch holds more rooms than `disclosed` carries. */
  disclosedTruncated: boolean;
  /** Rooms in this branch beyond the disclosed bound. Never negative. */
  undisclosedCount: number;
};

export type PortfolioActivityPage = {
  rows: BranchRow[];
  /** Opaque cursor for the next page, or null at the end. */
  nextCursor: string | null;
  /**
   * True when more rooms exist beyond this page. A partial page is never
   * presented as an estate total.
   */
  partial: boolean;
  /** Unique rooms represented on this page. */
  observedRooms: number;
};

/**
 * Project one bounded page of branch rows.
 *
 * Ordering is by branch id, and rooms are deduplicated by id before counting, so
 * a room reachable through two links is counted once. The cursor is the last
 * branch id emitted, which keeps paging stable under insertion.
 */
export function projectPortfolioActivityPage(input: {
  rooms: readonly RoomActivityInput[];
  now: Date | number;
  /** Max branches per page (PWA-07 targets 50 room rows per page). */
  pageSize?: number;
  /** Max representative activities per collapsed branch. */
  representativeLimit?: number;
  /** Max rooms an expanded branch discloses before it reports a remainder. */
  disclosureLimit?: number;
  /** Resume after this branch id. */
  cursor?: string | null;
}): PortfolioActivityPage {
  const pageSize = Math.max(1, input.pageSize ?? 50);
  const representativeLimit = input.representativeLimit ?? 3;
  const disclosureLimit = input.disclosureLimit ?? DEFAULT_DISCLOSURE_LIMIT;

  const seen = new Set<string>();
  const byBranch = new Map<string, RoomActivityInput[]>();
  for (const room of input.rooms) {
    if (seen.has(room.roomId)) continue;
    seen.add(room.roomId);
    const bucket = byBranch.get(room.branchId);
    if (bucket) bucket.push(room);
    else byBranch.set(room.branchId, [room]);
  }

  const orderedBranchIds = [...byBranch.keys()].sort((a, b) => a.localeCompare(b, "en-US"));
  const startIndex = input.cursor
    ? orderedBranchIds.findIndex((id) => id === input.cursor) + 1
    : 0;
  const slice = orderedBranchIds.slice(startIndex, startIndex + pageSize);
  const partial = startIndex + slice.length < orderedBranchIds.length;

  const rows = slice.map((branchId) => {
    const rooms = byBranch.get(branchId)!;
    const attentionCount = rooms.filter((room) => {
      const state = deriveActivitySignal(room, input.now).state;
      return state === "blocked" || state === "waiting-on-person";
    }).length;
    const disclosed = selectRepresentativeActivities(rooms, input.now, disclosureLimit);

    return {
      branchId,
      portfolioRole: rooms[0]!.portfolioRole,
      roomCount: rooms.length,
      attentionCount,
      representative: selectRepresentativeActivities(rooms, input.now, representativeLimit),
      disclosed,
      disclosedTruncated: rooms.length > disclosed.length,
      undisclosedCount: Math.max(0, rooms.length - disclosed.length),
    };
  });

  return {
    rows,
    nextCursor: partial ? slice[slice.length - 1] ?? null : null,
    partial,
    observedRooms: rows.reduce((total, row) => total + row.roomCount, 0),
  };
}

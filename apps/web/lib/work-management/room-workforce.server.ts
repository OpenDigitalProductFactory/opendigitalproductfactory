/**
 * The room inspector's read side (PWA-03, PWA-04, PWA-06) — D5.
 *
 * The three projections this composes already existed and were merged with
 * unit coverage, but nothing rendered them: a room's effective human
 * accountability and its named workers were computable and invisible. This is
 * the loader that makes them reachable from a room, and it is deliberately thin
 * — it reads rows and hands them to the pure resolvers, which own every
 * judgement about inheritance, delegation and truthfulness.
 *
 * Two rules the reads follow, because getting them wrong is how this surface
 * would start lying:
 *
 * Accountability is walked, never guessed. The ancestor closure is bounded and
 * followed only along responsibility relations; the resolver decides whether the
 * answer is explicit, inherited, or the organization's recorded owner, and says
 * `setup-required` when nobody recorded one. No fallback to a creator, a
 * requester or a lease holder.
 *
 * Worker liveness is not invented. A participant row records who is in a room
 * and what they said they are doing; it does not record a progress observation.
 * So every worker is handed to the rollup with `state: "unknown"` and no
 * progress timestamp, and the panel says the state is not recorded rather than
 * deriving "working" from a row's `updatedAt` — which changes for any edit and
 * is not evidence that anyone is working.
 */

import {
  RESPONSIBILITY_RELATION_KINDS,
  resolveEffectiveHumanAccountability,
  type AccountabilityEdge,
  type AccountabilityRoomInput,
  type EffectiveHumanAccountability,
} from "./human-accountability";
import { readOrganizationTopAccountablePrincipalId } from "./organization-accountable.server";
import {
  groupDelegatedWorkers,
  rollUpNamedWorkers,
  selectWorkerPage,
  type WorkerGroup,
  type WorkerSessionInput,
} from "./worker-rollup";

/**
 * Prisma identifier <-> stored value for the responsibility relations.
 *
 * `WorkroomRelationKind` stores `spawned-from` but the generated client calls it
 * `spawned_from`, so a query written in domain values is rejected and a row read
 * back in client identifiers fails `isResponsibilityRelation`. Both directions
 * are translated here, at the one boundary that touches the client, rather than
 * letting either spelling leak into the resolver.
 */
const RELATION_CLIENT_BY_VALUE: Record<string, string> = {
  contains: "contains",
  "spawned-from": "spawned_from",
};
const RELATION_VALUE_BY_CLIENT: Record<string, string> = Object.fromEntries(
  Object.entries(RELATION_CLIENT_BY_VALUE).map(([value, client]) => [client, value]),
);

/** How far up the responsibility graph one read will walk. */
export const ACCOUNTABILITY_WALK_MAX_DEPTH = 10;

/** Workers listed on one page of the inspector. */
export const ROOM_WORKER_PAGE_SIZE = 20;

export type RoomWorkforceDb = {
  workroomRelation: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
  workroomParticipant: { findMany(args: unknown): Promise<Array<Record<string, unknown>>> };
  organization: { findFirst(args: unknown): Promise<{ topAccountablePrincipalId: string | null } | null> };
};

export type RoomWorkforce = {
  accountability: EffectiveHumanAccountability;
  /** Display name for the accountable principal, when one resolved and is known. */
  accountableDisplayName: string | null;
  groups: WorkerGroup[];
  /** Workers matching before paging, so the panel can say "12 of 100". */
  matched: number;
  /** True when more workers exist than this page carries. */
  partial: boolean;
};

function displayNameOf(principal: Record<string, unknown> | null | undefined): string | null {
  if (!principal) return null;
  const name = principal["displayName"];
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/**
 * Walk up the responsibility graph from one room, bounded.
 *
 * Only `contains` and `spawned-from` carry responsibility; every other relation
 * kind is a link between rooms that does not delegate accountability, and
 * following one would inherit an owner from a room that never owned this work.
 */
async function loadAncestorClosure(
  db: RoomWorkforceDb,
  workroomId: string,
): Promise<{ roomIds: string[]; edges: AccountabilityEdge[] }> {
  const roomIds = new Set<string>([workroomId]);
  const edges: AccountabilityEdge[] = [];
  let frontier = [workroomId];

  for (let depth = 0; depth < ACCOUNTABILITY_WALK_MAX_DEPTH && frontier.length > 0; depth += 1) {
    const rows = await db.workroomRelation.findMany({
      where: {
        toWorkroomId: { in: frontier },
        relation: { in: RESPONSIBILITY_RELATION_KINDS.map((kind) => RELATION_CLIENT_BY_VALUE[kind]!) },
      },
      select: { fromWorkroomId: true, toWorkroomId: true, relation: true },
    });
    const next: string[] = [];
    for (const row of rows) {
      const from = String(row["fromWorkroomId"]);
      const to = String(row["toWorkroomId"]);
      const raw = String(row["relation"]);
      edges.push({
        fromWorkroomId: from,
        toWorkroomId: to,
        relation: RELATION_VALUE_BY_CLIENT[raw] ?? raw,
      });
      // A cycle stops the walk here; the resolver reports it rather than looping.
      if (!roomIds.has(from)) {
        roomIds.add(from);
        next.push(from);
      }
    }
    frontier = next;
  }

  return { roomIds: [...roomIds], edges };
}

/**
 * Load one room's effective human accountability and its named workers.
 *
 * `query` filters the roster by worker name or current task, which is how an
 * operator finds one worker among a hundred.
 */
export async function loadRoomWorkforce(
  db: RoomWorkforceDb,
  input: { workroomId: string; organizationId?: string; query?: string | null; now?: Date },
): Promise<RoomWorkforce> {
  const { roomIds, edges } = await loadAncestorClosure(db, input.workroomId);

  const participantRows = await db.workroomParticipant.findMany({
    where: { workroomId: { in: roomIds }, lifecycle: "active" },
    select: {
      workroomId: true,
      principalId: true,
      roles: true,
      currentWorkSummary: true,
      principal: { select: { displayName: true } },
    },
  });

  const rooms: AccountabilityRoomInput[] = roomIds.map((roomId) => ({
    workroomId: roomId,
    accountablePrincipalIds: participantRows
      .filter((row) => row["workroomId"] === roomId && asRoles(row["roles"]).includes("accountable"))
      .map((row) => String(row["principalId"])),
  }));

  const accountability = resolveEffectiveHumanAccountability({
    workroomId: input.workroomId,
    rooms,
    edges,
    organizationTopAccountablePrincipalId: await readOrganizationTopAccountablePrincipalId(
      db,
      input.organizationId,
    ),
  });

  // The roster is this room's own participants. An ancestor's participants are
  // accountable for it, not working in it.
  const sessions: WorkerSessionInput[] = participantRows
    .filter((row) => row["workroomId"] === input.workroomId)
    .map((row) => {
      const principal = row["principal"] as Record<string, unknown> | null;
      const summary = row["currentWorkSummary"];
      return {
        workerId: String(row["principalId"]),
        displayName: displayNameOf(principal) ?? String(row["principalId"]),
        executorKind: "portal",
        // Not recorded per participant, so not claimed. See the header note.
        state: "unknown" as const,
        currentTask: typeof summary === "string" && summary.trim() ? summary.trim() : null,
        lastProgressAt: null,
        // Delegation parentage is not persisted on a participant row, so it is
        // left absent and the rollup keeps it `unknown` rather than inferring a
        // chain of command from co-membership.
      };
    });

  const workers = rollUpNamedWorkers(sessions, input.now ?? new Date());
  const page = selectWorkerPage({ workers, pageSize: ROOM_WORKER_PAGE_SIZE, query: input.query ?? null });

  const accountableDisplayName =
    accountability.state === "resolved"
      ? displayNameOf(
          participantRows.find((row) => row["principalId"] === accountability.principalId)?.[
            "principal"
          ] as Record<string, unknown> | null,
        )
      : null;

  return {
    accountability,
    accountableDisplayName,
    groups: groupDelegatedWorkers(page.workers),
    matched: page.matched,
    partial: page.partial,
  };
}

function asRoles(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

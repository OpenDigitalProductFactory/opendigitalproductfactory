import {
  WORK_CAPSULE_PORTFOLIO_ROLES,
  WORK_CAPSULE_STATUSES,
  type WorkCapsulePortfolioRole,
} from "@/lib/work-capsules";
import { portfolioRoleLabel } from "@/lib/work-capsules/work-capsule-presenter";
import { TERMINAL_CAPSULE_STATUSES } from "@/lib/work-capsules/work-capsule-branch-identity";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import type { Prisma, PrismaClient } from "@dpf/db";
import { projectStoredWorkroomDriveObservation } from "@/lib/work-management/workroom-drive-state";
import { loadRoomAccountabilityBatch, type RoomWorkforceDb } from "@/lib/work-management/room-workforce.server";
import { isRecord } from "@/lib/shared/coerce";

type ArchitectureDb = {
  valueStreamTeam: { findMany(args: unknown): Promise<any[]> };
};

export type InitiativeOperation = {
  id: string; title: string; description: string | null; scopeKind: string | null;
  storedRefs: string[]; operation: string; openRooms: number;
};

const INITIATIVE_FIELDS = { id: true, epicId: true, title: true, description: true, scopeKind: true } as const;
const initiativeRefs = (epic: { id: string; epicId: string }) => [...new Set([epic.epicId, epic.id])].sort();

/** Resolve selection independently of the inventory page; a missing identity never broadens the filter. */
export async function loadInitiativeOperation(db: { epic: Pick<PrismaClient["epic"], "findUnique"> }, id: string) {
  const epic = await db.epic.findUnique({ where: { epicId: id }, select: { id: true, epicId: true, title: true } }).catch(() => null);
  return epic ? { id: epic.epicId, title: epic.title, storedRefs: initiativeRefs(epic) } : null;
}

/** Existing initiative membership is an operation context, never a value-stream assignment. */
export async function loadWorkroomInitiatives(db: {
  workroom: Pick<PrismaClient["workroom"], "groupBy">;
  epic: Pick<PrismaClient["epic"], "findMany">;
}, now = new Date(), search = ""): Promise<{
  initiatives: InitiativeOperation[]; readAt: string; truncated: boolean; partial: boolean; unresolvedRooms: number | null;
}> {
  try {
    const query = search.trim().slice(0, 200);
    const matching = query ? await db.epic.findMany({
      where: { OR: [{ title: { contains: query, mode: "insensitive" } }, { epicId: { contains: query, mode: "insensitive" } }] },
      select: INITIATIVE_FIELDS, orderBy: { epicId: "asc" }, take: 201,
    }) : null;
    const groups = await db.workroom.groupBy({ by: ["epicId"],
      where: { archivedAt: null, status: { notIn: TERMINAL_CAPSULE_STATUSES },
        epicId: matching ? { in: matching.slice(0, 200).flatMap(initiativeRefs) } : { not: null } },
      _count: { _all: true }, orderBy: { epicId: "asc" }, take: 201,
    });
    const page = groups.slice(0, 200);
    const refs = page.flatMap(row => row.epicId ? [row.epicId] : []);
    const epics = matching?.slice(0, 200) ?? (refs.length ? await db.epic.findMany({
      where: { OR: [{ id: { in: refs } }, { epicId: { in: refs } }] },
      select: INITIATIVE_FIELDS,
    }) : []);
    const byReference = new Map<string, typeof epics>();
    for (const epic of epics) for (const ref of initiativeRefs(epic)) {
      const matches = byReference.get(ref) ?? [];
      matches.push(epic);
      byReference.set(ref, matches);
    }
    const initiatives = new Map<string, InitiativeOperation>();
    let unresolvedRooms = 0;
    for (const group of page) {
      const matches = byReference.get(group.epicId ?? "") ?? [];
      if (matches.length !== 1) { unresolvedRooms += group._count._all; continue; }
      const epic = matches[0]!;
      const existing = initiatives.get(epic.epicId);
      if (existing) existing.openRooms += group._count._all;
      else initiatives.set(epic.epicId, { id: epic.epicId, title: epic.title,
        description: epic.description, scopeKind: epic.scopeKind,
        storedRefs: initiativeRefs(epic), operation: `initiative:${epic.epicId}`,
        openRooms: group._count._all,
      });
    }
    return { initiatives: [...initiatives.values()].sort((a, b) => a.id.localeCompare(b.id)),
      readAt: now.toISOString(), truncated: groups.length > 200 || (matching?.length ?? 0) > 200, partial: false, unresolvedRooms };
  } catch {
    return { initiatives: [], readAt: now.toISOString(), truncated: false, partial: true, unresolvedRooms: null };
  }
}

/** A bounded observation of actual rooms; assignment never implies accountability. */
export async function loadWorkroomCoordination(
  db: { workroom: Pick<PrismaClient["workroom"], "findMany"> } & Partial<RoomWorkforceDb>,
  now = new Date(),
    filter: { teamId?: string | null; initiative?: { id: string; storedRefs: string[] }; query?: string; status?: string; after?: string; initiativeQuery?: string } = {},
) {
  const query = filter.query?.trim().slice(0, 200) ?? "";
  const after = filter.after?.trim().slice(0, 100) ?? "";
  const status = WORK_CAPSULE_STATUSES.find((candidate) => candidate === filter.status
    && !TERMINAL_CAPSULE_STATUSES.includes(candidate));
  const conditions: Prisma.WorkroomWhereInput[] = [];
  if (filter.teamId === null) conditions.push({ OR: [{ workItem: { is: null } }, { workItem: { is: { teamId: null } } }] });
  if (query) conditions.push({ OR: [{ title: { contains: query, mode: "insensitive" } }, { capsuleId: { contains: query, mode: "insensitive" } }] });
  const rows = await db.workroom.findMany({
    where: { archivedAt: null, status: status ?? { notIn: TERMINAL_CAPSULE_STATUSES },
      ...(filter.initiative ? { epicId: { in: filter.initiative.storedRefs } } : {}),
      ...(typeof filter.teamId === "string" ? { workItem: { is: { teamId: filter.teamId } } } : {}),
      ...(conditions.length ? { AND: conditions } : {}),
      ...(after ? { capsuleId: { gt: after } } : {}),
    },
    orderBy: { capsuleId: "asc" }, take: 201,
    select: { id: true, capsuleId: true, title: true, status: true, workspaceState: true, epicId: true,
      workItem: { select: { teamId: true, parentItemId: true, assignedToUserId: true, assignedToAgentId: true } },
    },
  });
  const ids = rows.slice(0, 200).map(row => row.id);
  const [accountability, relations] = await Promise.all([
    db.workroomRelation && db.workroomParticipant && db.organization
      ? loadRoomAccountabilityBatch(db as RoomWorkforceDb, ids).catch(() => null) : null,
    db.workroomRelation && ids.length ? db.workroomRelation.findMany({
      where: { OR: [{ fromWorkroomId: { in: ids } }, { toWorkroomId: { in: ids } }] },
      orderBy: { id: "asc" }, take: 1001,
      select: { id: true, fromWorkroomId: true, toWorkroomId: true, relation: true,
        fromWorkroom: { select: { capsuleId: true, title: true } },
        toWorkroom: { select: { capsuleId: true, title: true } } },
    }).catch(() => null) : ids.length ? null : [],
  ]);
  return {
    readAt: now.toISOString(), truncated: rows.length > 200,
    contextPartial: ids.length > 0 && (!accountability || !relations || relations.length > 1000),
    nextCursor: rows.length > 200 ? rows[199]!.capsuleId : null,
    rooms: rows.slice(0, 200).map((row) => {
      const teamId = row.workItem?.teamId ?? null;
      const caseKey = encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: row.capsuleId });
      const params = new URLSearchParams({ operation: filter.initiative ? `initiative:${filter.initiative.id}`
        : filter.teamId === undefined ? "all" : filter.teamId ?? "unmapped" });
      if (query) params.set("coordinationQuery", query);
      if (status) params.set("coordinationStatus", status);
      if (after) params.set("coordinationAfter", after);
      if (filter.initiativeQuery) params.set("initiativeQuery", filter.initiativeQuery.trim().slice(0, 200));
      const owner = accountability?.get(row.id);
      const relationships = (relations ?? []).slice(0, 1000).flatMap(edge => {
        const outgoing = edge.fromWorkroomId === row.id;
        if (!outgoing && edge.toWorkroomId !== row.id) return [];
        const peer = outgoing ? edge.toWorkroom : edge.fromWorkroom;
        if (!isRecord(peer) || typeof peer.capsuleId !== "string" || typeof peer.title !== "string") return [];
        return [{ id: String(edge.id), relation: String(edge.relation).replaceAll("_", "-"),
          direction: outgoing ? "outgoing" as const : "incoming" as const,
          roomId: peer.capsuleId, title: peer.title,
          href: `/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: peer.capsuleId })}?${params}` }];
      });
      return {
        roomId: row.capsuleId, title: row.title, status: row.status, teamId, initiativeRef: row.epicId ?? null,
        accountability: owner?.accountability ?? null,
        accountableName: owner?.accountableDisplayName ?? (owner?.accountability.state === "resolved" ? owner.accountability.principalId : null),
        relationships,
        parentItemId: row.workItem?.parentItemId ?? null,
        assignedActorRef: row.workItem?.assignedToUserId ?? row.workItem?.assignedToAgentId ?? null,
        waitReason: projectStoredWorkroomDriveObservation(row.workspaceState).attentionReason,
        href: `/workspace/cases/${caseKey}?${params}`,
      };
    }),
  };
}

export type WorkroomDefinition = {
  id: string;
  name: string;
  valueStream: string;
  shape: string;
  coordinationPattern: unknown;
  isActive: boolean;
  participants: Array<{ roleName: string; workerType: string; modelTier: string | null }>;
  triggers: Array<{ triggerPoint: string; requiredRole: string; escalationTimeoutMinutes: number }>;
  queues: Array<{ queueId: string; name: string; queueType: string; isActive: boolean }>;
  instanceCount: number;
  eaProcessId: string | null;
  eaViewId: string | null;
  placement: PortfolioPlacement;
};

/**
 * How a team's portfolio placement was decided. `unresolved` is a first-class
 * outcome: a team nobody has classified is reported as such, never folded into
 * a real portfolio. Reading a placement without its source cannot distinguish a
 * decided classification from a coincidental string match, which is exactly the
 * ambiguity that made the previous Foundational fallback untrustworthy.
 */
export type PortfolioPlacementSource =
  | "coordination-pattern"
  | "portfolio-slug"
  | "portfolio-name"
  | "unresolved";

export type PortfolioPlacement =
  | { role: WorkCapsulePortfolioRole; source: Exclude<PortfolioPlacementSource, "unresolved"> }
  | { role: null; source: "unresolved"; reason: string };

export type WorkroomPortfolioBand = {
  role: WorkCapsulePortfolioRole;
  label: string;
  definitions: WorkroomDefinition[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const PORTFOLIO_ALIASES: Record<string, WorkCapsulePortfolioRole> = {
  foundational: "foundational",
  foundation: "foundational",
  manufactureanddeliver: "manufactureAndDeliver",
  manufacturinganddelivery: "manufactureAndDeliver",
  operations: "manufactureAndDeliver",
  foremployees: "forEmployees",
  workforce: "forEmployees",
  productsandservicessold: "productsAndServicesSold",
  goodsandservicesforsale: "productsAndServicesSold",
};

function normalizePortfolioKey(value: unknown): string {
  return String(value ?? "").replaceAll(/[^a-z]/gi, "").toLocaleLowerCase("en-US");
}

/**
 * Resolve a team's portfolio placement from its authoritative source, and say
 * which source decided it.
 *
 * Order is authority order: an explicit `coordinationPattern.portfolioRole` is a
 * recorded decision and wins; the portfolio slug and then its display name are
 * weaker derivations and are reported as such. When none of them resolves, the
 * result is `unresolved` with a reason. It is deliberately not defaulted to
 * Foundational — an unclassified team reported as Foundational is indistinguishable
 * from a team genuinely in that portfolio, and the larger the unclassified set the
 * more authoritative that wrong answer looks.
 */
export function resolvePortfolioPlacement(team: {
  coordinationPattern?: unknown;
  portfolio?: { slug?: string | null; name?: string | null } | null;
}): PortfolioPlacement {
  const explicit = asRecord(team.coordinationPattern).portfolioRole;
  if (typeof explicit === "string" && WORK_CAPSULE_PORTFOLIO_ROLES.includes(explicit as WorkCapsulePortfolioRole)) {
    return { role: explicit as WorkCapsulePortfolioRole, source: "coordination-pattern" };
  }
  const slugRole = PORTFOLIO_ALIASES[normalizePortfolioKey(team.portfolio?.slug)];
  if (slugRole) return { role: slugRole, source: "portfolio-slug" };
  const nameRole = PORTFOLIO_ALIASES[normalizePortfolioKey(team.portfolio?.name)];
  if (nameRole) return { role: nameRole, source: "portfolio-name" };
  const described = String(team.portfolio?.slug ?? team.portfolio?.name ?? "").trim();
  return {
    role: null,
    source: "unresolved",
    reason: described
      ? `Portfolio "${described}" matches no canonical portfolio role.`
      : "The team is linked to no portfolio.",
  };
}

/**
 * The four canonical portfolio bands, plus everything that could not be placed
 * and whether the read was complete. `unplaced` is not a fifth portfolio: it is
 * the exception group PWA-01 requires, and it exists so that unresolved work is
 * discoverable and repairable without inflating a real portfolio's totals.
 */
export type WorkroomArchitectureProjection = {
  bands: WorkroomPortfolioBand[];
  unplaced: WorkroomDefinition[];
  /** True when more teams exist than this bounded read returned. */
  truncated: boolean;
  /** Teams returned by this page; never presented as an estate total. */
  observed: number;
};

const ARCHITECTURE_PAGE_SIZE = 200;

/** A COUNT of the rooms that actually exist, by portfolio placement.
 *
 *  The coordination list is a bounded sample (201 rows) and must never be read
 *  as a total. This is the total, and it reports rooms with no recorded
 *  placement as `unclassified` rather than folding them into a portfolio —
 *  the same rule PR #5189 established for teams: a reader must be able to tell
 *  a room genuinely in a portfolio from one nobody has classified (BI-0EB855CC).
 */
export async function loadRoomInventory(
  db: { workroom: { groupBy(args: unknown): Promise<Array<{ portfolioRole: string | null; _count: { _all: number } }>> } },
): Promise<{
  openTotal: number;
  unclassified: number;
  byRole: Record<WorkCapsulePortfolioRole, number>;
}> {
  const rows = await db.workroom.groupBy({
    by: ["portfolioRole"],
    where: { archivedAt: null, status: { notIn: TERMINAL_CAPSULE_STATUSES } },
    _count: { _all: true },
  });

  const byRole = Object.fromEntries(
    WORK_CAPSULE_PORTFOLIO_ROLES.map((role) => [role, 0]),
  ) as Record<WorkCapsulePortfolioRole, number>;
  let unclassified = 0;
  let openTotal = 0;

  for (const row of rows) {
    const count = row._count?._all ?? 0;
    openTotal += count;
    const role = row.portfolioRole as WorkCapsulePortfolioRole | null;
    if (role && role in byRole) byRole[role] += count;
    else unclassified += count;
  }

  return { openTotal, unclassified, byRole };
}

export async function loadWorkroomArchitecture(db: ArchitectureDb): Promise<WorkroomArchitectureProjection> {
  const teams = await db.valueStreamTeam.findMany({
    where: { isActive: true },
    orderBy: [{ portfolioId: "asc" }, { name: "asc" }],
    take: ARCHITECTURE_PAGE_SIZE + 1,
    select: {
      id: true,
      name: true,
      valueStream: true,
      teamPattern: true,
      coordinationPattern: true,
      eaProcessId: true,
      eaViewId: true,
      portfolioId: true,
      isActive: true,
      portfolio: { select: { slug: true, name: true } },
      roles: {
        orderBy: [{ priority: "asc" }, { roleName: "asc" }],
        select: { roleName: true, workerType: true, modelTier: true },
      },
      hitlGates: {
        orderBy: [{ triggerPoint: "asc" }, { requiredRole: "asc" }],
        select: { triggerPoint: true, requiredRole: true, escalationTimeoutMinutes: true },
      },
      queues: {
        orderBy: { name: "asc" },
        select: { queueId: true, name: true, queueType: true, isActive: true },
      },
      workItems: { select: { _count: { select: { capsules: true } } } },
    },
  });

  const truncated = teams.length > ARCHITECTURE_PAGE_SIZE;
  const page = truncated ? teams.slice(0, ARCHITECTURE_PAGE_SIZE) : teams;

  const bands = WORK_CAPSULE_PORTFOLIO_ROLES.map((role) => ({
    role,
    label: portfolioRoleLabel(role),
    definitions: [] as WorkroomDefinition[],
  }));
  const unplaced: WorkroomDefinition[] = [];
  const byRole = new Map(bands.map((band) => [band.role, band]));
  for (const team of page) {
    const placement = resolvePortfolioPlacement(team);
    const definition: WorkroomDefinition = {
      id: team.id,
      name: team.name,
      valueStream: team.valueStream,
      shape: team.teamPattern,
      coordinationPattern: team.coordinationPattern,
      isActive: team.isActive,
      participants: team.roles,
      triggers: team.hitlGates,
      queues: team.queues,
      instanceCount: team.workItems.reduce((total: number, item: any) => total + (item._count?.capsules ?? 0), 0),
      eaProcessId: team.eaProcessId,
      eaViewId: team.eaViewId,
      placement,
    };
    // A room is counted once per scope: placed into exactly one band, or into
    // the exception group. Never both, and never silently into Foundational.
    if (placement.role === null) unplaced.push(definition);
    else byRole.get(placement.role)?.definitions.push(definition);
  }
  return { bands, unplaced, truncated, observed: page.length };
}

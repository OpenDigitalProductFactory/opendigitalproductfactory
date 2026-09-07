import { loadCapsuleLivenessInventory } from "./liveness-inventory";
import { readWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

type OwnershipDb = {
  workroom: { findMany(args: unknown): Promise<any[]> };
  featureBuild: { findMany(args: unknown): Promise<any[]> };
  nonProductionEnvironmentLease?: { findMany(args: unknown): Promise<any[]> };
};

type LockDb = {
  $queryRaw?(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
};

export type BacklogWorkroomSummary = {
  capsuleId: string;
  title: string;
  status: string;
  backlogItemId: string | null;
  repositoryFullName: string | null;
  headBranch: string | null;
  worktreePath: string | null;
  executorKind: string | null;
  executorRef: string | null;
  leaseHolderPrincipalId: string | null;
  leaseExpiresAt: string | null;
  liveness: string;
  isLive: boolean;
  livenessReason: string;
  trueLivenessAt: string | null;
  /** The room's declared/derived delivery shape as `key@version`, when bound (BI-D03BE728). */
  workShape?: string | null;
};

function workShapeRefOf(scopeClaims: unknown): string | null {
  const ref = readWorkShapeClaim(scopeClaims);
  return ref ? `${ref.key}@${ref.version}` : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function loadBacklogWorkroomOwnership(
  db: OwnershipDb,
  backlogItemIds: string | string[],
  now: Date = new Date(),
): Promise<{ workrooms: BacklogWorkroomSummary[]; liveWorkrooms: BacklogWorkroomSummary[] }> {
  const ids = Array.isArray(backlogItemIds) ? backlogItemIds : [backlogItemIds];
  const inventory = await loadCapsuleLivenessInventory(
    db,
    { where: { backlogItemId: { in: [...new Set(ids)] }, archivedAt: null }, take: 1000 },
    now,
  );
  if (inventory.capsulesAll.length === 1000) {
    throw new Error("Backlog Workroom ownership exceeded the safe projection limit; refusing an incomplete ownership decision.");
  }
  const workrooms = inventory.capsulesAll.map((row): BacklogWorkroomSummary => ({
    capsuleId: String(row.capsuleId),
    title: String(row.title),
    status: String(row.status),
    backlogItemId: nullableString(row.backlogItemId),
    repositoryFullName: nullableString(row.repositoryFullName),
    headBranch: nullableString(row.headBranch),
    worktreePath: nullableString(row.worktreePath),
    executorKind: nullableString(row.executorKind),
    executorRef: nullableString(row.executorRef),
    leaseHolderPrincipalId: nullableString(row.leaseHolderPrincipalId),
    leaseExpiresAt: row.leaseExpiresAt instanceof Date ? row.leaseExpiresAt.toISOString() : null,
    liveness: String(row.liveness),
    isLive: row.isLive === true,
    livenessReason: String(row.livenessReason),
    trueLivenessAt: nullableString(row.trueLivenessAt),
    workShape: workShapeRefOf((row as { scopeClaims?: unknown }).scopeClaims),
  }));
  return { workrooms, liveWorkrooms: workrooms.filter((room) => room.isLive) };
}

export function activeWorkroomsByBacklogItem(
  items: Array<{ id: string; itemId: string }>,
  workrooms: BacklogWorkroomSummary[],
): Map<string, BacklogWorkroomSummary[]> {
  const canonicalItemId = new Map<string, string>();
  for (const item of items) {
    canonicalItemId.set(item.id, item.itemId);
    canonicalItemId.set(item.itemId, item.itemId);
  }

  const grouped = new Map<string, BacklogWorkroomSummary[]>();
  for (const room of workrooms) {
    if (!room.isLive || !room.backlogItemId) continue;
    const itemId = canonicalItemId.get(room.backlogItemId);
    if (!itemId) continue;
    const owners = grouped.get(itemId) ?? [];
    if (!owners.some((owner) => owner.capsuleId === room.capsuleId)) owners.push(room);
    grouped.set(itemId, owners);
  }
  return grouped;
}

export class BacklogItemAlreadyClaimedError extends Error {
  readonly code = "backlog_item_already_claimed";

  constructor(
    readonly backlogItemId: string,
    readonly liveWorkrooms: BacklogWorkroomSummary[],
  ) {
    super(`${backlogItemId} already has live work in ${liveWorkrooms.map((room) => room.capsuleId).join(", ")}.`);
    this.name = "BacklogItemAlreadyClaimedError";
  }
}

export function assertBacklogWorkroomClaimAvailable(args: {
  backlogItemId: string;
  liveWorkrooms: BacklogWorkroomSummary[];
  repositoryFullName: string;
  headBranch: string;
  force: boolean;
  overrideReason: string | null;
}): { overrideConflicts: BacklogWorkroomSummary[] } {
  const conflicts = args.liveWorkrooms.filter((room) =>
    room.repositoryFullName !== args.repositoryFullName || room.headBranch !== args.headBranch);
  if (conflicts.length === 0) return { overrideConflicts: [] };
  if (!args.force) throw new BacklogItemAlreadyClaimedError(args.backlogItemId, conflicts);
  if (!args.overrideReason?.trim()) throw new Error("overrideReason is required when force overrides a live Workroom claim.");
  return { overrideConflicts: conflicts };
}

export async function lockBacklogItemForClaim(db: LockDb, rowId: string): Promise<void> {
  if (!db.$queryRaw) return;
  await db.$queryRaw`SELECT "id" FROM "BacklogItem" WHERE "id" = ${rowId} FOR UPDATE`;
}

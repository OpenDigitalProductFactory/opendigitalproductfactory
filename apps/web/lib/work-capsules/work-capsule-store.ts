import { randomUUID } from "node:crypto";

import {
  LEASE_TTL_MS,
  STATUS_OVERRIDE_TTL_MS,
  buildCapsuleBranchName,
  buildCapsuleSlug,
  buildCapsuleWorktreePath,
  isRootClonePath,
  isWorkCapsuleEvidenceKind,
  isWorkCapsuleExecutorKind,
  isWorkCapsuleSource,
  isWorkCapsuleStatus,
  normalizeBranchTaxonomy,
  parseScopeClaims,
  type ScopeClaim,
  type WorkCapsuleActivityKind,
  type WorkCapsuleBranchTaxonomy,
  type WorkCapsuleEvidenceKind,
  type WorkCapsuleExecutorKind,
  type WorkCapsuleSource,
  type WorkCapsuleStatus,
} from "@/lib/work-capsules";
import { revalidatePortalContext } from "@/lib/portal-context/invalidation";

export type WorkCapsuleActor = {
  userId: string;
  agentId: string | null;
  principalId: string | null;
};

export type CapsuleDb = {
  workCapsule: {
    create(args: unknown): Promise<any>;
    findFirst(args: unknown): Promise<any>;
    findUnique(args: unknown): Promise<any>;
    findMany(args: unknown): Promise<any[]>;
    update(args: unknown): Promise<any>;
  };
  workCapsuleActivity: {
    create(args: unknown): Promise<any>;
  };
  $transaction?<T>(fn: (tx: CapsuleDb) => Promise<T>): Promise<T>;
};

type CapsuleCreateInput = {
  title: string;
  objective: string;
  source: WorkCapsuleSource;
  idempotencyKey: string;
  executorKind?: WorkCapsuleExecutorKind | null;
  executorRef?: string | null;
  status?: WorkCapsuleStatus;
  backlogItemId?: string | null;
  epicId?: string | null;
  featureBuildId?: string | null;
  workspaceState?: Record<string, unknown>;
};

type CapsuleAdoptionInput = {
  title: string;
  objective: string;
  repositoryFullName: string;
  headBranch: string;
  worktreePath: string;
  baseBranch?: string | null;
  baseSha?: string | null;
  headSha?: string | null;
  executorKind?: WorkCapsuleExecutorKind | null;
};

type CapsuleEvidenceInput = {
  kind: WorkCapsuleEvidenceKind;
  summary: string;
  command?: string;
  url?: string;
  targetId?: string;
  runtimeTargetId?: string;
  verificationId?: string;
  result?: unknown;
};

type ScopeClaimInput = Pick<ScopeClaim, "kind" | "value" | "intent">;
type ScopeReleaseInput = Pick<ScopeClaim, "kind" | "value">;

type CapsuleWorkspacePlanInput = {
  capsuleId: string;
  taxonomy: WorkCapsuleBranchTaxonomy;
  os: NodeJS.Platform;
  home?: string;
  existingBranches: Set<string>;
  releaseOverride?: string;
};

function nextCapsuleId(): string {
  return `WC-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function leaseUntil(now = new Date()): Date {
  return new Date(now.getTime() + LEASE_TTL_MS);
}

function isExternalLeaseExecutor(executorKind: WorkCapsuleExecutorKind | null | undefined): boolean {
  return (
    executorKind === "codex-desktop" ||
    executorKind === "claude-desktop" ||
    executorKind === "grok-desktop" ||
    executorKind === "human"
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function inTransaction<T>(db: CapsuleDb, fn: (tx: CapsuleDb) => Promise<T>): Promise<T> {
  return db.$transaction ? db.$transaction(fn) : fn(db);
}

async function recordActivity(
  db: CapsuleDb,
  input: {
    workCapsuleId: string;
    kind: WorkCapsuleActivityKind;
    summary: string;
    payload?: Record<string, unknown>;
    actor: WorkCapsuleActor;
  },
) {
  const activity = await db.workCapsuleActivity.create({
    data: {
      workCapsuleId: input.workCapsuleId,
      kind: input.kind,
      summary: input.summary,
      payload: input.payload ?? {},
      recordedById: input.actor.userId,
      recordedByAgentId: input.actor.agentId,
    },
  });
  revalidatePortalContext();
  return activity;
}

export async function createWorkCapsule(args: {
  db: CapsuleDb;
  input: CapsuleCreateInput;
  actor: WorkCapsuleActor;
}) {
  if (!isWorkCapsuleSource(args.input.source)) throw new Error("Invalid capsule source");
  if (args.input.executorKind && !isWorkCapsuleExecutorKind(args.input.executorKind)) {
    throw new Error("Invalid executor kind");
  }
  if (args.input.status && !isWorkCapsuleStatus(args.input.status)) {
    throw new Error("Invalid capsule status");
  }

  const existing = await args.db.workCapsule.findUnique({
    where: { idempotencyKey: args.input.idempotencyKey },
  });
  if (existing) return existing;

  const now = new Date();
  try {
    return await inTransaction(args.db, async (tx) => {
      const created = await tx.workCapsule.create({
        data: {
          capsuleId: nextCapsuleId(),
          title: args.input.title,
          objective: args.input.objective,
          source: args.input.source,
          executorKind: args.input.executorKind ?? null,
          executorRef: args.input.executorRef ?? null,
          backlogItemId: args.input.backlogItemId ?? null,
          epicId: args.input.epicId ?? null,
          featureBuildId: args.input.featureBuildId ?? null,
          workspaceState: args.input.workspaceState ?? {},
          idempotencyKey: args.input.idempotencyKey,
          leaseHolderPrincipalId: isExternalLeaseExecutor(args.input.executorKind)
            ? args.actor.principalId
            : null,
          leaseExpiresAt: isExternalLeaseExecutor(args.input.executorKind) ? leaseUntil(now) : null,
          createdByPrincipalId: args.actor.principalId,
          status: args.input.status ?? (args.input.executorKind ? "ready" : "draft"),
        },
      });
      await recordActivity(tx, {
        workCapsuleId: created.id,
        kind: "created",
        summary: `Created Work Capsule ${created.capsuleId}`,
        actor: args.actor,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await args.db.workCapsule.findUnique({
        where: { idempotencyKey: args.input.idempotencyKey },
      });
      if (winner) return winner;
    }
    throw error;
  }
}

export async function adoptWorktreeCapsule(args: {
  db: CapsuleDb;
  input: CapsuleAdoptionInput;
  actor: WorkCapsuleActor;
}) {
  if (args.input.executorKind && !isWorkCapsuleExecutorKind(args.input.executorKind)) {
    throw new Error("Invalid executor kind");
  }

  const existing = await args.db.workCapsule.findFirst({
    where: {
      repositoryFullName: args.input.repositoryFullName,
      headBranch: args.input.headBranch,
      archivedAt: null,
    },
  });
  if (existing) return existing;

  const now = new Date();
  try {
    return await inTransaction(args.db, async (tx) => {
      const capsule = await tx.workCapsule.create({
        data: {
          capsuleId: nextCapsuleId(),
          title: args.input.title,
          objective: args.input.objective,
          source: "external-adoption",
          status: "ready",
          executorKind: args.input.executorKind ?? null,
          repositoryFullName: args.input.repositoryFullName,
          baseBranch: args.input.baseBranch ?? "main",
          baseSha: args.input.baseSha ?? null,
          headBranch: args.input.headBranch,
          headSha: args.input.headSha ?? null,
          worktreePath: args.input.worktreePath,
          branchTaxonomy: normalizeBranchTaxonomy(args.input.headBranch),
          leaseHolderPrincipalId: isExternalLeaseExecutor(args.input.executorKind)
            ? args.actor.principalId
            : null,
          leaseExpiresAt: isExternalLeaseExecutor(args.input.executorKind) ? leaseUntil(now) : null,
          createdByPrincipalId: args.actor.principalId,
          lastSyncedAt: now,
        },
      });
      await recordActivity(tx, {
        workCapsuleId: capsule.id,
        kind: "adopted",
        summary: `Adopted ${args.input.headBranch}`,
        payload: { worktreePath: args.input.worktreePath },
        actor: args.actor,
      });
      return capsule;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await args.db.workCapsule.findFirst({
        where: {
          repositoryFullName: args.input.repositoryFullName,
          headBranch: args.input.headBranch,
          archivedAt: null,
        },
      });
      if (winner) return winner;
    }
    throw error;
  }
}

async function hasWorkspaceCollision(
  db: CapsuleDb,
  args: { capsuleId: string; headBranch: string; worktreePath: string },
): Promise<boolean> {
  const existing = await db.workCapsule.findFirst({
    where: {
      capsuleId: { not: args.capsuleId },
      archivedAt: null,
      OR: [
        { headBranch: args.headBranch },
        { worktreePath: args.worktreePath },
      ],
    },
    select: { id: true },
  });
  return Boolean(existing);
}

export async function planCapsuleWorkspace(args: {
  db: CapsuleDb;
  input?: CapsuleWorkspacePlanInput;
  capsuleId?: string;
  taxonomy?: WorkCapsuleBranchTaxonomy;
  os?: NodeJS.Platform;
  home?: string;
  existingBranches?: Set<string>;
  releaseOverride?: string;
  actor: WorkCapsuleActor;
}) {
  const input: CapsuleWorkspacePlanInput = args.input ?? {
    capsuleId: args.capsuleId ?? "",
    taxonomy: args.taxonomy as WorkCapsuleBranchTaxonomy,
    os: args.os ?? process.platform,
    home: args.home,
    existingBranches: args.existingBranches ?? new Set<string>(),
    releaseOverride: args.releaseOverride,
  };

  const capsule = await args.db.workCapsule.findUnique({
    where: { capsuleId: input.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${input.capsuleId} not found`);

  if (capsule.headBranch && capsule.worktreePath) return capsule;
  if (capsule.headBranch || capsule.worktreePath) {
    throw new Error(
      `Work Capsule ${input.capsuleId} is in a partial-plan state ` +
        `(headBranch=${capsule.headBranch ?? "null"}, worktreePath=${capsule.worktreePath ?? "null"}). ` +
        "Repair the row before re-planning.",
    );
  }

  const baseSlug = buildCapsuleSlug(capsule.title, capsule.capsuleId);
  let slug = baseSlug;
  let headBranch = buildCapsuleBranchName({ taxonomy: input.taxonomy, slug });
  let worktreePath = buildCapsuleWorktreePath({ os: input.os, slug, home: input.home });
  let suffix = 2;

  while (
    input.existingBranches.has(headBranch) ||
    await hasWorkspaceCollision(args.db, { capsuleId: input.capsuleId, headBranch, worktreePath })
  ) {
    slug = `${baseSlug}-${suffix}`;
    headBranch = buildCapsuleBranchName({ taxonomy: input.taxonomy, slug });
    worktreePath = buildCapsuleWorktreePath({ os: input.os, slug, home: input.home });
    suffix += 1;
    if (suffix > 99) throw new Error("Could not allocate a unique branch name within 99 attempts");
  }

  if (isRootClonePath(worktreePath, input.os, input.home, input.releaseOverride)) {
    throw new Error("Refusing to plan the root clone as an active workspace");
  }

  return inTransaction(args.db, async (tx) => {
    const updated = await tx.workCapsule.update({
      where: { capsuleId: input.capsuleId },
      data: {
        headBranch,
        worktreePath,
        branchTaxonomy: input.taxonomy,
        baseBranch: capsule.baseBranch ?? "main",
        status: capsule.status === "draft" ? "ready" : capsule.status,
      },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "workspace-planned",
      summary: `Planned ${headBranch} at ${worktreePath}`,
      payload: { headBranch, worktreePath, branchTaxonomy: input.taxonomy },
      actor: args.actor,
    });
    return updated;
  });
}

export async function heartbeatWorkCapsule(args: {
  db: CapsuleDb;
  capsuleId: string;
  actor: WorkCapsuleActor;
  now?: Date;
}) {
  const nextLease = leaseUntil(args.now ?? new Date());
  return inTransaction(args.db, async (tx) => {
    const capsule = await tx.workCapsule.update({
      where: { capsuleId: args.capsuleId },
      data: {
        leaseHolderPrincipalId: args.actor.principalId,
        leaseExpiresAt: nextLease,
      },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "lease-renewed",
      summary: `Lease renewed until ${nextLease.toISOString()}`,
      actor: args.actor,
    });
    return capsule;
  });
}

export async function recordWorkCapsuleEvidence(args: {
  db: CapsuleDb;
  capsuleId: string;
  evidence: CapsuleEvidenceInput;
  actor: WorkCapsuleActor;
}) {
  if (!isWorkCapsuleEvidenceKind(args.evidence.kind)) {
    throw new Error("Invalid evidence kind");
  }

  const capsule = await args.db.workCapsule.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

  return recordActivity(args.db, {
    workCapsuleId: capsule.id,
    kind: "evidence-recorded",
    summary: args.evidence.summary,
    payload: args.evidence,
    actor: args.actor,
  });
}

/**
 * A scope claim on another active capsule that conflicts with an incoming
 * claim — same `kind:value`, with at least one side claiming `edit` intent.
 */
export type ScopeConflict = {
  capsuleId: string;
  title: string;
  kind: ScopeClaim["kind"];
  value: string;
  existingIntent: ScopeClaim["intent"];
  incomingIntent: ScopeClaim["intent"];
  leaseHolderPrincipalId: string | null;
};

/**
 * Thrown by claimWorkCapsuleScope when an incoming claim overlaps an active
 * claim held by another capsule. Carries the conflicts so the MCP boundary can
 * surface them to the caller (who must coordinate, pick different scope, or pass
 * force to deliberately co-claim).
 */
export class ScopeOverlapError extends Error {
  readonly conflicts: ScopeConflict[];
  constructor(conflicts: ScopeConflict[]) {
    super(
      `Scope overlap with ${conflicts.length} active claim(s) on other Work Capsule(s): ` +
        conflicts.map((c) => `${c.kind}:${c.value} (held by ${c.capsuleId})`).join(", "),
    );
    this.name = "ScopeOverlapError";
    this.conflicts = conflicts;
  }
}

// A capsule in one of these statuses no longer holds its scope — its claims are
// inert and never conflict with a fresh claim.
const TERMINAL_CAPSULE_STATUSES: WorkCapsuleStatus[] = ["complete", "abandoned", "archived"];

// `edit` is an exclusive intent: two `edit` claims on the same scope conflict, as
// does an `edit` against a `read`. Two `read` claims coexist (non-exclusive).
function intentsConflict(a: ScopeClaim["intent"], b: ScopeClaim["intent"]): boolean {
  return a === "edit" || b === "edit";
}

// Normalize a path scope value so separators and trailing slashes don't defeat
// containment checks ("src/", "src", and "src\\x" must compare consistently).
function normalizePathScope(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
}

// Two scope values overlap when they claim the same resource. For `path` kinds a
// directory claim covers its whole subtree, so an ancestor/descendant pair
// overlaps; the trailing-"/" boundary keeps siblings that merely share a string
// prefix (src/foo.ts vs src/foobar.ts) from colliding. All other kinds are
// exact-match scopes.
function scopeValuesOverlap(kind: ScopeClaim["kind"], a: string, b: string): boolean {
  if (a === b) return true;
  if (kind !== "path") return false;
  const na = normalizePathScope(a);
  const nb = normalizePathScope(b);
  if (na === nb) return true;
  return na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`);
}

/**
 * Find active claims on OTHER capsules that conflict with `claims`. "Active" =
 * not archived, not in a terminal status, and (for lease-backed executors) the
 * lease has not expired — an expired-lease capsule has released its hold, so its
 * scope is reclaimable. Conflict detection is done in JS over the parsed
 * scopeClaims JSON (the active-capsule population is small), mirroring how the
 * rest of this store reasons about scope.
 */
export async function detectScopeConflicts(args: {
  db: CapsuleDb;
  capsuleId: string;
  claims: ScopeClaimInput[];
  now?: Date;
}): Promise<ScopeConflict[]> {
  if (args.claims.length === 0) return [];

  const now = args.now ?? new Date();
  const others = await args.db.workCapsule.findMany({
    where: {
      capsuleId: { not: args.capsuleId },
      archivedAt: null,
      status: { notIn: TERMINAL_CAPSULE_STATUSES },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { gt: now } }],
    },
    select: {
      capsuleId: true,
      title: true,
      scopeClaims: true,
      leaseHolderPrincipalId: true,
    },
  });

  const conflicts: ScopeConflict[] = [];
  for (const other of others ?? []) {
    for (const existing of parseScopeClaims(other.scopeClaims)) {
      // A `path` claim covers its whole subtree, so a directory claim conflicts
      // with a file/dir beneath it (and vice-versa) even though the kind:value
      // strings differ — without this, `path:dir/` and `path:dir/file.ts` were
      // treated as disjoint and two sessions could both "own" overlapping edit
      // scope. Non-path kinds keep exact-value matching.
      const incoming = args.claims.find(
        (c) =>
          c.kind === existing.kind &&
          scopeValuesOverlap(existing.kind, existing.value, c.value) &&
          intentsConflict(existing.intent, c.intent),
      );
      if (incoming) {
        conflicts.push({
          capsuleId: other.capsuleId,
          title: other.title,
          kind: existing.kind,
          value: existing.value,
          existingIntent: existing.intent,
          incomingIntent: incoming.intent,
          leaseHolderPrincipalId: other.leaseHolderPrincipalId ?? null,
        });
      }
    }
  }
  return conflicts;
}

export async function claimWorkCapsuleScope(args: {
  db: CapsuleDb;
  capsuleId: string;
  claims: ScopeClaimInput[];
  actor: WorkCapsuleActor;
  now?: Date;
  /** Deliberately co-claim despite an overlap with another active capsule. */
  force?: boolean;
}) {
  const capsule = await args.db.workCapsule.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

  // Capsule-first enforcement: refuse to claim scope already held by another
  // active capsule unless the caller explicitly forces it. This is the lock that
  // stops two sessions from building the same BI / editing the same files.
  const conflicts = await detectScopeConflicts({
    db: args.db,
    capsuleId: args.capsuleId,
    claims: args.claims,
    now: args.now,
  });
  if (conflicts.length > 0 && !args.force) {
    throw new ScopeOverlapError(conflicts);
  }

  const recordedAt = (args.now ?? new Date()).toISOString();
  const nextClaims = new Map<string, ScopeClaim>();
  for (const entry of parseScopeClaims(capsule.scopeClaims)) {
    nextClaims.set(`${entry.kind}:${entry.value}`, entry);
  }

  const added: ScopeClaim[] = [];
  const refreshed: ScopeClaim[] = [];
  for (const claim of args.claims) {
    const normalized: ScopeClaim = {
      kind: claim.kind,
      value: claim.value,
      intent: claim.intent,
      recordedAt,
      recordedByPrincipalId: args.actor.principalId ?? "",
    };
    const key = `${normalized.kind}:${normalized.value}`;
    if (nextClaims.has(key)) refreshed.push(normalized);
    else added.push(normalized);
    nextClaims.set(key, normalized);
  }

  const scopeClaims = Array.from(nextClaims.values());
  return inTransaction(args.db, async (tx) => {
    const updated = await tx.workCapsule.update({
      where: { capsuleId: args.capsuleId },
      data: { scopeClaims },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "scope-claimed",
      summary:
        conflicts.length > 0
          ? `Force-claimed ${added.length} new scope item(s) over ${conflicts.length} active conflict(s); refreshed ${refreshed.length}.`
          : `Claimed ${added.length} new scope item(s); refreshed ${refreshed.length}.`,
      payload: {
        added,
        refreshed,
        ...(conflicts.length > 0 ? { forcedOverConflicts: conflicts } : {}),
      },
      actor: args.actor,
    });
    return updated;
  });
}

export async function releaseWorkCapsuleScope(args: {
  db: CapsuleDb;
  capsuleId: string;
  claims: ScopeReleaseInput[];
  actor: WorkCapsuleActor;
}) {
  const capsule = await args.db.workCapsule.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

  const releaseKeys = new Set(args.claims.map((claim) => `${claim.kind}:${claim.value}`));
  const existing = parseScopeClaims(capsule.scopeClaims);
  const scopeClaims = existing.filter((claim) => !releaseKeys.has(`${claim.kind}:${claim.value}`));
  const released = existing.filter((claim) => releaseKeys.has(`${claim.kind}:${claim.value}`));

  return inTransaction(args.db, async (tx) => {
    const updated = await tx.workCapsule.update({
      where: { capsuleId: args.capsuleId },
      data: { scopeClaims },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "scope-released",
      summary: `Released ${released.length} scope item(s).`,
      payload: { released },
      actor: args.actor,
    });
    return updated;
  });
}

export async function updateWorkCapsuleStatus(args: {
  db: CapsuleDb;
  capsuleId: string;
  status: WorkCapsuleStatus;
  reason: string;
  actor: WorkCapsuleActor;
  now?: Date;
}) {
  if (!isWorkCapsuleStatus(args.status)) throw new Error("Invalid capsule status");

  const capsule = await args.db.workCapsule.findUnique({
    where: { capsuleId: args.capsuleId },
  });
  if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found`);

  const currentWorkspaceState =
    capsule.workspaceState && typeof capsule.workspaceState === "object" && !Array.isArray(capsule.workspaceState)
      ? capsule.workspaceState as Record<string, unknown>
      : {};
  const now = args.now ?? new Date();
  const statusOverride = {
    reason: args.reason,
    until: new Date(now.getTime() + STATUS_OVERRIDE_TTL_MS).toISOString(),
  };

  return inTransaction(args.db, async (tx) => {
    const updated = await tx.workCapsule.update({
      where: { capsuleId: args.capsuleId },
      data: {
        status: args.status,
        workspaceState: {
          ...currentWorkspaceState,
          statusOverride,
        },
      },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "status-override",
      summary: args.reason,
      payload: { status: args.status, statusOverride },
      actor: args.actor,
    });
    return updated;
  });
}

import {
  LEASE_TTL_MS,
  type WorkCapsuleExecutorKind,
  type WorkCapsuleScopeInput,
  type WorkCapsuleStatus,
} from "@/lib/work-capsules";
import type { WorkCapsuleActor } from "./work-capsule-store-types";

export type CapsuleAdoptionInput = {
  title: string;
  objective: string;
  repositoryFullName: string;
  headBranch: string;
  worktreePath: string;
  baseBranch?: string | null;
  baseSha?: string | null;
  headSha?: string | null;
  executorKind?: WorkCapsuleExecutorKind | null;
  executorRef?: string | null;
  backlogItemId?: string | null;
  epicId?: string | null;
  scope?: WorkCapsuleScopeInput | null;
};

type BranchCapsuleRecord = {
  id: string;
  capsuleId: string;
  status?: string | null;
  archivedAt?: Date | string | null;
  backlogItemId?: string | null;
  executorKind?: WorkCapsuleExecutorKind | null;
  executorRef?: string | null;
  baseBranch?: string | null;
  baseSha?: string | null;
  headSha?: string | null;
  headBranch?: string | null;
  epicId?: string | null;
  worktreePath?: string | null;
  repositoryFullName?: string | null;
};

export const TERMINAL_CAPSULE_STATUSES: WorkCapsuleStatus[] = ["complete", "abandoned", "archived"];

export function isTerminalCapsuleStatus(status: unknown): boolean {
  return typeof status === "string" && (TERMINAL_CAPSULE_STATUSES as string[]).includes(status);
}

export function isExternalLeaseExecutor(
  executorKind: WorkCapsuleExecutorKind | null | undefined,
): boolean {
  return (
    executorKind === "codex-desktop" ||
    executorKind === "claude-desktop" ||
    executorKind === "grok-desktop" ||
    executorKind === "antigravity-desktop" ||
    executorKind === "human"
  );
}

export function leaseUntil(now = new Date()): Date {
  return new Date(now.getTime() + LEASE_TTL_MS);
}

export function isReusableLiveCapsule(
  existing: Pick<BranchCapsuleRecord, "status" | "backlogItemId" | "executorRef">,
  input: Pick<CapsuleAdoptionInput, "backlogItemId" | "executorRef">,
): boolean {
  if (isTerminalCapsuleStatus(existing.status)) return false;
  const existingBi = existing.backlogItemId ?? null;
  const incomingBi = input.backlogItemId ?? null;
  if (existingBi == null) return true;
  if (incomingBi != null && existingBi !== incomingBi) return false;
  const existingSession = existing.executorRef ?? null;
  const incomingSession = input.executorRef ?? null;
  return existingSession == null || incomingSession == null || existingSession === incomingSession;
}

/**
 * The remedy for an occupied branch, which depends on what is occupying it.
 *
 * BI-D526F72C: the message used to say "Resume that capsule for the same backlog
 * item" unconditionally — including for a capsule that HAS no backlog item, where
 * that instruction is impossible to follow. A remedy that cannot be executed
 * reads as a dead end and sends the caller to a different branch name, which is
 * the outcome the durable branch identity exists to avoid.
 */
function branchOccupiedRemedy(backlogItemId: string | null): string {
  if (backlogItemId) {
    return `Resume ${backlogItemId} on that capsule, or use a different branch.`;
  }
  return (
    "That capsule carries no backlog item, so there is nothing to resume it "
    + "against. Re-adopt the branch with adopt_worktree(backlogItemId) to bind and "
    + "resume it, or use a different branch."
  );
}

export class CapsuleBranchOccupiedError extends Error {
  readonly capsuleId: string;
  readonly status: string;
  readonly backlogItemId: string | null;

  constructor(existing: Pick<BranchCapsuleRecord, "capsuleId" | "status" | "backlogItemId" | "headBranch">) {
    const status = existing.status ?? "unknown";
    const backlogItemId = existing.backlogItemId ?? null;
    super(
      `Branch ${existing.headBranch ?? "unknown"} is already bound to Work Capsule ` +
        `${existing.capsuleId} (${status}${backlogItemId ? `, ${backlogItemId}` : ""}). ` +
        branchOccupiedRemedy(backlogItemId),
    );
    this.name = "CapsuleBranchOccupiedError";
    this.capsuleId = existing.capsuleId;
    this.status = status;
    this.backlogItemId = backlogItemId;
  }
}

/**
 * Whether a TERMINAL capsule holding this branch's durable identity may be
 * resumed by this adoption, and whether resuming also binds a backlog item.
 *
 * Two shapes qualify, and the second is BI-D526F72C.
 *
 * 1. An abandoned capsule bound to the SAME backlog item. Resuming continues its
 *    own history, which is what "abandoned" is for.
 * 2. An ORPHAN capsule — terminal with no backlog item at all. `adopt_worktree`
 *    could produce one (its schema never accepted `backlogItemId`, so a supplied
 *    one was dropped), and the result occupied the branch permanently: unclaimable
 *    because it matched no subject, and unreleasable because abandoning it did not
 *    free the branch. Resuming it binds the incoming identity onto the row that
 *    already owns the branch, so the durable identity is preserved rather than
 *    forked, and no capsule can stay simultaneously unclaimable and unreleasable.
 *
 * A terminal capsule bound to a DIFFERENT backlog item still refuses. That row
 * records real history on the branch, and rebinding it would overwrite whose work
 * the branch was — the case `readBranchIdentityCapsule` deliberately protects.
 */
export function planTerminalCapsuleResume(args: {
  existing: BranchCapsuleRecord | null;
  input: CapsuleAdoptionInput;
  actor: WorkCapsuleActor;
  now: Date;
}) {
  const { existing, input, actor, now } = args;
  if (!existing || !isTerminalCapsuleStatus(existing.status)) return null;

  const existingBacklogItemId = existing.backlogItemId ?? null;
  const incomingBacklogItemId = input.backlogItemId ?? null;
  const sameSubjectAbandoned =
    existing.status === "abandoned"
    && existing.archivedAt == null
    && existingBacklogItemId != null
    && existingBacklogItemId === incomingBacklogItemId;
  // An orphan carries no history to overwrite: nothing was ever bound to it.
  const orphan = existingBacklogItemId == null;
  if (!sameSubjectAbandoned && !orphan) return null;

  const previousStatus = existing.status ?? "unknown";
  const boundBacklogItemId = existingBacklogItemId ?? incomingBacklogItemId;

  return {
    update: {
      where: { capsuleId: existing.capsuleId },
      data: {
        status: "ready" as const,
        title: input.title,
        objective: input.objective,
        // A resumed capsule is live again. Leaving `archivedAt` set would produce
        // a ready-but-archived row that reads as active on one surface and gone
        // on another — the reporting defect this fix exists to end.
        archivedAt: null,
        ...(orphan && incomingBacklogItemId
          ? {
            backlogItemId: incomingBacklogItemId,
            ...(input.epicId && existing.epicId == null ? { epicId: input.epicId } : {}),
          }
          : {}),
        baseBranch: input.baseBranch ?? existing.baseBranch ?? "main",
        baseSha: input.baseSha ?? existing.baseSha ?? null,
        headSha: input.headSha ?? existing.headSha ?? null,
        worktreePath: input.worktreePath,
        executorKind: input.executorKind ?? existing.executorKind ?? null,
        executorRef: input.executorRef ?? existing.executorRef ?? null,
        leaseHolderPrincipalId: isExternalLeaseExecutor(input.executorKind) ? actor.principalId : null,
        leaseExpiresAt: isExternalLeaseExecutor(input.executorKind) ? leaseUntil(now) : null,
        lastSyncedAt: now,
      },
    },
    activity: {
      workCapsuleId: existing.id,
      kind: "adopted" as const,
      summary: boundBacklogItemId
        ? `Resumed ${existing.capsuleId} on ${input.headBranch} for ${boundBacklogItemId}`
        : `Resumed ${existing.capsuleId} on ${input.headBranch}`,
      payload: {
        resumed: true,
        previousStatus,
        orphanRebind: orphan && incomingBacklogItemId != null,
        backlogItemId: boundBacklogItemId,
        worktreePath: input.worktreePath,
        executorRef: input.executorRef ?? null,
      },
    },
  };
}

/**
 * The repository a Workroom is bound to when the caller did not name one.
 *
 * BI-F83CF689: three call sites each inlined this fallback, and the two that
 * did NOT — `create_workroom` and `plan_workroom_worktree` — left
 * `repositoryFullName` null. Because a branch's durable identity is keyed on
 * (repositoryFullName, headBranch), a null repo cannot match, so the documented
 * paved road produced a SECOND live capsule on a branch that already had one.
 * One resolver, used everywhere a capsule is created or planned.
 */
export function defaultPlatformRepositoryFullName(): string {
  return process.env.DPF_REPO_FULL_NAME?.trim() || "OpenDigitalProductFactory/opendigitalproductfactory";
}

type BranchIdentityReader = {
  workroom: { findFirst: (args: unknown) => Promise<BranchCapsuleRecord | null> };
};

/**
 * Read the one capsule that owns this branch's durable identity.
 *
 * The schema deliberately owns one capsule identity per (repository, branch).
 * That row is read regardless of lifecycle: an abandoned same-BI capsule is
 * the durable identity to resume, while a foreign/terminal identity must
 * refuse instead of falling through to an impossible duplicate create
 * (BI-E363A524).
 *
 * BI-F83CF689: rows created before the repository was persisted on create and
 * plan carry a null repositoryFullName, so the keyed read cannot see them and
 * the caller forks a SECOND live capsule on a branch that already has one. A
 * live repo-less row on the same branch IS that branch's identity — return it
 * and let the caller bind the repository. A TERMINAL repo-less row is history,
 * not identity: adopting it would newly refuse branch names that were
 * previously free, which is a regression rather than enforcement.
 */
export async function readBranchIdentityCapsule(
  db: BranchIdentityReader,
  input: Pick<CapsuleAdoptionInput, "repositoryFullName" | "headBranch">,
): Promise<{ existing: Awaited<ReturnType<BranchIdentityReader["workroom"]["findFirst"]>>; repositoryUnbound: boolean }> {
  const keyed = await db.workroom.findFirst({
    where: { repositoryFullName: input.repositoryFullName, headBranch: input.headBranch },
    orderBy: { updatedAt: "desc" },
  });
  if (keyed) return { existing: keyed, repositoryUnbound: false };
  const unkeyed = await db.workroom.findFirst({
    where: {
      repositoryFullName: null,
      headBranch: input.headBranch,
      status: { notIn: TERMINAL_CAPSULE_STATUSES },
    },
    orderBy: { updatedAt: "desc" },
  });
  return { existing: unkeyed, repositoryUnbound: unkeyed !== null };
}

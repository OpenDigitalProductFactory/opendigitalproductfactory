import type { AsyncOperationBinding } from "./async-operation-contract";

type QueryArgs = Record<string, unknown>;

export interface AsyncOperationAuthorityDatabase {
  taskRun: {
    findUnique(args: QueryArgs): Promise<any>;
  };
  workroom: {
    findUnique(args: QueryArgs): Promise<any>;
  };
}

export type AsyncOperationAuthorityActor = {
  userId: string | null;
  agentId: string | null;
  principalId: string | null;
  isSuperuser: boolean;
};

export type AsyncOperationAuthorityRequest =
  | {
      kind: "task-run";
      /** Public TaskRun semantic identity; never the database row id. */
      taskRunId: string;
      requestKey: string;
      requestDigest: string;
    }
  | {
      kind: "workroom";
      /** Public Workroom semantic identity (`WC-*`), despite the field name. */
      workroomId: string;
      requestKey: string;
      requestDigest: string;
    };

export type AsyncOperationAuthorityTarget =
  | Pick<Extract<AsyncOperationAuthorityRequest, { kind: "task-run" }>, "kind" | "taskRunId">
  | Pick<Extract<AsyncOperationAuthorityRequest, { kind: "workroom" }>, "kind" | "workroomId">;

export type ResolvedAsyncOperationAuthority =
  | { kind: "task-run"; taskRunId: string }
  | { kind: "workroom"; workroomId: string };

export class AsyncOperationAuthorizationError extends Error {
  constructor(code: "NOT_FOUND" | "DENIED") {
    super(`ASYNC_OPERATION_AUTHORITY_${code}`);
    this.name = "AsyncOperationAuthorizationError";
  }
}

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function validateRequestIdentity(request: AsyncOperationAuthorityRequest): {
  requestKey: string;
  requestDigest: string;
} {
  const requestKey = required(request.requestKey, "ASYNC_OPERATION_REQUEST_KEY_INVALID");
  const requestDigest = request.requestDigest.trim();
  if (!/^[a-f0-9]{64}$/u.test(requestDigest)) {
    throw new Error("ASYNC_OPERATION_REQUEST_DIGEST_INVALID");
  }
  return { requestKey, requestDigest };
}

function actorRefs(actor: AsyncOperationAuthorityActor): Set<string> {
  return new Set(
    [actor.userId, actor.agentId, actor.principalId]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function hasHumanSuperuserAuthority(actor: AsyncOperationAuthorityActor): boolean {
  // The platform's superuser affordance belongs to the signed-in human. An AI
  // actor must still match the exact TaskRun/Workroom assignment even if its
  // surrounding session happens to carry an elevated user flag.
  return actor.isSuperuser && actor.userId !== null && actor.agentId === null;
}

/**
 * Resolve public TaskRun/Workroom identities against durable server records and
 * return only the internal foreign-key identity after authorization succeeds.
 * A caller cannot supply an internal scope key or platform operation id here.
 */
export async function resolveServerOwnedAsyncOperationBinding(input: {
  request: AsyncOperationAuthorityRequest;
  actor: AsyncOperationAuthorityActor;
  db: AsyncOperationAuthorityDatabase;
}): Promise<AsyncOperationBinding> {
  const identity = validateRequestIdentity(input.request);
  const authority = await resolveServerOwnedAsyncOperationAuthority({
    target: input.request,
    actor: input.actor,
    db: input.db,
  });
  return { ...authority, ...identity };
}

export async function resolveServerOwnedAsyncOperationAuthority(input: {
  target: AsyncOperationAuthorityTarget;
  actor: AsyncOperationAuthorityActor;
  db: AsyncOperationAuthorityDatabase;
}): Promise<ResolvedAsyncOperationAuthority> {
  const refs = actorRefs(input.actor);

  if (input.target.kind === "task-run") {
    const taskRunId = required(input.target.taskRunId, "ASYNC_OPERATION_TASK_RUN_ID_INVALID");
    const row = await input.db.taskRun.findUnique({
      where: { taskRunId },
      select: {
        id: true,
        taskRunId: true,
        userId: true,
        initiatingAgentId: true,
        currentAgentId: true,
      },
    });
    if (!row) throw new AsyncOperationAuthorizationError("NOT_FOUND");
    const authorized = hasHumanSuperuserAuthority(input.actor)
      || refs.has(row.userId)
      || (typeof row.currentAgentId === "string" && refs.has(row.currentAgentId))
      || (typeof row.initiatingAgentId === "string" && refs.has(row.initiatingAgentId));
    if (!authorized) throw new AsyncOperationAuthorizationError("DENIED");
    return {
      kind: "task-run",
      taskRunId: row.id,
    };
  }

  const capsuleId = required(input.target.workroomId, "ASYNC_OPERATION_WORKROOM_ID_INVALID");
  const row = await input.db.workroom.findUnique({
    where: { capsuleId },
    select: {
      id: true,
      capsuleId: true,
      executorRef: true,
      leaseHolderPrincipalId: true,
      participants: {
        where: { lifecycle: "active" },
        select: { principalId: true, lifecycle: true },
      },
    },
  });
  if (!row) throw new AsyncOperationAuthorizationError("NOT_FOUND");
  const authorized = hasHumanSuperuserAuthority(input.actor)
    || (typeof row.executorRef === "string" && refs.has(row.executorRef))
    || (typeof row.leaseHolderPrincipalId === "string" && refs.has(row.leaseHolderPrincipalId))
    || (Array.isArray(row.participants)
      && row.participants.some((participant: any) =>
        participant?.lifecycle === "active"
        && typeof participant.principalId === "string"
        && refs.has(participant.principalId),
      ));
  if (!authorized) throw new AsyncOperationAuthorizationError("DENIED");
  return {
    kind: "workroom",
    workroomId: row.id,
  };
}

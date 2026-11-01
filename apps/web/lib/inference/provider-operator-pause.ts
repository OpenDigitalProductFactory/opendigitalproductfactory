import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";

export type PauseDatabase = Pick<typeof prisma, "$transaction" | "modelProvider" | "aiProviderConnection" | "scheduledJob" | "adminActivity">;
export type PauseDependencies = {
  db?: PauseDatabase;
  now?: Date;
  newId?: () => string;
  send?: (event: { name: string; data: Record<string, unknown>; id: string }) => unknown;
  probe?: (providerId: string) => Promise<boolean>;
};
export type PauseDuration = { value: number; unit: "hours" | "days" };
export const PROVIDER_PAUSE_EXPIRY_EVENT = "ops/provider.pause-expire";
const PAUSE_KIND = "operator-provider-pause";
export const providerPauseJobId = (providerId: string) => `provider-pause-${providerId}`;
export type ProviderPauseState = {
  kind: typeof PAUSE_KIND;
  version: 1;
  providerId: string;
  operationId: string;
  actorId: string;
  pausedAt: string;
  resumeAt: string | null;
  priorProviderStatus: string;
  priorConnectionStatus: string;
  restoredFromOperationId?: string;
};

function assertProviderId(providerId: string) {
  if (!providerId || !/^[a-zA-Z0-9_-]+$/.test(providerId)) throw new Error("Invalid provider identity");
}
const isLocal = (providerId: string) => providerId === "local" || providerId === "ollama";
export function readProviderPauseState(value: unknown): ProviderPauseState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== PAUSE_KIND || row.version !== 1
    || typeof row.providerId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(row.providerId)
    || !["operationId", "actorId", "pausedAt", "priorProviderStatus", "priorConnectionStatus"].every(key => typeof row[key] === "string" && row[key] !== "")
    || !Number.isFinite(Date.parse(String(row.pausedAt)))
    || (row.resumeAt !== null && (typeof row.resumeAt !== "string" || !Number.isFinite(Date.parse(row.resumeAt))))) return null;
  return row as ProviderPauseState;
}
/** Read-only qualification, reused by native consequence classification and again
 * under the lifecycle lock. Only a persisted dated pause can be restored. */
export function readProviderPauseRestoration(input: { providerId: string; expectedOperationId: string; account: unknown; job: unknown }, now = new Date()): { pause: ProviderPauseState; alreadyRestored: boolean } | null {
  const row = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const account = row(input.account), job = row(input.job), metadata = row(job.metadata);
  const pause = readProviderPauseState(metadata);
  if (!input.expectedOperationId.trim() || !isLocal(input.providerId)
    || account.providerId !== input.providerId || account.connectionId !== `provider-default-${input.providerId}`
    || account.authMethod !== "local" || account.executionChannel !== "local-runtime"
    || account.credentialEntryId !== null || account.organizationId !== null
    || job.jobId !== providerPauseJobId(input.providerId) || job.enabled !== true
    || !pause || pause.providerId !== input.providerId || !pause.resumeAt || Date.parse(pause.resumeAt) <= now.getTime()
    || !["active", "degraded", "inactive"].includes(pause.priorProviderStatus)
    || !["active", "degraded", "inactive"].includes(pause.priorConnectionStatus)) return null;
  const alreadyRestored = job.lastStatus === "paused" && account.status === "paused"
    && pause.restoredFromOperationId === input.expectedOperationId && pause.operationId !== input.expectedOperationId;
  if (alreadyRestored) return { pause, alreadyRestored: true };
  if (job.lastStatus !== "resumed" || !["active", "degraded"].includes(String(account.status))
    || pause.operationId !== input.expectedOperationId || typeof metadata.resumedAt !== "string"
    || !Number.isFinite(Date.parse(metadata.resumedAt)) || Date.parse(metadata.resumedAt) > now.getTime()) return null;
  return { pause, alreadyRestored: false };
}
function expiry(now: Date, duration?: PauseDuration): string | null {
  if (!duration) return null;
  const multiplier = duration.unit === "hours" ? 3_600_000 : duration.unit === "days" ? 86_400_000 : NaN;
  const time = now.getTime() + duration.value * multiplier;
  if (!Number.isFinite(duration.value) || duration.value <= 0 || !Number.isFinite(time) || !Number.isFinite(new Date(time).getTime())) {
    throw new Error("Enter a positive duration in hours or days");
  }
  return new Date(time).toISOString();
}
async function lockProvider(tx: Prisma.TransactionClient, providerId: string) {
  // Match the existing provider -> connection write order; every pause/expiry
  // serializes on the provider row, including first creation of the job row.
  await tx.$queryRaw`SELECT "id" FROM "ModelProvider" WHERE "providerId" = ${providerId} FOR UPDATE`;
  // Connection-only credential/account writers also take this row's lock.
  // Acquire it second, in the same order as the existing default helper.
  const connectionId = `provider-default-${providerId}`;
  await tx.$queryRaw`SELECT "id" FROM "AiProviderConnection" WHERE "connectionId" = ${connectionId} FOR UPDATE`;
}
async function auditPause(tx: Prisma.TransactionClient, pause: ProviderPauseState, action: string, now: Date, actorId?: string, automatic = false) {
  // A timer executes the operator's instruction; its origin remains attributable
  // without claiming the operator personally performed the scheduled action.
  await tx.adminActivity.create({ data: {
    userId: actorId ?? pause.actorId, toolName: "provider_operator_pause", tier: 2, result: "success",
    parameters: { action, providerId: pause.providerId, operationId: pause.operationId, resumeAt: pause.resumeAt,
      ...(pause.restoredFromOperationId ? { restoredFromOperationId: pause.restoredFromOperationId } : {}),
      authorizingOperatorId: pause.actorId, executedBy: automatic ? "timer" : actorId ?? "provider-account-control", executedAt: now.toISOString() },
    summary: `${action}: ${pause.providerId}`,
  } });
}
export async function getProviderControlState(providerId: string, db: Pick<PauseDatabase, "scheduledJob" | "aiProviderConnection"> = prisma) {
  assertProviderId(providerId);
  const [job, connection] = await Promise.all([
    db.scheduledJob.findUnique({ where: { jobId: providerPauseJobId(providerId) } }),
    db.aiProviderConnection.findUnique({ where: { connectionId: `provider-default-${providerId}` } }),
  ]);
  const state = connection?.status === "paused" && job?.lastStatus === "paused" ? readProviderPauseState(job.metadata) : null;
  return { pause: state?.providerId === providerId ? state : null, connectionStatus: connection?.status ?? null };
}
/** Catalog reads stay constant as provider count grows. Actor metadata stays server-side. */
export async function getProviderControlStates(providerIds: string[], db: Pick<PauseDatabase, "scheduledJob" | "aiProviderConnection"> = prisma) {
  const ids = [...new Set(providerIds)];
  const [jobs, connections] = await Promise.all([
    db.scheduledJob.findMany({ where: { jobId: { in: ids.map(providerPauseJobId) } }, select: { jobId: true, lastStatus: true, metadata: true } }),
    db.aiProviderConnection.findMany({ where: { connectionId: { in: ids.map(id => `provider-default-${id}`) } }, select: { providerId: true, status: true } }),
  ]);
  const jobsById = new Map(jobs.map(job => [job.jobId, job]));
  const connectionsById = new Map(connections.map(connection => [connection.providerId, connection]));
  return new Map(ids.map(id => {
    const job = jobsById.get(providerPauseJobId(id));
    const connection = connectionsById.get(id);
    const pause = connection?.status === "paused" && job?.lastStatus === "paused" ? readProviderPauseState(job.metadata) : null;
    return [id, { pause: pause?.providerId === id ? pause : null, connectionStatus: connection?.status ?? null }] as const;
  }));
}
export async function getOperatorProviderPause(providerId: string, db: Pick<PauseDatabase, "scheduledJob" | "aiProviderConnection"> = prisma): Promise<ProviderPauseState | null> {
  return (await getProviderControlState(providerId, db)).pause;
}

/** Bounded repair for overdue persisted timers after restart or event failure. */
export async function reconcileOverdueProviderPauses(deps: PauseDependencies = {}): Promise<number> {
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const rows = await db.scheduledJob.findMany({
    where: { jobId: { startsWith: "provider-pause-" }, enabled: true, lastStatus: "paused", nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" }, take: 10,
  });
  let resumed = 0;
  for (const row of rows) {
    const pause = readProviderPauseState(row.metadata);
    if (!pause?.resumeAt || row.jobId !== providerPauseJobId(pause.providerId)) continue;
    const result = await resumeOperatorProvider({ providerId: pause.providerId, operationId: pause.operationId, automatic: true }, { ...deps, now });
    if (result.outcome === "resumed") resumed++;
  }
  return resumed;
}

type PauseWriteResult = { operationId: string; resumeAt: string | null; deliveryPending?: boolean; outcome: "paused" | "restored" | "already-restored" };
export async function pauseOperatorProvider(input: { providerId: string; actorId: string; duration?: PauseDuration }, deps: PauseDependencies = {}): Promise<{ operationId: string; resumeAt: string | null; deliveryPending: boolean }> {
  const result = await writeOperatorPause(input, deps);
  return { operationId: result.operationId, resumeAt: result.resumeAt, deliveryPending: result.deliveryPending === true };
}
/** This narrows current routing eligibility; it never enables an account, accepts
 * a caller-selected deadline, or impersonates the original operator. */
export async function restoreOperatorProviderPause(input: { providerId: string; connectionId: string; actorId: string; expectedOperationId: string }, deps: PauseDependencies = {}): Promise<PauseWriteResult> {
  if (!isLocal(input.providerId) || input.connectionId !== `provider-default-${input.providerId}`) throw new Error("Restore requires the exact canonical local account identity");
  if (typeof input.expectedOperationId !== "string" || !input.expectedOperationId.trim()) throw new Error("An exact persisted pause source is required");
  return writeOperatorPause({ providerId: input.providerId, actorId: input.actorId, restoreOperationId: input.expectedOperationId }, deps);
}
async function writeOperatorPause(input: { providerId: string; actorId: string; duration?: PauseDuration; restoreOperationId?: string }, deps: PauseDependencies): Promise<PauseWriteResult> {
  assertProviderId(input.providerId);
  if (!input.actorId) throw new Error("An operator identity is required");
  const db = deps.db ?? prisma;
  let now = deps.now ?? new Date();
  const requestedExpiry = expiry(now, input.duration);
  const connectionId = `provider-default-${input.providerId}`;
  const jobId = providerPauseJobId(input.providerId);
  const committed = await db.$transaction(async tx => {
    await lockProvider(tx, input.providerId);
    if (input.restoreOperationId) {
      const { loadInstanceStance, prismaInstanceStanceStore } = await import("@/lib/install/instance-stance");
      const stance = await loadInstanceStance(prismaInstanceStanceStore(tx));
      if (stance.environmentClass !== "development" || stance.primaryPurpose !== "evolve-dpf") throw new Error("Pause restoration requires current DEV maintenance eligibility");
    }
    const provider = await tx.modelProvider.findUnique({ where: { providerId: input.providerId } });
    const connection = await tx.aiProviderConnection.findUnique({ where: { connectionId } });
    if (!provider || !connection) throw new Error("Provider account not found");
    if (["service", "transcription"].includes(provider.endpointType)) throw new Error("This endpoint does not support model-routing pauses");
    if (provider.status === "unconfigured") throw new Error("Set up this provider before pausing traffic");
    const priorJob = await tx.scheduledJob.findUnique({ where: { jobId } });
    if (input.restoreOperationId) now = deps.now ?? new Date(); // Recheck expiry after waiting for the lifecycle lock/readers.
    const restoration = input.restoreOperationId ? readProviderPauseRestoration({ providerId: input.providerId, expectedOperationId: input.restoreOperationId, account: connection, job: priorJob }, now) : null;
    if (input.restoreOperationId && !restoration) throw new Error("Provider pause source changed or expired; refresh before restoring");
    if (restoration?.alreadyRestored) return { outcome: "already-restored" as const, operationId: restoration.pause.operationId, resumeAt: restoration.pause.resumeAt };
    const prior = restoration?.pause ?? (connection.status === "paused" && priorJob?.lastStatus === "paused" ? readProviderPauseState(priorJob.metadata) : null);
    const operationId = (deps.newId ?? randomUUID)();
    const resumeAt = restoration ? restoration.pause.resumeAt : requestedExpiry;
    const metadata: ProviderPauseState = {
      kind: PAUSE_KIND, version: 1, providerId: input.providerId, operationId, actorId: input.actorId,
      pausedAt: now.toISOString(), resumeAt,
      ...(restoration ? { restoredFromOperationId: restoration.pause.operationId } : {}),
      priorProviderStatus: prior?.priorProviderStatus ?? provider.status,
      priorConnectionStatus: prior?.priorConnectionStatus ?? connection.status,
    };
    if (isLocal(input.providerId) && ["active", "degraded", "inactive"].includes(provider.status)) {
      await tx.modelProvider.update({ where: { providerId: input.providerId }, data: { status: "inactive" } });
    }
    await tx.aiProviderConnection.update({ where: { connectionId }, data: { status: "paused" } });
    const data = { schedule: "once", nextRunAt: resumeAt ? new Date(resumeAt) : null, lastStatus: "paused", lastError: null,
      metadata, enabled: true, category: "core", locked: true };
    await tx.scheduledJob.upsert({ where: { jobId }, create: { jobId, name: `Operator pause for ${input.providerId}`, ...data }, update: data });
    await auditPause(tx, metadata, restoration ? "restore-pause" : prior ? "change-pause" : "pause", now, input.actorId);
    return { outcome: restoration ? "restored" as const : "paused" as const, operationId, resumeAt };
  });
  if (committed.outcome === "already-restored") return committed;
  let deliveryPending = false;
  if (committed.resumeAt) {
    try {
      const send = deps.send ?? (async event => (await import("@/lib/jobs")).jobs.send(event));
      await send({ name: PROVIDER_PAUSE_EXPIRY_EVENT, id: `provider-pause-expiry-${committed.operationId}`, data: { providerId: input.providerId, operationId: committed.operationId, resumeAt: committed.resumeAt } });
    } catch { deliveryPending = true; } // The committed timer is repaired by the overdue sweep.
  }
  return { ...committed, deliveryPending };
}

export async function resumeOperatorProvider(input: { providerId: string; operationId?: string; automatic?: boolean; actorId?: string }, deps: PauseDependencies = {}): Promise<{ outcome: "resumed" | "superseded" | "not-due"; status?: string; connectionStatus?: string }> {
  assertProviderId(input.providerId);
  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const pause = await getOperatorProviderPause(input.providerId, db);
  if (!pause) {
    if (input.automatic && input.operationId) await db.$transaction(async tx => {
      await lockProvider(tx, input.providerId);
      const connection = await tx.aiProviderConnection.findUnique({ where: { connectionId: `provider-default-${input.providerId}` } });
      const job = await tx.scheduledJob.findUnique({ where: { jobId: providerPauseJobId(input.providerId) } });
      const stored = readProviderPauseState(job?.metadata);
      if (connection?.status !== "paused" && job?.lastStatus === "paused" && stored?.providerId === input.providerId && stored.operationId === input.operationId) {
        await tx.scheduledJob.update({ where: { jobId: providerPauseJobId(input.providerId) }, data: {
          lastStatus: "superseded", nextRunAt: null, lastRunAt: now,
          metadata: { ...stored, supersededObservedAt: now.toISOString() },
        } });
      }
    });
    return { outcome: "superseded" };
  }
  if ((input.operationId && input.operationId !== pause.operationId)
    || (input.automatic && (!input.operationId || !pause.resumeAt))) return { outcome: "superseded" };
  if (input.automatic && Date.parse(pause.resumeAt!) > now.getTime()) return { outcome: "not-due" };
  const probe = deps.probe ?? (async providerId => {
    const provider = await db.modelProvider.findUnique({ where: { providerId } });
    if (!provider) return false;
    const { probeLocalRunner } = await import("./ollama");
    const { resolveOpencodeProviderBaseUrl } = await import("./ollama-url");
    return probeLocalRunner(resolveOpencodeProviderBaseUrl(provider));
  });
  const healthy = isLocal(input.providerId) ? await probe(input.providerId).catch(() => false) : false;
  return db.$transaction(async tx => {
    await lockProvider(tx, input.providerId);
    const current = await getOperatorProviderPause(input.providerId, tx);
    if (current?.operationId !== pause.operationId) return { outcome: "superseded" as const };
    const provider = await tx.modelProvider.findUnique({ where: { providerId: input.providerId } });
    if (!provider) return { outcome: "superseded" as const };
    const connectionStatus = isLocal(input.providerId) && ["active", "degraded", "inactive"].includes(pause.priorConnectionStatus) ? "active" : pause.priorConnectionStatus;
    const resumed = await tx.aiProviderConnection.updateMany({
      where: { connectionId: `provider-default-${input.providerId}`, status: "paused" }, data: { status: connectionStatus },
    });
    if (resumed.count !== 1) return { outcome: "superseded" as const };
    const connectionUsable = connectionStatus === "active" || connectionStatus === "degraded";
    let status = provider.status;
    // Only undo the inactive projection owned by this pause. Auth, billing,
    // unconfigured and other independent restrictions stay authoritative.
    if (isLocal(input.providerId) && status === "inactive") {
      const wasUsable = ["active", "degraded", "inactive"].includes(pause.priorProviderStatus);
      status = wasUsable && healthy && connectionUsable ? pause.priorProviderStatus === "degraded" ? "degraded" : "active" : pause.priorProviderStatus === "disabled" ? "disabled" : "inactive";
      await tx.modelProvider.update({ where: { providerId: input.providerId }, data: { status } });
    }
    await tx.scheduledJob.update({ where: { jobId: providerPauseJobId(input.providerId) }, data: {
      lastStatus: input.automatic ? "expired" : "resumed", nextRunAt: null, lastRunAt: now,
      metadata: { ...pause, resumedAt: now.toISOString(), resumedBy: input.automatic ? "timer" : input.actorId ?? null },
    } });
    await auditPause(tx, pause, input.automatic ? "expire" : "resume", now, input.actorId, input.automatic);
    return { outcome: "resumed" as const, status, connectionStatus };
  });
}

// Compatibility for the original local-provider callers; one lifecycle owns both.
export const getLocalProviderControlState = getProviderControlState;
export const getLocalProviderPause = getOperatorProviderPause;
export const pauseLocalProvider = pauseOperatorProvider;
export const resumeLocalProvider = resumeOperatorProvider;

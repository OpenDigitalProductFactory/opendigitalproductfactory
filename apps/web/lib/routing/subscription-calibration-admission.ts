import { createHash, randomUUID } from "node:crypto";
import { prisma, Prisma } from "@dpf/db";
import { can } from "@/lib/permissions";
import { resolveWorkforcePlatformRole } from "@/lib/govern/auth-utils";
import { resolveActiveHumanPrincipalRecordIdForUser } from "@/lib/identity/principal-linking";
import { captureExecutionProofBinding, readCurrentExecutionProof } from "./provider-capacity/execution-proof.server";
import type { ExecutionProof } from "./provider-capacity/execution-proof";
import { BUILTIN_DIMENSIONS } from "./types";
import { getTestsForDimension } from "./golden-tests";
import { currentGovernedInferenceDeadline } from "./governed-inference-deadline";

type Db = Prisma.TransactionClient;
export const calibrationCorpus = () => BUILTIN_DIMENSIONS.flatMap(d => getTestsForDimension(d));
export const calibrationCorpusHash = () => createHash("sha256").update(JSON.stringify(calibrationCorpus())).digest("hex");
export const calibrationJobId = (providerId: string, modelId: string) =>
  `eval-owned-${createHash("sha256").update(JSON.stringify([providerId, modelId])).digest("hex")}`;
export type CalibrationCommission = {
  version: 1; runId: string; jobId: string; userId: string; principalId: string;
  accountId: string; credentialId: string; providerId: string; modelId: string;
  proof: ExecutionProof; corpusHash: string; admittedAt: number; deadlineAt: number;
  maxCalls: number; maxOutputTokens: number;
};
export type CalibrationAttempt = { id: string; testId: string; cap: number;
  disposition: "unknown" | "terminal" | "rate-limit" | "refused"; responseId?: string;
  finishReason?: string; outputTokens?: number; traceId: string };
export type CalibrationJournal = { commission: CalibrationCommission;
  state: "queued" | "running" | "settled"; attempts: CalibrationAttempt[] };

export function readCalibrationJournal(value: unknown): CalibrationJournal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as CalibrationJournal;
  if (v.commission?.version !== 1 || !["queued", "running", "settled"].includes(v.state)
    || !Array.isArray(v.attempts) || typeof v.commission.runId !== "string"
    || !Number.isSafeInteger(v.commission.deadlineAt)) return null;
  return v;
}

async function currentOperator(userId: string, db: Db) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { groups: { include: { platformRole: true } } } });
  if (!user?.isActive || user.workHandedOverAt || user.automationExpiresAt && user.automationExpiresAt.getTime() <= Date.now()
    || !can({ isSuperuser: user.isSuperuser, platformRole: resolveWorkforcePlatformRole(user.groups) }, "manage_capabilities")) return null;
  return resolveActiveHumanPrincipalRecordIdForUser(userId, db);
}

/** Observation and current ownership are both required; neither creates authority. */
export async function validateCalibrationCommission(c: CalibrationCommission, db: Db = prisma): Promise<boolean> {
  const tests = calibrationCorpus();
  if (c.providerId !== "chatgpt" || c.jobId !== calibrationJobId(c.providerId, c.modelId)
    || c.corpusHash !== calibrationCorpusHash() || Date.now() >= c.deadlineAt
    || c.deadlineAt > c.admittedAt + 600_000 || c.deadlineAt > c.proof.expiresAt
    || c.maxCalls !== tests.length * 2 || c.maxOutputTokens !== tests.reduce((n,t) => n + (t.maxTokens ?? 512), 0) * 2
    || await currentOperator(c.userId, db) !== c.principalId) return false;
  const account = await db.aiProviderConnection.findUnique({ where: { connectionId: c.proof.connectionId }, include: { capacityStatus: true } });
  if (!account || account.id !== c.accountId || account.credentialEntryId !== c.credentialId
    || account.executionChannel !== "direct-api" || account.organizationId !== null) return false;
  const current = await readCurrentExecutionProof(c.proof.connectionId, c.modelId, account.capacityStatus?.executionProof, Date.now(), db);
  return !!current && Object.keys(c.proof).every(key => current[key as keyof ExecutionProof] === c.proof[key as keyof ExecutionProof]);
}

/** One lock owner for admissions, attempt reservations, and final projection. No network here. */
export async function lockCalibration(db: Db, jobId: string) {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${jobId}, 0))`;
}
export async function lockCalibrationIdentity(db: Db, c: CalibrationCommission) {
  await db.$queryRaw`SELECT a.id FROM "AiProviderConnection" a JOIN "CredentialEntry" c ON c.id=a."credentialEntryId"
    WHERE a.id=${c.accountId} FOR UPDATE OF a,c`;
  await db.$queryRaw`SELECT id FROM "User" WHERE id=${c.userId} FOR UPDATE`;
  await db.$queryRaw`SELECT id FROM "Principal" WHERE id=${c.principalId} FOR UPDATE`;
  await db.$queryRaw`SELECT g.id FROM "UserGroup" g JOIN "PlatformRole" p ON p.id=g."platformRoleId"
    WHERE g."userId"=${c.userId} FOR SHARE OF g,p`;
  await db.$queryRaw`SELECT id FROM "PrincipalAlias" WHERE "principalId"=${c.principalId} FOR SHARE`;
}

/** A lost queue acknowledgement leaves a reservation; a new request cannot adopt it. */
export async function commissionSubscriptionCalibration(userId: string, providerId: string, modelId: string): Promise<CalibrationCommission> {
  if (providerId !== "chatgpt") throw new Error("Subscription calibration is unsupported for this transport.");
  return prisma.$transaction(async db => {
    const jobId = calibrationJobId(providerId, modelId);
    await lockCalibration(db, jobId);
    const prior = await db.scheduledJob.findUnique({ where: { jobId } });
    if (prior && (readCalibrationJournal(prior.metadata)?.state !== "settled" || prior.runCursor))
      throw new Error("A calibration commission is unresolved; reconcile its history before another run.");
    // Never age out or reinterpret legacy remote work, including old running rows.
    const legacy = await db.endpointTestRun.findFirst({ where: { endpointId: providerId, modelId, taskType: "dimension-eval", status: "running" } });
    if (legacy) throw new Error("An earlier evaluation has an unknown outcome; reconciliation is required.");
    const principalId = await currentOperator(userId, db);
    const connectionId = "provider-default-chatgpt";
    const captured = await captureExecutionProofBinding(connectionId, modelId, db);
    const account = await db.aiProviderConnection.findUnique({ where: { connectionId }, include: { capacityStatus: true } });
    const proof = await readCurrentExecutionProof(connectionId, modelId, account?.capacityStatus?.executionProof, Date.now(), db);
    if (!principalId || !captured || !account?.credentialEntryId || account.executionChannel !== "direct-api" || !proof)
      throw new Error("Current operator, owned account and selected-model capacity evidence are required before calibration.");
    const tests = calibrationCorpus();
    const c: CalibrationCommission = { version: 1, runId: `DE-${randomUUID()}`, jobId, userId, principalId,
      accountId: captured.accountId, credentialId: account.credentialEntryId, providerId, modelId, proof,
      corpusHash: calibrationCorpusHash(), admittedAt: Date.now(), deadlineAt: Math.min(Date.now() + 600_000, proof.expiresAt,
        currentGovernedInferenceDeadline()?.deadlineAt ?? Infinity),
      maxCalls: tests.length * 2, maxOutputTokens: tests.reduce((n, t) => n + (t.maxTokens ?? 512), 0) * 2 };
    await lockCalibrationIdentity(db, c);
    if (!await validateCalibrationCommission(c, db)) throw new Error("Calibration identity changed before admission.");
    const metadata = { commission: c, state: "queued", attempts: [] } as unknown as Prisma.InputJsonValue;
    await db.scheduledJob.upsert({ where: { jobId }, create: { jobId, name: `Calibration: ${modelId}`, schedule: "manual",
      enabled: true, runCursor: c.runId, metadata, lastStatus: "queued", nextRunAt: null },
      update: { runCursor: c.runId, metadata, lastStatus: "queued", lastError: null, enabled: true } });
    await db.endpointTestRun.create({ data: { runId: c.runId, endpointId: providerId, modelId,
      triggeredBy: userId, taskType: "dimension-eval", status: "running", results: { commission: c } as unknown as Prisma.InputJsonValue } });
    return c;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
}

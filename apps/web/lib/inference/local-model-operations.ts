import { createHash } from "node:crypto";
import { Prisma, prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import {
  discoverModelsInternal,
  profileModelsInternal,
} from "./ai-provider-internals";
import {
  canonicalLocalModelKey,
  listLocalModels,
  validateLocalModelReference,
  type LocalModelInfo,
  type LocalModelOperationStatus,
} from "./local-model-management";

const JOB_PREFIX = "local-model-install:";
const RECENT_OPERATION_LIMIT = 100;
const ACTIVE_STATUSES = new Set<LocalModelOperationStatus>(["queued", "running"]);
const OPERATION_STATUSES = new Set<LocalModelOperationStatus>([
  "queued",
  "running",
  "completed",
  "failed",
]);

export type LocalModelOperation = {
  jobId: string;
  modelReference: string;
  comparisonKey: string;
  status: LocalModelOperationStatus;
  attempt: number;
  requestedByUserId: string;
  transferredBytes: number | null;
  totalBytes: number | null;
  percent: number | null;
  message: string | null;
  error: string | null;
  updatedAt: string;
};

export type LocalModelOperationRow = {
  jobId: string;
  lastStatus: string | null;
  lastError: string | null;
  metadata: unknown;
  updatedAt: Date;
};

export type LocalModelOperationUpdate = {
  jobId: string;
  attempt: number;
  status: LocalModelOperationStatus;
  transferredBytes?: number | null;
  totalBytes?: number | null;
  percent?: number | null;
  message?: string | null;
  error?: string | null;
};

export interface LocalModelOperationRepository {
  admit(input: {
    jobId: string;
    modelReference: string;
    requestedByUserId: string;
  }): Promise<{ admitted: boolean; row: LocalModelOperationRow }>;
  update(input: LocalModelOperationUpdate): Promise<LocalModelOperationRow | null>;
  listRecent(limit: number): Promise<LocalModelOperationRow[]>;
}

export type LocalModelStatusSnapshot = {
  observedAt: string;
  models: LocalModelInfo[];
  operations: LocalModelOperation[];
};

export type LocalModelReconciliationDependencies = {
  removeProjection(aliases: string[]): Promise<void>;
  discover(providerId: string): ReturnType<typeof discoverModelsInternal>;
  profile(providerId: string): ReturnType<typeof profileModelsInternal>;
};

const prismaReconciliationDependencies: LocalModelReconciliationDependencies = {
  async removeProjection(aliases) {
    const providerIds = ["local", "ollama"];
    const aliasFilter = aliases.map((modelId) => ({
      modelId: { equals: modelId, mode: Prisma.QueryMode.insensitive },
    }));
    await prisma.$transaction([
      prisma.modelProfile.updateMany({
        where: { providerId: { in: providerIds }, OR: aliasFilter },
        data: {
          modelStatus: "retired",
          retiredAt: new Date(),
          retiredReason: "Removed by operator",
        },
      }),
      prisma.discoveredModel.deleteMany({
        where: { providerId: { in: providerIds }, OR: aliasFilter },
      }),
    ]);
  },
  discover: discoverModelsInternal,
  profile: profileModelsInternal,
};

export async function reconcileRemovedLocalModel(
  reference: string,
  dependencies: LocalModelReconciliationDependencies = prismaReconciliationDependencies,
): Promise<void> {
  const aliases = localModelReferenceAliases(validateLocalModelReference(reference));
  await dependencies.removeProjection(aliases);
  const discovery = await dependencies.discover("local");
  if (discovery.error && discovery.discovered === 0) throw new Error(discovery.error);
  if (discovery.discovered === 0) return;
  const profiling = await dependencies.profile("local");
  if (profiling.error && profiling.profiled === 0) throw new Error(profiling.error);
}

export function localModelInstallJobId(reference: string): string {
  const digest = createHash("sha256")
    .update(canonicalLocalModelKey(reference))
    .digest("hex")
    .slice(0, 24);
  return `${JOB_PREFIX}${digest}`;
}

export function localModelReferenceAliases(reference: string): string[] {
  const aliases = new Set<string>([reference]);
  const withoutLatest = reference.replace(/:latest$/i, "");
  aliases.add(withoutLatest);

  if (/^hf\.co\//i.test(reference)) {
    aliases.add(reference.replace(/^hf\.co\//i, "huggingface.co/"));
  } else if (/^huggingface\.co\//i.test(reference)) {
    aliases.add(reference.replace(/^huggingface\.co\//i, "hf.co/"));
  }

  if (!/^(?:docker\.io|hf\.co|huggingface\.co)\//i.test(reference)) {
    aliases.add(`docker.io/${withoutLatest}`);
    aliases.add(`docker.io/${withoutLatest}:latest`);
  } else if (/^docker\.io\//i.test(reference)) {
    const short = withoutLatest.replace(/^docker\.io\//i, "");
    aliases.add(short);
    aliases.add(`docker.io/${short}:latest`);
  }

  return [...aliases].filter(Boolean);
}

export async function admitLocalModelInstall(
  reference: string,
  requestedByUserId: string,
  repository: LocalModelOperationRepository = prismaLocalModelOperationRepository,
): Promise<{ admitted: boolean; eventId: string; operation: LocalModelOperation }> {
  const modelReference = validateLocalModelReference(reference);
  const result = await repository.admit({
    jobId: localModelInstallJobId(modelReference),
    modelReference,
    requestedByUserId,
  });
  const operation = parseOperation(result.row);
  if (!operation) throw new Error("The local model operation record is invalid.");
  return {
    admitted: result.admitted,
    eventId: `${operation.jobId}:${operation.attempt}`,
    operation,
  };
}

export async function updateLocalModelOperation(
  input: LocalModelOperationUpdate,
  repository: LocalModelOperationRepository = prismaLocalModelOperationRepository,
): Promise<LocalModelOperation | null> {
  const row = await repository.update(input);
  return row ? parseOperation(row) : null;
}

export async function getLocalModelStatusSnapshot(
  repository: LocalModelOperationRepository = prismaLocalModelOperationRepository,
): Promise<LocalModelStatusSnapshot> {
  const [models, rows] = await Promise.all([
    listLocalModels(),
    repository.listRecent(RECENT_OPERATION_LIMIT),
  ]);
  return {
    observedAt: new Date().toISOString(),
    models,
    operations: rows.flatMap((row) => {
      const operation = parseOperation(row);
      return operation ? [operation] : [];
    }),
  };
}

function parseOperation(row: LocalModelOperationRow): LocalModelOperation | null {
  if (!isRecord(row.metadata) || !isOperationStatus(row.lastStatus)) return null;
  const modelReference = stringValue(row.metadata.modelReference);
  const requestedByUserId = stringValue(row.metadata.requestedByUserId);
  const attempt = positiveInteger(row.metadata.attempt);
  if (!modelReference || !requestedByUserId || attempt === null) return null;
  return {
    jobId: row.jobId,
    modelReference,
    comparisonKey: canonicalLocalModelKey(modelReference),
    status: row.lastStatus,
    attempt,
    requestedByUserId,
    transferredBytes: nullableNonNegativeNumber(row.metadata.transferredBytes),
    totalBytes: nullableNonNegativeNumber(row.metadata.totalBytes),
    percent: nullablePercent(row.metadata.percent),
    message: nullableString(row.metadata.message),
    error: row.lastError,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function admitWithPrisma(input: {
  jobId: string;
  modelReference: string;
  requestedByUserId: string;
}): Promise<{ admitted: boolean; row: LocalModelOperationRow }> {
  for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.scheduledJob.findUnique({ where: { jobId: input.jobId } });
        const existingAttempt = isRecord(existing?.metadata)
          ? positiveInteger(existing.metadata.attempt) ?? 0
          : 0;
        if (existing && isOperationStatus(existing.lastStatus) && ACTIVE_STATUSES.has(existing.lastStatus)) {
          return { admitted: false, row: existing };
        }
        const attempt = existingAttempt + 1;
        const metadata = operationMetadata({
          modelReference: input.modelReference,
          requestedByUserId: input.requestedByUserId,
          attempt,
          transferredBytes: null,
          totalBytes: null,
          percent: null,
          message: "Waiting to download",
        });
        const row = await tx.scheduledJob.upsert({
          where: { jobId: input.jobId },
          create: {
            jobId: input.jobId,
            name: `Install local model ${input.modelReference}`.slice(0, 255),
            schedule: "manual",
            enabled: true,
            lastStatus: "queued",
            lastError: null,
            metadata,
          },
          update: {
            lastRunAt: null,
            nextRunAt: null,
            lastStatus: "queued",
            lastError: null,
            metadata,
          },
        });
        return { admitted: true, row };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as { code?: string }).code === "P2034" && attemptNumber < 2) continue;
      throw error;
    }
  }
  throw new Error("Unable to admit the local model operation.");
}

async function updateWithPrisma(
  input: LocalModelOperationUpdate,
): Promise<LocalModelOperationRow | null> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.scheduledJob.findUnique({ where: { jobId: input.jobId } });
    if (!existing || !isRecord(existing.metadata)) return null;
    if (positiveInteger(existing.metadata.attempt) !== input.attempt) return null;
    const metadata = operationMetadata({
      ...existing.metadata,
      ...(input.transferredBytes !== undefined ? { transferredBytes: input.transferredBytes } : {}),
      ...(input.totalBytes !== undefined ? { totalBytes: input.totalBytes } : {}),
      ...(input.percent !== undefined ? { percent: input.percent } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
    });
    return tx.scheduledJob.update({
      where: { jobId: input.jobId },
      data: {
        lastRunAt: input.status === "running" ? new Date() : existing.lastRunAt,
        lastStatus: input.status,
        lastError: input.error ?? null,
        metadata,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export const prismaLocalModelOperationRepository: LocalModelOperationRepository = {
  admit: admitWithPrisma,
  update: updateWithPrisma,
  async listRecent(limit) {
    return prisma.scheduledJob.findMany({
      where: { jobId: { startsWith: JOB_PREFIX } },
      orderBy: { updatedAt: "desc" },
      take: Math.min(Math.max(1, limit), RECENT_OPERATION_LIMIT),
    });
  },
};

function operationMetadata(value: Record<string, unknown>): Prisma.InputJsonObject {
  return {
    modelReference: String(value.modelReference),
    requestedByUserId: String(value.requestedByUserId),
    attempt: Number(value.attempt),
    transferredBytes: value.transferredBytes === null ? null : Number(value.transferredBytes),
    totalBytes: value.totalBytes === null ? null : Number(value.totalBytes),
    percent: value.percent === null ? null : Number(value.percent),
    message: value.message === null ? null : String(value.message),
  };
}

function isOperationStatus(value: unknown): value is LocalModelOperationStatus {
  return typeof value === "string" && OPERATION_STATUSES.has(value as LocalModelOperationStatus);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : stringValue(value);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function nullableNonNegativeNumber(value: unknown): number | null {
  return value === null || value === undefined
    ? null
    : typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : null;
}

function nullablePercent(value: unknown): number | null {
  const number = nullableNonNegativeNumber(value);
  return number !== null && number <= 100 ? number : null;
}

import { randomUUID } from "crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { prisma, type Prisma } from "@dpf/db";

type TaskJson = Prisma.InputJsonValue | null;
type TaskRunReader = { taskRun: Pick<Prisma.TransactionClient["taskRun"], "findUnique"> };
type TaskArtifactWriter = TaskRunReader & { taskArtifact: Pick<Prisma.TransactionClient["taskArtifact"], "create" | "upsert"> };

type TaskMessageWriter = TaskRunReader & { taskMessage: Pick<Prisma.TransactionClient["taskMessage"], "create"> };

function toTaskJson(value: unknown): TaskJson {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function resolveTaskRunRecord(input: {
  publicTaskRunId: string;
  taskRunRecordId?: string | null;
}, db: TaskRunReader = prisma): Promise<{ id: string; contextId: string | null }> {
  if (input.taskRunRecordId) {
    return {
      id: input.taskRunRecordId,
      contextId: null,
    };
  }

  const taskRun = await db.taskRun.findUnique({
    where: { taskRunId: input.publicTaskRunId },
    select: { id: true, contextId: true },
  });

  if (!taskRun) {
    throw new Error(`TaskRun ${input.publicTaskRunId} not found`);
  }

  return taskRun;
}

export async function createTaskMessage(input: {
  taskRunId: string;
  taskRunRecordId?: string | null;
  contextId?: string | null;
  role: string;
  messageType?: string;
  content: string;
  metadata?: unknown;
  referenceTaskIds?: string[];
}, db: TaskMessageWriter = prisma): Promise<void> {
  const taskRun = await resolveTaskRunRecord({
    publicTaskRunId: input.taskRunId,
    taskRunRecordId: input.taskRunRecordId,
  }, db);
  const metadata = toTaskJson(input.metadata);

  await db.taskMessage.create({
    data: {
      id: randomUUID(),
      messageId: `tm_${randomUUID()}`,
      taskRunId: taskRun.id,
      contextId: input.contextId ?? taskRun.contextId ?? null,
      role: input.role,
      parts: toTaskJson([
        {
          type: input.messageType ?? "message",
          text: input.content,
        },
      ]) as Prisma.InputJsonValue,
      referenceTaskIds: input.referenceTaskIds ?? [],
      ...(metadata !== null ? { metadata } : {}),
    },
  });
}

export async function createTaskArtifact(input: {
  /** Server-derived identity for immutable, retry-safe publication. */
  artifactId?: string;
  taskRunId: string;
  taskRunRecordId?: string | null;
  artifactType: string;
  name: string;
  mimeType?: string | null;
  summary?: string | null;
  content?: unknown;
  metadata?: unknown;
  producerAgentId?: string | null;
  producerNodeId?: string | null;
}, db: TaskArtifactWriter = prisma): Promise<{ id: string; artifactId: string }> {
  const taskRun = await resolveTaskRunRecord({
    publicTaskRunId: input.taskRunId,
    taskRunRecordId: input.taskRunRecordId,
  }, db);
  const metadata = toTaskJson(input.metadata);

  const data = {
      id: randomUUID(),
      artifactId: input.artifactId ?? `ta_${randomUUID()}`,
      taskRunId: taskRun.id,
      name: input.name,
      description: input.summary ?? null,
      parts: toTaskJson([
        {
          type: input.artifactType,
          mimeType: input.mimeType ?? "application/json",
          data: input.content ?? null,
        },
      ]) as Prisma.InputJsonValue,
      producerAgentId: input.producerAgentId ?? null,
      producerNodeId: input.producerNodeId ?? null,
      ...(metadata !== null ? { metadata } : {}),
  };
  const created = input.artifactId
    ? await db.taskArtifact.upsert({ where: { artifactId: input.artifactId }, create: data, update: { artifactId: input.artifactId } })
    : await db.taskArtifact.create({ data, select: { id: true, artifactId: true } });
  if (input.artifactId) {
    // Compare semantic JSON: database JSON objects need not preserve key order.
    for (const key of ["taskRunId", "name", "description", "parts", "metadata", "producerAgentId", "producerNodeId"] as const) {
      if (canonicalJson(created[key as keyof typeof created] ?? null) !== canonicalJson(data[key as keyof typeof data] ?? null)) {
        throw new Error("TaskArtifact identity/content conflict: " + input.artifactId);
      }
    }
  }
  return { id: created.id, artifactId: created.artifactId };
}

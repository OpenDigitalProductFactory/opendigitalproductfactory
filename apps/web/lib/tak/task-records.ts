import { randomUUID } from "crypto";
import { prisma, type Prisma } from "@dpf/db";

type TaskJson = Prisma.InputJsonValue | null;

function toTaskJson(value: unknown): TaskJson {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function resolveTaskRunRecord(input: {
  publicTaskRunId: string;
  taskRunRecordId?: string | null;
}): Promise<{ id: string; contextId: string | null }> {
  if (input.taskRunRecordId) {
    return {
      id: input.taskRunRecordId,
      contextId: null,
    };
  }

  const taskRun = await prisma.taskRun.findUnique({
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
}): Promise<void> {
  const taskRun = await resolveTaskRunRecord({
    publicTaskRunId: input.taskRunId,
    taskRunRecordId: input.taskRunRecordId,
  });
  const metadata = toTaskJson(input.metadata);

  await prisma.taskMessage.create({
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
}): Promise<{ id: string; artifactId: string }> {
  const taskRun = await resolveTaskRunRecord({
    publicTaskRunId: input.taskRunId,
    taskRunRecordId: input.taskRunRecordId,
  });
  const metadata = toTaskJson(input.metadata);

  const created = await prisma.taskArtifact.create({
    data: {
      id: randomUUID(),
      artifactId: `ta_${randomUUID()}`,
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
    },
    select: {
      id: true,
      artifactId: true,
    },
  });

  return created;
}

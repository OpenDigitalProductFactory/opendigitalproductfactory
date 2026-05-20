"use server";

import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma, type Prisma } from "@dpf/db";
import { dispatchAgentThread } from "@/lib/actions/agent-thread-dispatcher";
import { createTaskArtifact } from "@/lib/tak/task-records";
import { recordWorkCapsuleEvidence } from "@/lib/work-capsules/work-capsule-store";
import {
  revalidatePortalContextForBuild,
  revalidatePortalContextForTaskRun,
  revalidatePortalContextForThread,
} from "@/lib/portal-context/invalidation";
import { recordPortalContextBacklogEvidence } from "@/lib/portal-context/evidence-recording";
import type { HiveMindCandidate } from "@/lib/portal-context";

const TERMINAL_TASK_STATES = ["completed", "failed", "cancelled", "canceled", "rejected", "archived"];

export type PortalContextHiveInvocationInput = {
  parentTaskRunId: string;
  contextId?: string | null;
  routeContext: string;
  envelopeId?: string | null;
  candidate: Pick<HiveMindCandidate, "agentId" | "label" | "role" | "reason" | "taskType">;
  anchors?: {
    buildId?: string | null;
    capsuleId?: string | null;
    backlogItemId?: string | null;
    epicId?: string | null;
  };
};

export type PortalContextHiveInvocationResult =
  | { ok: true; reused: boolean; taskRunId: string; threadId: string | null }
  | { ok: false; error: string };

type ParentTaskRun = {
  id: string;
  taskRunId: string;
  userId: string;
  threadId: string | null;
  contextId: string | null;
  buildId: string | null;
  routeContext: string | null;
};

export async function invokePortalContextHiveCandidate(
  input: PortalContextHiveInvocationInput,
): Promise<PortalContextHiveInvocationResult> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { ok: false, error: "Unauthorized" };

  const parentTaskRunId = input.parentTaskRunId.trim();
  if (!parentTaskRunId) return { ok: false, error: "Parent task run is required." };

  const parent = await prisma.taskRun.findUnique({
    where: { taskRunId: parentTaskRunId },
    select: {
      id: true,
      taskRunId: true,
      userId: true,
      threadId: true,
      contextId: true,
      buildId: true,
      routeContext: true,
    },
  });
  if (!parent) return { ok: false, error: "Parent task run was not found." };
  if (parent.userId !== user.id) return { ok: false, error: "Unauthorized" };

  const contextId = normalizeNullable(input.contextId) ?? parent.contextId;
  const buildId = normalizeNullable(input.anchors?.buildId) ?? parent.buildId;
  const hiveMindContextId = createHiveMindContextId(parent.taskRunId, contextId, input.candidate.role);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.taskRun.findFirst({
      where: {
        parentTaskRunId: parent.taskRunId,
        contextId,
        status: { notIn: TERMINAL_TASK_STATES },
        a2aMetadata: {
          path: ["hiveMindRole"],
          equals: input.candidate.role,
        },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        taskRunId: true,
        threadId: true,
        status: true,
      },
    });
    if (existing) {
      return {
        reused: true,
        taskRunId: existing.taskRunId,
        taskRunRecordId: existing.id,
        threadId: existing.threadId ?? null,
        created: false,
      };
    }

    const childThread = parent.threadId
      ? await tx.agentThread.create({
          data: {
            userId: user.id!,
            contextKey: `portal-context-hive-${randomUUID()}`,
            parentThreadId: parent.threadId,
          },
          select: { id: true },
        })
      : null;

    if (parent.threadId) {
      await tx.agentThread.updateMany({
        where: { id: parent.threadId },
        data: { childCount: { increment: 1 } },
      });
    }

    const childTaskRunId = createHiveTaskRunId();
    const objective = createHiveObjective(input);
    const created = await tx.taskRun.create({
      data: {
        taskRunId: childTaskRunId,
        userId: user.id!,
        threadId: childThread?.id ?? parent.threadId,
        contextId,
        buildId,
        initiatingAgentId: input.candidate.agentId,
        currentAgentId: input.candidate.agentId,
        parentTaskRunId: parent.taskRunId,
        routeContext: input.routeContext || parent.routeContext,
        title: `${input.candidate.label} portal context review`,
        objective,
        source: "coworker",
        status: "submitted",
        authorityScope: [],
        a2aMetadata: {
          trigger: "portal-context-hive",
          hiveMindContextId,
          hiveMindRole: input.candidate.role,
          envelopeId: input.envelopeId ?? null,
          requestedAgentId: input.candidate.agentId,
          requestedAgentLabel: input.candidate.label,
          taskType: input.candidate.taskType,
          buildId,
          capsuleId: input.anchors?.capsuleId ?? null,
          backlogItemId: input.anchors?.backlogItemId ?? null,
          epicId: input.anchors?.epicId ?? null,
        } as Prisma.InputJsonValue,
      },
      select: { id: true, taskRunId: true, threadId: true },
    });

    if (childThread?.id) {
      await tx.agentMessage.create({
        data: {
          threadId: childThread.id,
          taskRunId: created.taskRunId,
          role: "user",
          content: objective,
          agentId: input.candidate.agentId,
          routeContext: input.routeContext || parent.routeContext,
        },
      });
    }

    return {
      reused: false,
      taskRunId: created.taskRunId,
      taskRunRecordId: created.id,
      threadId: created.threadId ?? null,
      created: true,
    };
  });

  if (result.created) {
    await createTaskArtifact({
      taskRunId: result.taskRunId,
      taskRunRecordId: result.taskRunRecordId,
      artifactType: "hive_invocation_request",
      name: "Portal context hive invocation",
      summary: createHiveEvidenceSummary(input),
      content: {
        routeContext: input.routeContext,
        envelopeId: input.envelopeId ?? null,
        hiveMindContextId,
        candidate: input.candidate,
        anchors: input.anchors ?? {},
      },
      metadata: {
        kind: "portal-context-hive-invocation",
        hiveMindContextId,
        hiveMindRole: input.candidate.role,
      },
      producerAgentId: input.candidate.agentId,
    });

    if (input.anchors?.capsuleId) {
      await recordWorkCapsuleEvidence({
        db: prisma,
        capsuleId: input.anchors.capsuleId,
        evidence: {
          kind: "note",
          summary: createHiveEvidenceSummary(input),
          result: {
            taskRunId: result.taskRunId,
            threadId: result.threadId,
            hiveMindRole: input.candidate.role,
            agentId: input.candidate.agentId,
          },
        },
        actor: {
          userId: user.id,
          agentId: input.candidate.agentId,
          principalId: null,
        },
      });
    }

    await recordPortalContextBacklogEvidence({
      db: prisma,
      backlogItemId: input.anchors?.backlogItemId,
      kind: "portal-context-hive-invoked",
      summary: createHiveEvidenceSummary(input),
      payload: {
        taskRunId: result.taskRunId,
        threadId: result.threadId,
        routeContext: input.routeContext,
        envelopeId: input.envelopeId ?? null,
        hiveMindContextId,
        hiveMindRole: input.candidate.role,
        agentId: input.candidate.agentId,
        anchors: input.anchors ?? {},
      },
      actor: {
        userId: user.id,
        agentId: input.candidate.agentId,
      },
    });
  }

  if (buildId) revalidatePortalContextForBuild(buildId);
  if (result.threadId) revalidatePortalContextForThread(result.threadId);

  if (result.created && result.threadId) {
    try {
      await dispatchAgentThread(result.threadId, user.id);
    } catch (error) {
      await prisma.taskRun.update({
        where: { taskRunId: result.taskRunId },
        data: { status: "failed", completedAt: new Date() },
      });
      revalidatePortalContextForTaskRun(result.taskRunId, result.threadId);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to dispatch hive coworker.",
      };
    }
  }

  return {
    ok: true,
    reused: result.reused,
    taskRunId: result.taskRunId,
    threadId: result.threadId,
  };
}

function createHiveTaskRunId(): string {
  return `TR-HIVE-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function createHiveMindContextId(parentTaskRunId: string, contextId: string | null, role: string): string {
  return `hive:${parentTaskRunId}:${contextId ?? "none"}:${role}`;
}

function createHiveObjective(input: PortalContextHiveInvocationInput): string {
  const anchors = [
    input.anchors?.buildId ? `Build ${input.anchors.buildId}` : null,
    input.anchors?.capsuleId ? `Capsule ${input.anchors.capsuleId}` : null,
    input.anchors?.backlogItemId ? `Backlog ${input.anchors.backlogItemId}` : null,
  ].filter(Boolean).join(", ");

  return [
    `${input.candidate.label} should review the current portal work context as ${input.candidate.role}.`,
    input.candidate.reason,
    anchors ? `Anchors: ${anchors}.` : null,
    "Return a concise task artifact with risks, recommendation, and next action.",
  ].filter(Boolean).join("\n");
}

function createHiveEvidenceSummary(input: PortalContextHiveInvocationInput): string {
  return `${input.candidate.label} asked to review the current portal context.`;
}

function normalizeNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

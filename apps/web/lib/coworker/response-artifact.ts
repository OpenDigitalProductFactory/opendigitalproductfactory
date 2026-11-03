import "server-only";
import { prisma } from "@dpf/db";
import type { PortalContextEnvelope } from "@/lib/portal-context";
import { isSubstantiveCoworkerOutput } from "./agent-coworker-core";

export async function persistCoworkerResponseArtifact(input: {
  taskRunId: string | null;
  responseContent: string;
  routeContext: string;
  threadId: string;
  agentId: string;
  agentName: string;
  providerId: string | null;
  modelId: string | null;
  portalContext: PortalContextEnvelope | null;
  userId: string;
}): Promise<void> {
  if (!input.taskRunId) return;
  if (!isSubstantiveCoworkerOutput(input.responseContent)) return;

  try {
    const { createTaskArtifact } = await import("@/lib/tak/task-records");
    await createTaskArtifact({
      taskRunId: input.taskRunId,
      artifactType: "coworker_response",
      name: "Coworker response",
      summary: input.responseContent.slice(0, 240),
      content: {
        routeContext: input.routeContext,
        threadId: input.threadId,
        response: input.responseContent,
        providerId: input.providerId,
        modelId: input.modelId,
        anchors: input.portalContext?.anchors ?? [],
      },
      metadata: {
        kind: "coworker-response",
        deliveryState: "responded",
        routeContext: input.routeContext,
        envelopeId: input.portalContext?.envelopeId ?? null,
      },
      producerAgentId: input.agentId,
    });

    const capsuleId = input.portalContext?.work?.capsule?.capsuleId ?? null;
    if (capsuleId) {
      const { recordWorkCapsuleEvidence } = await import("@/lib/work-capsules/work-capsule-store");
      await recordWorkCapsuleEvidence({
        db: prisma,
        capsuleId,
        evidence: {
          kind: "note",
          summary: `${input.agentName} response captured for the current portal context.`,
          result: {
            taskRunId: input.taskRunId,
            threadId: input.threadId,
            agentId: input.agentId,
            routeContext: input.routeContext,
          },
        },
        actor: {
          userId: input.userId,
          agentId: input.agentId,
          principalId: input.portalContext?.user?.principalId ?? null,
        },
      });
    }

    const backlogItemId = input.portalContext?.work?.backlogItem?.backlogItemId ?? null;
    if (backlogItemId) {
      const { recordPortalContextBacklogEvidence } = await import("@/lib/portal-context/evidence-recording");
      await recordPortalContextBacklogEvidence({
        db: prisma,
        backlogItemId,
        kind: "portal-context-coworker-response",
        summary: `${input.agentName} response captured for the current portal context.`,
        payload: {
          taskRunId: input.taskRunId,
          threadId: input.threadId,
          agentId: input.agentId,
          routeContext: input.routeContext,
          envelopeId: input.portalContext?.envelopeId ?? null,
        },
        actor: {
          userId: input.userId,
          agentId: input.agentId,
        },
      });
    }
  } catch (error) {
    console.warn("[portal-context] Failed to persist coworker response artifact", error);
  }
}

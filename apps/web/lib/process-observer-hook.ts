// ─── Process Observer Hook — Wires observer into sendMessage ─────────────────
// Async fire-and-forget: never blocks the user's response.

import { prisma } from "@dpf/db";
import { analyzeConversation, type ConversationMessage } from "./process-observer";
import { triageAndFile, type BacklogItemData } from "./process-observer-triage";
import { evaluateAndUpdateProfile } from "./orchestrator-evaluator";
import type { SensitivityLevel } from "./agent-router-types";

export type RoutingMeta = {
  endpointId: string;
  taskType: string;
  sensitivity: string;
  userMessage: string;
  aiResponse: string;
};

const DEFAULT_SAMPLE_RATE = 5;
const threadCounter = new Map<string, number>();

export async function observeConversation(
  threadId: string,
  routeContext: string,
  routingMeta?: RoutingMeta,
): Promise<void> {
  // BRANCH B: Performance evaluation (always fires, bypasses sampling)
  if (routingMeta) {
    evaluateAndUpdateProfile({
      threadId,
      endpointId: routingMeta.endpointId,
      taskType: routingMeta.taskType,
      routeContext,
      sensitivity: routingMeta.sensitivity as SensitivityLevel,
      userMessage: routingMeta.userMessage,
      aiResponse: routingMeta.aiResponse,
    }).catch((err) => console.error("[orchestrator-evaluator]", err));
  }

  // BRANCH A: Existing analysis (respects sampling) — existing code below unchanged
  // /build gets realtime observation; everything else is sampled
  const mode = routeContext.startsWith("/build") ? "realtime" : "sampled";

  if (mode === "sampled") {
    const count = (threadCounter.get(threadId) ?? 0) + 1;
    threadCounter.set(threadId, count);
    if (count % DEFAULT_SAMPLE_RATE !== 0) return;
  }

  const messages = await prisma.agentMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, role: true, content: true, agentId: true, routeContext: true },
  });

  const transcript: ConversationMessage[] = messages.reverse().map((m) => ({
    id: m.id,
    role: m.role as ConversationMessage["role"],
    content: m.content,
    agentId: m.agentId ?? "",
    routeContext: m.routeContext ?? "",
  }));

  const findings = analyzeConversation(transcript);
  if (findings.length === 0) return;

  // Resolve product context
  let digitalProductId: string | null = null;
  if (routeContext.startsWith("/build")) {
    const thread = await prisma.agentThread.findUnique({
      where: { id: threadId },
      select: { userId: true },
    });
    if (thread) {
      const build = await prisma.featureBuild.findFirst({
        where: { createdById: thread.userId, phase: { notIn: ["complete", "failed"] } },
        orderBy: { updatedAt: "desc" },
        select: { digitalProductId: true },
      });
      digitalProductId = build?.digitalProductId ?? null;
    }
  }

  await triageAndFile(
    findings,
    { digitalProductId, routeContext },
    {
      getExistingTitles: async () => {
        const items = await prisma.backlogItem.findMany({
          where: { source: "process_observer" },
          select: { title: true },
        });
        return items.map((i) => i.title);
      },
      createBacklogItem: async (data: BacklogItemData) => {
        await prisma.backlogItem.create({ data });
      },
    },
  );
}

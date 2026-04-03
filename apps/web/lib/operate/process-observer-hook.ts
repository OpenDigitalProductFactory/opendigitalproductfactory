// ─── Process Observer Hook — Wires observer into sendMessage ─────────────────
// Async fire-and-forget: never blocks the user's response.

import { prisma } from "@dpf/db";
import { analyzeConversation, inferHumanScore, type ConversationMessage } from "./process-observer";
import { triageAndFile, type BacklogItemData } from "./process-observer-triage";
import { evaluateAndUpdateProfile, updateHumanScore } from "@/lib/orchestrator-evaluator";
import type { SensitivityLevel } from "@/lib/agent-router-types";

export type RoutingMeta = {
  endpointId: string;
  taskType: string;
  sensitivity: string;
  userMessage: string;
  aiResponse: string;
  agentId?: string; // EP-AI-WORKFORCE-001: agent slug for performance bridging
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
      agentId: routingMeta.agentId, // EP-AI-WORKFORCE-001
    }).catch((err) => console.error("[orchestrator-evaluator]", err));
  }

  // BRANCH C: Human feedback inference (fires when there are messages to analyze)
  if (routingMeta === undefined) {
    // Only infer feedback when we're NOT processing a new AI response
    // (routingMeta undefined means this is a user message turn, good time to evaluate prior AI)
    const feedbackMessages = await prisma.agentMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, role: true, content: true, agentId: true, routeContext: true },
    });

    if (feedbackMessages.length >= 2) {
      const feedbackTranscript: ConversationMessage[] = feedbackMessages.reverse().map((m) => ({
        id: m.id,
        role: m.role as ConversationMessage["role"],
        content: m.content,
        agentId: m.agentId ?? "",
        routeContext: m.routeContext ?? "",
      }));

      const assistantMessages = feedbackTranscript.filter((m) => m.role === "assistant");
      const userMessages = feedbackTranscript.filter((m) => m.role === "user");
      const lastAssistant = assistantMessages[assistantMessages.length - 1];
      const lastUser = userMessages[userMessages.length - 1];

      if (lastAssistant && lastUser) {
        const humanScore = inferHumanScore(lastAssistant, lastUser);
        if (humanScore !== null) {
          // Find the prior evaluation for this assistant message and update it
          prisma.taskEvaluation.updateMany({
            where: {
              threadId,
              humanScore: null,
            },
            data: { humanScore },
          }).catch((err) => console.error("[human-feedback]", err));

          // Also update the performance profile's human score
          const priorMsg = await prisma.agentMessage.findFirst({
            where: { threadId, role: "assistant", routedEndpointId: { not: null } },
            orderBy: { createdAt: "desc" },
            select: { routedEndpointId: true, taskType: true },
          });
          if (priorMsg?.routedEndpointId && priorMsg?.taskType) {
            updateHumanScore(priorMsg.routedEndpointId, priorMsg.taskType, humanScore)
              .catch((err) => console.error("[human-feedback-profile]", err));
          }
        }
      }
    }
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

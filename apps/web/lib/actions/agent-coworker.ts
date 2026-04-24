"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { validateMessageInput } from "@/lib/agent-coworker-types";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import { generateCannedResponse } from "@/lib/agent-routing";
import { resolveAgentForRouteWithPrompts } from "@/lib/tak/agent-routing-server";
import { serializeMessage } from "@/lib/agent-coworker-data";
import {
  NoAllowedProvidersForSensitivityError,
  NoProvidersAvailableError,
} from "@/lib/ai-provider-priority";
import { NoEligibleEndpointsError } from "@/lib/routed-inference";
import { logTokenUsage } from "@/lib/ai-inference";
import type { ChatMessage } from "@/lib/ai-inference";
import { buildCoworkerContextKey } from "@/lib/agent-coworker-context";
import {
  buildFormAssistInstruction,
  extractFormAssistResult,
  type AgentFormAssistContext,
} from "@/lib/agent-form-assist";
// mcp-tools is imported dynamically at call sites to avoid NFT whole-project tracing
import type { BuildPhaseTag } from "@/lib/mcp-tools";
import { getActionsForRoute } from "@/lib/agent-action-registry";
import { getBuildContextSection } from "@/lib/build-agent-prompts";
import { getFeatureBuildForContext } from "@/lib/feature-build-data";
// file-upload is imported dynamically at call site to avoid NFT whole-project tracing
import { getRouteDataContext } from "@/lib/route-context";
import { observeConversation } from "@/lib/process-observer-hook";
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";
import { resolveRouteContext } from "@/lib/route-context-map";
import { assembleSystemPrompt } from "@/lib/prompt-assembler";
import { getGrantedCapabilities, getDeniedCapabilities } from "@/lib/permissions";
import { classifyTask } from "@/lib/task-classifier";
import { getTaskType } from "@/lib/task-types";
import { loadPerformanceProfiles, ensurePerformanceProfile } from "@/lib/agent-router-data";
import type { RoutingMeta } from "@/lib/process-observer-hook";
import {
  ensureTaskForCoworkerTurn,
  projectThreadMessageToTask,
} from "@/lib/tak/task-chat-projection";

// ─── Auth helper ────────────────────────────────────────────────────────────

async function requireAuthUser() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");
  return user;
}

/**
 * Build the coworker's chat summary of the ideate-research + design-review
 * outcome. Reads the build's CURRENT phase after the review tool finished
 * (the review tool auto-advances to plan when the gate is satisfied) so the
 * message reflects what ACTUALLY happened rather than a stale "Ready to
 * move to the planning phase?" question that sends users in circles.
 */
async function summariseIdeateOutcome(
  approach: string,
  reviewPassed: boolean,
  buildId: string,
): Promise<string> {
  let currentPhase: string | null = null;
  try {
    const refreshed = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { phase: true },
    });
    currentPhase = refreshed?.phase ?? null;
  } catch {
    // Non-fatal — fall through to a generic message below.
  }

  const head = `I've researched the codebase and drafted the design.\n\n**Approach:** ${approach.slice(0, 300)}\n\n`;

  if (!reviewPassed) {
    return `${head}Design review flagged some issues — I'll revise and re-run the review.`;
  }

  if (currentPhase === "plan") {
    return `${head}Design review passed and we're now in the Plan phase. I'll draft the implementation plan next.`;
  }
  if (currentPhase === "ideate") {
    // Review passed but auto-advance gate held us. Make the blocker visible
    // instead of asking a rhetorical "ready?" question.
    return `${head}Design review passed, but the phase gate is holding advance (usually missing intake anchors — taxonomy, backlog, epic, or a constrained goal). I'll complete the remaining anchors and retry.`;
  }
  return `${head}Design review passed. Current phase: ${currentPhase ?? "unknown"}.`;
}

// ─── Server Actions ─────────────────────────────────────────────────────────

/**
 * Load a thread's messages by its DB id (not by route context).
 *
 * Use this when the caller already knows which thread it's displaying
 * (e.g. AgentCoworkerPanel has `threadId` as a prop). The generic
 * `getOrCreateThreadSnapshot({routeContext})` lookup can land on a
 * DIFFERENT thread when the route context differs from the thread's
 * original context — e.g. on /build the panel is bound to
 * `/build#FB-xxx` via the Shell, but `pathname === "/build"`, and
 * fetching by route context would return the empty generic /build
 * thread, blowing away the active-build messages. This overload
 * binds the fetch to the actual thread id.
 */
export async function getThreadSnapshotById(input: {
  threadId: string;
}): Promise<{ threadId: string; messages: AgentMessageRow[] } | null> {
  const user = await requireAuthUser();

  const thread = await prisma.agentThread.findFirst({
    where: { id: input.threadId, userId: user.id },
    select: { id: true },
  });
  if (!thread) return null;

  const messages = await prisma.agentMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      role: true,
      content: true,
      agentId: true,
      routeContext: true,
      createdAt: true,
      attachments: {
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, parsedContent: true },
      },
    },
  });

  return {
    threadId: thread.id,
    messages: messages.reverse().map((m) => serializeMessage(m)),
  };
}

export async function getOrCreateThreadSnapshot(input: {
  routeContext: string;
}): Promise<{ threadId: string; messages: AgentMessageRow[] } | null> {
  const user = await requireAuthUser();

  // Verify user exists in DB (JWT may reference a stale user after re-seed)
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true },
  });
  if (!dbUser) return null;

  const contextKey = buildCoworkerContextKey(input.routeContext);

  const thread = await prisma.agentThread.upsert({
    where: { userId_contextKey: { userId: user.id, contextKey } },
    update: {},
    create: { userId: user.id, contextKey },
    select: { id: true },
  });

  const messages = await prisma.agentMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      role: true,
      content: true,
      agentId: true,
      routeContext: true,
      createdAt: true,
      attachments: {
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, parsedContent: true },
      },
    },
  });

  return {
    threadId: thread.id,
    messages: messages.reverse().map((m) => serializeMessage(m)),
  };
}

export async function getOrCreateThread(input?: {
  routeContext?: string;
}): Promise<{ threadId: string } | null> {
  const snapshot = await getOrCreateThreadSnapshot({
    routeContext: input?.routeContext ?? "/workspace",
  });
  return snapshot ? { threadId: snapshot.threadId } : null;
}

export async function sendMessage(input: {
  threadId: string;
  content: string;
  routeContext: string;
  coworkerMode?: "advise" | "act";
  externalAccessEnabled?: boolean;
  elevatedFormFillEnabled?: boolean;
  formAssistContext?: AgentFormAssistContext;
  buildId?: string;
  attachmentId?: string;
}): Promise<
  | { userMessage: AgentMessageRow; agentMessage: AgentMessageRow; systemMessage?: AgentMessageRow; formAssistUpdate?: Record<string, unknown> }
  | { error: string }
> {
  const user = await requireAuthUser();

  // Verify thread ownership
  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return { error: "Unauthorized" };
  }

  // Validate input
  const validationError = validateMessageInput(input);
  if (validationError) return { error: validationError };

  const trimmedContent = input.content.trim();
  let currentTaskRun: Awaited<ReturnType<typeof ensureTaskForCoworkerTurn>> | null = null;
  let taskProjectionAgentId: string | null = null;

  const getCurrentTaskRun = async (agentId?: string | null) => {
    if (currentTaskRun && (!agentId || taskProjectionAgentId === agentId)) {
      return currentTaskRun;
    }

    currentTaskRun = await ensureTaskForCoworkerTurn({
      userId: user.id!,
      threadId: input.threadId,
      routeContext: input.routeContext,
      content: trimmedContent,
      agentId: agentId ?? null,
    }).catch(() => null);

    if (agentId) {
      taskProjectionAgentId = agentId;
    }

    return currentTaskRun;
  };

  const createProjectedAgentMessage = async (message: {
    role: "user" | "assistant" | "system";
    content: string;
    agentId?: string | null;
    routeContext?: string | null;
    providerId?: string | null;
    taskType?: string | null;
    routedEndpointId?: string | null;
    messageType?: string;
    metadata?: Record<string, unknown>;
  }) => {
    const taskRun = await getCurrentTaskRun(message.agentId ?? null);
    const persisted = await prisma.agentMessage.create({
      data: {
        threadId: input.threadId,
        taskRunId: taskRun?.taskRunId ?? null,
        role: message.role,
        content: message.content,
        ...(message.agentId !== undefined ? { agentId: message.agentId } : {}),
        ...(message.routeContext !== undefined ? { routeContext: message.routeContext } : {}),
        ...(message.providerId !== undefined ? { providerId: message.providerId } : {}),
        ...(message.taskType !== undefined ? { taskType: message.taskType } : {}),
        ...(message.routedEndpointId !== undefined ? { routedEndpointId: message.routedEndpointId } : {}),
      },
      select: {
        id: true,
        role: true,
        content: true,
        agentId: true,
        routeContext: true,
        createdAt: true,
      },
    });

    if (taskRun) {
      await projectThreadMessageToTask({
        task: taskRun,
        role: persisted.role,
        content: persisted.content,
        routeContext: persisted.routeContext ?? input.routeContext,
        agentId: persisted.agentId ?? message.agentId ?? null,
        providerId: message.providerId ?? null,
        taskType: message.taskType ?? null,
        routedEndpointId: message.routedEndpointId ?? null,
        messageType: message.messageType,
        metadata: {
          threadMessageId: persisted.id,
          ...(message.metadata ?? {}),
        },
      }).catch(() => {});
    }

    return persisted;
  };

  // Handle "re-enable" command — last-resort provider recovery
  if (trimmedContent.toLowerCase() === "re-enable") {
    const reEnabled = await prisma.modelProvider.findFirst({
      where: { status: "inactive" },
      orderBy: { updatedAt: "desc" },
      select: { providerId: true, name: true },
    });
    if (reEnabled) {
      await prisma.modelProvider.update({
        where: { providerId: reEnabled.providerId },
        data: { status: "active" },
      });
      // Cancel the re-enable scheduled job if it exists
      await prisma.scheduledJob.deleteMany({
        where: { jobId: `provider-reenable-${reEnabled.providerId}` },
      }).catch(() => {});

      const sysMsg = await createProjectedAgentMessage({
        role: "system",
        content: `${reEnabled.name} has been re-enabled. It may have reduced quota — try sending your message again.`,
        routeContext: input.routeContext,
        messageType: "status",
      });

      // Fire-and-forget: process observer
      observeConversation(input.threadId, input.routeContext).catch((err) =>
        console.error("[process-observer]", err),
      );

      return {
        userMessage: serializeMessage(await createProjectedAgentMessage({
          role: "user",
          content: trimmedContent,
          routeContext: input.routeContext,
        })),
        agentMessage: serializeMessage(sysMsg),
      };
    }
  }

  // Persist user message
  const userMsg = await createProjectedAgentMessage({
    role: "user",
    content: trimmedContent,
    routeContext: input.routeContext,
  });

  // Link attachment to the user message if provided
  if (input.attachmentId) {
    await prisma.agentAttachment.update({
      where: { id: input.attachmentId },
      data: { messageId: userMsg.id },
    });
    // Re-fetch so the serialized response includes the attachment
    const linked = await prisma.agentAttachment.findMany({
      where: { messageId: userMsg.id },
      select: { id: true, fileName: true, mimeType: true, sizeBytes: true, parsedContent: true },
    });
    (userMsg as Record<string, unknown>).attachments = linked;
  }

  // Always inject all thread attachments so the agent remembers uploaded files
  const threadAttachments = await prisma.agentAttachment.findMany({
    where: { threadId: input.threadId },
    orderBy: { createdAt: "asc" },
    select: { fileName: true, parsedContent: true },
  });
  let attachmentContext: string | null = null;
  if (threadAttachments.length > 0) {
    const summaries = threadAttachments.map((att) => {
      const parsed = att.parsedContent as Record<string, unknown> | null;
      if (!parsed) return `- ${att.fileName} (uploaded but content not available)`;
      const summary = parsed.summary ?? "";
      const columns = Array.isArray(parsed.columns) ? `\n  Columns: ${(parsed.columns as string[]).join(", ")}` : "";
      // Include sample data rows for spreadsheets
      let sampleData = "";
      if (Array.isArray(parsed.sampleRows) && (parsed.sampleRows as string[][]).length > 0) {
        const rows = parsed.sampleRows as string[][];
        const header = Array.isArray(parsed.columns) ? (parsed.columns as string[]).join(" | ") : "";
        const dataLines = rows.map((r) => r.join(" | ")).join("\n    ");
        sampleData = header ? `\n  Data:\n    ${header}\n    ${dataLines}` : `\n  Data:\n    ${dataLines}`;
      }
      const text = typeof parsed.fullText === "string" ? `\n  Content: ${(parsed.fullText as string).slice(0, 2000)}` : "";
      return `- ${att.fileName}: ${summary}${columns}${sampleData}${text}`;
    });
    attachmentContext = [
      "",
      "FILE UPLOADS — THE USER HAS UPLOADED FILES. THEIR CONTENT IS BELOW.",
      "You CAN see this data. Do NOT say you cannot read files. Use this data to answer the user's question.",
      "",
      ...summaries,
    ].join("\n");
  }

  // Check unified coworker feature flag
  const useUnified = await isUnifiedCoworkerEnabled();

  // Resolve agent
  const agent = await resolveAgentForRouteWithPrompts(input.routeContext, {
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  }, useUnified);

  // Track build ID at function scope — used in both prompt assembly and post-inference research dispatch
  let resolvedBuildId = input.buildId;

  // Build inference context: recent window + semantic recall for older context.
  // Build phases need more context (research findings, schema details, tool results)
  // because the agentic loop's tool call results aren't persisted in messages.
  // Conversation phases use a shorter window to prevent context poisoning.
  const isBuildPhase = input.routeContext === "/build";
  const RECENT_WINDOW = isBuildPhase ? 20 : 8;
  const recentMessages = await prisma.agentMessage.findMany({
    where: { threadId: input.threadId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: RECENT_WINDOW,
    select: { id: true, role: true, content: true },
  });
  // Token-aware trimming: keep newest messages up to a token budget.
  // Prevents 8 long messages from overwhelming context.
  const CHAT_HISTORY_TOKEN_BUDGET = isBuildPhase ? 4000 : 2000;
  const reversed = recentMessages.reverse();
  let historyTokens = 0;
  const trimmedMessages: typeof reversed = [];
  // Walk from newest (end) to oldest, accumulating tokens
  for (let i = reversed.length - 1; i >= 0; i--) {
    const msgTokens = Math.ceil(reversed[i]!.content.length / 4);
    if (historyTokens + msgTokens > CHAT_HISTORY_TOKEN_BUDGET && trimmedMessages.length >= 2) break;
    trimmedMessages.unshift(reversed[i]!);
    historyTokens += msgTokens;
  }
  // Track message IDs for semantic recall dedup
  const windowMessageIds = new Set(trimmedMessages.map((m) => m.id));
  const chatHistory: ChatMessage[] = trimmedMessages.map((m) => ({
    role: m.role as ChatMessage["role"],
    content: m.content,
  }));

  // Enrich the last user message with file content so the LLM sees it inline,
  // not just in the system prompt. LLMs pay more attention to message content
  // than system prompt context.
  if (attachmentContext && chatHistory.length > 0) {
    const lastIdx = chatHistory.length - 1;
    const last = chatHistory[lastIdx]!;
    if (last.role === "user") {
      const lastText = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
      chatHistory[lastIdx] = {
        role: "user",
        content: `${lastText}\n\n${attachmentContext}`,
      };
    }
  }

  let populatedPrompt: string;

  if (useUnified) {
    // ── Unified prompt path: composable blocks from route-context-map + prompt-assembler ──
    // EP-CTX-001: Context sources are submitted to the arbitrator, which enforces
    // per-model-tier token budgets and priority-based selection.
    const routeCtx = resolveRouteContext(input.routeContext);
    const userCtx = { platformRole: user.platformRole, isSuperuser: user.isSuperuser };
    const granted = getGrantedCapabilities(userCtx);
    const denied = getDeniedCapabilities(userCtx);

    const routeData = await getRouteDataContext(input.routeContext, user.id!);

    // EP-KM-001: Load knowledge pointers (title-only, not full summaries)
    let knowledgePointers = "";
    try {
      knowledgePointers = await getKnowledgePointersForRoute(input.routeContext);
    } catch {
      // Non-blocking
    }

    // EP-CTX-001: Build context sources for arbitration
    const { arbitrate, getBudgetForTier, inferModelTierFromRoute, countTokens, formatArbitrationLog } = await import("@/lib/tak/context-arbitrator");
    const modelTier = inferModelTierFromRoute(input.routeContext);
    const budget = getBudgetForTier(modelTier);

    const domainBlock = routeCtx.domainTools.length > 0
      ? routeCtx.domainContext + `\nAvailable domain tools: ${routeCtx.domainTools.join(", ")}`
      : routeCtx.domainContext;

    // User facts: structured memory from prior conversations
    const { loadUserFacts, formatFactsAsContext, formatFactsCompressed } = await import("@/lib/tak/user-facts");
    const routeDomain = input.routeContext.replace(/^\//, "").split("/")[0] || undefined;
    const userFacts = await loadUserFacts(user.id!, routeDomain).catch(() => []);
    const factsContext = formatFactsAsContext(userFacts);
    const factsCompressed = formatFactsCompressed(userFacts);

    // Semantic memory: recall relevant context from past conversations, scoped to current route.
    // Pass excludeMessageIds to avoid duplicating content already in the chat window.
    const { recallRelevantContext } = await import("@/lib/semantic-memory");
    const recalledContext = await recallRelevantContext({
      query: input.content,
      userId: user.id!,
      routeContext: input.routeContext,
      limit: 8,
      excludeMessageIds: windowMessageIds,
    }).catch(() => null);

    // Build compressed version: top 3 results only
    let compressedRecall: string | undefined;
    if (recalledContext) {
      const lines = recalledContext.split("\n");
      const headerLines = lines.slice(0, 3); // header text
      const memoryLines = lines.slice(3, 6); // top 3 memories
      compressedRecall = [...headerLines, ...memoryLines].join("\n");
    }

    const contextSources = [
      // L1: Route-essential context
      { tier: "L1" as const, priority: 0, content: domainBlock, tokenCount: countTokens(domainBlock), source: "domain", compressible: false },
      // L1: User facts — structured memory from prior conversations
      ...(factsContext ? [{
        tier: "L1" as const, priority: 1, content: factsContext, tokenCount: countTokens(factsContext),
        source: "user-facts", compressible: true,
        compressedContent: factsCompressed ?? "",
        compressedTokenCount: countTokens(factsCompressed ?? ""),
      }] : []),
      // L2: Situational — page data
      ...(routeData ? [{
        tier: "L2" as const, priority: 1, content: `--- PAGE DATA ---\n${routeData}`, tokenCount: countTokens(routeData),
        source: "page-data", compressible: true,
        compressedContent: `--- PAGE DATA ---\n${routeData.slice(0, 400)}...`,
        compressedTokenCount: countTokens(routeData.slice(0, 400)),
      }] : []),
      // L2: Semantic memory — past conversation context
      ...(recalledContext ? [{
        tier: "L2" as const, priority: 2, content: recalledContext, tokenCount: countTokens(recalledContext),
        source: "semantic-memory", compressible: true,
        compressedContent: compressedRecall!,
        compressedTokenCount: countTokens(compressedRecall!),
      }] : []),
      // L2: Knowledge pointers
      ...(knowledgePointers ? [{
        tier: "L2" as const, priority: 3, content: knowledgePointers, tokenCount: countTokens(knowledgePointers),
        source: "knowledge", compressible: true, compressedContent: "", compressedTokenCount: 0,
      }] : []),
      // L2: Attachments — already injected inline in the last user message (lines 273-283)
      // for better LLM attention. Do NOT duplicate here in the system prompt.
      // See EP-CTX-001: attachment dedup.
    ];

    const result = arbitrate(contextSources, budget);

    // Context arbitration logging — always on for operator visibility
    console.log(formatArbitrationLog(result, budget));

    // Reconstruct domain context and route data from selected sources
    const selectedDomain = result.selected.find((s) => s.source === "domain")?.content ?? routeCtx.domainContext;
    const selectedPageData = result.selected.find((s) => s.source === "page-data")?.content?.replace("--- PAGE DATA ---\n", "") ?? null;
    const selectedAttachments = result.selected.find((s) => s.source === "attachments")?.content ?? null;
    const selectedKnowledge = result.selected.find((s) => s.source === "knowledge")?.content ?? null;
    const selectedMemory = result.selected.find((s) => s.source === "semantic-memory")?.content ?? null;

    // Merge knowledge and semantic memory into domain context if they made the budget
    let finalDomainContext = selectedDomain;
    if (selectedKnowledge) finalDomainContext += "\n\n" + selectedKnowledge;
    if (selectedMemory) finalDomainContext += "\n\n" + selectedMemory;

    populatedPrompt = await assembleSystemPrompt({
      hrRole: user.platformRole ?? "none",
      grantedCapabilities: granted,
      deniedCapabilities: denied,
      mode: (input.coworkerMode as "advise" | "act") ?? "advise",
      sensitivity: routeCtx.sensitivity,
      domainContext: finalDomainContext,
      domainTools: [], // Already included in domain block
      routeData: selectedPageData,
      attachmentContext: selectedAttachments,
    });
  } else {
    // ── Legacy persona-based prompt assembly ──
    const promptSections = [
      agent.systemPrompt,
      "",
      "Current context:",
      `- Route: ${input.routeContext}`,
      `- User role: ${user.platformRole ?? "none"}`,
      `- Page sensitivity: ${agent.sensitivity}`,
    ];

    if (input.elevatedFormFillEnabled && input.formAssistContext) {
      promptSections.push("", buildFormAssistInstruction(input.formAssistContext));
    }

    // Inject Build Studio context — use explicit buildId or auto-resolve on /build route
    if (!resolvedBuildId && input.routeContext.startsWith("/build")) {
      // Auto-resolve: find the user's most recent non-terminal build
      const latestBuild = await prisma.featureBuild.findFirst({
        where: { createdById: user.id!, phase: { notIn: ["complete", "failed"] } },
        orderBy: { updatedAt: "desc" },
        select: { buildId: true },
      });
      resolvedBuildId = latestBuild?.buildId ?? undefined;
    }
    if (resolvedBuildId) {
      const buildCtx = await getFeatureBuildForContext(resolvedBuildId, user.id!);
      if (buildCtx) {
        promptSections.push(await getBuildContextSection(buildCtx));

        // Detect if the reusability question was already asked and answered.
        // The ideate prompt says "Ask ONE question about reusability" but the model
        // re-reads this instruction every call and re-asks. Inject a guard.
        if (buildCtx.phase === "ideate" && chatHistory.length > 2) {
          const assistantMsgs = chatHistory.filter(m => m.role === "assistant").map(m => typeof m.content === "string" ? m.content : "");
          const askedReusability = assistantMsgs.some(msg =>
            /reusab|other.*provider|other.*certification|configurable|generic/i.test(msg)
          );
          if (askedReusability) {
            promptSections.push(
              "\n--- IMPORTANT: Reusability question already asked ---\n" +
              "You have ALREADY asked the user about reusability/scope. The user answered in the conversation history above. " +
              "Do NOT ask again. Skip Step 2 of the ideate process. Proceed directly to Step 3 (design document) using the user's answer."
            );
          }
        }
      }

      // Inject live build execution progress so the user can interact mid-build
      try {
        const buildRecord = await prisma.featureBuild.findUnique({
          where: { buildId: resolvedBuildId },
          select: { buildExecState: true, verificationOut: true, taskResults: true, phase: true },
        });
        if (buildRecord?.phase === "build" && buildRecord.buildExecState) {
          const execState = buildRecord.buildExecState as Record<string, unknown>;
          const progressLines = [
            "",
            "--- Build Execution Progress ---",
            `Pipeline step: ${execState.step ?? "unknown"}`,
          ];
          if (execState.containerId) progressLines.push(`Sandbox: ${execState.containerId}`);
          if (execState.error) progressLines.push(`Last error: ${String(execState.error).slice(0, 300)}`);
          if (buildRecord.taskResults) {
            const tasks = buildRecord.taskResults as Record<string, unknown>;
            if (tasks.toolsExecuted) progressLines.push(`Tools executed: ${(tasks.toolsExecuted as string[]).join(", ")}`);
          }
          if (buildRecord.verificationOut) {
            const verify = buildRecord.verificationOut as Record<string, unknown>;
            progressLines.push(`Tests: ${verify.testsPassed ? "PASS" : "FAIL"}. Typecheck: ${verify.typeCheckPassed ? "PASS" : "FAIL"}.`);
          }
          promptSections.push(progressLines.join("\n"));
        }
      } catch {
        // Non-fatal — proceed without progress context
      }
    }

    if (attachmentContext) {
      promptSections.push(attachmentContext);
    }

    // Inject route-specific page data context
    const routeData = await getRouteDataContext(input.routeContext, user.id!);
    if (routeData) {
      promptSections.push(routeData);
    }

    // Semantic memory: recall relevant context from ALL conversations.
    // With a short recent window (8 messages), semantic recall is the primary
    // mechanism for remembering older context — both cross-thread and same-thread.
    const { recallRelevantContext } = await import("@/lib/semantic-memory");
    const recalledContext = await recallRelevantContext({
      query: input.content,
      userId: user.id!,
      routeContext: input.routeContext,
      // Don't exclude current thread — we need older same-thread context too
      limit: 8,
    }).catch(() => null);
    if (recalledContext) {
      promptSections.push(recalledContext);
    }

    populatedPrompt = promptSections.join("\n");
  }

  // Get ALL platform tools (no mode filtering — we filter the merged set below)
  const { getAvailableTools, toolsToOpenAIFormat } = await import("@/lib/mcp-tools");
  const allPlatformTools = await getAvailableTools({
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  }, {
    externalAccessEnabled: input.externalAccessEnabled === true,
    // Skip mode filtering here — applied to merged set
    unifiedMode: useUnified,
    agentId: agent.agentId,
  });

  // Get page-specific actions
  const pageActions = getActionsForRoute(input.routeContext, {
    userId: user.id!,
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  });

  // Merge and apply mode + build phase filtering
  const mergedTools = [...allPlatformTools, ...pageActions];

  // Resolve the active build phase for tool filtering
  let activeBuildPhase: string | null = null;
  if (input.routeContext.startsWith("/build")) {
    const activeBuild = await prisma.featureBuild.findFirst({
      where: { createdById: user.id!, phase: { notIn: ["complete", "failed"] } },
      orderBy: { updatedAt: "desc" },
      select: { phase: true, buildId: true, threadId: true },
    }).catch(() => null);
    activeBuildPhase = activeBuild?.phase ?? null;

    // Link build to this chat thread so the BuildStudio UI can live-refresh
    // via SSE when the AI updates the build phase, sandbox, or evidence.
    if (activeBuild && !activeBuild.threadId && input.threadId) {
      prisma.featureBuild.update({
        where: { buildId: activeBuild.buildId },
        data: { threadId: input.threadId },
      }).catch(() => {});
    }
  }

  const availableTools = mergedTools.filter((t) => {
    // Advise mode: exclude side-effect tools
    if (input.coworkerMode === "advise" && t.sideEffect) return false;
    // Build phase filtering: when in a build, ONLY include tools that are
    // explicitly assigned to the current phase. This prevents tool overload
    // (53+ tools) which causes smaller models to miss critical tools.
    if (activeBuildPhase) {
      if (!t.buildPhases) return false; // Exclude general-purpose tools during builds
      return t.buildPhases.includes(activeBuildPhase as BuildPhaseTag);
    }
    return true;
  });

  // Conversation-only detection: if the message is a conversational skill (analyze, advise),
  // strip tools entirely so the model responds with text instead of trying to call tools.
  const isConversationOnly = /^This is a CONVERSATION request/i.test(trimmedContent);

  const toolsForProvider = (!isConversationOnly && availableTools.length > 0)
    ? toolsToOpenAIFormat(availableTools)
    : undefined;

  // Log tools available for this build phase (helps diagnose missing tool issues)
  if (activeBuildPhase) {
    console.log(`[tools] Phase: ${activeBuildPhase} | ${availableTools.length} tools: ${availableTools.map(t => t.name).join(", ")}`);

    // Inject PhaseHandoff context — structured summary from the previous phase
    // replaces raw chat history for focused, token-efficient context
    try {
      const activeBuild = await prisma.featureBuild.findFirst({
        where: { createdById: user.id!, phase: { notIn: ["complete", "failed"] } },
        orderBy: { updatedAt: "desc" },
        select: { buildId: true },
      });
      if (activeBuild) {
        const latestHandoff = await prisma.phaseHandoff.findFirst({
          where: { buildId: activeBuild.buildId, toPhase: activeBuildPhase },
          orderBy: { createdAt: "desc" },
        });
        if (latestHandoff) {
          const handoffContext = [
            "",
            "## Context from Previous Phase",
            "",
            `Phase: ${latestHandoff.fromPhase} -> ${latestHandoff.toPhase} (handed off by ${latestHandoff.fromAgentId})`,
            `Summary: ${latestHandoff.summary}`,
            latestHandoff.decisionsMade.length > 0 ? `Decisions: ${latestHandoff.decisionsMade.join("; ")}` : null,
            latestHandoff.openIssues.length > 0 ? `Open Issues: ${latestHandoff.openIssues.join("; ")}` : null,
            latestHandoff.userPreferences.length > 0 ? `User Preferences: ${latestHandoff.userPreferences.join("; ")}` : null,
            "",
            "Evidence:",
            ...Object.entries(latestHandoff.evidenceDigest as Record<string, string>).map(
              ([field, digest]) => `- ${field}: ${digest}`,
            ),
          ].filter(Boolean).join("\n");
          populatedPrompt += handoffContext;
          console.log(`[handoff] Injected PhaseHandoff context for ${activeBuildPhase} (${handoffContext.length} chars)`);
        }
      }
    } catch (err) {
      console.error("[handoff] Failed to load PhaseHandoff:", err);
    }

    // Ship phase: inject impact analysis and approval authority context
    // so the AI Coworker can present the approval card to the user
    if (activeBuildPhase === "ship") {
      try {
        const shipBuild = await prisma.featureBuild.findFirst({
          where: { createdById: user.id!, phase: "ship" },
          orderBy: { updatedAt: "desc" },
          select: { buildId: true, diffPatch: true, title: true },
        });
        if (shipBuild?.diffPatch) {
          const { analyzeChangeImpact, formatImpactForChat } = await import("@/lib/change-impact");
          const { resolveApprovalAuthority, isCurrentUserTheAuthority, formatAuthorityForChat } = await import("@/lib/approval-authority");

          const impactReport = await analyzeChangeImpact(shipBuild.diffPatch);
          const authority = await resolveApprovalAuthority(
            "deployment", "normal", impactReport.riskLevel, user.id!,
          );
          const isSelf = isCurrentUserTheAuthority(authority, user.id!);

          const shipContext = [
            "",
            "## Deployment Approval Context",
            "",
            `Build: ${shipBuild.buildId} — ${shipBuild.title ?? "Untitled"}`,
            "",
            formatImpactForChat(impactReport),
            "",
            formatAuthorityForChat(authority, isSelf),
            "",
            isSelf
              ? "The current user IS the approval authority. Present the approval request directly with [Approve] [Reject] [Schedule for Later] options."
              : "The current user is NOT the approval authority. Inform them that the authority has been notified.",
          ].join("\n");

          populatedPrompt += shipContext;
          console.log(`[ship] Injected impact analysis + authority context (${shipContext.length} chars)`);
        }
      } catch (err) {
        console.warn("[ship] Failed to inject impact/authority context:", err);
      }

      // Ship phase: inject contribution mode context for STEP 5 advisory
      try {
        const devConfig = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" } });
        const mode = devConfig?.contributionMode ?? "policy_pending";
        const hasRepo = !!devConfig?.gitRemoteUrl;
        const hasDco = !!devConfig?.dcoAcceptedAt;

        const modeContext: string[] = [
          "",
          `## Platform Contribution Mode: ${mode}`,
          "",
        ];

        if (mode === "policy_pending") {
          modeContext.push(
            "Platform Development policy is not configured yet.",
            "The user can keep testing and validating, but production promotion and upstream contribution should stay blocked until Admin > Platform Development is completed.",
            "",
          );
        }

        if (mode === "fork_only" && !hasRepo) {
          const untrackedCount = await prisma.featureBuild.count({
            where: { phase: "complete", gitCommitHashes: { isEmpty: true } },
          });
          if (untrackedCount > 0) {
            modeContext.push(
              `WARNING: ${untrackedCount} feature(s) deployed without version control backup.`,
              "After completing the ship sequence, warn the user about data loss risk.",
              "Suggest setting up a git repository in Admin > Platform Development.",
              "",
            );
          }
        }

        if (mode === "selective" || mode === "contribute_all") {
          if (!hasDco) {
            modeContext.push(
              "DCO has NOT been accepted yet. If the user chooses to contribute, remind them",
              "to accept the Developer Certificate of Origin in Admin > Platform Development first.",
              "",
            );
          }
        }

        populatedPrompt += modeContext.join("\n");
        console.log(`[ship] Injected contribution mode context: ${mode}`);
      } catch (err) {
        console.warn("[ship] Failed to inject contribution mode context:", err);
      }
    }
  }

  // When external access is enabled, tell the agent about its web tools
  if (input.externalAccessEnabled) {
    const externalTools = availableTools.filter((t) => t.requiresExternalAccess);
    if (externalTools.length > 0) {
      const toolList = externalTools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
      populatedPrompt += [
        "",
        "",
        "EXTERNAL ACCESS ENABLED — you have the following additional tools this session:",
        toolList,
        "Use these tools when the user asks about external websites, URLs, web searches, or public information.",
      ].join("\n");
    }
  }

  // Surface MCP service resources that are discoverable but not yet enabled for this org
  const availableResources = await prisma.modelProvider.findMany({
    where: {
      catalogVisibility: "visible",
      status: { not: "active" },
      endpointType: "service",
    },
    select: { name: true, catalogEntry: true, costPerformanceNotes: true },
  });
  if (availableResources.length > 0) {
    const resourceHints = availableResources
      .map((r) => {
        const desc =
          (r.catalogEntry as Record<string, unknown>)?.description ??
          r.costPerformanceNotes ??
          "External service";
        return `- ${r.name}: ${desc}`;
      })
      .join("\n");
    populatedPrompt += [
      "",
      "",
      "The following external services are available but not yet enabled for this organization. If a task would benefit from one, mention it to the user:",
      resourceHints,
    ].join("\n");
  }

  // Setup-mode override: when the user message is a setup step trigger, inject
  // instructions that tell the coworker to pause its normal role and guide the
  // user through this setup step.  This lets each page's native coworker handle
  // setup while focusing on guidance instead of admin/infrastructure tools.
  const isSetupTrigger = trimmedContent.startsWith("[Setup step:");
  if (isSetupTrigger) {
    populatedPrompt = [
      "SETUP MODE — You are guiding a new platform owner through initial setup.",
      "The user message contains a [Setup step: ...] tag with their organisation context.",
      "Your ONLY job right now is to introduce this page and guide the user through this specific step.",
      "",
      "SETUP RULES:",
      "- Do NOT use admin tools, file tools, sandbox tools, or investigation tools.",
      "- Do NOT check logs, run commands, query the database, or inspect infrastructure.",
      "- Do NOT mention Document Parser, Data Enrichment, Advanced Code Analysis, or MCP services.",
      "- DO explain what this step means for their specific business type.",
      "- DO give them one concrete action to take right now.",
      "- DO ask one question to help them make the right choice.",
      "- Keep your response under 120 words.",
      "",
      "---",
      "",
      populatedPrompt,
    ].join("\n");
  }

  let responseContent = "";
  let responseProviderId: string | null = null;
  let responseModelId: string | null = null;
  let formAssistUpdate: Record<string, unknown> | undefined;
  let systemMessage: AgentMessageRow | undefined;
  currentTaskRun = await getCurrentTaskRun(agent.agentId);

  // EP-AI-WORKFORCE-001: Provider pinning is now via AgentModelConfig.pinnedProviderId
  // (resolved in agentic-loop.ts via agentModelConfig lookup). No need to merge here.
  const modelReqs = { ...agent.modelRequirements };

  // --- Task classification and performance profile injection ---
  // EP-INF-009b: Routing is handled by the agentic loop via routeAndCall().
  // We classify here for metadata and performance profile instruction injection.
  let taskTypeId: string = "unknown";

  {
    const recentContent = chatHistory.slice(-3).map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content));
    const classification = classifyTask(trimmedContent, recentContent);
    taskTypeId = classification.taskType;

    // Inject task-specific instructions from performance profile (if confident classification)
    if (classification.taskType !== "unknown" && classification.confidence >= 0.5) {
      try {
        const profiles = await loadPerformanceProfiles(classification.taskType);
        // Find the best performance profile to inject guidance from
        const profile = profiles[0];
        if (profile?.currentInstructions) {
          populatedPrompt += `\n\n--- TASK GUIDANCE ---\n${profile.currentInstructions}`;
        }
      } catch (err) {
        console.error("[routing] performance profile load error:", err);
      }
    }
  }

  // ── EP-BUILD-ORCHESTRATOR: parallel specialist dispatch for build phase ───
  if (input.routeContext.startsWith("/build") && activeBuildPhase === "build") {
    const activeBuild = await prisma.featureBuild.findFirst({
      where: { createdById: user.id!, phase: "build" },
      orderBy: { updatedAt: "desc" },
      select: { buildId: true, buildPlan: true, taskResults: true },
    });
    const buildPlan = activeBuild?.buildPlan as import("@/lib/explore/feature-build-types").BuildPlanDoc | undefined;

    // Guard: don't re-trigger orchestrator if all tasks already completed.
    // Without this, any user message (e.g. "yes" to "Ready for review?")
    // while phase is still "build" re-dispatches the entire build.
    const storedResults = activeBuild?.taskResults as { completedTasks?: number; totalTasks?: number } | null;
    const buildAlreadyComplete = storedResults
      && typeof storedResults.completedTasks === "number"
      && typeof storedResults.totalTasks === "number"
      && storedResults.totalTasks > 0
      && storedResults.completedTasks >= storedResults.totalTasks;

    if (buildAlreadyComplete) {
      console.log(`[orchestrator] Build ${activeBuild!.buildId} already completed (${storedResults!.completedTasks}/${storedResults!.totalTasks} tasks). Skipping re-dispatch, advancing to review.`);

      // Auto-advance to review phase if still in build
      try {
        await prisma.featureBuild.update({
          where: { buildId: activeBuild!.buildId, phase: "build" },
          data: { phase: "review" },
        });
      } catch { /* already advanced or concurrent update — fine */ }

      const needsReview = (activeBuild!.taskResults as { tasks?: Array<{ outcome: string; title: string }> })?.tasks
        ?.filter(t => t.outcome !== "DONE") ?? [];
      const reviewItems = needsReview.length > 0
        ? `\n\n**${needsReview.length} item${needsReview.length > 1 ? "s" : ""} flagged for review:**\n${needsReview.map(t => `- ${t.title}`).join("\n")}\n\nWould you like me to walk through each one, or do you want to check the sandbox preview first?`
        : "\n\nAll tasks completed cleanly. Would you like me to run a final verification (tests + typecheck), or do you want to check the sandbox preview first?";
      responseContent = `Build complete — ${storedResults!.completedTasks}/${storedResults!.totalTasks} tasks done.${reviewItems}`;
      responseProviderId = "orchestrator";
      responseModelId = "multi-specialist";
      // Fall through to message persistence below
    }

    if (activeBuild && !buildPlan?.tasks?.length) {
      console.warn(`[orchestrator] SKIPPED for ${activeBuild.buildId}: buildPlan missing "tasks" array. Plan keys: ${buildPlan ? Object.keys(buildPlan).join(", ") : "null"}. Falling back to single-agent mode — no specialist dispatch.`);
    }

    if (activeBuild && buildPlan?.tasks?.length && !buildAlreadyComplete) {
      const { runBuildOrchestrator } = await import("@/lib/integrate/build-orchestrator");
      const { agentEventBus } = await import("@/lib/agent-event-bus");

      const orchestratorResult = await runBuildOrchestrator({
        buildId: activeBuild.buildId,
        plan: buildPlan,
        userId: user.id!,
        platformRole: user.platformRole ?? null,
        isSuperuser: user.isSuperuser ?? false,
        parentThreadId: input.threadId,
        buildContext: populatedPrompt,
      });

      // EP-ASYNC-COWORKER-001: done event moved to caller (API route) so it fires
      // AFTER message persistence, enabling SSE-driven async completion.

      responseContent = orchestratorResult.content;
      responseProviderId = "orchestrator";
      responseModelId = "multi-specialist";

      // Log token usage
      logTokenUsage({
        agentId: agent.agentId,
        providerId: "orchestrator",
        contextKey: "coworker",
        inputTokens: orchestratorResult.totalInputTokens,
        outputTokens: orchestratorResult.totalOutputTokens,
        inferenceMs: 0,
      }).catch((err) => console.error("[logTokenUsage]", err));

      // Fall through to message persistence and return below
    }
  }

  // ── Single-agent fallback (all phases except orchestrated build) ─────────
  if (!responseContent) {
  try {
    // ── Agentic execution loop ──────────────────────────────────────────────
    // EP-INF-009b: The loop handles V2 routing internally via routeAndCall().
    const { runAgenticLoop } = await import("@/lib/agentic-loop");
    const { agentEventBus } = await import("@/lib/agent-event-bus");
    const agenticResult = await runAgenticLoop({
      chatHistory,
      systemPrompt: populatedPrompt,
      sensitivity: agent.sensitivity,
      tools: availableTools,
      toolsForProvider,
      userId: user.id!,
      routeContext: input.routeContext,
      agentId: agent.agentId,
      threadId: input.threadId,
      taskRunId: currentTaskRun?.taskRunId,
      taskType: taskTypeId,
      agentDisplayName: agent.agentName,
      ...(Object.keys(modelReqs).length > 0 ? { modelRequirements: modelReqs } : {}),
      onProgress: (event) => agentEventBus.emit(input.threadId, event),
    });

    // EP-ASYNC-COWORKER-001: done event moved to caller (API route) so it fires
    // AFTER message persistence, enabling SSE-driven async completion.

    // Handle proposal — agent wants to take a side-effecting action that needs approval
    if (agenticResult.proposal) {
      const tc = agenticResult.proposal;
      const proposalId = "AP-" + Math.random().toString(36).substring(2, 7).toUpperCase();
      const agentMsg = await createProjectedAgentMessage({
        role: "assistant",
        content: tc.content || `I'd like to ${tc.name.replace(/_/g, " ")} with the following details.`,
        agentId: agent.agentId,
        routeContext: input.routeContext,
        providerId: agenticResult.providerId,
        taskType: taskTypeId !== "unknown" ? taskTypeId : null,
        routedEndpointId: null,
        messageType: "proposal",
        metadata: {
          proposalName: tc.name,
        },
      });
      const proposal = await prisma.agentActionProposal.create({
        data: {
          proposalId, threadId: input.threadId, messageId: agentMsg.id,
          taskRunId: currentTaskRun?.taskRunId ?? null,
          agentId: agent.agentId, actionType: tc.name,
          parameters: tc.arguments as import("@dpf/db").Prisma.InputJsonValue, status: "proposed",
        },
        select: { proposalId: true, actionType: true, parameters: true, status: true, resultEntityId: true, resultError: true },
      });
      observeConversation(input.threadId, input.routeContext).catch((err) => console.error("[process-observer]", err));
      return { userMessage: serializeMessage(userMsg), agentMessage: serializeMessage(agentMsg, proposal) };
    }

    // Map agentic result to the shape downstream code expects
    const result = {
      content: agenticResult.content,
      providerId: agenticResult.providerId,
      modelId: agenticResult.modelId,
      downgraded: agenticResult.downgraded,
      downgradeMessage: agenticResult.downgradeMessage,
      inputTokens: agenticResult.totalInputTokens,
      outputTokens: agenticResult.totalOutputTokens,
      inferenceMs: 0,
      toolCalls: undefined as undefined, // already handled by loop
    };

    responseContent = result.content;
    responseProviderId = result.providerId;
    responseModelId = result.modelId;

    // ── Scout research dispatch: runs BEFORE ideate research ──
    if (activeBuildPhase === "ideate" && resolvedBuildId) {
      const buildForScout = await prisma.featureBuild.findUnique({
        where: { buildId: resolvedBuildId },
        select: { buildExecState: true, title: true, description: true },
      });
      const scoutState = buildForScout?.buildExecState as Record<string, unknown> | null;

      if (scoutState?.scoutResearchRequested) {
        console.log(`[coworker] Scout research requested — dispatching scout dispatch`);
        const { agentEventBus } = await import("@/lib/agent-event-bus");
        agentEventBus.emit(input.threadId, { type: "tool:start", tool: "scout_research", iteration: 0 });

        try {
          const { dispatchScoutResearch } = await import("@/lib/integrate/scout-dispatch");
          const scoutResult = await dispatchScoutResearch({
            featureTitle: buildForScout?.title ?? "",
            featureDescription: buildForScout?.description ?? "",
            externalUrls: (scoutState.scoutUrls as string[] | undefined) ?? [],
          });

          if (scoutResult.success && scoutResult.result) {
            console.log(
              `[coworker] Scout success: ${scoutResult.result.relatedModels.length} models, ${scoutResult.result.gaps.length} gaps, complexity=${scoutResult.result.estimatedComplexity}`
            );
            const { executeTool } = await import("@/lib/mcp-tools");
            await executeTool(
              "saveBuildEvidence",
              { field: "scoutFindings", value: scoutResult.result },
              user.id!,
              { routeContext: input.routeContext }
            );
          } else {
            console.log(`[coworker] Scout failed: ${scoutResult.error}`);
          }
        } catch (err) {
          console.error(`[coworker] Scout dispatch error (non-fatal):`, err);
        }

        // Clear flag regardless of success
        await prisma.featureBuild.update({
          where: { buildId: resolvedBuildId },
          data: {
            buildExecState: {
              ...(scoutState as object),
              scoutResearchRequested: false,
            },
          },
        });

        agentEventBus.emit(input.threadId, { type: "tool:complete", tool: "scout_research", success: true });
      }
    }

    // ── Ideate research dispatch: if the agentic loop called start_ideate_research,
    // dispatch the research to Codex CLI and save the result ──
    if (activeBuildPhase === "ideate" && resolvedBuildId) {
      const buildForResearch = await prisma.featureBuild.findUnique({
        where: { buildId: resolvedBuildId },
        select: { buildExecState: true, title: true, description: true },
      });
      const execState = buildForResearch?.buildExecState as Record<string, unknown> | null;
      if (execState?.ideateResearchRequested) {
        console.log(`[coworker] Ideate research requested — dispatching to Codex CLI`);
        const { agentEventBus } = await import("@/lib/agent-event-bus");
        agentEventBus.emit(input.threadId, { type: "tool:start", tool: "codebase_research", iteration: 0 });

        try {
          const { dispatchIdeateResearch } = await import("@/lib/integrate/ideate-dispatch");
          const { getBuildStudioConfig } = await import("@/lib/integrate/build-studio-config");
          const config = await getBuildStudioConfig();

          // Build context for the research
          const buildCtx = await getFeatureBuildForContext(resolvedBuildId, user.id!);
          // Use the active provider — Claude or Codex depending on config
          const ideateProviderId = config.provider === "claude"
            ? config.claudeProviderId
            : config.codexProviderId;
          const ideateModel = config.provider === "claude"
            ? config.claudeModel
            : config.codexModel;

          const ideateResult = await dispatchIdeateResearch({
            featureTitle: buildForResearch?.title ?? "Untitled Feature",
            featureDescription: buildForResearch?.description ?? "",
            reusabilityScope: String(execState.reusabilityScope ?? "parameterizable"),
            userContext: String(execState.userContext ?? ""),
            businessContext: buildCtx?.businessContext ?? undefined,
            providerId: ideateProviderId,
            model: ideateModel,
            dispatchEngine: config.provider,
            onProgress: (message: string) => {
              agentEventBus.emit(input.threadId, {
                type: "orchestrator:task_progress",
                buildId: resolvedBuildId!,
                taskTitle: "Codebase Research",
                message,
              });
            },
          });

          agentEventBus.emit(input.threadId, { type: "tool:complete", tool: "codebase_research", success: ideateResult.success });

          console.log(`[coworker] Ideate result: success=${ideateResult.success}, hasDesignDoc=${!!ideateResult.designDoc}, docKeys=${ideateResult.designDoc ? Object.keys(ideateResult.designDoc as Record<string, unknown>).join(",") : "none"}`);

          if (ideateResult.success && ideateResult.designDoc) {
            // Save design doc via the same tool handler
            console.log(`[coworker] Saving design doc + triggering review...`);
            const { executeTool } = await import("@/lib/mcp-tools");
            const saveResult = await executeTool(
              "saveBuildEvidence",
              { field: "designDoc", value: ideateResult.designDoc },
              user.id!,
              { routeContext: input.routeContext },
            );

            console.log(`[coworker] saveBuildEvidence result: success=${saveResult.success}, msg=${saveResult.message?.slice(0, 100)}`);

            if (saveResult.success) {
              const approach = String((ideateResult.designDoc as Record<string, unknown>).proposedApproach ?? "").trim();
              console.log(`[coworker] Approach length: ${approach.length}`);
              if (approach.length < 30) {
                // Design doc saved but approach is blank — research engine produced an empty doc.
                console.log(`[coworker] Approach too short (${approach.length} chars) — treating as empty doc`);
                responseContent = "The codebase research ran but didn't produce a complete design. The research engine may have had trouble accessing the codebase. Please try starting the feature again — if the problem persists, check that the sandbox is running.";
              } else {
                // Run the design doc review
                console.log(`[coworker] Running reviewDesignDoc...`);
                agentEventBus.emit(input.threadId, { type: "tool:start", tool: "design_review", iteration: 0 });
                const reviewResult = await executeTool("reviewDesignDoc", {}, user.id!, { routeContext: input.routeContext });
                console.log(`[coworker] reviewDesignDoc result: success=${reviewResult.success}, msg=${reviewResult.message?.slice(0, 100)}`);
                agentEventBus.emit(input.threadId, { type: "tool:complete", tool: "design_review", success: reviewResult.success });

                const reviewDecision = (reviewResult.data as { review?: { decision?: string }; blocked?: boolean } | undefined);
                const reviewPassed = reviewDecision?.review?.decision === "pass" && !reviewDecision?.blocked;
                responseContent = await summariseIdeateOutcome(
                  approach,
                  reviewPassed,
                  resolvedBuildId,
                );
              }
            } else {
              // If the only issue is a missing/short codebase audit, auto-patch the doc and retry once.
              // This prevents an infinite loop where the agent calls start_ideate_research repeatedly
              // when the research engine produced valid content but omitted the audit field.
              const rawDoc = ideateResult.designDoc as Record<string, unknown>;
              const auditRaw = String(rawDoc?.existingCodeAudit ?? rawDoc?.existingFunctionalityAudit ?? "");
              if (saveResult.error === "Design doc missing codebase research." && auditRaw.length < 20) {
                const reusePlan = String(rawDoc?.reusePlan ?? "").slice(0, 150);
                const fallbackAudit = reusePlan.length > 10
                  ? `No existing implementation found. ${reusePlan}`
                  : "No existing implementation found. Searched for related models, routes, and components. This is a new feature.";
                const patchedDoc = { ...rawDoc, existingCodeAudit: fallbackAudit };
                const retryResult = await executeTool(
                  "saveBuildEvidence",
                  { field: "designDoc", value: patchedDoc },
                  user.id!,
                  { routeContext: input.routeContext },
                );
                if (retryResult.success) {
                  // Only treat as success if proposedApproach has real content.
                  // An empty approach means the research engine ran but produced a blank doc.
                  const approach = String(rawDoc.proposedApproach ?? "").trim();
                  if (approach.length < 30) {
                    responseContent = "The codebase research ran but didn't produce a complete design. The research engine may have had trouble accessing the codebase. Please try starting the feature again — if the problem persists, check that the sandbox is running.";
                  } else {
                    agentEventBus.emit(input.threadId, { type: "tool:start", tool: "design_review", iteration: 0 });
                    const reviewResult = await executeTool("reviewDesignDoc", {}, user.id!, { routeContext: input.routeContext });
                    agentEventBus.emit(input.threadId, { type: "tool:complete", tool: "design_review", success: reviewResult.success });
                    const reviewDecision = (reviewResult.data as { review?: { decision?: string }; blocked?: boolean } | undefined);
                    const reviewPassed = reviewDecision?.review?.decision === "pass" && !reviewDecision?.blocked;
                    responseContent = await summariseIdeateOutcome(
                      approach,
                      reviewPassed,
                      resolvedBuildId,
                    );
                  }
                } else {
                  responseContent = `Research completed. ${retryResult.message ?? "Please describe what you'd like me to focus on for this feature."}`;
                }
              } else {
                responseContent = `Research completed but the design doc needs revision. ${saveResult.message ?? "Please provide more context about the feature."}`;
              }
            }
          } else {
            responseContent = ideateResult.error
              ? `Research encountered an issue: ${ideateResult.error}`
              : "Research completed but I couldn't generate a structured design. Let me try a different approach.";
          }

          // Clear the research request
          await prisma.featureBuild.update({
            where: { buildId: resolvedBuildId },
            data: {
              buildExecState: { ideateResearchRequested: false },
            },
          });
        } catch (err) {
          console.error(`[coworker] Ideate research dispatch failed:`, err);
          agentEventBus.emit(input.threadId, { type: "tool:complete", tool: "codebase_research", success: false });
          // Fall through with the agentic loop's response
        }
      }
    }

    // Log token usage (fire-and-forget with error logging)
    logTokenUsage({
      agentId: agent.agentId,
      providerId: result.providerId,
      contextKey: "coworker",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      inferenceMs: result.inferenceMs,
    }).catch((err) => console.error("[logTokenUsage]", err));

    // Downgrade notification — only show once per thread (suppress repeats)
    if (result.downgraded && result.downgradeMessage) {
      const recentDowngrade = await prisma.agentMessage.findFirst({
        where: {
          threadId: input.threadId,
          role: "system",
          content: { startsWith: "Switched to" },
          createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) }, // within 30 min
        },
      });
      if (!recentDowngrade) {
        const sysMsg = await createProjectedAgentMessage({
          role: "system",
          content: result.downgradeMessage,
          agentId: agent.agentId,
          routeContext: input.routeContext,
          messageType: "status",
        });
        systemMessage = serializeMessage(sysMsg);
      }
    }
  } catch (e) {
    if (e instanceof NoEligibleEndpointsError || e instanceof NoAllowedProvidersForSensitivityError) {
      responseContent = generateCannedResponse(agent.agentId, input.routeContext, user.platformRole);

      const sysMsg = await createProjectedAgentMessage({
        role: "system",
        content: e instanceof NoEligibleEndpointsError
          ? `No eligible AI endpoints for this task (${e.reason}). The coworker used a local fallback response.`
          : `The current page is marked ${agent.sensitivity}. No allowed AI provider is configured for that sensitivity, so the coworker switched to a local fallback response.`,
        agentId: agent.agentId,
        routeContext: input.routeContext,
        messageType: "status",
      });
      systemMessage = serializeMessage(sysMsg);
    } else if (e instanceof NoProvidersAvailableError) {
      const inactiveProviders = await prisma.modelProvider.findMany({
        where: { status: "inactive" },
        select: { providerId: true, name: true },
        take: 3,
      });

      responseContent = generateCannedResponse(agent.agentId, input.routeContext, user.platformRole);

      let sysContent: string;
      if (e.attempts.length > 0) {
        const failureDetails = e.attempts.map((a) => `${a.providerId}: ${a.error.slice(0, 200)}`).join("; ");
        sysContent = `All AI providers failed: ${failureDetails}. Check configuration in Platform > AI Providers.`;
      } else if (inactiveProviders.length > 0) {
        sysContent = `AI co-workers are temporarily offline. Type "re-enable" to reactivate a provider, or visit Platform > AI Providers.`;
      } else {
        sysContent = "No AI providers are configured. An administrator can set them up from Platform > AI Providers.";
      }

      const sysMsg = await createProjectedAgentMessage({
        role: "system",
        content: sysContent,
        agentId: agent.agentId,
        routeContext: input.routeContext,
        messageType: "status",
      });
      systemMessage = serializeMessage(sysMsg);
    } else {
      throw e;
    }
  }
  } // close if (!responseContent)

  if (input.elevatedFormFillEnabled && input.formAssistContext) {
    const extracted = extractFormAssistResult(responseContent, input.formAssistContext);
    responseContent = extracted.displayContent;
    formAssistUpdate = extracted.fieldUpdates ?? undefined;
  }

  // Sanitize: strip only agent self-talk that is never useful to the user.
  // The agentic loop's continuation nudge handles "narrate instead of act" — so
  // we only strip filler/apologies here, NOT action-intent language.
  const rawResponseBeforeSanitize = responseContent;
  responseContent = responseContent
    // "Action: tool_name(...)" — raw tool-call narration leaked as text
    .replace(/^Action:?\s*\w+\([^\n]*$/gm, "")
    // "Self-correction:" — agent internal monologue
    .replace(/^Self-correction:?\s*[^\n]*$/gim, "")
    // Filler apologies
    .replace(/^(?:I (?:apologize|appreciate)|My apologies|I'm sorry)[^\n]*$/gim, "")
    // Stalling ("Give me a moment", "This will take...")
    .replace(/^(?:Give me|Let me take|This (?:will|may|might) take)[^\n]*$/gim, "")
    // Clean up excessive whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Quality gate: if the response was almost entirely stripped (agent was all questions/narration),
  // replace with an honest fallback rather than showing empty or useless text.
  if (responseContent.length < 20) {
    console.warn(
      `[quality-gate] Response too short (${responseContent.length} chars). ` +
      `Raw from loop (${rawResponseBeforeSanitize.length} chars): ${JSON.stringify(rawResponseBeforeSanitize.slice(0, 500))} | ` +
      `After sanitize: ${JSON.stringify(responseContent)} | ` +
      `Provider: ${responseProviderId}/${responseModelId} | ` +
      `Route: ${input.routeContext}`,
    );
    const providerHint = responseProviderId
      ? `Provider ${responseProviderId}/${responseModelId} returned an empty response.`
      : "No AI provider was matched by the routing pipeline.";
    responseContent = `**Unable to process this request.** ${providerHint} Check AI Workforce settings (Platform > AI) to verify provider configuration.`;
  }

  // Persist agent response
  const agentMsg = await createProjectedAgentMessage({
    role: "assistant",
    content: responseContent,
    agentId: agent.agentId,
    routeContext: input.routeContext,
    providerId: responseProviderId,
    taskType: taskTypeId !== "unknown" ? taskTypeId : null,
    routedEndpointId: null, // EP-INF-009b: routing is per-iteration via routeAndCall
  });

  // Fire-and-forget: store conversation memories in Qdrant
  import("@/lib/semantic-memory").then(({ storeConversationMemory }) => {
    const memBase = {
      userId: user.id!,
      agentId: agent.agentId,
      routeContext: input.routeContext,
      threadId: input.threadId,
    };
    // Skip trivial messages that add noise to semantic search
    const isSubstantive = (text: string) => text.length > 15 && !/^(?:ok|yes|no|thanks|thank you|sure|got it|hello|hi|hey)$/i.test(text.trim());
    if (isSubstantive(trimmedContent)) {
      storeConversationMemory({ ...memBase, messageId: userMsg.id, content: trimmedContent, role: "user" })
        .catch((e) => console.warn("[memory-store] user:", e instanceof Error ? e.message : String(e)));
    }
    if (isSubstantive(responseContent)) {
      storeConversationMemory({ ...memBase, messageId: agentMsg.id, content: responseContent, role: "assistant" })
        .catch((e) => console.warn("[memory-store] assistant:", e instanceof Error ? e.message : String(e)));
    }
  }).catch((e) => console.warn("[memory-store] import failed:", e instanceof Error ? e.message : String(e)));

  // Fire-and-forget: extract user facts from substantive user messages
  if (trimmedContent.length > 30) {
    import("@/lib/tak/user-facts").then(({ extractAndStoreFacts }) => {
      extractAndStoreFacts({
        userId: user.id!,
        messageContent: trimmedContent,
        routeContext: input.routeContext,
        messageId: userMsg.id,
      }).catch((e) => console.warn("[user-facts] extract failed:", e instanceof Error ? e.message : String(e)));
    }).catch((e) => console.warn("[user-facts] import failed:", e instanceof Error ? e.message : String(e)));
  }

  // Fire-and-forget: process observer
  // EP-INF-009b: endpoint is resolved per-iteration by routeAndCall; use providerId from result
  const mainMeta: RoutingMeta | undefined = (taskTypeId !== "unknown" && responseProviderId) ? {
    endpointId: responseProviderId,
    taskType: taskTypeId,
    sensitivity: resolveRouteContext(input.routeContext).sensitivity,
    userMessage: trimmedContent,
    aiResponse: responseContent,
  } : undefined;
  observeConversation(input.threadId, input.routeContext, mainMeta).catch((err) =>
    console.error("[process-observer]", err),
  );

  return {
    userMessage: serializeMessage(userMsg),
    agentMessage: serializeMessage(agentMsg),
    ...(formAssistUpdate !== undefined && { formAssistUpdate }),
    ...(systemMessage !== undefined && { systemMessage }),
    ...(responseProviderId && responseModelId && { providerInfo: { providerId: responseProviderId, modelId: responseModelId } }),
  };
}

export async function loadEarlierMessages(input: {
  threadId: string;
  before: string;
  limit?: number;
}): Promise<{ messages: AgentMessageRow[]; hasMore: boolean } | { error: string }> {
  const user = await requireAuthUser();

  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return { error: "Unauthorized" };
  }

  const limit = input.limit ?? 20;

  const messages = await prisma.agentMessage.findMany({
    where: { threadId: input.threadId },
    orderBy: { createdAt: "desc" },
    cursor: { id: input.before },
    skip: 1, // skip the cursor itself
    take: limit + 1, // fetch one extra to check hasMore
    select: {
      id: true,
      role: true,
      content: true,
      agentId: true,
      routeContext: true,
      createdAt: true,
    },
  });

  const hasMore = messages.length > limit;
  const slice = hasMore ? messages.slice(0, limit) : messages;

  return {
    messages: slice.reverse().map((m) => serializeMessage(m)),
    hasMore,
  };
}

export async function recordAgentTransition(input: {
  threadId: string;
  agentId: string;
  agentName: string;
  routeContext: string;
}): Promise<{ message: AgentMessageRow } | { error: string }> {
  const user = await requireAuthUser();

  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return { error: "Unauthorized" };
  }

  const content = `${input.agentName} has joined the conversation`;

  const taskRun = await ensureTaskForCoworkerTurn({
    userId: user.id,
    threadId: input.threadId,
    routeContext: input.routeContext,
    content,
    agentId: input.agentId,
  }).catch(() => null);

  const msg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      taskRunId: taskRun?.taskRunId ?? null,
      role: "system",
      content,
      agentId: input.agentId,
      routeContext: input.routeContext,
    },
    select: {
      id: true,
      role: true,
      content: true,
      agentId: true,
      routeContext: true,
      createdAt: true,
    },
  });

  if (taskRun) {
    await projectThreadMessageToTask({
      task: taskRun,
      role: "system",
      content,
      routeContext: input.routeContext,
      agentId: input.agentId,
      messageType: "status",
      metadata: {
        threadMessageId: msg.id,
      },
    }).catch(() => {});
  }

  return { message: serializeMessage(msg) };
}

export async function clearConversation(input: {
  threadId: string;
}): Promise<{ ok: true } | { error: string }> {
  const user = await requireAuthUser();

  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { userId: true },
  });
  if (!thread || thread.userId !== user.id) {
    return { error: "Unauthorized" };
  }

  // Delete attachments (files on disk + DB rows), then proposals (FK on messageId), then messages
  const { deleteAttachmentsForThread } = await import("@/lib/file-upload");
  await deleteAttachmentsForThread(input.threadId);
  await prisma.agentActionProposal.deleteMany({
    where: { threadId: input.threadId },
  });
  await prisma.agentMessage.deleteMany({
    where: { threadId: input.threadId },
  });

  return { ok: true };
}

// ─── EP-KM-001 + EP-CTX-001: Knowledge Pointers ────────────────────────────

/**
 * Return title-only knowledge pointers for the current route context.
 * Costs ~45 tokens instead of ~150 for full summaries.
 * The agent uses search_knowledge_base to pull full content when needed.
 */
async function getKnowledgePointersForRoute(routeContext: string): Promise<string> {
  const productMatch = routeContext.match(/\/portfolio\/product\/([^/]+)/);
  const portfolioMatch = !productMatch && routeContext.match(/\/portfolio\/([^/]+)/);

  if (!productMatch && !portfolioMatch) return "";

  const { searchKnowledgeArticles } = await import("@/lib/semantic-memory");

  if (productMatch) {
    const productId = productMatch[1];
    const product = await prisma.digitalProduct.findUnique({
      where: { id: productId },
      select: { name: true },
    });
    if (!product) return "";

    const articles = await searchKnowledgeArticles({
      query: product.name,
      productId,
      limit: 3,
    });
    if (articles.length === 0) return "";

    // Enrich with utility-generated abstracts from DB when available
    const abstracts = await prisma.knowledgeArticle.findMany({
      where: { articleId: { in: articles.map((a) => a.articleId) } },
      select: { articleId: true, abstract: true },
    });
    const abstractMap = new Map(abstracts.map((a) => [a.articleId, a.abstract]));

    const lines = articles.map((a) => {
      const abs = abstractMap.get(a.articleId);
      return abs ? `- ${a.articleId}: "${a.title}" (${a.category}) — ${abs}` : `- ${a.articleId}: "${a.title}" (${a.category})`;
    });
    return `KNOWLEDGE: ${articles.length} articles for ${product.name} — use search_knowledge_base for details.\n${lines.join("\n")}`;
  }

  if (portfolioMatch) {
    const portfolioSlug = portfolioMatch[1];
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: portfolioSlug },
      select: { id: true, name: true },
    });
    if (!portfolio) return "";

    const articles = await searchKnowledgeArticles({
      query: portfolio.name,
      portfolioId: portfolio.id,
      limit: 3,
    });
    if (articles.length === 0) return "";

    const abstracts = await prisma.knowledgeArticle.findMany({
      where: { articleId: { in: articles.map((a) => a.articleId) } },
      select: { articleId: true, abstract: true },
    });
    const abstractMap = new Map(abstracts.map((a) => [a.articleId, a.abstract]));

    const lines = articles.map((a) => {
      const abs = abstractMap.get(a.articleId);
      return abs ? `- ${a.articleId}: "${a.title}" (${a.category}) — ${abs}` : `- ${a.articleId}: "${a.title}" (${a.category})`;
    });
    return `KNOWLEDGE: ${articles.length} articles for ${portfolio.name} portfolio — use search_knowledge_base for details.\n${lines.join("\n")}`;
  }

  return "";
}

// ─── Marketing Skill Rules ─────────────────────────────────────────────

export async function getMarketingSkillRules(): Promise<Record<string, unknown> | null> {
  const config = await prisma.storefrontConfig.findFirst({
    select: { archetypeId: true },
  });
  if (!config) return null;

  const archetype = await prisma.storefrontArchetype.findUnique({
    where: { id: config.archetypeId },
  });
  // marketingSkillRules is a Json? field added by migration; access via index signature
  // to avoid type errors before Prisma client is regenerated.
  const rules = (archetype as Record<string, unknown> | null)?.["marketingSkillRules"];
  if (!rules || typeof rules !== "object") return null;
  return rules as Record<string, unknown>;
}

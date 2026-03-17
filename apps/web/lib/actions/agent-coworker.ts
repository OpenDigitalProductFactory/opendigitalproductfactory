"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { validateMessageInput } from "@/lib/agent-coworker-types";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import { resolveAgentForRoute, generateCannedResponse } from "@/lib/agent-routing";
import { serializeMessage } from "@/lib/agent-coworker-data";
import {
  callWithFailover,
  NoAllowedProvidersForSensitivityError,
  NoProvidersAvailableError,
} from "@/lib/ai-provider-priority";
import { logTokenUsage } from "@/lib/ai-inference";
import type { ChatMessage } from "@/lib/ai-inference";
import { buildCoworkerContextKey } from "@/lib/agent-coworker-context";
import {
  buildFormAssistInstruction,
  extractFormAssistResult,
  type AgentFormAssistContext,
} from "@/lib/agent-form-assist";
import { executeTool, getAvailableTools, toolsToOpenAIFormat } from "@/lib/mcp-tools";
import { getBuildContextSection } from "@/lib/build-agent-prompts";
import { getFeatureBuildForContext } from "@/lib/feature-build-data";
import { deleteAttachmentsForThread } from "@/lib/file-upload";
import { getRouteDataContext } from "@/lib/route-context";
import { observeConversation } from "@/lib/process-observer-hook";
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";
import { resolveRouteContext } from "@/lib/route-context-map";
import { assembleSystemPrompt } from "@/lib/prompt-assembler";
import { getGrantedCapabilities, getDeniedCapabilities } from "@/lib/permissions";
import { classifyTask } from "@/lib/task-classifier";
import { getTaskType } from "@/lib/task-types";
import { routeWithPerformance } from "@/lib/agent-router";
import { loadEndpoints, loadPerformanceProfiles, ensurePerformanceProfile } from "@/lib/agent-router-data";
import type { RoutingMeta } from "@/lib/process-observer-hook";

// ─── Auth helper ────────────────────────────────────────────────────────────

async function requireAuthUser() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new Error("Unauthorized");
  return user;
}

// ─── Server Actions ─────────────────────────────────────────────────────────

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

      const sysMsg = await prisma.agentMessage.create({
        data: {
          threadId: input.threadId,
          role: "system",
          content: `${reEnabled.name} has been re-enabled. It may have reduced quota — try sending your message again.`,
          routeContext: input.routeContext,
        },
        select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
      });

      // Fire-and-forget: process observer
      observeConversation(input.threadId, input.routeContext).catch((err) =>
        console.error("[process-observer]", err),
      );

      return {
        userMessage: serializeMessage(await prisma.agentMessage.create({
          data: { threadId: input.threadId, role: "user", content: trimmedContent, routeContext: input.routeContext },
          select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
        })),
        agentMessage: serializeMessage(sysMsg),
      };
    }
  }

  // Persist user message
  const userMsg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      role: "user",
      content: trimmedContent,
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

  // Link attachment to the user message if provided
  // Link new attachment to this message if provided
  if (input.attachmentId) {
    await prisma.agentAttachment.update({
      where: { id: input.attachmentId },
      data: { messageId: userMsg.id },
    });
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
      if (!parsed) return `- ${att.fileName} (not parsed)`;
      const summary = parsed.summary ?? "";
      const columns = Array.isArray(parsed.columns) ? `\n  Columns: ${(parsed.columns as string[]).join(", ")}` : "";
      const text = typeof parsed.fullText === "string" ? `\n  Content: ${(parsed.fullText as string).slice(0, 1500)}` : "";
      return `- ${att.fileName}: ${summary}${columns}${text}`;
    });
    attachmentContext = `\n--- Uploaded Files ---\n${summaries.join("\n")}`;
  }

  // Check unified coworker feature flag
  const useUnified = await isUnifiedCoworkerEnabled();

  // Resolve agent
  const agent = resolveAgentForRoute(input.routeContext, {
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  }, useUnified);

  // Build inference context
  const recentMessages = await prisma.agentMessage.findMany({
    where: { threadId: input.threadId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { role: true, content: true },
  });
  const chatHistory: ChatMessage[] = recentMessages.reverse().map((m) => ({
    role: m.role as ChatMessage["role"],
    content: m.content,
  }));

  let populatedPrompt: string;

  if (useUnified) {
    // ── Unified prompt path: composable blocks from route-context-map + prompt-assembler ──
    const routeCtx = resolveRouteContext(input.routeContext);
    const userCtx = { platformRole: user.platformRole, isSuperuser: user.isSuperuser };
    const granted = getGrantedCapabilities(userCtx);
    const denied = getDeniedCapabilities(userCtx);

    const routeData = await getRouteDataContext(input.routeContext, user.id!);

    populatedPrompt = assembleSystemPrompt({
      hrRole: user.platformRole ?? "none",
      grantedCapabilities: granted,
      deniedCapabilities: denied,
      mode: (input.coworkerMode as "advise" | "act") ?? "advise",
      sensitivity: routeCtx.sensitivity,
      domainContext: routeCtx.domainContext,
      domainTools: routeCtx.domainTools,
      routeData: routeData,
      attachmentContext,
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
    let resolvedBuildId = input.buildId;
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
        promptSections.push(getBuildContextSection(buildCtx));
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

    populatedPrompt = promptSections.join("\n");
  }

  // Get available tools for this user
  const availableTools = getAvailableTools({
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  }, {
    externalAccessEnabled: input.externalAccessEnabled === true,
    mode: input.coworkerMode ?? "advise",
    unifiedMode: useUnified,
  });
  const toolsForProvider = availableTools.length > 0 ? toolsToOpenAIFormat(availableTools) : undefined;

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

  let responseContent: string;
  let responseProviderId: string | null = null;
  let responseModelId: string | null = null;
  let formAssistUpdate: Record<string, unknown> | undefined;
  let systemMessage: AgentMessageRow | undefined;

  // Check DB for agent-level provider preference (overrides hardcoded config)
  const dbAgent = await prisma.agent.findUnique({
    where: { agentId: agent.agentId },
    select: { preferredProviderId: true },
  });
  const modelReqs = {
    ...agent.modelRequirements,
    ...(dbAgent?.preferredProviderId ? { preferredProviderId: dbAgent.preferredProviderId } : {}),
  };

  // --- Task classification and performance routing (unified mode only) ---
  let resolvedEndpointId: string | undefined;
  let taskTypeId: string = "unknown";

  if (useUnified) {
    // Classify the task
    const recentContent = chatHistory.slice(-3).map((m) => m.content);
    const classification = classifyTask(trimmedContent, recentContent);
    taskTypeId = classification.taskType;

    // Performance-weighted routing (only for confident classifications)
    if (classification.taskType !== "unknown" && classification.confidence >= 0.5) {
      const allEndpoints = await loadEndpoints();
      const profiles = await loadPerformanceProfiles(classification.taskType);
      const routeCtx = resolveRouteContext(input.routeContext);

      const perfRoute = routeWithPerformance(allEndpoints, profiles, {
        sensitivity: routeCtx.sensitivity,
        minCapabilityTier: getTaskType(classification.taskType)?.minCapabilityTier ?? "basic",
        requiredTags: [classification.taskType],
        taskType: classification.taskType,
      });

      if (perfRoute) {
        resolvedEndpointId = perfRoute.endpointId;

        // Ensure performance profile exists (lazy creation)
        const taskTypeDef = getTaskType(classification.taskType);
        if (taskTypeDef) {
          await ensurePerformanceProfile(perfRoute.endpointId, classification.taskType, taskTypeDef.defaultInstructions);
        }

        // Inject task-specific instructions
        const profile = profiles.find((p) => p.endpointId === perfRoute.endpointId);
        if (profile?.currentInstructions) {
          populatedPrompt += `\n\n--- TASK GUIDANCE ---\n${profile.currentInstructions}`;
        }
      }
    }

    // Apply resolved endpoint as preferred provider
    if (resolvedEndpointId) {
      modelReqs.preferredProviderId = resolvedEndpointId;
    }
  }

  try {
    const result = await callWithFailover(
      chatHistory,
      populatedPrompt,
      agent.sensitivity,
      {
        ...(toolsForProvider ? { tools: toolsForProvider } : {}),
        ...(Object.keys(modelReqs).length > 0 ? { modelRequirements: modelReqs } : {}),
      },
    );

    // Handle tool calls — execute read-only tools immediately, propose side-effecting tools.
    if (result.toolCalls && result.toolCalls.length > 0) {
      const tc = result.toolCalls[0]!; // v1: one proposal per message
      const toolDefinition = availableTools.find((tool) => tool.name === tc.name);

      if (toolDefinition?.executionMode === "immediate") {
        const toolResult = await executeTool(
          tc.name,
          tc.arguments,
          user.id,
          { routeContext: input.routeContext },
        );

        // If the tool returned data (search results, scores), feed it back to the LLM
        // so the agent can craft a natural response instead of echoing "Found 12 items"
        if (toolResult.data && toolResult.success) {
          const toolContext: ChatMessage[] = [
            ...chatHistory,
            { role: "assistant" as const, content: `[Tool ${tc.name} returned: ${JSON.stringify(toolResult.data).slice(0, 2000)}]` },
            { role: "user" as const, content: "Use the tool results above to continue the conversation naturally. Do not mention the tool by name." },
          ];
          try {
            const followUp = await callWithFailover(
              toolContext,
              populatedPrompt,
              agent.sensitivity,
              { ...(agent.modelRequirements ? { modelRequirements: agent.modelRequirements } : {}) },
            );
            const agentMsg = await prisma.agentMessage.create({
              data: {
                threadId: input.threadId,
                role: "assistant",
                content: followUp.content,
                agentId: agent.agentId,
                routeContext: input.routeContext,
                providerId: followUp.providerId,
                taskType: useUnified ? taskTypeId : null,
                routedEndpointId: useUnified ? (resolvedEndpointId ?? null) : null,
              },
              select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
            });

            // Fire-and-forget: process observer
            const followUpMeta: RoutingMeta | undefined = (useUnified && resolvedEndpointId) ? {
              endpointId: resolvedEndpointId,
              taskType: taskTypeId,
              sensitivity: resolveRouteContext(input.routeContext).sensitivity,
              userMessage: trimmedContent,
              aiResponse: followUp.content,
            } : undefined;
            observeConversation(input.threadId, input.routeContext, followUpMeta).catch((err) =>
              console.error("[process-observer]", err),
            );

            return {
              userMessage: serializeMessage(userMsg),
              agentMessage: serializeMessage(agentMsg),
              ...(toolResult.data !== undefined ? { formAssistUpdate: toolResult.data } : {}),
            };
          } catch {
            // If follow-up LLM call fails, fall through to showing the raw tool message
          }
        }

        const agentMsg = await prisma.agentMessage.create({
          data: {
            threadId: input.threadId,
            role: "assistant",
            content: toolResult.message,
            agentId: agent.agentId,
            routeContext: input.routeContext,
            providerId: result.providerId,
            taskType: useUnified ? taskTypeId : null,
            routedEndpointId: useUnified ? (resolvedEndpointId ?? null) : null,
          },
          select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
        });

        // Fire-and-forget: process observer
        const toolResultMeta: RoutingMeta | undefined = (useUnified && resolvedEndpointId) ? {
          endpointId: resolvedEndpointId,
          taskType: taskTypeId,
          sensitivity: resolveRouteContext(input.routeContext).sensitivity,
          userMessage: trimmedContent,
          aiResponse: toolResult.message,
        } : undefined;
        observeConversation(input.threadId, input.routeContext, toolResultMeta).catch((err) =>
          console.error("[process-observer]", err),
        );

        return {
          userMessage: serializeMessage(userMsg),
          agentMessage: serializeMessage(agentMsg),
          ...(toolResult.data !== undefined ? { formAssistUpdate: toolResult.data } : {}),
        };
      }

      const proposalId = "AP-" + Math.random().toString(36).substring(2, 7).toUpperCase();

      // Create the agent message first
      const proposalContent = result.content || `I'd like to ${tc.name.replace(/_/g, " ")} with the following details.`;
      const agentMsg = await prisma.agentMessage.create({
        data: {
          threadId: input.threadId,
          role: "assistant",
          content: proposalContent,
          agentId: agent.agentId,
          routeContext: input.routeContext,
          providerId: result.providerId,
          taskType: useUnified ? taskTypeId : null,
          routedEndpointId: useUnified ? (resolvedEndpointId ?? null) : null,
        },
        select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
      });

      // Create the proposal linked to the message
      const proposal = await prisma.agentActionProposal.create({
        data: {
          proposalId,
          threadId: input.threadId,
          messageId: agentMsg.id,
          agentId: agent.agentId,
          actionType: tc.name,
          parameters: tc.arguments as import("@dpf/db").Prisma.InputJsonValue,
        },
      });

      // Fire-and-forget: process observer
      const proposalMeta: RoutingMeta | undefined = (useUnified && resolvedEndpointId) ? {
        endpointId: resolvedEndpointId,
        taskType: taskTypeId,
        sensitivity: resolveRouteContext(input.routeContext).sensitivity,
        userMessage: trimmedContent,
        aiResponse: proposalContent,
      } : undefined;
      observeConversation(input.threadId, input.routeContext, proposalMeta).catch((err) =>
        console.error("[process-observer]", err),
      );

      return {
        userMessage: serializeMessage(userMsg),
        agentMessage: serializeMessage(agentMsg, proposal),
      };
    }

    responseContent = result.content;
    responseProviderId = result.providerId;
    responseModelId = result.modelId;

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
        const sysMsg = await prisma.agentMessage.create({
          data: {
            threadId: input.threadId,
            role: "system",
            content: result.downgradeMessage,
            agentId: agent.agentId,
            routeContext: input.routeContext,
          },
          select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
        });
        systemMessage = serializeMessage(sysMsg);
      }
    }
  } catch (e) {
    if (e instanceof NoAllowedProvidersForSensitivityError) {
      responseContent = generateCannedResponse(agent.agentId, input.routeContext, user.platformRole);

      const sysMsg = await prisma.agentMessage.create({
        data: {
          threadId: input.threadId,
          role: "system",
          content: `The current page is marked ${agent.sensitivity}. No allowed AI provider is configured for that sensitivity, so the coworker switched to a local fallback response.`,
          agentId: agent.agentId,
          routeContext: input.routeContext,
        },
        select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
      });
      systemMessage = serializeMessage(sysMsg);
    } else if (e instanceof NoProvidersAvailableError) {
      // Check if there are inactive providers that could be re-enabled as a last resort
      const inactiveProviders = await prisma.modelProvider.findMany({
        where: { status: "inactive" },
        select: { providerId: true, name: true },
        take: 3,
      });

      responseContent = generateCannedResponse(agent.agentId, input.routeContext, user.platformRole);

      let sysContent: string;
      if (inactiveProviders.length > 0) {
        sysContent = `AI co-workers are temporarily offline. An administrator can re-enable them from Platform > AI Providers.`;
      } else {
        sysContent = "AI co-workers haven't been set up yet. An administrator can configure them from Platform > AI Providers.";
      }

      const sysMsg = await prisma.agentMessage.create({
        data: {
          threadId: input.threadId,
          role: "system",
          content: sysContent,
          agentId: agent.agentId,
          routeContext: input.routeContext,
        },
        select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
      });
      systemMessage = serializeMessage(sysMsg);
    } else {
      throw e;
    }
  }

  if (input.elevatedFormFillEnabled && input.formAssistContext) {
    const extracted = extractFormAssistResult(responseContent, input.formAssistContext);
    responseContent = extracted.displayContent;
    formAssistUpdate = extracted.fieldUpdates ?? undefined;
  }

  // Sanitize: strip tool narration that some LLMs emit as text instead of tool calls.
  responseContent = responseContent
    // "Action: tool_name(...)" or "Action: Create/Update/Remove..."
    .replace(/^Action:?\s*[^\n]*$/gm, "")
    // "Step N: ..." planning
    .replace(/^Step \d+:?\s*[^\n]*$/gm, "")
    // "Self-correction:", "Here's my plan:", "My plan is:", "I will now..."
    .replace(/^(?:Self-correction|Here's my plan|My plan is|I (?:will|am going to|need to|have to) (?:now |immediately |proceed |also |then )?(?:create|update|add|remove|delete|modify|change|set|initiate|execute|implement))[^\n]*$/gim, "")
    // "Let me read/search/call/look/check..."
    .replace(/^Let me (?:read|search|call|look|check|find|query|analyze|investigate|examine|review)[^\n]*$/gim, "")
    // "What you need to do next" / "What's next?" sections with content
    .replace(/^What(?:'s| you need to do) next[^\n]*$/gim, "")
    // "In summary:" / "To reiterate:" / "To summarize:" sections
    .replace(/^(?:In summary|To reiterate|To summarize)[^\n]*$/gim, "")
    // Numbered list items that are just planning ("1. Create...", "2. Update...")
    .replace(/^\d+\.\s*(?:Create|Update|Remove|Add|Delete|Modify|Change|Set|Initiate)\s+(?:a |the |new )?(?:backlog|provider|entry|item|category|record)[^\n]*$/gim, "")
    // Clean up excessive whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Persist agent response
  const agentMsg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      role: "assistant",
      content: responseContent,
      agentId: agent.agentId,
      routeContext: input.routeContext,
      providerId: responseProviderId,
      taskType: useUnified ? taskTypeId : null,
      routedEndpointId: useUnified ? (resolvedEndpointId ?? null) : null,
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

  // Fire-and-forget: process observer
  const mainMeta: RoutingMeta | undefined = (useUnified && resolvedEndpointId) ? {
    endpointId: resolvedEndpointId,
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

  const msg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      role: "system",
      content: `${input.agentName} has joined the conversation`,
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
  await deleteAttachmentsForThread(input.threadId);
  await prisma.agentActionProposal.deleteMany({
    where: { threadId: input.threadId },
  });
  await prisma.agentMessage.deleteMany({
    where: { threadId: input.threadId },
  });

  return { ok: true };
}

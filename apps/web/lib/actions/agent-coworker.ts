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
import { getActionsForRoute } from "@/lib/agent-action-registry";
import { getBuildContextSection } from "@/lib/build-agent-prompts";
import { getFeatureBuildForContext } from "@/lib/feature-build-data";
import { deleteAttachmentsForThread } from "@/lib/file-upload";
import { getRouteDataContext } from "@/lib/route-context";
import { observeConversation } from "@/lib/process-observer-hook";
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";
import {
  loadEndpointManifests,
  loadTaskRequirement,
  loadPolicyRules,
  loadOverrides,
  routeEndpoint,
  persistRouteDecision,
} from "@/lib/routing";
import { resolveRouteContext } from "@/lib/route-context-map";
import { assembleSystemPrompt } from "@/lib/prompt-assembler";
import { getGrantedCapabilities, getDeniedCapabilities } from "@/lib/permissions";
import { classifyTask } from "@/lib/task-classifier";
import { getTaskType } from "@/lib/task-types";
import { loadPerformanceProfiles, ensurePerformanceProfile } from "@/lib/agent-router-data";
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
  const agent = resolveAgentForRoute(input.routeContext, {
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  }, useUnified);

  // Build inference context: short recent window + semantic recall for older context.
  // Keep only last 8 messages as raw history — Qdrant semantic recall fills in
  // relevant older context. This prevents long confused conversations from poisoning
  // the response and keeps the context window focused.
  const RECENT_WINDOW = 8;
  const recentMessages = await prisma.agentMessage.findMany({
    where: { threadId: input.threadId },
    orderBy: { createdAt: "desc" },
    take: RECENT_WINDOW,
    select: { role: true, content: true },
  });
  const chatHistory: ChatMessage[] = recentMessages.reverse().map((m) => ({
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

    // Semantic memory: recall relevant context from ALL conversations.
    // With a short recent window (8 messages), semantic recall is the primary
    // mechanism for remembering older context — both cross-thread and same-thread.
    const { recallRelevantContext } = await import("@/lib/semantic-memory");
    const recalledContext = await recallRelevantContext({
      query: input.content,
      userId: user.id!,
      // Don't exclude current thread — we need older same-thread context too
      limit: 8,
    }).catch(() => null);
    if (recalledContext) {
      promptSections.push(recalledContext);
    }

    populatedPrompt = promptSections.join("\n");
  }

  // Get ALL platform tools (no mode filtering — we filter the merged set below)
  const allPlatformTools = getAvailableTools({
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  }, {
    externalAccessEnabled: input.externalAccessEnabled === true,
    // Skip mode filtering here — applied to merged set
    unifiedMode: useUnified,
  });

  // Get page-specific actions
  const pageActions = getActionsForRoute(input.routeContext, {
    userId: user.id!,
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  });

  // Merge and apply mode filtering once to the combined set
  const mergedTools = [...allPlatformTools, ...pageActions];
  const availableTools = input.coworkerMode === "advise"
    ? mergedTools.filter((t) => !t.sideEffect)
    : mergedTools;

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
  let manifestRouteDecision: import("@/lib/routing/types").RouteDecision | undefined;

  if (useUnified) {
    // Classify the task
    const recentContent = chatHistory.slice(-3).map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content));
    const classification = classifyTask(trimmedContent, recentContent);
    taskTypeId = classification.taskType;

    // Performance-weighted routing (only for confident classifications)
    if (classification.taskType !== "unknown" && classification.confidence >= 0.5) {
      const profiles = await loadPerformanceProfiles(classification.taskType);
      const routeCtx = resolveRouteContext(input.routeContext);

      // ── EP-INF-001: Manifest-based routing (replaces legacy routeWithPerformance) ──
      try {
        const [manifests, taskReq, policies, epOverrides] = await Promise.all([
          loadEndpointManifests(),
          loadTaskRequirement(classification.taskType),
          loadPolicyRules(),
          loadOverrides(classification.taskType),
        ]);
        const manifestDecision = routeEndpoint(
          manifests,
          taskReq,
          routeCtx.sensitivity,
          policies,
          epOverrides,
        );

        // Persist routing decision for audit trail
        await persistRouteDecision(manifestDecision, undefined, false);

        if (manifestDecision.selectedEndpoint) {
          resolvedEndpointId = manifestDecision.selectedEndpoint;
          manifestRouteDecision = manifestDecision;
          console.log(
            `[routing] ${classification.taskType}: ${manifestDecision.reason}`,
          );

          // Ensure performance profile exists for the selected endpoint
          const taskTypeDef = getTaskType(classification.taskType);
          if (taskTypeDef) {
            await ensurePerformanceProfile(resolvedEndpointId, classification.taskType, taskTypeDef.defaultInstructions);
          }

          // Inject task-specific instructions from performance profile
          const profile = profiles.find((p) => p.endpointId === resolvedEndpointId);
          if (profile?.currentInstructions) {
            populatedPrompt += `\n\n--- TASK GUIDANCE ---\n${profile.currentInstructions}`;
          }
        } else {
          console.warn(
            `[routing] ${classification.taskType}: no eligible endpoint — falling back to legacy. ${manifestDecision.reason}`,
          );
        }
      } catch (err) {
        console.error("[routing] manifest router error, falling back to legacy:", err);
      }
    }

    // Apply resolved endpoint as preferred provider
    if (resolvedEndpointId) {
      modelReqs.preferredProviderId = resolvedEndpointId;
    }
  }

  try {
    // ── Agentic execution loop ──────────────────────────────────────────────
    // Agent calls tools iteratively until it responds with text only (max 6 iterations).
    const { runAgenticLoop } = await import("@/lib/agentic-loop");
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
      ...(Object.keys(modelReqs).length > 0 ? { modelRequirements: modelReqs } : {}),
      ...(manifestRouteDecision ? { routeDecision: manifestRouteDecision } : {}),
    });

    // Handle proposal — agent wants to take a side-effecting action that needs approval
    if (agenticResult.proposal) {
      const tc = agenticResult.proposal;
      const proposalId = "AP-" + Math.random().toString(36).substring(2, 7).toUpperCase();
      const agentMsg = await prisma.agentMessage.create({
        data: {
          threadId: input.threadId, role: "assistant",
          content: tc.content || `I'd like to ${tc.name.replace(/_/g, " ")} with the following details.`,
          agentId: agent.agentId, routeContext: input.routeContext,
          providerId: agenticResult.providerId,
          taskType: useUnified ? taskTypeId : null,
          routedEndpointId: useUnified ? (resolvedEndpointId ?? null) : null,
        },
        select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
      });
      const proposal = await prisma.agentActionProposal.create({
        data: {
          proposalId, threadId: input.threadId, messageId: agentMsg.id,
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
    responseContent = "I wasn't able to help with that effectively. I've logged it so the team can follow up. Try rephrasing your request, or use the skills menu in the header for common actions.";
  }

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
      storeConversationMemory({ ...memBase, messageId: userMsg.id, content: trimmedContent, role: "user" }).catch(() => {});
    }
    if (isSubstantive(responseContent)) {
      storeConversationMemory({ ...memBase, messageId: agentMsg.id, content: responseContent, role: "assistant" }).catch(() => {});
    }
  }).catch(() => {});

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

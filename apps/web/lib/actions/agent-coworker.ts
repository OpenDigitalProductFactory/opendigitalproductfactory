"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { validateMessageInput } from "@/lib/agent-coworker-types";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import { resolveAgentForRoute, generateCannedResponse } from "@/lib/agent-routing";
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
import { executeTool, getAvailableTools, toolsToOpenAIFormat } from "@/lib/mcp-tools";
import { getActionsForRoute } from "@/lib/agent-action-registry";
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

  // Build inference context: recent window + semantic recall for older context.
  // Build phases need more context (research findings, schema details, tool results)
  // because the agentic loop's tool call results aren't persisted in messages.
  // Conversation phases use a shorter window to prevent context poisoning.
  const isBuildPhase = input.routeContext === "/build";
  const RECENT_WINDOW = isBuildPhase ? 20 : 8;
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

    const contextSources = [
      // L1: Route-essential context
      { tier: "L1" as const, priority: 0, content: domainBlock, tokenCount: countTokens(domainBlock), source: "domain", compressible: false },
      // L2: Situational — page data
      ...(routeData ? [{
        tier: "L2" as const, priority: 1, content: `--- PAGE DATA ---\n${routeData}`, tokenCount: countTokens(routeData),
        source: "page-data", compressible: true,
        compressedContent: `--- PAGE DATA ---\n${routeData.slice(0, 400)}...`,
        compressedTokenCount: countTokens(routeData.slice(0, 400)),
      }] : []),
      // L2: Knowledge pointers
      ...(knowledgePointers ? [{
        tier: "L2" as const, priority: 3, content: knowledgePointers, tokenCount: countTokens(knowledgePointers),
        source: "knowledge", compressible: true, compressedContent: "", compressedTokenCount: 0,
      }] : []),
      // L2: Attachments (Block 7 — no longer duplicated in user message)
      ...(attachmentContext ? [{
        tier: "L2" as const, priority: 4, content: attachmentContext, tokenCount: countTokens(attachmentContext),
        source: "attachments", compressible: true,
        compressedContent: attachmentContext.slice(0, 600),
        compressedTokenCount: countTokens(attachmentContext.slice(0, 600)),
      }] : []),
    ];

    const result = arbitrate(contextSources, budget);

    // Debug logging in development
    if (process.env.NODE_ENV === "development") {
      console.log(formatArbitrationLog(result, budget));
    }

    // Reconstruct domain context and route data from selected sources
    const selectedDomain = result.selected.find((s) => s.source === "domain")?.content ?? routeCtx.domainContext;
    const selectedPageData = result.selected.find((s) => s.source === "page-data")?.content?.replace("--- PAGE DATA ---\n", "") ?? null;
    const selectedAttachments = result.selected.find((s) => s.source === "attachments")?.content ?? null;
    const selectedKnowledge = result.selected.find((s) => s.source === "knowledge")?.content ?? null;

    // Merge knowledge into domain context if it made the budget
    const finalDomainContext = selectedKnowledge
      ? selectedDomain + "\n\n" + selectedKnowledge
      : selectedDomain;

    populatedPrompt = assembleSystemPrompt({
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
      // Don't exclude current thread — we need older same-thread context too
      limit: 8,
    }).catch(() => null);
    if (recalledContext) {
      promptSections.push(recalledContext);
    }

    populatedPrompt = promptSections.join("\n");
  }

  // Get ALL platform tools (no mode filtering — we filter the merged set below)
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
      return t.buildPhases.includes(activeBuildPhase as import("@/lib/mcp-tools").BuildPhaseTag);
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

  let responseContent = "";
  let responseProviderId: string | null = null;
  let responseModelId: string | null = null;
  let formAssistUpdate: Record<string, unknown> | undefined;
  let systemMessage: AgentMessageRow | undefined;

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
      taskType: taskTypeId,
      ...(Object.keys(modelReqs).length > 0 ? { modelRequirements: modelReqs } : {}),
      onProgress: (event) => agentEventBus.emit(input.threadId, event),
    });

    // EP-ASYNC-COWORKER-001: done event moved to caller (API route) so it fires
    // AFTER message persistence, enabling SSE-driven async completion.

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
          taskType: taskTypeId !== "unknown" ? taskTypeId : null,
          routedEndpointId: null, // EP-INF-009b: routing handled per-iteration by routeAndCall
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
    if (e instanceof NoEligibleEndpointsError || e instanceof NoAllowedProvidersForSensitivityError) {
      responseContent = generateCannedResponse(agent.agentId, input.routeContext, user.platformRole);

      const sysMsg = await prisma.agentMessage.create({
        data: {
          threadId: input.threadId,
          role: "system",
          content: e instanceof NoEligibleEndpointsError
            ? `No eligible AI endpoints for this task (${e.reason}). The coworker used a local fallback response.`
            : `The current page is marked ${agent.sensitivity}. No allowed AI provider is configured for that sensitivity, so the coworker switched to a local fallback response.`,
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
  const agentMsg = await prisma.agentMessage.create({
    data: {
      threadId: input.threadId,
      role: "assistant",
      content: responseContent,
      agentId: agent.agentId,
      routeContext: input.routeContext,
      providerId: responseProviderId,
      taskType: taskTypeId !== "unknown" ? taskTypeId : null,
      routedEndpointId: null, // EP-INF-009b: routing is per-iteration via routeAndCall
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

"use server";
import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import { validateMessageInput, type AgentMessageRow } from "@/lib/agent-coworker-types";
import { generateCannedResponse } from "@/lib/agent-routing";
import { loadOpeningBriefingPayload } from "@/lib/agent/opening-briefing-loader";
import type { OpeningBriefingPayload } from "@/lib/agent/opening-briefing";
import { resolveAgentForRouteWithPrompts } from "@/lib/tak/agent-routing-server";
import { serializeMessage, loadProviderInfo } from "@/lib/agent-coworker-data";
import {
  NoAllowedProvidersForSensitivityError,
  NoProvidersAvailableError,
} from "@/lib/ai-provider-priority";
import { NoEligibleEndpointsError } from "@/lib/routed-inference";
import { logTokenUsage, type ChatMessage } from "@/lib/ai-inference";
import { buildCoworkerContextKey } from "@/lib/agent-coworker-context";
import { resolveWithheldHistory } from "@/lib/tak/thread-history-withholding";
import { getKnowledgePointersForRoute } from "@/lib/actions/route-knowledge-pointers";
import {
  buildFormAssistInstruction,
  extractFormAssistResult,
  type AgentFormAssistContext,
} from "@/lib/agent-form-assist";
// mcp-tools is imported dynamically at call sites to avoid NFT whole-project tracing;
// type-only imports are erased at build time and safe.
import type { ToolDefinition } from "@/lib/mcp-tools";
import { sanitizeForLog } from "@/lib/security/safe-log";
import { getActionsForRoute } from "@/lib/agent-action-registry";
import { getBuildContextSection } from "@/lib/build-agent-prompts";
import { getFeatureBuildForContext } from "@/lib/feature-build-data";
// file-upload is imported dynamically at call site to avoid NFT whole-project tracing
import { getRouteDataContext } from "@/lib/route-context";
import { observeConversation } from "@/lib/process-observer-hook";
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";
import { resolveRouteContext } from "@/lib/route-context-map";
import { assembleSystemPromptWithProvenance } from "@/lib/prompt-assembler";
import { composeCoworkerDomainContext } from "@/lib/tak/coworker-prompt-provenance";
import { buildInitiativeBlock } from "@/lib/tak/initiative-block";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import { resolveReadingLevelForRoute } from "@/lib/readability/policy";
import type { QuestionPacket } from "@/lib/tak/question-packet";
import { resolvePortalContextEnvelope } from "@/lib/portal-context";
import type { PortalContextEnvelope } from "@/lib/portal-context";
import { formatCoworkerOperationalCloseout } from "@/lib/tak/coworker-interaction-contract";
import {
  formatIdeateResearchIssueMessage,
  formatIdeateResearchResultMessage,
  formatIncompleteIdeateDesignMessage,
  formatProviderUnavailableMessage,
  summariseIdeateOutcome,
} from "@/lib/tak/coworker-operational-messages";
import {
  extractInvokedSkillId,
  getSkillsForAgent,
  toSkillSummariesForPrompt,
} from "@/lib/skills/runtime";
import { rankSkillsByRelevance } from "@/lib/skills/skill-relevance";
import { recordSkillUsageEvents } from "@/lib/skills/usage-events";
import { recallWikiContext } from "@/lib/wiki/recall";
import { recordCoverageGap } from "@/lib/wiki/coverage-gap";
import { resolveProfessionCorpusContext } from "@/lib/decision-perspective/profession-corpus";
import { recordProfessionCorpusEvidence } from "@/lib/decision-perspective/profession-corpus-evidence";
import { resolveInstallVariantContext } from "@/lib/decision-perspective/install-variant-context";
import {
  classifyPerspective,
  extractPageTopic,
  buildPerspectiveQuery,
  buildPerspectiveHint,
  PERSPECTIVE_PAGE_KINDS,
} from "@/lib/wiki/perspective-intent";
import { getGrantedCapabilities, getDeniedCapabilities } from "@/lib/permissions";
import { classifyTask } from "@/lib/task-classifier";
import { getTaskType } from "@/lib/task-types";
import { applyProviderRouteModelPreference } from "@/lib/ai-provider-route-context";
import { loadPerformanceProfiles, ensurePerformanceProfile } from "@/lib/agent-router-data";
import type { RoutingMeta } from "@/lib/process-observer-hook";
import {
  executeAutonomousAgenticLoop,
  findCurrentAutonomousWorkRun,
} from "@/lib/tak/autonomous-work-run";
import { deriveEffortWarrant } from "@/lib/tak/effort-warrant";
import { applyLocalDegradationCaveat } from "@/lib/tak/local-degradation-caveat";
import { coworkerUnavailableResult } from "./coworker-send-eligibility";
import {
  classifyTurnMutationIntent,
  isConversationalExpansionRequest,
  isPageExplanationOnlyRequest,
  isPlatformMechanismQuestion,
  isTrivialSocialMessage,
} from "@/lib/tak/conversation-intent";
import {
  buildExternalAccessDisabledInstruction,
  getExternalAccessToolSummaries,
  recordExternalAccessPermissionAudit,
  shouldRequestExternalAccess,
} from "@/lib/agent-external-access-permission";

// ─── Auth helper ────────────────────────────────────────────────────────────

import { filterToolsForCoworkerRuntime, buildAdvisePromptSuffix } from "./coworker-tool-filter";
import { labelHistory, prependLabelled } from "@/lib/tak/message-origins";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { requireUser } from "./shared/guards";
import {
  formatPortalContextPromptSection,
  isSubstantiveCoworkerOutput,
  normalizePortalContextPathname,
  normalizePortalContextRoute,
  isPortalContextSupportedPath,
  resolveBuildIdFromRouteContext,
  resolveCapsuleIdFromPathname,
} from "@/lib/coworker/agent-coworker-core";
import { AUTHORIZED_SURFACE_PROMPT, AUTHORIZED_SURFACE_TOOL_NAMES, COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS } from "@/lib/coworker/authorized-surface-coworker-contract";
export { filterToolsForCoworkerRuntime };

async function buildPortalContextPromptSection(input: {
  routeContext: string;
  threadId: string;
  buildId?: string | null;
}, userId: string): Promise<{ section: string; envelope: PortalContextEnvelope } | null> {
  const pathname = normalizePortalContextPathname(input.routeContext);
  if (!isPortalContextSupportedPath(pathname)) return null;

  try {
    const capsuleId = resolveCapsuleIdFromPathname(pathname);
    const buildId = input.buildId ?? resolveBuildIdFromRouteContext(input.routeContext);
    const envelope = await resolvePortalContextEnvelope(
      {
        pathname,
        routeContext: normalizePortalContextRoute(pathname),
        ...(buildId ? { buildId } : {}),
        ...(capsuleId ? { capsuleId } : {}),
        threadId: input.threadId,
      },
      userId,
    );

    const section = formatPortalContextPromptSection(envelope.promptDigest, envelope.anchors);
    return section ? { section, envelope } : null;
  } catch (error) {
    console.warn("[portal-context] Failed to resolve coworker prompt context", error);
    return null;
  }
}

async function persistCoworkerResponseArtifact(input: {
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
  const user = await requireUser();

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
      providerId: true,
      modelId: true,
      createdAt: true,
      attachments: {
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, parsedContent: true },
      },
    },
  });

  // BI-1D0B5308: resolve per-turn provider/model so the attribution badge shows
  // right after a turn completes (client refreshes via this snapshot), not only
  // on a full page reload.
  const providerInfo = await loadProviderInfo(messages);
  return {
    threadId: thread.id,
    messages: messages.reverse().map((m) => serializeMessage(m, undefined, providerInfo.get(m.id))),
  };
}

export async function getOrCreateThreadSnapshot(input: {
  routeContext: string;
}): Promise<{
  threadId: string;
  messages: AgentMessageRow[];
  openingBriefing?: OpeningBriefingPayload | null;
} | null> {
  const user = await requireUser();

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
      providerId: true,
      modelId: true,
      createdAt: true,
      attachments: {
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, parsedContent: true },
      },
    },
  });

  // BI-1D0B5308: attach per-turn provider/model attribution on initial load.
  const providerInfo = await loadProviderInfo(messages);

  // BI-DED493BA: proactive on-load briefing — the panel must not open silent.
  // Best-effort: a briefing failure never breaks thread load.
  const openingBriefing = await loadOpeningBriefingPayload(user, input.routeContext).catch(
    () => null,
  );

  return {
    threadId: thread.id,
    messages: messages.reverse().map((m) => serializeMessage(m, undefined, providerInfo.get(m.id))),
    openingBriefing,
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
  questionPacket?: QuestionPacket | null;
}): Promise<
  | { userMessage: AgentMessageRow; agentMessage: AgentMessageRow; systemMessage?: AgentMessageRow; formAssistUpdate?: Record<string, unknown> }
  | { error: string }
> {
  const user = await requireUser();

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
    select: { fileName: true, parsedContent: true, mimeType: true },
  });
  let attachmentContext: string | null = null;
  // Images are injected as vision content blocks (below), not as text — exclude
  // them from the textual file-context summary so they don't surface as
  // "uploaded but content not available".
  const docAttachments = threadAttachments.filter((att) => !att.mimeType?.startsWith("image/"));
  if (docAttachments.length > 0) {
    const summaries = docAttachments.map((att) => {
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

  // If the message's attachment is an image, build a vision content block from
  // it (downscaled base64 data URL). Documents stay on the text path above;
  // images ride as an `image_url` block on the user message so vision models can
  // actually see them. runAgenticLoop raises the imageInput capability floor when
  // the turn carries an image, so routing picks a vision-capable endpoint (local
  // DMR first) and degrades gracefully if none is configured.
  let imageContentBlock: { type: "image_url"; image_url: { url: string } } | null = null;
  if (input.attachmentId) {
    const imageAtt = await prisma.agentAttachment.findUnique({
      where: { id: input.attachmentId },
      select: { mimeType: true, storageKey: true },
    });
    if (imageAtt?.mimeType?.startsWith("image/")) {
      const { readAttachmentImageAsDataUrl } = await import("@/lib/shared/file-upload");
      const dataUrl = await readAttachmentImageAsDataUrl(imageAtt.storageKey, imageAtt.mimeType);
      if (dataUrl) imageContentBlock = { type: "image_url", image_url: { url: dataUrl } };
    }
  }

  // Check unified coworker feature flag
  const useUnified = await isUnifiedCoworkerEnabled();

  // Resolve agent
  const agent = await resolveAgentForRouteWithPrompts(input.routeContext, {
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  }, useUnified);
  if (!agent.canAssist) return coworkerUnavailableResult();

  // Lifecycle gate (EP-COWORKER-LIFECYCLE Phase 3, BI-2C4056BF): a draft or
  // retired coworker — and, under COWORKER_LIFECYCLE_STRICT, one that failed
  // its last behavioral certification — is not summonable in chat. The error
  // surfaces to the panel via the normal { error } path.
  if (agent.agentId) {
    const { evaluateLifecycleGate } = await import("@/lib/coworker-lifecycle/lifecycle-gate");
    const gateVerdict = await evaluateLifecycleGate(agent.agentId, { purpose: "chat" });
    if (!gateVerdict.allowed) {
      return { error: gateVerdict.reason };
    }
  }

  // Track build ID at function scope — used in both prompt assembly and post-inference research dispatch
  let resolvedBuildId = input.buildId;
  const portalContextPromptContext = await buildPortalContextPromptSection(
    {
      routeContext: input.routeContext,
      threadId: input.threadId,
      buildId: resolvedBuildId ?? null,
    },
    user.id!,
  );
  const portalContextPrompt = portalContextPromptContext?.section ?? null;

  // Build inference context: recent window + semantic recall for older context.
  // Build phases need more context (research findings, schema details, tool results)
  // because the agentic loop's tool call results aren't persisted in messages.
  // Conversation phases use a shorter window to prevent context poisoning.
  const isBuildPhase = input.routeContext === "/build";
  const RECENT_WINDOW = isBuildPhase ? 20 : 8;
  // BI-706530B2: withhold earlier history from DISPATCH (never from the owner's
  // view) at all three doors. See lib/tak/thread-history-withholding.ts.
  const withheld = await resolveWithheldHistory(prisma, input.threadId);
  const recentMessages = await prisma.agentMessage.findMany({
    where: {
      threadId: input.threadId,
      role: { in: ["user", "assistant"] },
      ...withheld.windowWhere,
    },
    orderBy: { createdAt: "desc" },
    take: RECENT_WINDOW,
    select: { id: true, role: true, content: true },
  });
  // Keep newest messages within a token budget.
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
  const windowMessageIds = new Set(trimmedMessages.map((m) => m.id));
  const withheldRecallExclusions = withheld.recallExclusions(windowMessageIds);
  let chatHistory: ChatMessage[] = trimmedMessages.map((m) => ({
    role: m.role as ChatMessage["role"],
    content: m.content,
  }));

  // EP-COST Phase 3: rolling thread compaction.
  // If the assembled window still exceeds the threshold (e.g. large build-phase
  // window), summarize the oldest turns rather than dropping them silently.
  // Non-fatal: errors inside applyRollingCompaction return the original list.
  if (chatHistory.length > 0) {
    const { applyRollingCompaction } = await import("@/lib/actions/thread-compaction");
    chatHistory = await applyRollingCompaction(chatHistory);
  }

  // Labels for what each message IS, moved with the messages (BI-40EF7C44).
  let labelled = labelHistory(chatHistory);

  // BI-FDECBE0A (EP-8C706944 P1): prepend the thread's durable rolling checkpoint
  // — a persisted running summary of every turn older than the recency window —
  // so long threads keep continuity that does not depend on vector recall. Strict
  // no-op until a checkpoint exists; non-fatal on any error.
  try {
    const { loadThreadCheckpointMessage } = await import("@/lib/tak/thread-checkpoint-runner");
    const checkpointMessage = withheld.checkpointAllowed
      ? await loadThreadCheckpointMessage(input.threadId)
      : null;
    if (checkpointMessage) {
      labelled = prependLabelled(labelled, checkpointMessage, "thread-checkpoint");
    }
  } catch (err) {
    console.warn("[thread-checkpoint] inject failed:", getErrorMessage(err));
  }

  // BI-A9052DCB (EP-8C706944 P3): prepend the session-start projection briefing —
  // a precomputed "what you already know about this user" block distilled offline
  // from governed records — ahead of the recency window. Strict no-op until a
  // briefing exists; the read lazily fire-and-forget refreshes it when stale.
  if (user.id) {
    try {
      const { loadUserBriefingMessage } = await import("@/lib/tak/coworker-briefing-runner");
      const briefingMessage = await loadUserBriefingMessage(agent.agentId, user.id);
      if (briefingMessage) {
        labelled = prependLabelled(labelled, briefingMessage, "user-briefing");
      }
    } catch (err) {
      console.warn("[coworker-briefing] inject failed:", getErrorMessage(err));
    }
  }
  chatHistory = labelled.messages;
  const recentContentForClassification = chatHistory
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content));
  const taskClassification = classifyTask(trimmedContent, recentContentForClassification);
  let taskTypeId: string = taskClassification.taskType;
  if (taskTypeId === "onboarding" && !input.routeContext.startsWith("/setup")) taskTypeId = "unknown";

  // Enrich the last user message with file content so the LLM sees it inline,
  // not just in the system prompt. LLMs pay more attention to message content
  // than system prompt context.
  if ((attachmentContext || imageContentBlock) && chatHistory.length > 0) {
    const lastIdx = chatHistory.length - 1;
    const last = chatHistory[lastIdx]!;
    if (last.role === "user") {
      const lastText = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
      const enrichedText = attachmentContext ? `${lastText}\n\n${attachmentContext}` : lastText;
      chatHistory[lastIdx] = imageContentBlock
        ? { role: "user", content: [{ type: "text", text: enrichedText }, imageContentBlock] }
        : { role: "user", content: enrichedText };
    }
  }

  // Cross-cutting overlay agents (today: the COO / AGT-ORCH-000 only) read
  // memory globally rather than scoped to a single route. See the topology
  // decision DR-2026-04-28-02. Specialists keep route-scoped recall (Pass 1
  // first, global fallback if <3 results). The COO skips Pass 1 entirely so
  // cross-route follow-ups surface reliably regardless of how many memories
  // happen to be tagged with the current route.
  const isCrossCuttingOverlay = agent.agentId === "AGT-ORCH-000";

  // ── WSID Phase 3: profession-corpus retrieval (shared by both prompt paths) ──
  // Resolve the coworker's profession-family corpus ONCE so every response is
  // grounded in the right professional knowledge base. Fail-open: a null result
  // never blocks the response. The registry resolver keys on the PERSISTED Agent
  // identity tuple (role slug lives in Agent.name for registry agents, slugId for
  // hardcoded seeds), so fetch that rather than trusting the routing agent shape.
  // Promise.resolve().then(...) so a synchronous throw (e.g. a partial prisma
  // mock without `agent.findFirst`) becomes a rejection the .catch() absorbs —
  // the identity lookup must never break a coworker response.
  const professionIdentityRow = await Promise.resolve()
    .then(() =>
      prisma.agent.findFirst({
        where: { agentId: agent.agentId },
        select: { agentId: true, slugId: true, name: true },
      }),
    )
    .catch(() => null);
  // WSID archetype/region axis: resolve the install's variant context so the
  // coworker is served its archetype's craft (and shielded from another
  // archetype's) and the right regional doctrine. Fail-open to {} (no filtering).
  const installVariantContext = await Promise.resolve()
    .then(() => resolveInstallVariantContext(prisma))
    .catch(() => ({}));
  const professionCorpus = await resolveProfessionCorpusContext({
    db: prisma,
    identity: professionIdentityRow ?? { agentId: agent.agentId },
    query: trimmedContent,
    installContext: installVariantContext,
  }).catch((e) => {
    console.warn("[profession-corpus] resolve failed (fail-open):", e);
    return null;
  });
  // Whether the corpus block actually landed in the final prompt (the unified
  // path's arbitrator can drop it under a tight token budget). Set per-branch.
  let professionInjectedIntoPrompt = false;

  let populatedPrompt: string;
  let systemPromptInstructionSpans: string[] = [];
  // Governed Hermes learning Slice 1: active coworker skill (if any).
  // Set inside the unified-prompt branch when the user message invokes a
  // known eligible skill via the canonical `Use the <id> skill.` marker.
  // Threaded through executeAutonomousAgenticLoop so ToolExecution.skillId
  // attributes each tool call to the active skill.
  let activeSkillId: string | null = null;

  // BI-E35A8AA4 drove the Initiative block from this coworker's saved Proactivity
  // choice. BI-87C9C91C removed that identity ownership: this is the interactive
  // turn path with no Workroom in scope, so it takes the platform default and who
  // is staffed to the conversation cannot change its initiative. `null` IS that
  // default (buildInitiativeBlock maps it to balanced) — byte-identical to an
  // agent with no saved preference. Spec §3.1.
  const proactivityLevel: ProactivityLevel | null = null;

  // Resolve the LOCAL model's served context ONCE up front — it sizes BOTH the
  // per-turn tool-attachment cap (below) and the skills-catalog cap (in each
  // prompt branch). The skills catalog is the largest UNCAPPED non-tool block, so
  // on a small local window it must be bounded like the tool schemas are, or a
  // heavy coworker (36-38 skills) can still overflow after the tool cap. Reads the
  // DMR served-context truth; null/unknown (or a capable window) → Infinity cap =
  // no change (cloud + large-window installs are byte-identical).
  const { resolveLocalServingPosture } = await import(
    "@/lib/inference/local-model-context-reconcile"
  );
  const { deriveSkillCatalogCap, capSkillCatalog } = await import(
    "@/lib/actions/coworker-tool-budget"
  );
  // Presence rides with the window: a null window cannot tell an absent local
  // model from an unread one, and the tool cap below needs that (BI-A8BFEFCE).
  const { servedContextTokens: localServedContext, presence: localPresence } = await resolveLocalServingPosture();
  const skillCatalogCap = deriveSkillCatalogCap(localServedContext, { localPresence });
  // Computed once; an explicitly-invoked skill is pinned into the catalog so the
  // cap never breaks a `Use the <id> skill.` request (reused for telemetry below).
  const invokedSkillId = extractInvokedSkillId(input.content);

  // BI-3E218D80. Outer scope: arbitration runs inside `useUnified`, both assistant-message
  // writes are below it. Rationale/contract: lib/tak/arbitration-trace.ts.
  let contextTrace: import("@/lib/tak/arbitration-trace").ArbitrationTrace | undefined;

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

    const { buildGovernedMemoryContext } = await import("@/lib/tak/governed-memory");
    const governedMemory = await buildGovernedMemoryContext({
      userId: user.id!,
      agentId: agent.agentId,
      routeContext: isCrossCuttingOverlay ? undefined : input.routeContext,
      query: input.content,
      currentThreadId: input.threadId,
      limit: 8,
      excludeMessageIds: withheldRecallExclusions,
    });
    const factsContext = governedMemory.factsContext;
    const factsCompressed = governedMemory.factsCompressed;
    const recalledContext = governedMemory.recalledContext;
    const compressedRecall = governedMemory.compressedRecall ?? undefined;

    const contextSources = [
      // L1: Route-essential context
      { tier: "L1" as const, priority: 0, content: domainBlock, tokenCount: countTokens(domainBlock), source: "domain", compressible: false },
      // L1: PAGE DATA — screen the employee is on; promoted from L2 so it's funded before in-flight work and survives small tiers; ~1500-char compressed floor (BI-7C9DCBF7).
      ...(routeData ? [{
        tier: "L1" as const, priority: 1, content: `--- PAGE DATA ---\n${routeData}`, tokenCount: countTokens(routeData),
        source: "page-data", compressible: true,
        compressedContent: `--- PAGE DATA ---\n${routeData.slice(0, 1500)}...`,
        compressedTokenCount: countTokens(routeData.slice(0, 1500)),
      }] : []),
      // L1: Profession corpus (WSID Phase 3) — professional knowledge base above
      // generic wiki recall; compressible to abstracts-only under tight budget.
      ...(professionCorpus?.promptBlock ? [{
        tier: "L1" as const, priority: 2, content: professionCorpus.promptBlock,
        tokenCount: professionCorpus.tokenCount, source: "profession-corpus", compressible: true,
        compressedContent: professionCorpus.compactBlock ?? "",
        compressedTokenCount: professionCorpus.compactTokenCount,
      }] : []),
      // L1: In-flight work (portal-context) — the FALLBACK topic; ranks below page-data.
      ...(portalContextPrompt ? [{
        tier: "L1" as const,
        priority: 3,
        content: portalContextPrompt,
        tokenCount: countTokens(portalContextPrompt),
        source: "portal-context",
        compressible: false,
      }] : []),
      // L1: User facts — structured memory from prior conversations
      ...(factsContext ? [{
        tier: "L1" as const, priority: 4, content: factsContext, tokenCount: countTokens(factsContext),
        source: "user-facts", compressible: true,
        compressedContent: factsCompressed ?? "",
        compressedTokenCount: countTokens(factsCompressed ?? ""),
      }] : []),
      // L2: Semantic memory — past conversation context
      ...(recalledContext ? [{
        tier: "L2" as const, priority: 1, content: recalledContext, tokenCount: countTokens(recalledContext),
        source: "semantic-memory", compressible: true,
        compressedContent: compressedRecall!,
        compressedTokenCount: countTokens(compressedRecall!),
      }] : []),
      // L2: Knowledge pointers
      ...(knowledgePointers ? [{
        tier: "L2" as const, priority: 2, content: knowledgePointers, tokenCount: countTokens(knowledgePointers),
        source: "knowledge", compressible: true, compressedContent: "", compressedTokenCount: 0,
      }] : []),
      // L2: Attachments — already injected inline in the last user message (lines 273-283)
      // for better LLM attention. Do NOT duplicate here in the system prompt.
      // See EP-CTX-001: attachment dedup.
    ];

    const result = arbitrate(contextSources, budget);

    // Context arbitration logging — always on for operator visibility
    console.log(formatArbitrationLog(result, budget));

    // BI-3E218D80: the log above is ephemeral; persist the decision too. Labels and
    // counts only, never content — see lib/tak/arbitration-trace.ts.
    const { buildArbitrationTrace } = await import("@/lib/tak/arbitration-trace");
    contextTrace = buildArbitrationTrace(result, budget);

    // Reconstruct domain context and route data from selected sources
    const selectedDomain = result.selected.find((s) => s.source === "domain")?.content ?? routeCtx.domainContext;
    const selectedPageData = result.selected.find((s) => s.source === "page-data")?.content?.replace("--- PAGE DATA ---\n", "") ?? null;
    const selectedAttachments = result.selected.find((s) => s.source === "attachments")?.content ?? null;
    // WSID Phase 3: the profession corpus block that survived arbitration (null
    // if it was dropped under budget — recorded as a usage miss below).
    const selectedProfessionContext = result.selected.find((s) => s.source === "profession-corpus")?.content ?? null;
    professionInjectedIntoPrompt = selectedProfessionContext !== null;

    // Merge knowledge and semantic memory into domain context if they made the budget
    // Knowledge and memory are recalled from the org's own records — DATA, and
    // deliberately not declared as instruction. See coworker-prompt-provenance.
    const domain = composeCoworkerDomainContext({
      persona: selectedDomain,
      surfaceInstruction: AUTHORIZED_SURFACE_PROMPT,
      knowledge: result.selected.find((s) => s.source === "knowledge")?.content ?? null,
      memory: result.selected.find((s) => s.source === "semantic-memory")?.content ?? null,
    });

    // EP-WIKI-001 Phase 3b1: passive wiki context injection.
    // Pulls the top-K kernel + overlay pages relevant to the user's
    // message and renders them in Block 5 below domainContext.
    // recallWikiContext has a silent-degradation contract (returns
    // null on any failure) so wiki retrieval can never break the
    // prompt pipeline.
    const wikiOrg = await prisma.organization
      .findFirst({ select: { id: true } })
      .catch(() => null);

    // BI-F5179C9E: perspective routing. "what would Mark think/do" (WWMD) and
    // "what would we / should we" (WWWD) carry an intent the generic recall
    // misses. Detect it, resolve deictic pronouns ("this") against the page the
    // employee is viewing, bias retrieval toward the right corpus, and inject a
    // framing hint so the coworker attributes correctly instead of dead-ending
    // on "'this' isn't specific".
    const perspective = classifyPerspective(input.content);
    const pageTopic = extractPageTopic(selectedPageData, input.routeContext);
    const wikiQuery = perspective.needsPageContext
      ? buildPerspectiveQuery(input.content, pageTopic)
      : input.content;
    let wikiContext = await recallWikiContext({
      query: wikiQuery,
      organizationId: wikiOrg?.id ?? null,
      limit: 4,
      preferredPageKinds: perspective.perspective
        ? PERSPECTIVE_PAGE_KINDS[perspective.perspective]
        : undefined,
    });
    // BI-741B6329: capture the WWWD coverage gap BEFORE the hint is folded into
    // wikiContext below (which makes it non-null). Empty recall on a WWWD query
    // means the org has no recorded stance on this topic yet.
    const wwwdRecallEmpty = perspective.perspective === "wwwd" && !wikiContext;
    if (perspective.perspective) {
      const hint = buildPerspectiveHint(perspective.perspective, pageTopic);
      wikiContext = wikiContext ? `${hint}\n\n${wikiContext}` : hint;
    }
    // Continuous enrichment (EP-CORPUS-BOOTSTRAP): record the unanswered WWWD
    // question as a deduplicated draft "open question" so the gap surfaces for
    // review/enrichment. Fire-and-forget + fail-open — never block or break the
    // response path. (Autonomous research to fill it is gated on open-Q#4.)
    if (wwwdRecallEmpty && wikiOrg?.id) {
      void recordCoverageGap({ organizationId: wikiOrg.id, query: input.content }).catch(
        (e) => console.warn("[coverage-gap] record failed (fail-open):", e),
      );
    }

    // Governed Hermes learning Slice 1: eligible skills go into the prompt
    // alongside domain context, and we emit SkillUsageEvent telemetry for
    // each eligible skill (and again as `loaded` once the skills block is
    // included in the composed prompt). Telemetry failures are swallowed
    // inside recordSkillUsageEvents — they must never break the response.
    const coworkerSkills = capSkillCatalog(
      rankSkillsByRelevance(await getSkillsForAgent(agent.agentId), trimmedContent),
      skillCatalogCap,
      invokedSkillId,
    );
    const skillSummaries = toSkillSummariesForPrompt(coworkerSkills);
    const eligibleSkillIds = skillSummaries.map((s) => s.skillId);
    if (eligibleSkillIds.length > 0) {
      void recordSkillUsageEvents({
        phase: "eligible",
        skillIds: eligibleSkillIds,
        agentId: agent.agentId,
        userId: user.id ?? null,
        threadId: input.threadId ?? null,
        routeContext: input.routeContext,
      });
    }

    // BI-15FE2F07 (working-memory Slice 2): surface the coworker's own durable
    // working notes into the prompt. Fail-open — notes must never break a reply,
    // and a coworker with no notes yields null (a strict no-op in the assembler).
    let workingNotes: string | null = null;
    try {
      const { resolveCoworkerAgent } = await import("@/lib/tak/coworker-tool-grant-core");
      const { loadCoworkerNotes, formatNotesAsContext } = await import("@/lib/tak/coworker-memory");
      const resolvedCoworker = await resolveCoworkerAgent(agent.agentId);
      if (resolvedCoworker) {
        workingNotes = formatNotesAsContext(await loadCoworkerNotes(resolvedCoworker.id));
      }
    } catch (err) {
      console.warn("[coworker-memory] working-note injection failed (fail-open):", err);
    }

    // BI-45514C4E: reach parity with the legacy path — inject the form-assist
    // instruction and Build Studio context (and auto-resolve the /build-route
    // build id so build-scoped tool filtering below applies on the unified path
    // too). Empty when neither applies, so this is a no-op for ordinary turns.
    const { buildCoworkerExtraSections } = await import("@/lib/tak/coworker-context-sections");
    const coworkerExtra = await buildCoworkerExtraSections({
      buildId: resolvedBuildId,
      routeContext: input.routeContext,
      userId: user.id!,
      chatHistory,
      elevatedFormFillEnabled: input.elevatedFormFillEnabled,
      formAssistContext: input.formAssistContext,
    });
    resolvedBuildId = coworkerExtra.resolvedBuildId;

    const assembled = await assembleSystemPromptWithProvenance({
      instructionSpans: domain.instructionSpans,
      hrRole: user.platformRole ?? "none",
      grantedCapabilities: granted,
      deniedCapabilities: denied,
      mode: (input.coworkerMode as "advise" | "act") ?? "advise",
      sensitivity: routeCtx.sensitivity,
      domainContext: domain.domainContext,
      domainTools: [],
      routeData: selectedPageData,
      attachmentContext: selectedAttachments,
      professionContext: selectedProfessionContext,
      wikiContext,
      workingNotes,
      extraSections: coworkerExtra.sections,
      skills: skillSummaries,
      questionPacket: input.questionPacket ?? null,
      // BI-8F8C5F28 reading level; BI-E35A8AA4 proactivity → in-task initiative.
      readingLevel: await resolveReadingLevelForRoute(input.routeContext),
      proactivityLevel,
    });
    populatedPrompt = assembled.text;
    systemPromptInstructionSpans = assembled.instructionSpans;

    if (eligibleSkillIds.length > 0) {
      void recordSkillUsageEvents({
        phase: "loaded",
        skillIds: eligibleSkillIds,
        agentId: agent.agentId,
        userId: user.id ?? null,
        threadId: input.threadId ?? null,
        routeContext: input.routeContext,
      });
    }

    // If the user message explicitly invokes a known skill via the canonical
    // `Use the <id> skill.` marker (compileSkillInvocationPrompt output), emit
    // an `invoked` event so reflection and metrics can distinguish offered
    // vs. selected skills. The active skill id is also propagated through
    // the autonomous loop in Task 7 so ToolExecution.skillId gets populated.
    activeSkillId =
      invokedSkillId && eligibleSkillIds.includes(invokedSkillId)
        ? invokedSkillId
        : null;
    if (activeSkillId) {
      void recordSkillUsageEvents({
        phase: "invoked",
        skillIds: [activeSkillId],
        agentId: agent.agentId,
        userId: user.id ?? null,
        threadId: input.threadId ?? null,
        routeContext: input.routeContext,
      });
    }
  } else {
    // ── Legacy persona-based prompt assembly ──
    // Proactive decision-routing governance contract (WWMD/WWWD/WSID) — must be
    // surface-uniform with the unified prompt-assembler path. Without this, a
    // legacy-path coworker (the install default while USE_UNIFIED_COWORKER is
    // off) never sees the instruction to consult a decision surface before
    // proposing or asking, and never sees its decision skills at all.
    const { loadDecisionRoutingBlock } = await import("@/lib/tak/decision-routing-block");
    const legacyDecisionRoutingBlock = await loadDecisionRoutingBlock();
    // Limitation-response contract — must be surface-uniform with the unified
    // prompt-assembler path. Without this, a legacy-path coworker never sees the
    // instruction to propose the one enabler + ask a single yes/no when blocked,
    // and instead dead-ends or deflects to "ask an admin".
    const { loadLimitationResponseBlock } = await import("@/lib/tak/limitation-response-block");
    const legacyLimitationResponseBlock = await loadLimitationResponseBlock();
    // BI-E35A8AA4: Proactivity → in-task initiative — surface-uniform with the
    // unified path, which injects the same block via assembleSystemPrompt.
    const legacyInitiativeBlock = buildInitiativeBlock(proactivityLevel);
    // BI-463BE12A: the coworker's brief. Everything pushed onto promptSections
    // below (page context, form-assist, Build Studio) is DATA and stays
    // undeclared. This is the install default while USE_UNIFIED_COWORKER is off.
    systemPromptInstructionSpans = [
      agent.systemPrompt,
      legacyDecisionRoutingBlock,
      legacyLimitationResponseBlock,
      legacyInitiativeBlock,
      AUTHORIZED_SURFACE_PROMPT,
    ].filter((span): span is string => Boolean(span?.trim()));
    const promptSections = [
      agent.systemPrompt,
      "",
      legacyDecisionRoutingBlock,
      "",
      legacyLimitationResponseBlock,
      "",
      legacyInitiativeBlock, "", AUTHORIZED_SURFACE_PROMPT,
      "",
      "Current context:",
      `- Route: ${input.routeContext}`,
      `- User role: ${user.platformRole ?? "none"}`,
      `- Page sensitivity: ${agent.sensitivity}`,
    ];

    if (portalContextPrompt) {
      promptSections.push("", portalContextPrompt);
    }

    if (input.elevatedFormFillEnabled && input.formAssistContext) {
      promptSections.push("", buildFormAssistInstruction(input.formAssistContext));
    }

    // Inject Build Studio context — use explicit buildId or auto-resolve on /build route.
    // Exclude `abandoned` so a prior-test abandoned build doesn't shadow the real active build.
    if (!resolvedBuildId && input.routeContext.startsWith("/build")) {
      // On a capsule page (/build/work/<capsuleId>), resolve from the capsule's linked build.
      // Falling through to "latest build" would pick whichever build was updated most recently
      // across ALL user builds — e.g. a blocked Ollama build's 9 tasks bleed into an unrelated
      // ideate-phase capsule's coworker context.
      const capsuleMatch = input.routeContext.match(/\/build\/work\/(WC-[A-Z0-9]+)/);
      if (capsuleMatch) {
        const capsule = await prisma.workroom.findUnique({
          where: { capsuleId: capsuleMatch[1] },
          select: { featureBuildId: true },
        });
        if (capsule?.featureBuildId) {
          const build = await prisma.featureBuild.findUnique({
            where: { id: capsule.featureBuildId },
            select: { buildId: true },
          });
          resolvedBuildId = build?.buildId ?? undefined;
        }
        // No linked build → leave resolvedBuildId undefined; no build context injected
      } else {
        const latestBuild = await prisma.featureBuild.findFirst({
          where: { createdById: user.id!, phase: { notIn: ["complete", "failed", "abandoned"] } },
          orderBy: { updatedAt: "desc" },
          select: { buildId: true },
        });
        resolvedBuildId = latestBuild?.buildId ?? undefined;
      }
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
    // The COO / cross-cutting overlay passes undefined to skip route-scoped Pass 1.
    const { buildGovernedMemoryContext } = await import("@/lib/tak/governed-memory");
    const governedMemory = await buildGovernedMemoryContext({
      userId: user.id!,
      agentId: agent.agentId,
      routeContext: isCrossCuttingOverlay ? undefined : input.routeContext,
      query: input.content,
      // Don't exclude current thread here — the classic prompt path still benefits
      // from older same-thread semantic recall when it is freshness-safe.
      limit: 8,
    });
    if (governedMemory.factsContext) {
      promptSections.push(governedMemory.factsContext);
    }
    const recalledContext = governedMemory.recalledContext;
    if (recalledContext) {
      promptSections.push(recalledContext);
    }

    // WSID Phase 3: inject the profession corpus (no arbitration on this legacy
    // path — bounded by the service's own page/excerpt caps).
    if (professionCorpus?.promptBlock) {
      promptSections.push("", professionCorpus.promptBlock);
      professionInjectedIntoPrompt = true;
    }

    // Surface the coworker's eligible skills on the legacy path too. The unified
    // path lists these via assembleSystemPrompt; without this the install default
    // (USE_UNIFIED_COWORKER off) hides every skill — including the decision-routing
    // skills (dpf-decision-via-kernel, dpf-retrieve-decision-context,
    // dpf-record-decision-outcome) the governance block above tells the coworker
    // to run. Telemetry mirrors the unified path so eligibility is observable.
    const legacyCoworkerSkills = capSkillCatalog(
      rankSkillsByRelevance(await getSkillsForAgent(agent.agentId), trimmedContent),
      skillCatalogCap,
      invokedSkillId,
    );
    const legacySkillSummaries = toSkillSummariesForPrompt(legacyCoworkerSkills);
    if (legacySkillSummaries.length > 0) {
      let skillsBlock = "Available coworker skills:";
      for (const skill of legacySkillSummaries) {
        skillsBlock += `\n- ${skill.skillId}: ${skill.label} - ${skill.description}`;
      }
      promptSections.push("", skillsBlock);
      const legacyEligibleSkillIds = legacySkillSummaries.map((s) => s.skillId);
      void recordSkillUsageEvents({
        phase: "eligible",
        skillIds: legacyEligibleSkillIds,
        agentId: agent.agentId,
        userId: user.id ?? null,
        threadId: input.threadId ?? null,
        routeContext: input.routeContext,
      });
      const legacyCandidateSkillId = extractInvokedSkillId(input.content);
      activeSkillId =
        legacyCandidateSkillId && legacyEligibleSkillIds.includes(legacyCandidateSkillId)
          ? legacyCandidateSkillId
          : null;
      if (activeSkillId) {
        void recordSkillUsageEvents({
          phase: "invoked",
          skillIds: [activeSkillId],
          agentId: agent.agentId,
          userId: user.id ?? null,
          threadId: input.threadId ?? null,
          routeContext: input.routeContext,
        });
      }
    }

    populatedPrompt = promptSections.join("\n");
  }

  // WSID Phase 3: record corpus usage/miss evidence for this turn — fire-and-
  // forget, fail-open. `injected` reflects what actually reached the prompt
  // (the unified arbitrator may have dropped the block under budget); misses and
  // low-relevance hits also write a deduped growth-gap so the corpus grows from
  // real usage. Telemetry line mirrors the existing `[tools]`/`[handoff]` style.
  if (professionCorpus) {
    console.log(
      `[profession-corpus] agent=${JSON.stringify(agent.agentId)} ` +
        `family=${JSON.stringify(professionCorpus.professionKey)} status=${professionCorpus.status} ` +
        `injected=${professionInjectedIntoPrompt} pages=${professionCorpus.pages.length} ` +
        `lowRelevance=${professionCorpus.lowRelevance}`,
    );
    void recordProfessionCorpusEvidence({
      context: professionCorpus,
      query: trimmedContent,
      agentId: agent.agentId,
      routeContext: input.routeContext,
      promptInjected: professionInjectedIntoPrompt,
    }).catch((e) => console.warn("[profession-corpus] evidence record failed (fail-open):", e));
  }

  // Get ALL platform tools (no mode filtering — we filter the merged set below)
  const { getAvailableTools, toolsToOpenAIFormat } = await import("@/lib/mcp-tools");
  // Every coworker holds a read-only baseline (page coordination data, docs,
  // source, code graph) on top of its agent-specific grants — BI-FD7E4D72.
  const { COWORKER_READ_BASELINE_GRANTS } = await import("@/lib/tak/agent-grants");
  const coworkerDefaultGrants = [...COWORKER_READ_BASELINE_GRANTS, ...COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS];
  const toolUserContext = {
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  };
  const allPlatformTools = await getAvailableTools(toolUserContext, {
    externalAccessEnabled: input.externalAccessEnabled === true,
    // Skip mode filtering here — applied to merged set
    unifiedMode: useUnified,
    agentId: agent.agentId,
    additionalGrants: coworkerDefaultGrants,
  });

  // Get page-specific actions
  const pageActions = getActionsForRoute(input.routeContext, {
    userId: user.id!,
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  });

  // Merge and apply mode + build phase filtering
  const mergedTools = [...allPlatformTools, ...pageActions];

  // Resolve the active build phase for tool filtering. Prefer the build that
  // prompt assembly already locked onto (resolvedBuildId) so we filter tools
  // by the same build the agent is reasoning about — otherwise an abandoned
  // build with a later updatedAt could leak its phase into the tool allowlist.
  let activeBuildPhase: string | null = null;
  if (input.routeContext.startsWith("/build")) {
    const activeBuild = resolvedBuildId
      ? await prisma.featureBuild.findUnique({
          where: { buildId: resolvedBuildId },
          select: { phase: true, buildId: true, threadId: true },
        }).catch(() => null)
      : await prisma.featureBuild.findFirst({
          where: { createdById: user.id!, phase: { notIn: ["complete", "failed", "abandoned"] } },
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

  // BI-867263F4: in Advise mode, keep the side-effecting tools and let the loop
  // capture each call as an AgentActionProposal, so the coworker's recommended
  // actions surface as selectable Approve/Reject cards instead of prose that
  // asks the employee to flip a global toggle. Off in Act mode (tools run) and
  // during a build phase (phase gating owns the surface).
  //
  // BI-FBBA70DF: Explicit read-only intent overrides proposal surfacing for
  // this turn. When the operator explicitly says "do not create/change/publish
  // anything", suppress proposals and strip side-effecting tools — identical to
  // pre-BI-867263F4 advise behavior. Ambiguous planning language is unaffected.
  const turnIntent = classifyTurnMutationIntent(input.content ?? "");
  const surfaceAsProposals =
    input.coworkerMode === "advise" && !activeBuildPhase && turnIntent !== "read-only";
  const availableTools = filterToolsForCoworkerRuntime(mergedTools, {
    coworkerMode: input.coworkerMode,
    surfaceAsProposals,
    activeBuildPhase,
  });

  // Right-size the per-turn tool ATTACHMENT without touching authority. A page
  // coworker's grants + the universal read baseline can expand to ~100 tools
  // (~34k tokens of schema), overflowing a budget local model's served context
  // and failing every tool turn. Attach a capped core+role set and defer the
  // rest (still authorized); the model pulls deferred tools back on demand via
  // load_tools. Keeps capability, cuts per-turn cost.
  const { selectCoworkerToolBudget, deriveCoworkerToolCap, LOAD_TOOLS_TOOL, LOAD_TOOLS_TOOL_NAME } = await import(
    "@/lib/actions/coworker-tool-budget"
  );
  const { getAgentToolGrantsAsync } = await import("@/lib/tak/agent-grants");
  const roleGrants = await getAgentToolGrantsAsync(agent.agentId);
  // Size the per-turn attachment cap to the LOCAL model's served context. The
  // 48-tool default assumes a ~32k window; a VRAM-constrained local model served
  // at ~24.5k overflows (exceed_context_size_error) with 48 tool schemas (~16k
  // tokens) plus a long thread. This binds on the local context even when a cloud
  // provider is preferred — the cloud→local FALLBACK is exactly where the overflow
  // bites — at the cost of only a few extra load_tools round-trips on a cloud turn.
  // Reads the DMR served-context TRUTH (not ModelProfile, which model discovery can
  // reset to null); no reachable local generation model → the full 48. Resolved
  // once up front (localServedContext) and reused here + for the skills-catalog cap.
  // BI-DF3092F4 (Phase 2) — lift the cap above the fail-safe cliff only when the
  // local model has MEASURED tool-selection fidelity evidence for a larger
  // surface; unmeasured → null → Phase-1 fail-safe. Best-effort (never throws).
  const { resolveLocalToolFidelityCeiling } = await import("@/lib/routing/local-tool-fidelity");
  const measuredToolFidelityCeiling = await resolveLocalToolFidelityCeiling();
  const toolCap = deriveCoworkerToolCap(localServedContext, { measuredToolFidelityCeiling, localPresence });
  // BI-B5C358B1 — the route's declared domain tools are the ones a turn on this
  // route is most likely to need (e.g. /ops → backlog query/update). They were
  // only injected as system-prompt PROSE, never attached, so the intent ranker's
  // shallow lexical overlap could defer them (a backlog question whose words
  // don't appear in the tool descriptions scores 0). Force them into tier-0 so
  // route-relevant tools are always attached under the cap. This reprioritizes
  // ATTACHMENT only among already-authorized tools — a name the coworker isn't
  // granted simply isn't in availableTools and is a no-op here (authority INV-3
  // intact).
  const routeDomainToolNames = resolveRouteContext(input.routeContext).domainTools ?? [];
  // BI-FB0A5C82 (Phase 3) — planner-driven capability discovery. The broker
  // classifies the turn's intent and proactively selects the capability set it
  // needs (the intent's authoritative tools + top keyword-relevant tools), which
  // can extend BEYOND the route's static domainTools. Force-attaching them means
  // the model gets the right tools without a model-driven load_tools round-trip;
  // load_tools remains as the shim for the long tail. Discovery/attachment only —
  // the broker can only surface already-authorized tools (INV-3 intact).
  const { brokerCapabilities } = await import("@/lib/tak/capability-broker");
  const brokerResult = brokerCapabilities({
    routeContext: input.routeContext,
    message: trimmedContent,
    tools: availableTools,
  });
  const brokeredToolNames = brokerResult.brokeredNames;
  // BI-17ACD329 (Phase 4) — mixture-of-experts routing, RECOMMEND-ONLY (kernel
  // DI-D1C241BCCBF0). When the turn's intent belongs to a different specialist
  // coworker, record the recommendation for observability. It does NOT delegate
  // or change authority — coworkers hold no delegation grant, and granting one is
  // a governed, least-privilege decision. The record is ready to drive delegation
  // the moment governance enables it.
  const { routeToSpecialist } = await import("@/lib/tak/specialist-router");
  const specialistRecommendation = routeToSpecialist({
    taskClass: brokerResult.taskClass,
    currentAgentId: agent.agentId,
  });
  if (specialistRecommendation) {
    console.log(
      `[specialist-router] route=${JSON.stringify(input.routeContext)} ` +
        `current=${JSON.stringify(agent.agentId)} taskClass=${JSON.stringify(specialistRecommendation.taskClass)} ` +
        `→ specialist=${JSON.stringify(specialistRecommendation.specialistAgentId)} (recommend-only)`,
    );
  }
  const { attached: budgetedTools, deferred: deferredTools } = selectCoworkerToolBudget({
    tools: availableTools,
    roleGrants,
    pageActionNames: new Set([...pageActions.map((t) => t.name), ...routeDomainToolNames, ...brokeredToolNames, ...AUTHORIZED_SURFACE_TOOL_NAMES]),
    alwaysIncludeNames: new Set([LOAD_TOOLS_TOOL_NAME]),
    cap: availableTools.length > toolCap ? Math.max(1, toolCap - 1) : toolCap,
    // BI-ACE1EBA4 — when the cap forces deferral, keep the tools most relevant to
    // this turn's intent within each priority tier.
    intentQuery: trimmedContent,
  });
  // Advertise the load_tools meta-tool only when something was actually deferred.
  const attachedTools = deferredTools.length > 0 ? [LOAD_TOOLS_TOOL, ...budgetedTools] : budgetedTools;

  let disabledExternalTools: Array<{ name: string; description: string }> = [];
  if (input.externalAccessEnabled !== true) {
    const externalEnabledPlatformTools = await getAvailableTools(toolUserContext, {
      externalAccessEnabled: true,
      unifiedMode: useUnified,
      agentId: agent.agentId,
      additionalGrants: coworkerDefaultGrants,
    });
    disabledExternalTools = getExternalAccessToolSummaries(
      filterToolsForCoworkerRuntime(externalEnabledPlatformTools, {
        coworkerMode: input.coworkerMode,
        activeBuildPhase,
      }),
    );
  }

  // Conversation-only detection: if the message is a conversational skill or a
  // natural-language page/UI explanation request, strip tools entirely so the
  // model explains from context instead of turning friction into backlog work.
  const isExplicitConversationSkill = /^This is a CONVERSATION request/i.test(trimmedContent);
  const isPageExplanationOnly = isPageExplanationOnlyRequest(trimmedContent);
  const isExpansionFollowup = isConversationalExpansionRequest(trimmedContent);
  // Platform-mechanism questions ("if I deploy, will it also rebase?") should
  // answer from prompt + portal context, not by spinning tools. Especially
  // important on Build Studio routes where the tool surface is large enough
  // to drown a small local fallback model. See FB-71FB3A53 thread, 2026-05-22.
  const isMechanismQuestion = isPlatformMechanismQuestion(trimmedContent);
  // Trivial social turns ("hello", "thanks", "ok cool") carry no task. With the
  // full tool surface attached they dispatch the heavyweight tool-loaded CLI
  // agentic loop (8-130s); tool-free they answer in ~2s. See the Portfolio
  // Analyst latency investigation, 2026-06-04.
  const isTrivialSocial = isTrivialSocialMessage(trimmedContent);
  const isConversationOnly = isExplicitConversationSkill || isPageExplanationOnly || isExpansionFollowup || isMechanismQuestion || isTrivialSocial;

  const toolsForProvider = (!isConversationOnly && attachedTools.length > 0)
    ? toolsToOpenAIFormat(attachedTools)
    : undefined;

  // Log tools available so we can diagnose why a model claims it can't see a
  // tool that should be in scope. Logged for every coworker call, not just
  // build-phase ones — chat coworkers on /workspace etc. were silent before.
  // CodeQL js/log-injection: input.routeContext + agent.agentId + tool names
  // are user-influenced. Compose the line, then route it through the registered
  // sanitizeForLog sanitizer so embedded control chars can't forge log entries.
  // Log three distinct numbers so a small-context overflow is diagnosable at a
  // glance: `authorized` = the full grant-allowed surface, `attached` = how many
  // schemas the model ACTUALLY receives this turn (0 on conversation-only turns,
  // where tools are stripped), `deferred` = authorized tools held back and
  // loadable on demand. `tools=[…]` lists the attached set (what the model sees).
  const toolsLogLine =
    `[tools] thread=${JSON.stringify(input.threadId)} route=${JSON.stringify(input.routeContext)} agent=${JSON.stringify(agent.agentId)} ` +
    `${activeBuildPhase ? `buildPhase=${JSON.stringify(activeBuildPhase)} ` : ""}` +
    `authorized=${availableTools.length} attached=${toolsForProvider !== undefined ? attachedTools.length : 0} ` +
    `cap=${toolCap} deferred=${deferredTools.length}${isConversationOnly ? " (conversation-only)" : ""} ` +
    `tools=[${attachedTools.map(t => JSON.stringify(t.name)).join(", ")}]`;
  console.log(sanitizeForLog(toolsLogLine));
  if (activeBuildPhase) {

    // Inject PhaseHandoff context — structured summary from the previous phase
    // replaces raw chat history for focused, token-efficient context.
    // Prefer the already-resolved buildId so we don't reach for a different
    // build than the one assembling this prompt.
    try {
      const activeBuild = resolvedBuildId
        ? await prisma.featureBuild.findUnique({
            where: { buildId: resolvedBuildId },
            select: { buildId: true },
          })
        : await prisma.featureBuild.findFirst({
            where: { createdById: user.id!, phase: { notIn: ["complete", "failed", "abandoned"] } },
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

        if ((mode === "private" || mode === "fork_only") && !hasRepo) {
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

        if (mode === "contributing" || mode === "selective" || mode === "contribute_all") {
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

  // Advise-mode prompt suffix: either "your recommendations become approval
  // cards" (surfaceAsProposals, BI-867263F4) or the legacy held-back muzzle note
  // (build-phase advise). Extracted to coworker-tool-filter for testability.
  populatedPrompt += buildAdvisePromptSuffix({
    coworkerMode: input.coworkerMode,
    surfaceAsProposals,
    mergedTools,
  });

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
      if (shouldRequestExternalAccess({
        content: trimmedContent,
        taskRequiresWebSearch: taskClassification.requiresWebSearch,
        externalTools,
      })) {
        await recordExternalAccessPermissionAudit({
          decision: "approval",
          threadId: input.threadId,
          agentId: agent.agentId,
          userId: user.id!,
          routeContext: input.routeContext,
          content: trimmedContent,
          requestedTools: externalTools.map((tool) => tool.name),
        });
      }
    }
  } else if (shouldRequestExternalAccess({
    content: trimmedContent,
    taskRequiresWebSearch: taskClassification.requiresWebSearch,
    externalTools: disabledExternalTools,
  })) {
    populatedPrompt += buildExternalAccessDisabledInstruction(disabledExternalTools);
    await recordExternalAccessPermissionAudit({
      decision: "request",
      threadId: input.threadId,
      agentId: agent.agentId,
      userId: user.id!,
      routeContext: input.routeContext,
      content: trimmedContent,
      requestedTools: disabledExternalTools.map((tool) => tool.name),
    });
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

  if (isPageExplanationOnly) {
    populatedPrompt += [
      "",
      "",
      "READ-ONLY PAGE EXPLANATION REQUEST",
      "The employee is asking you to explain the current UI or page, not to file, log, queue, or triage work.",
      "Do not call tools, create backlog items, report issues, propose improvements, or list backlog status for this turn.",
      "Use PAGE DATA and recent conversation to explain what the user is seeing. If context is missing, say what you can infer and ask one concise clarifying question.",
    ].join("\n");
  }

  if (isExpansionFollowup) {
    populatedPrompt += [
      "",
      "",
      "READ-ONLY FOLLOW-UP REQUEST",
      "The employee is asking for more explanation of the previous answer, not granting permission for an offered action.",
      "Do not call tools, create backlog items, report issues, propose improvements, or list backlog status for this turn.",
      "Answer by expanding the prior explanation. If the prior answer offered an action, do not perform it unless the employee explicitly asks you to do that action.",
    ].join("\n");
  }

  if (isMechanismQuestion) {
    populatedPrompt += [
      "",
      "",
      "PLATFORM MECHANISM QUESTION",
      "The employee is asking how a DPF mechanism behaves (e.g. what happens when they promote, deploy, ship, or rebase), not asking you to perform an action.",
      "Answer from your system prompt, PAGE DATA, and the active build / backlog context. Do not call tools to look up basic platform behavior.",
      "If you genuinely do not know the answer, say so plainly and offer to investigate — do not guess and do not spin through tools hoping one will explain it.",
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
  let responseIsSystemFailure = false;
  let formAssistUpdate: Record<string, unknown> | undefined;
  let systemMessage: AgentMessageRow | undefined;
  // Pre-allocate the assistant AgentMessage id so adapter telemetry rows
  // written inside the agentic loop carry the join key back to the row this
  // sendMessage will eventually create (either the proposal path or the
  // standard path below). Without this, AdapterRunTelemetry.agentMessageId is
  // always null and the per-turn provider/model badge degrades to provider
  // name only.
  const pendingAgentMessageId = randomUUID();
  const currentTaskRun = await findCurrentAutonomousWorkRun({
    userId: user.id!,
    threadId: input.threadId,
  }).catch(() => null);

  // EP-AI-WORKFORCE-001: Provider pinning is now via AgentModelConfig.pinnedProviderId
  // (resolved in agentic-loop.ts via agentModelConfig lookup). No need to merge here.
  const modelReqs = applyProviderRouteModelPreference(
    { ...agent.modelRequirements },
    input.routeContext,
  );

  // --- Task classification and performance profile injection ---
  // EP-INF-009b: Routing is handled by the agentic loop via routeAndCall().
  // We classify here for metadata and performance profile instruction injection.
  // Inject task-specific instructions from performance profile (if confident classification)
  if (taskClassification.taskType !== "unknown" && taskClassification.confidence >= 0.5) {
    try {
      const profiles = await loadPerformanceProfiles(taskClassification.taskType);
      // Find the best performance profile to inject guidance from
      const profile = profiles[0];
      if (profile?.currentInstructions) {
        populatedPrompt += `\n\n--- TASK GUIDANCE ---\n${profile.currentInstructions}`;
      }
    } catch (err) {
      console.error("[routing] performance profile load error:", err);
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
        const { revalidatePortalContextForBuild } = await import("@/lib/portal-context/invalidation");
        revalidatePortalContextForBuild(activeBuild!.buildId);
      } catch { /* already advanced or concurrent update — fine */ }

      const needsReview = (activeBuild!.taskResults as { tasks?: Array<{ outcome: string; title: string }> })?.tasks
        ?.filter(t => t.outcome !== "DONE") ?? [];
      const reviewItems = needsReview.length > 0
        ? `\n\n**${needsReview.length} item${needsReview.length > 1 ? "s" : ""} flagged for review:**\n${needsReview.map(t => `- ${t.title}`).join("\n")}`
        : "\n\nAll tasks completed cleanly.";
      const closeout = needsReview.length > 0
        ? formatCoworkerOperationalCloseout({
          status: "needs review",
          evidence: `${storedResults!.completedTasks}/${storedResults!.totalTasks} tasks are complete; ${needsReview.length} item${needsReview.length === 1 ? "" : "s"} are flagged for review.`,
          nextAction: "review the flagged item output, then run the Build Studio review phase.",
          owner: "Build Studio review agent",
        })
        : formatCoworkerOperationalCloseout({
          status: "ready for review",
          evidence: `${storedResults!.completedTasks}/${storedResults!.totalTasks} tasks are complete with no flagged task output.`,
          nextAction: "run final verification in the Build Studio review phase.",
          owner: "Build Studio review agent",
        });
      responseContent = `Build complete — ${storedResults!.completedTasks}/${storedResults!.totalTasks} tasks done.${reviewItems}\n\n${closeout}`;
      responseProviderId = "orchestrator";
      responseModelId = "multi-specialist";
      // Fall through to message persistence below
    }

    if (activeBuild && !buildPlan?.tasks?.length) {
      console.warn(`[orchestrator] SKIPPED for ${activeBuild.buildId}: buildPlan missing "tasks" array. Plan keys: ${buildPlan ? Object.keys(buildPlan).join(", ") : "null"}. Falling back to single-agent mode — no specialist dispatch.`);
    }

    if (activeBuild && buildPlan?.tasks?.length && !buildAlreadyComplete) {
      const { runBuildOrchestrator } = await import("@/lib/build/build-orchestrator");
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
    const { agentEventBus } = await import("@/lib/agent-event-bus");

    // Build Specialist Operator Contract platform guards (clauses 2.2/2.4/2.6)
    // need to know the active FeatureBuild's phase + id for attribution.
    // findFirst returns null on non-build threads; the guards no-op when
    // buildPhase is null/non-build.
    const activeBuild = await prisma.featureBuild.findFirst({
      where: { threadId: input.threadId },
      select: { id: true, phase: true },
    }).catch(() => null);

    // BI-F0005EB0 — auto-retry a TRANSIENT ideate inference failure (connection
    // hiccup / short rate-limit) with backoff before it reaches the user. The
    // ideate first turn is the reported dead-end: without this, a single
    // ConnectionRefused stalls the whole build. Non-ideate turns run once
    // (enabled:false), so behavior elsewhere is unchanged. A failure that
    // survives all retries falls through to the persist-time sanitizer below and
    // the "Retry the AI call" affordance.
    // EP-27FD96BC · P1 — the unified per-turn effort warrant. Derived once here
    // from the same task classification that seeds the model path, the attached
    // tool surface, and the prompt length; the loop co-tunes iterations and
    // duration from it (and later pillars read its toolBudgetTarget/contextTier).
    const effortWarrant = deriveEffortWarrant({
      taskType: taskTypeId,
      availableToolNames: attachedTools.map((t) => t.name),
      messageChars: trimmedContent.length,
    });

    // EP-27FD96BC · P4 (BI-8167C9CD) — delegation & altitude decision layer. Map
    // the turn's altitude (from the warrant) and the agent's human-oversight tier
    // (hitlTierDefault) to a recommended mode and surface it as guidance, so the
    // coworker escalates high-stakes work / considers delegating big work instead
    // of flailing inline. capabilityGap / decomposable are the model's judgment,
    // so it gets the primitive menu rather than a forced choice.
    try {
      const agentRow = await prisma.agent
        .findUnique({ where: { agentId: agent.agentId }, select: { hitlTierDefault: true } })
        .catch(() => null);
      const { decideDelegation, renderDelegationGuidance } = await import("@/lib/tak/delegation-policy");
      const delegation = decideDelegation({
        effortLevel: effortWarrant.level,
        hitlTier: agentRow?.hitlTierDefault ?? 2,
        capabilityGap: false,
        decomposable: false,
        delegationDepth: 0,
      });
      const guidance = renderDelegationGuidance(delegation);
      if (guidance) {
        populatedPrompt = `${populatedPrompt}\n\n${guidance}`;
      } else if (effortWarrant.level === "high") {
        populatedPrompt =
          `${populatedPrompt}\n\nDELEGATION: this is high-effort work. If it needs a ` +
          `capability you lack, call \`request_coworker\`; if it splits into independent ` +
          `parallel parts, call \`spawn_work_thread\`; otherwise proceed inline.`;
      }
    } catch {
      // Delegation guidance is advisory — never block the turn on it.
    }

    const { runWithTransientInferenceRetry } = await import("@/lib/build/inference-retry");
    const agenticResult = await runWithTransientInferenceRetry(
      () => executeAutonomousAgenticLoop({
        chatHistory,
        systemPrompt: populatedPrompt,
        systemPromptInstructionSpans,
        messageOrigins: labelled.origins,
        sensitivity: agent.sensitivity,
        tools: attachedTools,
        toolsForProvider,
        deferredTools,
        userId: user.id!,
        routeContext: input.routeContext,
        agentId: agent.agentId,
        threadId: input.threadId,
        taskType: taskTypeId,
        effortWarrant,
        agentDisplayName: agent.agentName,
        buildPhase: activeBuild?.phase ?? null,
        featureBuildId: activeBuild?.id ?? null,
        activeSkillId,
        agentMessageId: pendingAgentMessageId,
        // sendMessage is the user-typed-a-question path. Chat mode disables the
        // Operator Contract zero-tool-call / unsaved-evidence guards so a
        // conversational reply ("yes do the truck list first") does not
        // false-positive into a PlatformIssueReport.
        interactionMode: "chat",
        // BI-867263F4: Advise mode surfaces recommended actions as proposals —
        // the loop diverts each side-effecting non-artifact call to an
        // AgentActionProposal card instead of executing it.
        proposeSideEffects: surfaceAsProposals,
        ...(Object.keys(modelReqs).length > 0 ? { modelRequirements: modelReqs } : {}),
        onProgress: (event) => agentEventBus.emit(input.threadId, event),
      }),
      {
        enabled: activeBuildPhase === "ideate",
        onRetry: (attempt, kind) =>
          console.warn(`[coworker] ideate inference ${kind} failure — auto-retry attempt ${attempt}`),
      },
    );

    // EP-ASYNC-COWORKER-001: done event moved to caller (API route) so it fires
    // AFTER message persistence, enabling SSE-driven async completion.

    // Handle proposal — agent wants to take a side-effecting action that needs approval
    if (agenticResult.proposal) {
      const tc = agenticResult.proposal;
      const proposalId = "AP-" + Math.random().toString(36).substring(2, 7).toUpperCase();
      const agentMsg = await prisma.agentMessage.create({
        data: {
          id: pendingAgentMessageId,
          threadId: input.threadId, role: "assistant",
          taskRunId: currentTaskRun?.taskRunId ?? null,
          content: tc.content || `I'd like to ${tc.name.replace(/_/g, " ")} with the following details.`,
          agentId: agent.agentId, routeContext: input.routeContext,
          providerId: agenticResult.providerId,
          modelId: agenticResult.modelId,
          taskType: taskTypeId !== "unknown" ? taskTypeId : null,
          routedEndpointId: null, // EP-INF-009b: routing handled per-iteration by routeAndCall
          contextTrace, // BI-3E218D80 — proposal path (see also the plain-response write)
        },
        select: { id: true, role: true, content: true, agentId: true, routeContext: true, createdAt: true },
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

    // The Golden Triangle review already ran inside executeAutonomousAgenticLoop.
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
    responseIsSystemFailure = Boolean(agenticResult.failure);

    // Caveat a blind local answer, but not one grounded in authoritative ASC state.
    responseContent = applyLocalDegradationCaveat(result.content, {
      providerId: result.providerId,
      executedToolCount: agenticResult.executedTools.length,
      authoritativeSurfaceEvidence: agenticResult.authoritativeSurfaceEvidence,
    });
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
          const { dispatchScoutResearch } = await import("@/lib/build/scout-dispatch");
          const scoutResult = await dispatchScoutResearch({
            buildId: resolvedBuildId,
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
              { buildId: resolvedBuildId, field: "scoutFindings", value: scoutResult.result },
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
    // dispatch the research to the configured external CLI (Claude / Codex / Grok) and save the result ──
    if (activeBuildPhase === "ideate" && resolvedBuildId) {
      const buildForResearch = await prisma.featureBuild.findUnique({
        where: { buildId: resolvedBuildId },
        select: { buildExecState: true, title: true, description: true },
      });
      const execState = buildForResearch?.buildExecState as Record<string, unknown> | null;
      if (execState?.ideateResearchRequested) {
        const { agentEventBus } = await import("@/lib/agent-event-bus");
        agentEventBus.emit(input.threadId, { type: "tool:start", tool: "codebase_research", iteration: 0 });

        try {
          const { dispatchIdeateResearch } = await import("@/lib/build/ideate-dispatch");
          const { getBuildStudioConfig } = await import("@/lib/build/build-studio-config");
          const config = await getBuildStudioConfig();
          console.log(`[coworker] Ideate research requested — dispatching to ${config.provider === "claude" ? "Claude" : config.provider === "grok" ? "Grok" : "Codex"} CLI`);

          // Build context for the research
          const buildCtx = await getFeatureBuildForContext(resolvedBuildId, user.id!);
          // Use the active provider — Claude, Codex, or Grok depending on config
          const ideateProviderId = config.provider === "claude" ? config.claudeProviderId
            : config.provider === "grok" ? config.grokProviderId
            : config.provider === "opencode" ? config.opencodeProviderId
            : config.codexProviderId;
          const ideateModel = config.provider === "claude" ? config.claudeModel
            : config.provider === "grok" ? config.grokModel
            : config.provider === "opencode" ? config.opencodeModel
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
              { buildId: resolvedBuildId, field: "designDoc", value: ideateResult.designDoc },
              user.id!,
              { routeContext: input.routeContext },
            );

            console.log(`[coworker] saveBuildEvidence result: success=${saveResult.success}, msg=${JSON.stringify(saveResult.message?.slice(0, 100))}`);

            if (saveResult.success) {
              const approach = String((ideateResult.designDoc as Record<string, unknown>).proposedApproach ?? "").trim();
              console.log(`[coworker] Approach length: ${approach.length}`);
              if (approach.length < 30) {
                // Design doc saved but approach is blank — research engine produced an empty doc.
                console.log(`[coworker] Approach too short (${approach.length} chars) — treating as empty doc`);
                responseContent = formatIncompleteIdeateDesignMessage(resolvedBuildId);
              } else {
                // Run the design doc review
                console.log(`[coworker] Running reviewDesignDoc...`);
                agentEventBus.emit(input.threadId, { type: "tool:start", tool: "design_review", iteration: 0 });
                const reviewResult = await executeTool("reviewDesignDoc", { buildId: resolvedBuildId }, user.id!, { routeContext: input.routeContext });
                console.log(`[coworker] reviewDesignDoc result: success=${reviewResult.success}, msg=${JSON.stringify(reviewResult.message?.slice(0, 100))}`);
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
                  { buildId: resolvedBuildId, field: "designDoc", value: patchedDoc },
                  user.id!,
                  { routeContext: input.routeContext },
                );
                if (retryResult.success) {
                  // Only treat as success if proposedApproach has real content.
                  // An empty approach means the research engine ran but produced a blank doc.
                  const approach = String(rawDoc.proposedApproach ?? "").trim();
                  if (approach.length < 30) {
                    responseContent = formatIncompleteIdeateDesignMessage(resolvedBuildId);
                  } else {
                    agentEventBus.emit(input.threadId, { type: "tool:start", tool: "design_review", iteration: 0 });
                    const reviewResult = await executeTool("reviewDesignDoc", { buildId: resolvedBuildId }, user.id!, { routeContext: input.routeContext });
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
                  responseContent = formatIdeateResearchIssueMessage({
                    summary: `Research completed, but the patched design evidence was not accepted.${retryResult.message ? ` ${retryResult.message}` : ""}`,
                    evidence: `saveBuildEvidence rejected the patched design document for build ${resolvedBuildId}.`,
                    nextAction: "revise the design evidence and rerun ideate review.",
                  });
                }
              } else {
                responseContent = formatIdeateResearchIssueMessage({
                  summary: `Research completed, but the design document needs revision.${saveResult.message ? ` ${saveResult.message}` : ""}`,
                  evidence: `saveBuildEvidence did not accept the design document for build ${resolvedBuildId}.`,
                  nextAction: "revise the design document and rerun design review.",
                });
              }
            }
          } else {
            responseContent = formatIdeateResearchResultMessage({
              buildId: resolvedBuildId,
              error: ideateResult.error,
            });
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

      const sysContent = formatProviderUnavailableMessage({
        attempts: e.attempts,
        inactiveProviders,
      });

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
    // CodeQL js/log-injection: .length values are numeric but CodeQL
    // tracks them as tainted via the source string. Number() coercion is
    // a recognised sanitiser.
    console.warn(
      `[quality-gate] Response too short (${Number(responseContent.length)} chars). ` +
      `Raw from loop (${Number(rawResponseBeforeSanitize.length)} chars): ${JSON.stringify(rawResponseBeforeSanitize.slice(0, 500))} | ` +
      `After sanitize: ${JSON.stringify(responseContent)} | ` +
      `Provider: ${JSON.stringify(responseProviderId)}/${JSON.stringify(responseModelId)} | ` +
      `Route: ${JSON.stringify(input.routeContext)}`,
    );
    const providerHint = responseProviderId
      ? `Provider ${responseProviderId}/${responseModelId} returned an empty response.`
      : "No AI provider was matched by the routing pipeline.";
    responseContent = `**Unable to process this request.** ${providerHint} Check AI Workforce settings (Platform > AI) to verify provider configuration.`;
  }

  // BI-F0005EB0 — never persist a raw provider/CLI error string as a
  // user-visible assistant message. When the loop smuggled a raw error into
  // `content` (e.g. `API Error: Unable to connect to API (ConnectionRefused)`),
  // replace it with provider-detail-free copy; the raw string stays in server
  // logs for engineers. The sanitized copy is still classifiable, so the
  // progress-visibility signal + "Retry the AI call" affordance still fire.
  {
    const { isRawProviderError, classifyInferenceFailure, friendlyInferenceFailureMessage } =
      await import("@/lib/build/inference-failure");
    if (isRawProviderError(responseContent)) {
      const kind = classifyInferenceFailure(responseContent) ?? "provider-unavailable";
      console.warn(
        `[coworker] raw inference error hidden from user (kind=${kind}, route=${JSON.stringify(input.routeContext)}): ${JSON.stringify(responseContent.slice(0, 300))}`,
      );
      responseContent = friendlyInferenceFailureMessage(kind);
    }
  }

  const agentMsg = await prisma.agentMessage.create({
    data: {
      id: pendingAgentMessageId,
      threadId: input.threadId,
      role: responseIsSystemFailure ? "system" : "assistant",
      taskRunId: currentTaskRun?.taskRunId ?? null,
      content: responseContent,
      agentId: responseIsSystemFailure ? null : agent.agentId,
      routeContext: input.routeContext,
      providerId: responseIsSystemFailure ? null : responseProviderId,
      modelId: responseIsSystemFailure ? null : responseModelId,
      taskType: taskTypeId !== "unknown" ? taskTypeId : null,
      routedEndpointId: null, // EP-INF-009b: routing is per-iteration via routeAndCall
      contextTrace, // BI-3E218D80 — plain-response path (see also the proposal write)
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

  await persistCoworkerResponseArtifact({
    taskRunId: currentTaskRun?.taskRunId ?? null,
    responseContent,
    routeContext: input.routeContext,
    threadId: input.threadId,
    agentId: agent.agentId,
    agentName: agent.agentName,
    providerId: responseProviderId,
    modelId: responseModelId,
    portalContext: portalContextPromptContext?.envelope ?? null,
    userId: user.id!,
  });

  const { resolveAIDocForAgent } = await import("@/lib/identity/aidoc-resolver");
  const memoryOperatingProfileFingerprint = (
    await resolveAIDocForAgent(agent.agentId).catch(() => null)
  )?.operating_profile_fingerprint ?? null;

  // Fire-and-forget: store conversation memories in Qdrant
  import("@/lib/semantic-memory").then(({ storeConversationMemory }) => {
    const memBase = {
      userId: user.id!,
      agentId: agent.agentId,
      routeContext: input.routeContext,
      threadId: input.threadId,
      // BI-DG-001: pass the resolved sensitivity + declared purpose into the
      // derived-copy write (gate fails closed on restricted, masks confidential).
      sensitivity: agent.sensitivity,
      purpose: "coworker-semantic-recall",
      operatingProfileFingerprint: memoryOperatingProfileFingerprint,
    };
    // Skip trivial messages that add noise to semantic search
    const isSubstantive = (text: string) => text.length > 15 && !/^(?:ok|yes|no|thanks|thank you|sure|got it|hello|hi|hey)$/i.test(text.trim());
    if (isSubstantive(trimmedContent)) {
      storeConversationMemory({ ...memBase, messageId: userMsg.id, content: trimmedContent, role: "user" })
        .catch((e) => console.warn("[memory-store] user:", getErrorMessage(e)));
    }
    if (isSubstantive(responseContent) && !responseIsSystemFailure) {
      storeConversationMemory({ ...memBase, messageId: agentMsg.id, content: responseContent, role: "assistant" })
        .catch((e) => console.warn("[memory-store] assistant:", getErrorMessage(e)));
    }
  }).catch((e) => console.warn("[memory-store] import failed:", getErrorMessage(e)));

  // Fire-and-forget: extract user facts from substantive user messages
  if (trimmedContent.length > 30) {
    import("@/lib/tak/user-facts").then(({ extractAndStoreFacts }) => {
      extractAndStoreFacts({
        userId: user.id!,
        messageContent: trimmedContent,
        routeContext: input.routeContext,
        messageId: userMsg.id,
        sourceAgentId: agent.agentId,
        operatingProfileFingerprint: memoryOperatingProfileFingerprint,
      }).catch((e) => console.warn("[user-facts] extract failed:", getErrorMessage(e)));
    }).catch((e) => console.warn("[user-facts] import failed:", getErrorMessage(e)));
  }

  // BI-FDECBE0A (EP-8C706944 P1): fire-and-forget advance of the durable rolling
  // checkpoint. Folds turns that have just aged out of the recency window into the
  // persisted summary (a no-op until a batch has accumulated), so the fold is paid
  // once per batch instead of re-summarized every turn. keepRecentCount mirrors the
  // window this route loads above.
  {
    const keepRecentCount = isBuildPhase ? 20 : 8;
    import("@/lib/tak/thread-checkpoint-runner")
      .then(({ advanceThreadCheckpointForThread }) =>
        advanceThreadCheckpointForThread(input.threadId, keepRecentCount),
      )
      .catch((e) => console.warn("[thread-checkpoint] advance failed:", getErrorMessage(e)));
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
  const user = await requireUser();

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
  const user = await requireUser();

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
  const user = await requireUser();

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

// ─── Agent Thread Spawning ────────────────────────────────────────────────────

type SpawnWorkThreadInput = {
  parentThreadId: string;
  objective: string;
  title?: string;
  routeContext?: string;
  agentId?: string;
};

export async function spawnWorkThread(
  input: SpawnWorkThreadInput,
  userId: string,
): Promise<{ child: { id: string }; taskRunId: string }> {
  const { spawnWorkThread: spawn } = await import("@/lib/actions/agent-threads");
  return spawn(input.parentThreadId, input.objective, userId, {
    title: input.title,
    routeContext: input.routeContext,
    agentId: input.agentId,
  });
}

export async function cancelThread(
  input: { threadId: string },
  userId: string,
): Promise<{ ok: boolean }> {
  const thread = await prisma.agentThread.findUnique({
    where: { id: input.threadId },
    select: { id: true, userId: true, cancelledAt: true },
  });
  if (!thread) {
    throw new Error(`Thread ${input.threadId} not found.`);
  }
  if (thread.userId !== userId) {
    throw new Error("Unauthorized: thread is owned by another user.");
  }
  if (thread.cancelledAt) {
    return { ok: true };
  }
  await prisma.agentThread.update({
    where: { id: input.threadId },
    data: { cancelledAt: new Date() },
  });
  return { ok: true };
}

export async function getThreadResult(
  input: { childId: string },
  userId: string,
): Promise<{ status: string; summary: string | null; terminalError: unknown }> {
  const thread = await prisma.agentThread.findUnique({
    where: { id: input.childId },
    select: { id: true, userId: true, terminalError: true },
  });
  if (!thread) {
    throw new Error(`Thread ${input.childId} not found.`);
  }
  if (thread.userId !== userId) {
    throw new Error("Unauthorized: thread is owned by another user.");
  }
  const taskRun = await prisma.taskRun.findFirst({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
    select: { status: true, progressPayload: true },
  });
  const status = taskRun?.status ?? "unknown";
  const summary =
    typeof (taskRun?.progressPayload as Record<string, unknown> | null)?.["summary"] === "string"
      ? ((taskRun!.progressPayload as Record<string, unknown>)["summary"] as string)
      : null;
  return { status, summary, terminalError: thread.terminalError };
}

export async function getChildThreads(
  input: { parentThreadId: string },
  userId: string,
): Promise<Array<{ id: string; objective: string | null; status: string }>> {
  const children = await prisma.agentThread.findMany({
    where: { parentThreadId: input.parentThreadId, userId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const results: Array<{ id: string; objective: string | null; status: string }> = [];
  for (const child of children) {
    const taskRun = await prisma.taskRun.findFirst({
      where: { threadId: child.id },
      orderBy: { createdAt: "desc" },
      select: { objective: true, status: true },
    });
    results.push({
      id: child.id,
      objective: taskRun?.objective ?? null,
      status: taskRun?.status ?? "unknown",
    });
  }
  return results;
}

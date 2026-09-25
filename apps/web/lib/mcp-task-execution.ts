import { coworkerBriefSpans } from "@/lib/tak/coworker-prompt-provenance";
import { loadPirEvidenceContext } from "./pir-evidence-context";
import { prisma, type Prisma } from "@dpf/db";
import { terminalWriterDispatchContractForProvider } from "@/lib/routing/execution-plan";
import type { RequestContract } from "@/lib/routing/request-contract";
import { loadInitiativeReviewOutcome } from "./mcp-task-review-outcome";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import {
  executeAutonomousAgenticLoop,
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
} from "@/lib/tak/autonomous-work-run";
import { createTaskMessage } from "@/lib/tak/task-records";
import { deriveEffortWarrant } from "@/lib/tak/effort-warrant";
import {
  createInitiativeReviewTerminalToolPolicy,
  enterTerminalWriterPhase,
  terminalWriterFailureMessage as describeTerminalWriterFailure,
} from "@/lib/tak/terminal-tool-policy";
import {
  createResourceWaitProjection,
  preInferenceResourceWait,
  RESOURCE_WAIT_MAX_ATTEMPTS,
} from "./mcp-task-capacity-contract";
import {
  narrowInitiativeReviewTools,
  requiredToolNames,
  requiresInitiativeReviewEffort,
} from "./mcp-task-review-contract";
import type {
  RemoteTaskSubmitAuth,
  RemoteTaskSubmitOutcome,
  RemoteTaskSubmitParams,
} from "./mcp-task-submit";
import { withTaskRunApprovalLocation } from "./mcp/external-approval-location-lookup";
import {
  TERMINAL_WRITER_REJECTED_WAIT_REASON,
  createTerminalWriterEscalation,
  lastTerminalWriterRejection,
  terminalWriterRejectionMessage,
  terminalWriterRejectionStructuredContent,
  terminalWriterEscalationMessage,
  terminalWriterEscalationStructuredContent,
  terminalWriterEscalationWaitReason,
  terminalWriterRetryIsExhausted,
} from "./mcp-task-terminal-writer-escalation";

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function remoteTaskContent(text: string) {
  return [{ type: "text", text }];
}

function approvalRequiredEnvelopeId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result["success"] !== false || result["error"] !== "approval_required") return null;
  const data = result["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return optionalString((data as Record<string, unknown>)["envelopeId"]);
}

export function remoteTaskConversation(input: {
  systemPrompt: string;
  prompt: string;
  resumeKind?: "capacity" | "terminal-writer";
  terminalWriterContext?: string;
}): {
  systemPrompt: string;
  chatHistory: Array<{ role: "user"; content: string }>;
} {
  return {
    systemPrompt: input.resumeKind === "terminal-writer" && input.terminalWriterContext
      ? `${input.systemPrompt}\n\n${input.terminalWriterContext}`
      : input.systemPrompt,
    chatHistory: [{ role: "user", content: input.prompt }],
  };
}

export async function executeRemoteTaskAttempt(input: {
  run: { id: string; taskRunId: string; contextId: string | null };
  threadId: string;
  token: RemoteTaskSubmitAuth;
  userContext: import("@/lib/permissions").UserContext;
  parsed: RemoteTaskSubmitParams;
  idempotentReplay: boolean;
  resumeKind?: "capacity" | "terminal-writer";
  terminalWriterContext?: string;
  capacityAttempt: number;
  terminalWriterAttempt?: number;
}): Promise<RemoteTaskSubmitOutcome> {
  const { run, token, userContext, parsed } = input;
  const agent = await resolveAutonomousWorkAgent({
    agentId: parsed.agentId,
    routeContext: parsed.routeContext,
    userContext,
  });
  const modelRoutingAgentId = agent.agentId ?? parsed.agentId;
  const resolvedAgentId = resolveCanonicalAgentId(modelRoutingAgentId);
  const requestedAgentId = parsed.agentId;
  const requestedCanonicalAgentId = resolveCanonicalAgentId(requestedAgentId);
  let routingConfig: {
    minimumTier: string;
    budgetClass: string;
    pinnedProviderId: string | null;
    pinnedModelId: string | null;
    residencyPolicy: string | null;
  } | null = null;
  // An explicit alias is itself an operator-selectable coworker identity, so
  // its assignment wins. A canonical request keeps the established resolved
  // slug first because the coworker management surface stores assignments by
  // slug. Grants and audit remain canonical in both cases.
  const configAgentIds = requestedAgentId === requestedCanonicalAgentId
    ? [modelRoutingAgentId, requestedAgentId]
    : [requestedAgentId, modelRoutingAgentId];
  for (const configAgentId of new Set(configAgentIds)) {
    routingConfig = await prisma.agentModelConfig?.findUnique({
      where: { agentId: configAgentId },
      select: {
        minimumTier: true,
        budgetClass: true,
        pinnedProviderId: true,
        pinnedModelId: true,
        residencyPolicy: true,
      },
    }).catch(() => null) ?? null;
    if (routingConfig) break;
  }
  const modelRequirements = routingConfig
    ? {
        defaultMinimumTier: routingConfig.minimumTier,
        defaultBudgetClass: routingConfig.budgetClass,
        ...(routingConfig.pinnedProviderId
          ? { preferredProviderId: routingConfig.pinnedProviderId }
          : {}),
        ...(routingConfig.pinnedModelId
          ? { preferredModelId: routingConfig.pinnedModelId }
          : {}),
        // BI-8CFA1CA8: residency is read as the stated policy it is. This used
        // to be inferred from `pinnedProviderId === "local"`, which let a
        // routing preference silently set — or silently clear — a data
        // guarantee. The migration wrote the policy explicitly for every
        // config that was local-pinned, so behaviour is unchanged.
        ...(routingConfig.residencyPolicy
          ? {
              residencyPolicy:
                routingConfig.residencyPolicy as RequestContract["residencyPolicy"],
            }
          : {}),
      }
    : null;
  const toolMode = parsed.riskClass === "read" ? "advise" : "act";
  const exactRequiredToolNames = requiredToolNames(parsed.authorityScope);
  const resolvedTools = await resolveAutonomousWorkTools({
    userContext,
    agentId: resolvedAgentId,
    mode: toolMode,
    externalAccessEnabled: true,
    routeContext: parsed.routeContext,
    intentQuery: parsed.prompt,
    requiredToolNames: exactRequiredToolNames,
  });
  const tools = narrowInitiativeReviewTools(
    resolvedTools,
    exactRequiredToolNames,
    parsed.initiativeReviewBinding,
    parsed.prompt,
  );
  const effortWarrant = requiresInitiativeReviewEffort(exactRequiredToolNames)
    ? deriveEffortWarrant({
        reasoningDepth: "high",
        availableToolNames: [
          ...tools.tools.map((tool) => tool.name),
          ...tools.deferredTools.map((tool) => tool.name),
        ],
        messageChars: parsed.prompt.length,
      })
    : undefined;
  const baseTerminalToolPolicy = parsed.initiativeReviewBinding
    ? createInitiativeReviewTerminalToolPolicy(
        parsed.initiativeReviewBinding.writerToolName,
        exactRequiredToolNames,
        parsed.initiativeReviewBinding.artifactRef,
      )
    : null;
  const terminalToolPolicy = baseTerminalToolPolicy && input.resumeKind === "terminal-writer"
    ? enterTerminalWriterPhase(baseTerminalToolPolicy)
    : baseTerminalToolPolicy;
  const resumedFlag = !input.idempotentReplay
    ? {}
    : input.resumeKind === "terminal-writer"
      ? { resumedFromTerminalWriterWait: true }
      : { resumedFromCapacity: true };
  const conversation = remoteTaskConversation({
    systemPrompt: `${agent.systemPrompt}\n${await loadPirEvidenceContext(prisma, parsed.initiativeReviewBinding)}`,
    prompt: parsed.prompt,
    resumeKind: input.resumeKind,
    terminalWriterContext: input.terminalWriterContext,
  });

  try {
    const result = await executeAutonomousAgenticLoop({
      systemPrompt: conversation.systemPrompt,
      systemPromptInstructionSpans: coworkerBriefSpans(agent.systemPrompt),
      chatHistory: conversation.chatHistory,
      sensitivity: agent.sensitivity ?? "internal",
      tools: tools.tools,
      toolsForProvider: tools.toolsForProvider,
      deferredTools: tools.deferredTools,
      userId: token.userId,
      routeContext: parsed.routeContext,
      agentId: resolvedAgentId,
      threadId: input.threadId,
      taskRunId: run.taskRunId,
      apiTokenId: token.tokenId,
      tokenScope: token.capability,
      taskType: "external-mcp",
      agentDisplayName: optionalString(agent.displayName) ?? resolvedAgentId,
      ...(effortWarrant ? { effortWarrant } : {}),
      ...(terminalToolPolicy ? { terminalToolPolicy } : {}),
      ...(modelRequirements ? { modelRequirements } : {}),
    });

    const writerResult = parsed.initiativeReviewBinding
      ? result.executedTools?.filter((tool) => tool.name === parsed.initiativeReviewBinding!.writerToolName && tool.result.success).at(-1)?.result
      : undefined;
    const receiptId = optionalString(writerResult?.data?.["receiptId"]);
    const persistedOutcome = receiptId && parsed.initiativeReviewBinding
      ? await loadInitiativeReviewOutcome(parsed.initiativeReviewBinding, receiptId) : null;
    if (persistedOutcome) {
      result.content = persistedOutcome.summary;
      result.failure = undefined;
    }
    const receiptExpected = !!parsed.initiativeReviewBinding && parsed.initiativeReviewBinding.gate !== "objective-mapping"
      && !parsed.initiativeReviewBinding.eligibleEvidenceActivityIds?.length;
    if (writerResult && receiptExpected && !persistedOutcome) {
      result.content = `The writer returned success${receiptId ? ` for receipt ${receiptId}` : " without a receipt ID"}, but its persisted gate and immutable artifact could not be verified. Read back the writer result before retrying or advancing readiness.`;
    }

    await createTaskMessage({
      taskRunId: run.taskRunId,
      taskRunRecordId: run.id,
      contextId: run.contextId,
      role: "assistant",
      content: result.content,
      metadata: {
        source: "mcp.tasks/submit",
        executedToolCount: result.executedTools?.length ?? 0,
        capacityAttempt: input.capacityAttempt,
        ...(persistedOutcome ? { reviewOutcome: persistedOutcome } : {}),
      },
    });

    const currentRun = parsed.riskClass === "read"
      ? null
      : await prisma.taskRun.findUnique({
          where: { taskRunId: run.taskRunId },
          select: { status: true, progressPayload: true },
        });
    // The loop is not trusted to self-report a missing writer: main enforces this
    // at the completion boundary (#4925, #4930) so a review cannot pass without
    // the governed writer having been attempted. Ported verbatim into the async
    // flow, which previously relied on result.failure alone.
    const terminalWriterExecutions = terminalToolPolicy
      ? (result.executedTools ?? []).filter((tool) => tool.name === terminalToolPolicy.writerToolName)
      : [];
    const terminalWriterApprovalEnvelopeId = terminalToolPolicy
      ? terminalWriterExecutions
          .map((tool) => approvalRequiredEnvelopeId(tool.result))
          .find((envelopeId): envelopeId is string => envelopeId !== null) ?? null
      : null;
    const terminalWriterSucceeded = receiptExpected
      ? persistedOutcome !== null : terminalWriterExecutions.some((tool) => tool.result.success);
    const terminalWriterMissing = terminalToolPolicy !== null
      && !terminalWriterSucceeded
      && terminalWriterApprovalEnvelopeId === null;
    // BI-C35576A9: record the contract the provider that RAN was held to, never a
    // hard-coded claim. A CLI adapter is receipt-verified; an HTTP adapter forced
    // the call. Undefined when nothing ran, so a throw never invents a contract.
    const terminalWriterContract = terminalWriterDispatchContractForProvider(
      (result as { providerId?: string }).providerId,
    );
    // BI-8B8731EE: a resource wait is NOT a writer-contract failure, and this
    // branch would otherwise swallow it. `terminalWriterMissing` is true for any
    // governed route that executed no tools, which is exactly what a capacity
    // deferral looks like — so on a reviewer route the resource wait below was
    // unreachable and every deferral was reported as a missing receipt writer.
    // Let the resource wait win; it resumes on the same TaskRun either way.
    const resourceWaitOwnsThisTurn = preInferenceResourceWait(result) !== null;
    if (terminalWriterApprovalEnvelopeId && terminalToolPolicy && !persistedOutcome) {
      const priorProgress = currentRun?.progressPayload
        && typeof currentRun.progressPayload === "object"
        && !Array.isArray(currentRun.progressPayload)
        ? currentRun.progressPayload as Record<string, unknown>
        : {};
      const approvalProgress = { ...priorProgress };
      delete approvalProgress.terminalWriterWait;
      delete approvalProgress.terminalWriterDispatchFailure;
      delete approvalProgress.terminalWriterEscalation;
      delete approvalProgress.terminalWriterContextFailure;
      delete approvalProgress.resourceWait;
      await prisma.taskRun.update({
        where: { taskRunId: run.taskRunId },
        data: {
          status: "input-required",
          completedAt: null,
          progressPayload: {
            ...approvalProgress,
            summary: result.content,
            riskClass: parsed.riskClass,
            executedToolCount: result.executedTools?.length ?? 0,
            requiresApproval: true,
            approvalEnvelopeId: terminalWriterApprovalEnvelopeId,
            ...resumedFlag,
          },
        },
      });
      return {
        kind: "result",
        result: await withTaskRunApprovalLocation({
          taskRunId: run.taskRunId,
          status: "input-required",
          idempotentReplay: input.idempotentReplay,
          ...resumedFlag,
          requiresApproval: true,
          content: remoteTaskContent(result.content),
          executedToolCount: result.executedTools?.length ?? 0,
          isError: false,
        }, { taskRunId: run.taskRunId, callerUserId: token.userId }),
      };
    }
    if (
      result.failure?.kind === "required-terminal-writer-not-enforceable"
      && terminalWriterMissing
      && terminalToolPolicy
    ) {
      const terminalWriterAttempt = input.terminalWriterAttempt ?? 1;
      const observedAt = new Date().toISOString();
      const escalation = terminalWriterRetryIsExhausted(terminalWriterAttempt)
        ? createTerminalWriterEscalation({
            writerToolName: terminalToolPolicy.writerToolName,
            attempt: terminalWriterAttempt,
            observedAt,
          })
        : null;
      const priorProgress = currentRun?.progressPayload
        && typeof currentRun.progressPayload === "object"
        && !Array.isArray(currentRun.progressPayload)
        ? currentRun.progressPayload as Record<string, unknown>
        : {};
      await prisma.taskRun.update({
        where: { taskRunId: run.taskRunId },
        data: {
          status: "input-required",
          completedAt: null,
          progressPayload: {
            ...priorProgress,
            summary: result.failure.message,
            riskClass: parsed.riskClass,
            executedToolCount: result.executedTools?.length ?? 0,
            terminalWriterWait: {
              schemaVersion: 1,
              kind: "missing-terminal-writer",
              writerToolName: terminalToolPolicy.writerToolName,
              resumeMode: "same-taskrun",
              attempt: terminalWriterAttempt,
              observedAt,
              ...(terminalWriterContract ? { dispatchContract: terminalWriterContract } : {}),
            },
            terminalWriterDispatchFailure: {
              schemaVersion: 1,
              code: "required-terminal-writer-not-enforceable",
              writerToolName: terminalToolPolicy.writerToolName,
              observedAt,
            },
            ...(escalation ? { terminalWriterEscalation: escalation } : {}),
          },
        },
      });
      return {
        kind: "result",
        result: {
          taskRunId: run.taskRunId,
          status: "input-required",
          idempotentReplay: input.idempotentReplay,
          ...resumedFlag,
          requiresApproval: false,
          resumable: escalation === null,
          waitReason: escalation
            ? terminalWriterEscalationWaitReason(escalation)
            : "required-terminal-writer-not-enforceable",
          content: remoteTaskContent(
            escalation ? terminalWriterEscalationMessage(escalation) : result.failure.message,
          ),
          structuredContent: escalation
            ? terminalWriterEscalationStructuredContent(escalation)
            : { error: "required-terminal-writer-not-enforceable" },
          executedToolCount: result.executedTools?.length ?? 0,
          isError: true,
        },
      };
    }
    if (
      !resourceWaitOwnsThisTurn
      && (result.failure?.kind === "terminal-writer-missing" || terminalWriterMissing)
      && terminalToolPolicy
    ) {
      const terminalWriterAttempt = input.terminalWriterAttempt ?? 1;
      // BI-A57B6185: a writer that ran and REFUSED is a packet problem. Surface
      // its error verbatim, never count it as an omitted attempt, and never
      // advise switching reviewer: the next reviewer hits the same rejection.
      const writerRejection = lastTerminalWriterRejection(
        terminalToolPolicy.writerToolName,
        terminalWriterExecutions,
      );
      const terminalWriterFailureMessage = writerRejection
        ? terminalWriterRejectionMessage(terminalToolPolicy.writerToolName, writerRejection)
        : result.failure?.kind === "terminal-writer-missing"
        ? result.failure.message
        : writerResult && receiptExpected && !persistedOutcome ? result.content
        : describeTerminalWriterFailure(terminalToolPolicy, terminalWriterExecutions);
      // BI-50B0C471: a deferral after banked reads is a wait, not a writer no-show.
      const capacityDeferred = result.failure?.kind === "terminal-writer-missing"
        ? result.failure.deferredBy
        : undefined;
      const escalation = !writerRejection && !capacityDeferred && terminalWriterRetryIsExhausted(terminalWriterAttempt)
        ? createTerminalWriterEscalation({
            writerToolName: terminalToolPolicy.writerToolName,
            attempt: terminalWriterAttempt,
          })
        : null;
      await prisma.taskRun.update({
        where: { taskRunId: run.taskRunId },
        data: {
          status: "input-required",
          completedAt: null,
          progressPayload: {
            summary: terminalWriterFailureMessage,
            riskClass: parsed.riskClass,
            executedToolCount: result.executedTools?.length ?? 0,
            terminalWriterWait: {
              schemaVersion: 1,
              kind: "missing-terminal-writer",
              writerToolName: terminalToolPolicy.writerToolName,
              resumeMode: "same-taskrun",
              attempt: terminalWriterAttempt,
              observedAt: new Date().toISOString(),
              ...(terminalWriterContract ? { dispatchContract: terminalWriterContract } : {}),
              ...(terminalWriterFailureMessage.includes("did not honor the required writer tool-call contract")
                ? { noncompliance: "prose-without-required-writer" }
                : {}),
              ...(writerRejection ? { writerRejection } : {}),
              ...(capacityDeferred ? { capacityDeferred } : {}),
            },
            ...(escalation ? { terminalWriterEscalation: escalation } : {}),
          },
        },
      });
      return {
        kind: "result",
        result: {
          taskRunId: run.taskRunId,
          status: "input-required",
          idempotentReplay: input.idempotentReplay,
          ...resumedFlag,
          requiresApproval: false,
          resumable: escalation ? false : true,
          waitReason: escalation
            ? terminalWriterEscalationWaitReason(escalation)
            : writerRejection
            ? TERMINAL_WRITER_REJECTED_WAIT_REASON
            : capacityDeferred
            ? "provider-capacity"
            : "missing-terminal-writer",
          content: remoteTaskContent(
            escalation ? terminalWriterEscalationMessage(escalation) : terminalWriterFailureMessage,
          ),
          ...(escalation
            ? { structuredContent: terminalWriterEscalationStructuredContent(escalation) }
            : writerRejection
            ? {
                structuredContent: terminalWriterRejectionStructuredContent(
                  terminalToolPolicy.writerToolName,
                  terminalWriterAttempt,
                  writerRejection,
                ),
              }
            : {}),
          executedToolCount: result.executedTools?.length ?? 0,
          isError: false,
        },
      };
    }
    if (currentRun?.status === "input-required" && !persistedOutcome && !terminalToolPolicy) {
      return {
        kind: "result",
        result: await withTaskRunApprovalLocation({
          taskRunId: run.taskRunId,
          status: "input-required",
          idempotentReplay: input.idempotentReplay,
          ...resumedFlag,
          requiresApproval: true,
          content: remoteTaskContent(result.content),
          executedToolCount: result.executedTools?.length ?? 0,
          isError: false,
        }, { taskRunId: run.taskRunId, callerUserId: token.userId }),
      };
    }

    // A wait is bounded: after the last attempt the task fails as busy instead of parking forever.
    const waitFailureKind = input.capacityAttempt < RESOURCE_WAIT_MAX_ATTEMPTS ? preInferenceResourceWait(result) : null;
    if (waitFailureKind) {
      // Keep the dispatch history, so the next re-send gets a new event id rather
      // than repeating the first one, which the queue drops as a duplicate.
      const progressRow = currentRun
        ?? await prisma.taskRun.findUnique({ where: { taskRunId: run.taskRunId }, select: { progressPayload: true } });
      const priorDispatch = progressRow?.progressPayload && typeof progressRow.progressPayload === "object"
        ? (progressRow.progressPayload as Record<string, unknown>)["dispatch"] : undefined;
      await prisma.taskRun.update({
        where: { taskRunId: run.taskRunId },
        data: {
          status: "submitted",
          completedAt: null,
          progressPayload: {
            summary: result.content,
            riskClass: parsed.riskClass,
            executedToolCount: 0,
            resourceWait: createResourceWaitProjection(waitFailureKind, input.capacityAttempt),
            ...(priorDispatch ? { dispatch: priorDispatch as Prisma.InputJsonValue } : {}),
          },
        },
      });

      return {
        kind: "result",
        result: {
          taskRunId: run.taskRunId,
          status: "submitted",
          idempotentReplay: input.idempotentReplay,
          ...resumedFlag,
          requiresApproval: false,
          executedToolCount: 0,
          resumable: true,
          waitReason: "provider-capacity",
          content: remoteTaskContent(result.content),
          isError: false,
        },
      };
    }

    if (result.failure) {
      await prisma.taskRun.update({
        where: { taskRunId: run.taskRunId },
        data: {
          status: "failed",
          completedAt: new Date(),
          progressPayload: {
            summary: result.content,
            riskClass: parsed.riskClass,
            executedToolCount: result.executedTools?.length ?? 0,
            failureKind: result.failure.kind,
            ...resumedFlag,
          },
        },
      });
      return {
        kind: "result",
        result: {
          taskRunId: run.taskRunId,
          status: "failed",
          idempotentReplay: input.idempotentReplay,
          ...resumedFlag,
          requiresApproval: false,
          resumable: false,
          executedToolCount: result.executedTools?.length ?? 0,
          content: remoteTaskContent(result.content),
          isError: true,
        },
      };
    }

    await prisma.taskRun.update({
      where: { taskRunId: run.taskRunId },
      data: {
        status: "completed",
        completedAt: new Date(),
        progressPayload: {
          summary: result.content,
          riskClass: parsed.riskClass,
          executedToolCount: result.executedTools?.length ?? 0,
          ...resumedFlag,
          ...(persistedOutcome ? { reviewOutcome: persistedOutcome, requiresApproval: false } : {}),
        },
      },
    });

    return {
      kind: "result",
      result: {
        taskRunId: run.taskRunId,
        status: "completed",
        idempotentReplay: input.idempotentReplay,
        ...resumedFlag,
        requiresApproval: false,
        content: remoteTaskContent(result.content),
        executedToolCount: result.executedTools?.length ?? 0,
        isError: false,
        ...(persistedOutcome ? { structuredContent: persistedOutcome } : {}),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown remote coworker execution error";
    await prisma.taskRun.update({
      where: { taskRunId: run.taskRunId },
      data: {
        status: "failed",
        completedAt: new Date(),
        progressPayload: {
          summary: message,
          riskClass: parsed.riskClass,
          ...resumedFlag,
        },
      },
    });
    return {
      kind: "result",
      result: {
        taskRunId: run.taskRunId,
        status: "failed",
        idempotentReplay: input.idempotentReplay,
        ...resumedFlag,
        requiresApproval: false,
        content: remoteTaskContent(message),
        isError: true,
      },
    };
  }
}

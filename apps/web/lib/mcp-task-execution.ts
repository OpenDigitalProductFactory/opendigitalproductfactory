import { engagementVisualDeliveryRecorder, type EngagementVisualEvidence } from "./coworker-service-catalog/engagement-visual-evidence";
import { withInferenceAuthorityCheck } from "./routing/governed-inference-deadline";
import { EXECUTION_UNCERTAIN_MESSAGE, executionUncertaintyFromError, hasExecutionUncertainty } from "./shared/execution-uncertainty";
import { reservationIdentity, dispatchIdentity, settleRemoteTask } from "./mcp-task-attempt-state";
import { captureTaskExecutionFence, sameTaskExecutionFence } from "./shared/task-execution-fence";
import { withPersistedReassessmentExecution } from "./mcp-task-reassessment-capture";
import { assertReassessmentOwnerSupport } from "./shared/reassessment-owner-versions";
import { createReassessmentReceiptCheck } from "./mcp-task-review-receipt-stop";
import { parseReassessmentRootLocatorV2 } from "./routing/reassessment-phase-contract";
import { currentReassessmentExecution, hasPersistedReassessmentExecution, isReassessmentExecutionError,
  matchesPersistedReassessmentScope, refuseReassessmentExecution } from "./routing/reassessment-execution-scope";
import { projectRemoteTaskReplay, optionalString, remoteTaskContent } from "./mcp-task-replay-projection";
import { TASK_IN_FLIGHT_STATES } from "@/lib/tak/task-states";
import { currentReadEvidencePolicy, withReadEvidencePolicy } from "./tak/read-evidence-policy";
import { remoteTaskConversation } from "./mcp-task-conversation";
import { coworkerBriefSpans } from "@/lib/tak/coworker-prompt-provenance";
import { remoteReviewSensitivity } from "./mcp-task-review-sensitivity";
import { prisma, type Prisma } from "@dpf/db";
import { terminalWriterDispatchContractForProvider } from "@/lib/routing/execution-plan";
import { loadInitiativeReviewOutcome, loadTaskInitiativeReviewOutcome, reconcilePersistedReviewStatus } from "./mcp-task-review-outcome";
import { foldNativeMcpExecutions } from "@/lib/tak/native-mcp-executions";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import { prepareRemoteReviewAttempt } from "./mcp-task-reassessment-preparation";
import {
  executeAutonomousAgenticLoop,
  executeAutonomousWorkTool,
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
} from "@/lib/tak/autonomous-work-run";
import { createTaskMessage } from "@/lib/tak/task-records";
import { terminalWriterFailureMessage as describeTerminalWriterFailure } from "@/lib/tak/terminal-tool-policy";
import {
  createResourceWaitProjection,
  preInferenceResourceWait,
  RESOURCE_WAIT_MAX_ATTEMPTS,
} from "./mcp-task-capacity-contract";
import type { RemoteTaskAttemptInput, RemoteTaskSubmitOutcome } from "./mcp-task-submit-types";
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

function approvalRequiredEnvelopeId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result["success"] !== false || result["error"] !== "approval_required") return null;
  const data = result["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return optionalString((data as Record<string, unknown>)["envelopeId"]);
}

export async function executeRemoteTaskAttempt(input: RemoteTaskAttemptInput): Promise<RemoteTaskSubmitOutcome> {
  const { run, token, userContext, parsed } = input;
  if (parsed.engagementBinding?.presentAssessment) {
    const { executeEngagementPresentAttempt } = await import("./coworker-service-catalog/engagement-present-worker");
    return executeEngagementPresentAttempt(input, {
      prepareTurn: (attempt, binding) => prepareRemoteReviewAttempt({ parsed: attempt.parsed, userContext: attempt.userContext, restricted: true }, {
        resolveAgent: resolveAutonomousWorkAgent, resolveTools: requested => resolveAutonomousWorkTools({ ...requested, restrictedEngagementBinding: binding }),
      }),
      executeRead: ({ toolName, args, agentId, fence }, attempt) => executeAutonomousWorkTool({ toolName, args, agentId,
        userId: attempt.token.userId, userContext: attempt.userContext, routeContext: attempt.parsed.routeContext,
        threadId: attempt.threadId, taskRunId: attempt.run.taskRunId, taskExecutionFence: fence, apiTokenId: attempt.token.tokenId,
        tokenScope: "read", externalAccessEnabled: true }),
    });
  }
  const admittedRun = await prisma.taskRun.findUnique({
    where: { taskRunId: run.taskRunId }, select: { status: true, updatedAt: true, progressPayload: true, a2aMetadata: true },
  });
  if (!admittedRun || !(TASK_IN_FLIGHT_STATES as readonly string[]).includes(admittedRun.status)) {
    return {
      kind: "result",
      result: {
        taskRunId: run.taskRunId,
        status: admittedRun?.status ?? "unknown",
        progressPayload: admittedRun?.progressPayload ?? null,
        requiresApproval: false,
        resumable: false,
        isError: !admittedRun,
      },
    };
  }
  const persistedPresent = admittedRun.a2aMetadata && typeof admittedRun.a2aMetadata === "object"
    && !Array.isArray(admittedRun.a2aMetadata) ? (admittedRun.a2aMetadata as Record<string, unknown>).engagementBinding : null;
  if (persistedPresent && typeof persistedPresent === "object" && "presentAssessment" in persistedPresent) {
    return { kind: "result", result: { taskRunId: run.taskRunId, status: admittedRun.status, resumable: false, requiresApproval: false,
      isError: true, content: remoteTaskContent("This finite assessment requires its original live governed call; no execution was requested.") } };
  }
  const reservation = input.expectedReservation !== undefined
    ? input.expectedReservation : reservationIdentity(admittedRun?.progressPayload);
  const dispatchClaim = input.expectedDispatchClaim !== undefined
    ? input.expectedDispatchClaim : dispatchIdentity(admittedRun?.progressPayload);
  if (admittedRun && (reservationIdentity(admittedRun.progressPayload) !== reservation
    || dispatchIdentity(admittedRun.progressPayload) !== dispatchClaim)) {
    return projectRemoteTaskReplay({ existing: { ...admittedRun, taskRunId: run.taskRunId }, requestMatches: true });
  }
  const reassessmentExecution = hasPersistedReassessmentExecution(admittedRun.a2aMetadata);
  const taskExecutionFence = parsed.initiativeReviewBinding || parsed.engagementBinding || reassessmentExecution ? captureTaskExecutionFence(admittedRun.progressPayload,
    (admittedRun.a2aMetadata as Record<string, unknown> | null)?.requestDigest) : undefined;
  const settle = (args: Prisma.TaskRunUpdateManyArgs & { where: { taskRunId: string } }) =>
    settleRemoteTask(args, reservation, dispatchClaim, parsed.initiativeReviewBinding || reassessmentExecution ? {
      executionFence: taskExecutionFence ?? null, userId: token.userId, agentId: parsed.agentId,
    } : undefined);
  const receiptCompletion = async (outcome: NonNullable<Awaited<ReturnType<typeof loadTaskInitiativeReviewOutcome>>>,
    replay: { idempotentReplay: boolean; resumedFromTerminalWriterWait?: boolean; resumedFromCapacity?: boolean } = { idempotentReplay: true }) => {
    const completed = { kind: "result" as const, result: { taskRunId: run.taskRunId, status: "completed", ...replay,
      requiresApproval: false, resumable: false, content: remoteTaskContent(outcome.summary), structuredContent: outcome, isError: false } };
    if (await reconcilePersistedReviewStatus(run.taskRunId, admittedRun.progressPayload, outcome, admittedRun)) return completed;
    const readCurrent = () => prisma.taskRun.findUnique({ where: { taskRunId: run.taskRunId },
      select: { status: true, updatedAt: true, progressPayload: true, a2aMetadata: true, userId: true, currentAgentId: true } });
    let current = await readCurrent();
    const metadata = current?.a2aMetadata && typeof current.a2aMetadata === "object" && !Array.isArray(current.a2aMetadata)
      ? current.a2aMetadata as Record<string, unknown> : {};
    // Heartbeats change the row version without granting a new generation.
    // Refresh only receipt settlement once; cancellation and a new fence win.
    if (current && current.userId === token.userId && current.currentAgentId
      && resolveCanonicalAgentId(current.currentAgentId) === resolveCanonicalAgentId(parsed.agentId)
      && taskExecutionFence && metadata.requestDigest === taskExecutionFence.requestDigest
      && sameTaskExecutionFence(taskExecutionFence, captureTaskExecutionFence(current.progressPayload, metadata.requestDigest))) {
      if (await reconcilePersistedReviewStatus(run.taskRunId, current.progressPayload, outcome, current)) return completed;
      current = await readCurrent();
    }
    return current ? projectRemoteTaskReplay({ existing: { ...current, taskRunId: run.taskRunId }, requestMatches: true })
      : { kind: "result" as const, result: { taskRunId: run.taskRunId, status: "unknown", resumable: false, requiresApproval: false, isError: true } };
  };
  // Recover lost acknowledgements from the bound receipt under the same fence.
  const priorReview = parsed.initiativeReviewBinding
    ? await loadTaskInitiativeReviewOutcome(run.taskRunId, parsed.initiativeReviewBinding)
    : null;
  if (priorReview) return receiptCompletion(priorReview);
  const progress = admittedRun.progressPayload && typeof admittedRun.progressPayload === "object"
    && !Array.isArray(admittedRun.progressPayload) ? admittedRun.progressPayload as Record<string, unknown> : {};
  if (Object.hasOwn(progress, "reassessmentQuarantine")) return { kind: "result", result: {
    taskRunId: run.taskRunId, status: "input-required", resumable: false, requiresApproval: false,
    progressPayload: admittedRun.progressPayload, content: remoteTaskContent("This predecessor is quarantined; its original evidence remains retained."),
  } };
  if (hasExecutionUncertainty(admittedRun.progressPayload)) {
    const progress = admittedRun.progressPayload && typeof admittedRun.progressPayload === "object"
      && !Array.isArray(admittedRun.progressPayload) ? admittedRun.progressPayload as Record<string, unknown> : {};
    const displaced = await settle({ where: { taskRunId: run.taskRunId }, data: {
      status: "input-required", completedAt: null, progressPayload: {
        ...progress, summary: EXECUTION_UNCERTAIN_MESSAGE, requiresApproval: false,
      } as Prisma.InputJsonValue,
    } });
    return displaced ?? projectRemoteTaskReplay({ existing: { ...admittedRun,
      status: "input-required", taskRunId: run.taskRunId }, requestMatches: true });
  }
  // Retain stable authority/windows; each branch rebuilds transient waits.
  const recoveryCheckpoint = Object.fromEntries(["reviewExecutionAuthority", "deadlineAt", "expiresAt"]
    .filter(key => progress[key] !== undefined).map(key => [key, progress[key]])) as Prisma.InputJsonObject;
  const resumedFlag = !input.idempotentReplay ? {} : input.resumeKind === "terminal-writer"
    ? { resumedFromTerminalWriterWait: true } : { resumedFromCapacity: true };
  let loopEntered = false;
  try {
    if (reassessmentExecution && currentReadEvidencePolicy()) {
      refuseReassessmentExecution("reassessment-read-evidence-scope-conflict");
    }
    let visualEvidence: EngagementVisualEvidence | null = null;
    if (parsed.engagementBinding) {
      const { validateEngagementTask, reconcileEngagementTaskResult } = await import("./coworker-service-catalog/engagement-fulfillment");
      try {
        await reconcileEngagementTaskResult(run.taskRunId);
        visualEvidence = (await validateEngagementTask({ binding: parsed.engagementBinding, token, taskRunId: run.taskRunId, authorityScope: parsed.authorityScope ?? [], requireAssociation: true, request: parsed })).visualEvidence;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Engagement authority unavailable";
        const displaced = await settle({ where: { taskRunId: run.taskRunId }, data: { status: "failed", completedAt: new Date(), progressPayload: { summary: message, error: "engagement_execution_refused" } } });
        return displaced ?? { kind: "result", result: { taskRunId: run.taskRunId, status: "failed", isError: true, content: remoteTaskContent(message) } };
      }
    }
    if (reassessmentExecution) assertReassessmentOwnerSupport("worker", 2);
    if (reassessmentExecution && !matchesPersistedReassessmentScope(admittedRun.a2aMetadata, run.taskRunId)) {
      if (!parsed.initiativeReviewBinding) refuseReassessmentExecution("reassessment-manifest-invalid", "The accepted reassessment has no review binding.");
      const persistedInput = { taskRunRecordId: run.id, taskRunId: run.taskRunId,
        userId: token.userId, agentId: resolveCanonicalAgentId(parsed.agentId), binding: parsed.initiativeReviewBinding,
        requestDigest: (admittedRun.a2aMetadata as Record<string, unknown>).requestDigest as string,
        executionFence: taskExecutionFence ?? null, a2aMetadata: admittedRun.a2aMetadata, progressPayload: admittedRun.progressPayload,
      };
      const execute = () => executeRemoteTaskAttempt({ ...input, expectedReservation: reservation, expectedDispatchClaim: dispatchClaim });
      if (parseReassessmentRootLocatorV2((admittedRun.a2aMetadata as Record<string, unknown>).reassessmentExecution)) {
        const { withPresentReassessmentWorker } = await import("./mcp-task-reassessment-worker");
        return await withPresentReassessmentWorker({ persistedInput, parsed, token, userContext, threadId: input.threadId,
          resumeKind: input.resumeKind, terminalWriterContext: input.terminalWriterContext }, {
          resolveAgent: resolveAutonomousWorkAgent, resolveTools: resolveAutonomousWorkTools, resolveSensitivity: remoteReviewSensitivity,
        }, execute);
      }
      return await withPersistedReassessmentExecution(persistedInput, execute);
    }
    if (progress.reviewExecutionAuthority !== undefined) {
      const { revalidateReviewExecutionAuthority } = await import("./mcp-task-review-recovery");
      if (!await revalidateReviewExecutionAuthority({ token, parsed, userContext,
        metadata: admittedRun.a2aMetadata, progress })) {
        const displaced = await settle({ where: { taskRunId: run.taskRunId }, data: {
          status: "input-required", completedAt: null, progressPayload: {
            ...progress,
            errorCode: "review_execution_authority_refused", requiresApproval: false,
          } as Prisma.InputJsonValue,
        } });
        return displaced ?? { kind: "result", result: { taskRunId: run.taskRunId, status: "input-required", isError: true,
          content: remoteTaskContent("Current review execution authority was refused; no inference was dispatched."),
          structuredContent: { error: "review_execution_authority_refused" } } };
      }
    }
    const { agent, resolvedAgentId, modelRequirements, tools, effortWarrant, terminalToolPolicy, conversation: preparedConversation } =
      await prepareRemoteReviewAttempt({ parsed, userContext, restricted: reassessmentExecution,
        resumeKind: input.resumeKind, terminalWriterContext: input.terminalWriterContext,
        validateResolvedAgent: resolved => {
          const scope = currentReassessmentExecution();
          if (reassessmentExecution && (!scope || scope.agentId !== resolved || !sameTaskExecutionFence(scope.executionFence, taskExecutionFence))) {
            refuseReassessmentExecution("reassessment-execution-conflict", "The resolved reviewer or full execution fence differs from the sealed reassessment admission.");
          }
        } }, { resolveAgent: resolveAutonomousWorkAgent, resolveTools: resolveAutonomousWorkTools });

    // Preparation already includes terminal-writer context; engagement adds only its validated image inputs.
    const conversation = visualEvidence?.inputs.length ? remoteTaskConversation({
      systemPrompt: preparedConversation.systemPrompt,
      prompt: parsed.prompt,
      visualInputs: visualEvidence.inputs,
    }) : preparedConversation;
    const readEvidencePolicy = parsed.engagementBinding
      ? (await import("./coworker-service-catalog/engagement-read-completion")).engagementReadCompletion(run.taskRunId, parsed.engagementBinding)
      : undefined;
    if (readEvidencePolicy) readEvidencePolicy.mintReadOnlySession = async () =>
      (await import("./mcp/session-token")).createMcpSessionToken({
        userId: token.userId, agentId: resolvedAgentId, threadId: input.threadId,
        routeContext: parsed.routeContext, taskRunId: run.taskRunId, taskExecutionFence,
        scopes: ["file_read", "registry_read"], capability: "read",
      });
    if (readEvidencePolicy && parsed.engagementBinding) {
      readEvidencePolicy.recordImageInputDelivery = engagementVisualDeliveryRecorder(
        run.taskRunId, parsed.engagementBinding, taskExecutionFence ?? null, visualEvidence,
      );
    }
    // BI-2E479619: rows a CLI wrote natively during THIS attempt start here.
    const attemptStartedMs = Date.now();
    loopEntered = true;
    const runLoop = async () => withReadEvidencePolicy(
      readEvidencePolicy, async () => executeAutonomousAgenticLoop({
        ...(reassessmentExecution ? { canonicalReviewReceipt: createReassessmentReceiptCheck(run.taskRunId, parsed.initiativeReviewBinding) } : {}),
        systemPrompt: conversation.systemPrompt,
        systemPromptInstructionSpans: coworkerBriefSpans(agent.systemPrompt),
        chatHistory: conversation.chatHistory,
        sensitivity: await remoteReviewSensitivity(parsed, token, agent.sensitivity ?? "internal"),
        tools: tools.tools,
        toolsForProvider: tools.toolsForProvider,
        deferredTools: tools.deferredTools,
        userId: token.userId,
        routeContext: parsed.routeContext,
        agentId: resolvedAgentId,
        threadId: input.threadId,
        taskRunId: run.taskRunId,
        apiTokenId: token.tokenId,
        taskExecutionFence,
        tokenScope: token.capability,
        // Bound nested writer reads by the task's grant scope (BI-F8C661D0).
        tokenGrantScopes: parsed.authorityScope,
        taskType: "external-mcp",
        agentDisplayName: optionalString(agent.displayName) ?? resolvedAgentId,
        ...(effortWarrant ? { effortWarrant } : {}),
        ...(terminalToolPolicy ? { terminalToolPolicy } : {}),
        ...(modelRequirements ? { modelRequirements } : {}),
      }),
    );

    const result = await (parsed.engagementBinding ? withInferenceAuthorityCheck(async () => {
      const { validateEngagementTask } = await import("./coworker-service-catalog/engagement-fulfillment");
      await validateEngagementTask({ binding: parsed.engagementBinding!, token, taskRunId: run.taskRunId, authorityScope: parsed.authorityScope ?? [], requireAssociation: true, request: parsed });
      const current = await prisma.taskRun.findUnique({ where: { taskRunId: run.taskRunId }, select: { status: true, progressPayload: true, a2aMetadata: true } });
      return current?.status === "working" && !hasExecutionUncertainty(current.progressPayload) && sameTaskExecutionFence(taskExecutionFence,
        captureTaskExecutionFence(current.progressPayload, (current.a2aMetadata as Record<string, unknown> | null)?.requestDigest));
    }, runLoop) : runLoop());

    // BI-2E479619: a CLI adapter runs the governed tools natively, so the
    // loop's records can miss them. Fold this attempt's native rows (deduped
    // against any the loop already folded) so the writer check, a writer
    // refusal and executedToolCount all read the same calls.
    if (terminalToolPolicy) {
      await foldNativeMcpExecutions({
        taskRunId: run.taskRunId,
        providerId: (result as { providerId?: string }).providerId,
        sinceMs: attemptStartedMs,
        records: (result.executedTools ??= []),
      });
    }
    const writerResult = parsed.initiativeReviewBinding
      ? result.executedTools?.filter((tool) => tool.name === parsed.initiativeReviewBinding!.writerToolName && tool.result.success).at(-1)?.result
      : undefined;
    const receiptId = optionalString(writerResult?.data?.["receiptId"]);
    // The TaskRun's persisted receipt wins over incomplete turn records.
    const persistedOutcome = parsed.initiativeReviewBinding
      ? (receiptId ? await loadInitiativeReviewOutcome(parsed.initiativeReviewBinding, receiptId) : null)
        ?? await loadTaskInitiativeReviewOutcome(run.taskRunId, parsed.initiativeReviewBinding)
      : null;
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
        ...(parsed.engagementBinding&&result.readEvidenceInspection&&!result.readEvidenceInspection.check.complete
          ?{engagementContributionAttempt:{version:1,validated:false,...result.readEvidenceInspection}}:{}),
      },
    });

    const currentRun = parsed.riskClass === "read"
      ? null
      : await prisma.taskRun.findUnique({
          where: { taskRunId: run.taskRunId },
          select: { status: true, progressPayload: true },
        });
    if (result.failure?.kind === "execution-uncertain" && !persistedOutcome) {
      const savedProgress = currentRun?.progressPayload ?? admittedRun.progressPayload;
      const priorProgress = savedProgress && typeof savedProgress === "object"
        && !Array.isArray(savedProgress) ? savedProgress as Record<string, unknown> : {};
      const uncertainty = { ...executionUncertaintyFromError(result.failure.executionUncertainty),
        observedAt: new Date().toISOString() };
      const displaced = await settle({ where: { taskRunId: run.taskRunId }, data: {
        status: "input-required", completedAt: null, progressPayload: {
          ...recoveryCheckpoint,
          ...priorProgress, summary: EXECUTION_UNCERTAIN_MESSAGE, requiresApproval: false,
          executionUncertainty: uncertainty,
          executedToolCount: result.executedTools?.length ?? 0, ...resumedFlag,
        },
      } });
      if (displaced) return displaced;
      return { kind: "result", result: {
        taskRunId: run.taskRunId, status: "input-required", idempotentReplay: input.idempotentReplay,
        ...resumedFlag, requiresApproval: false, resumable: false, waitReason: "execution-uncertain",
        structuredContent: { error: "execution_uncertain", executionUncertainty: uncertainty },
        content: remoteTaskContent(EXECUTION_UNCERTAIN_MESSAGE), isError: false,
      } };
    }
    const readHold = parsed.engagementBinding ? await (await import("./coworker-service-catalog/engagement-read-completion")).engagementIncompleteOutcome({
      policy: readEvidencePolicy!, taskRunId: run.taskRunId, result, checkpoint: recoveryCheckpoint,
      flags: resumedFlag, skip: !!preInferenceResourceWait(result),
    }) : null;
    if (readHold) return (await settle(readHold.settlement)) ?? readHold.outcome;
    // Enforce the terminal writer at async completion as main does (#4925, #4930).
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
    // BI-C35576A9: record the actual provider's contract, undefined if none ran.
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
      const displaced = await settle({
        where: { taskRunId: run.taskRunId },
        data: {
          status: "input-required",
          completedAt: null,
          progressPayload: {
            ...recoveryCheckpoint,
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
      if (displaced) return displaced;
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
      const displaced = await settle({
        where: { taskRunId: run.taskRunId },
        data: {
          status: "input-required",
          completedAt: null,
          progressPayload: {
            ...recoveryCheckpoint,
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
      if (displaced) return displaced;
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
      const displaced = await settle({
        where: { taskRunId: run.taskRunId },
        data: {
          status: "input-required",
          completedAt: null,
          progressPayload: {
            ...recoveryCheckpoint,
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
      if (displaced) return displaced;
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
      const displaced = await settle({
        where: { taskRunId: run.taskRunId },
        data: {
          status: "submitted",
          completedAt: null,
          progressPayload: {
            ...recoveryCheckpoint,
            summary: result.content,
            riskClass: parsed.riskClass,
            executedToolCount: 0,
            resourceWait: createResourceWaitProjection(waitFailureKind, input.capacityAttempt),
            ...(priorDispatch ? { dispatch: priorDispatch as Prisma.InputJsonValue } : {}),
          },
        },
      });
      if (displaced) return displaced;

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
      const displaced = await settle({
        where: { taskRunId: run.taskRunId },
        data: {
          status: "failed",
          completedAt: new Date(),
          progressPayload: {
            ...recoveryCheckpoint,
            summary: result.content,
            riskClass: parsed.riskClass,
            executedToolCount: result.executedTools?.length ?? 0,
            failureKind: result.failure.kind,
            ...resumedFlag,
          },
        },
      });
      if (displaced) return displaced;
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

    const displaced = await settle({
      where: { taskRunId: run.taskRunId },
      data: {
        status: "completed",
        completedAt: new Date(),
        progressPayload: {
          ...recoveryCheckpoint,
          summary: result.content,
          riskClass: parsed.riskClass,
          executedToolCount: result.executedTools?.length ?? 0,
          ...resumedFlag,
          ...(persistedOutcome ? { reviewOutcome: persistedOutcome, requiresApproval: false } : {}),
        },
      },
    });
    if (displaced) return displaced;

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
    if (!reassessmentExecution && !loopEntered) throw err;
    let receiptReadUnavailable = false;
    const committedOutcome = parsed.initiativeReviewBinding
      ? await loadTaskInitiativeReviewOutcome(run.taskRunId, parsed.initiativeReviewBinding)
        .catch(() => { receiptReadUnavailable = true; return null; }) : null;
    if (committedOutcome) return receiptCompletion(committedOutcome, { idempotentReplay: input.idempotentReplay, ...resumedFlag });
    if (receiptReadUnavailable || (reassessmentExecution && isReassessmentExecutionError(err)
      && ["reassessment-capture-incomplete", "reassessment-effect-outcome-uncertain"].includes(err.code))) {
      const uncertainty = { ...executionUncertaintyFromError(err), observedAt: new Date().toISOString() };
      const summary = receiptReadUnavailable ? `Canonical review receipt readback is unavailable. ${EXECUTION_UNCERTAIN_MESSAGE}` : EXECUTION_UNCERTAIN_MESSAGE;
      const displaced = await settle({ where: { taskRunId: run.taskRunId }, data: {
        status: "input-required", completedAt: null, progressPayload: {
          ...progress, summary, requiresApproval: false, executionUncertainty: uncertainty, ...resumedFlag,
        } as Prisma.InputJsonValue,
      } });
      return displaced ?? { kind: "result", result: { taskRunId: run.taskRunId, status: "input-required",
        idempotentReplay: input.idempotentReplay, ...resumedFlag, requiresApproval: false, resumable: false,
        waitReason: "execution-uncertain", structuredContent: { error: "execution_uncertain", executionUncertainty: uncertainty,
          ...(receiptReadUnavailable ? { receiptReadback: "unavailable" } : {}) }, content: remoteTaskContent(summary), isError: false } };
    }
    const message = err instanceof Error ? err.message : "Unknown remote coworker execution error";
    const displaced = await settle({
      where: { taskRunId: run.taskRunId },
      data: {
        status: "failed",
        completedAt: new Date(),
        progressPayload: {
          ...recoveryCheckpoint,
          summary: message,
          riskClass: parsed.riskClass,
          ...resumedFlag,
        },
      },
    });
    if (displaced) return displaced;
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

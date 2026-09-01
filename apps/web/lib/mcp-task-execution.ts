import { coworkerBriefSpans } from "@/lib/tak/coworker-prompt-provenance";
import { prisma } from "@dpf/db";
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
} from "@/lib/tak/terminal-tool-policy";
import {
  createResourceWaitProjection,
  preInferenceResourceWait,
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

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function remoteTaskContent(text: string) {
  return [{ type: "text", text }];
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
  const routingConfig = await prisma.agentModelConfig?.findUnique({
    where: { agentId: modelRoutingAgentId },
    select: {
      minimumTier: true,
      budgetClass: true,
      pinnedProviderId: true,
      pinnedModelId: true,
    },
  }).catch(() => null) ?? null;
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
        ...(routingConfig.pinnedProviderId === "local"
          ? { residencyPolicy: "local_only" as const }
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

  try {
    const result = await executeAutonomousAgenticLoop({
      systemPrompt: agent.systemPrompt,
      systemPromptInstructionSpans: coworkerBriefSpans(agent.systemPrompt),
      chatHistory: [
        { role: "user", content: parsed.prompt },
        ...(input.resumeKind === "terminal-writer" && input.terminalWriterContext
          ? [{ role: "system" as const, content: input.terminalWriterContext }]
          : []),
      ],
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
      taskType: "external-mcp",
      agentDisplayName: optionalString(agent.displayName) ?? resolvedAgentId,
      ...(effortWarrant ? { effortWarrant } : {}),
      ...(terminalToolPolicy ? { terminalToolPolicy } : {}),
      ...(modelRequirements ? { modelRequirements } : {}),
    });

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
      },
    });

    const currentRun = parsed.riskClass === "read"
      ? null
      : await prisma.taskRun.findUnique({
          where: { taskRunId: run.taskRunId },
          select: { status: true },
        });
    if (result.failure?.kind === "terminal-writer-missing" && terminalToolPolicy) {
      const terminalWriterAttempt = input.terminalWriterAttempt ?? 1;
      await prisma.taskRun.update({
        where: { taskRunId: run.taskRunId },
        data: {
          status: "input-required",
          completedAt: null,
          progressPayload: {
            summary: result.failure.message,
            riskClass: parsed.riskClass,
            executedToolCount: result.executedTools?.length ?? 0,
            terminalWriterWait: {
              schemaVersion: 1,
              kind: "missing-terminal-writer",
              writerToolName: terminalToolPolicy.writerToolName,
              resumeMode: "same-taskrun",
              attempt: terminalWriterAttempt,
              observedAt: new Date().toISOString(),
              dispatchContract: "required-tool-call",
              ...(result.failure.message.includes("did not honor the required writer tool-call contract")
                ? { noncompliance: "prose-without-required-writer" }
                : {}),
            },
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
          resumable: true,
          waitReason: "missing-terminal-writer",
          content: remoteTaskContent(result.content),
          executedToolCount: result.executedTools?.length ?? 0,
          isError: false,
        },
      };
    }
    if (currentRun?.status === "input-required") {
      return {
        kind: "result",
        result: {
          taskRunId: run.taskRunId,
          status: "input-required",
          idempotentReplay: input.idempotentReplay,
          ...resumedFlag,
          requiresApproval: true,
          content: remoteTaskContent(result.content),
          executedToolCount: result.executedTools?.length ?? 0,
          isError: false,
        },
      };
    }

    const waitFailureKind = preInferenceResourceWait(result);
    if (waitFailureKind) {
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

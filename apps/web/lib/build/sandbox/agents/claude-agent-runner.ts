import { dispatchClaudeTask } from "../../claude-dispatch";
import type { AssignedTask } from "../../task-dependency-graph";
import type {
  AgentCredential,
  AgentRunResult,
  AgentRunSpec,
  BuildAgentRunner,
  BuildAgentRunnerCapabilities,
} from "../agent-runner-types";
import type { BuildExecutionProvider, SandboxHandle } from "../provider-types";

const capabilities: BuildAgentRunnerCapabilities = {
  tier: "full-spec-implement",
  requiresPersistentSession: true,
  requiresCredential: true,
  honorsLlmBaseUrl: false,
};

function taskFromSpec(spec: AgentRunSpec): AssignedTask {
  if (spec.task) return spec.task;
  const title = spec.title ?? spec.prompt?.split(/\r?\n/)[0]?.slice(0, 80) ?? "Build task";
  return {
    taskIndex: 0,
    title,
    specialist: "software-engineer",
    files: [],
    task: {
      title,
      testFirst: "",
      implement: spec.prompt ?? title,
      verify: "",
    },
  };
}

export const claudeAgentRunner: BuildAgentRunner = {
  id: "claude",

  async prepare(
    _provider: BuildExecutionProvider,
    _handle: SandboxHandle,
    _credential: AgentCredential | null,
  ): Promise<void> {
    // Existing dispatchClaudeTask resolves and injects credentials immediately before the run.
  },

  async run(
    provider: BuildExecutionProvider,
    _handle: SandboxHandle,
    spec: AgentRunSpec,
  ): Promise<AgentRunResult> {
    const result = await dispatchClaudeTask({
      task: taskFromSpec(spec),
      buildId: spec.buildId ?? "unknown-build",
      buildContext: spec.buildContext ?? "",
      priorResults: spec.priorResults,
      providerId: spec.providerId,
      model: spec.model,
      sessionId: spec.sessionId,
      onProgress: spec.onProgress,
    });

    return {
      exitCode: result.success ? 0 : 1,
      stdout: result.content,
      stderr: result.success ? "" : result.content,
      durationMs: result.durationMs,
      toolExecutionId: "claude-cli-dispatch",
      agentId: "claude",
      providerId: provider.id,
    };
  },

  capabilities(): BuildAgentRunnerCapabilities {
    return capabilities;
  },
};

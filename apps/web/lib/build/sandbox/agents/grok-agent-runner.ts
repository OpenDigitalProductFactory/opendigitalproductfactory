import { dispatchGrokTask } from "../../grok-dispatch";
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
  tier: "preview",   // Grok CLI dispatch is under active hardening (temp files, flags, sandbox integration, evidence). Not yet full-spec until concurrent builds + rollback paths are proven.
  requiresPersistentSession: false,
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

export const grokAgentRunner: BuildAgentRunner = {
  id: "grok",

  async prepare(
    _provider: BuildExecutionProvider,
    _handle: SandboxHandle,
    _credential: AgentCredential | null,
  ): Promise<void> {
    // dispatchGrokTask handles auth injection.
  },

  async run(
    provider: BuildExecutionProvider,
    handle: SandboxHandle,
    spec: AgentRunSpec,
  ): Promise<AgentRunResult> {
    const result = await dispatchGrokTask({
      task: taskFromSpec(spec),
      buildId: spec.buildId ?? "unknown-build",
      buildContext: spec.buildContext ?? "",
      priorResults: spec.priorResults,
      providerId: spec.providerId,
      model: spec.model,
      containerId: handle.containerId,   // Honor the BuildExecutionProvider / SandboxHandle abstraction
      onProgress: spec.onProgress,
    });

    return {
      exitCode: result.success ? 0 : 1,
      stdout: result.content,
      stderr: result.success ? "" : result.content,
      durationMs: result.durationMs,
      toolExecutionId: "grok-cli-dispatch",
      agentId: "grok",
      providerId: provider.id,
    };
  },

  capabilities(): BuildAgentRunnerCapabilities {
    return capabilities;
  },
};

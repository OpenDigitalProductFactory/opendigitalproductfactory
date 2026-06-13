import { dispatchOpencodeTask } from "../../opencode-dispatch";
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
  // Preview tier: the opencode runner is wired and selectable but not promoted to
  // a task tier until eval evidence on a real local model matches the established
  // agents. honorsLlmBaseUrl=true because inference goes to the install's local
  // OpenAI-compatible endpoint; requiresCredential=false because local servers
  // need no vendor key.
  tier: "preview",
  requiresPersistentSession: false,
  requiresCredential: false,
  honorsLlmBaseUrl: true,
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

export const opencodeAgentRunner: BuildAgentRunner = {
  id: "opencode",

  async prepare(
    _provider: BuildExecutionProvider,
    _handle: SandboxHandle,
    _credential: AgentCredential | null,
  ): Promise<void> {
    // No credential to inject — dispatchOpencodeTask writes the opencode provider
    // config (local endpoint + model) into the sandbox at run time.
  },

  async run(
    provider: BuildExecutionProvider,
    handle: SandboxHandle,
    spec: AgentRunSpec,
  ): Promise<AgentRunResult> {
    const result = await dispatchOpencodeTask({
      task: taskFromSpec(spec),
      buildId: spec.buildId ?? "unknown-build",
      buildContext: spec.buildContext ?? "",
      priorResults: spec.priorResults,
      providerId: spec.providerId,
      model: spec.model,
      containerId: handle.containerId,
      onProgress: spec.onProgress,
    });

    return {
      exitCode: result.success ? 0 : 1,
      stdout: result.content,
      stderr: result.success ? "" : result.content,
      durationMs: result.durationMs,
      toolExecutionId: "opencode-cli-dispatch",
      agentId: "opencode",
      providerId: provider.id,
    };
  },

  capabilities(): BuildAgentRunnerCapabilities {
    return capabilities;
  },
};

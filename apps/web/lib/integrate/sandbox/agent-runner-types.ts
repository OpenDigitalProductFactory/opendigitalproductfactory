import type {
  BuildExecutionProvider,
  BuildExecutionProviderCapabilities,
  BuildExecutionProviderId,
  SandboxHandle,
} from "./provider-types";
import type { AssignedTask } from "../task-dependency-graph";

export type BuildAgentId = "codex" | "claude" | "grok" | "dpf-native" | "opencode";

export type BuildAgentRunnerCapabilities = {
  // "preview" is the onboarding tier for a newly-admitted agent runner: it is
  // wired and selectable but not yet promoted to a task tier until eval/probe
  // evidence matches the established agents (see build-execution-provider-design).
  tier: "preview" | "single-file-edit" | "multi-file-refactor" | "full-spec-implement";
  requiresPersistentSession: boolean;
  requiresCallbackPort?: number;
  requiresCredential: boolean;
  honorsLlmBaseUrl: boolean;
};

export type AgentCredential = {
  agent: BuildAgentId;
  type: "oauth" | "api-key" | "none";
  payload: Record<string, string>;
};

export type AgentRunSpec = {
  prompt?: string;
  title?: string;
  task?: AssignedTask;
  buildId?: string;
  buildContext?: string;
  priorResults?: string;
  workspaceSubdir?: string;
  timeoutMs?: number;
  approvalPolicy?: "never" | "ask";
  toolGrants?: string[];
  envOverrides?: Record<string, string>;
  providerId?: string;
  model?: string;
  sessionId?: string;
  onProgress?: (message: string) => void;
};

export type AgentRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  toolExecutionId: string;
  agentId: BuildAgentId;
  providerId: BuildExecutionProviderId;
};

export interface BuildAgentRunner {
  readonly id: BuildAgentId;
  prepare(
    provider: BuildExecutionProvider,
    handle: SandboxHandle,
    credential: AgentCredential | null,
  ): Promise<void>;
  run(
    provider: BuildExecutionProvider,
    handle: SandboxHandle,
    spec: AgentRunSpec,
  ): Promise<AgentRunResult>;
  capabilities(): BuildAgentRunnerCapabilities;
}

export function assertAgentProviderCompatibility(
  agent: BuildAgentRunnerCapabilities,
  provider: BuildExecutionProviderCapabilities,
): void {
  if (agent.requiresPersistentSession && provider.workspacePersistence === "ephemeral") {
    throw new Error("agent requires persistent session but provider is ephemeral");
  }

  if (agent.requiresCallbackPort && !provider.supportsPortCallbacks) {
    throw new Error(`agent requires callback port ${agent.requiresCallbackPort}, but provider does not support callback ports`);
  }

  if (!agent.honorsLlmBaseUrl && provider.trustLevel === "untrusted-ok") {
    throw new Error("mode-4 CLI agents are not allowed on untrusted-ok providers in slice 1");
  }
}

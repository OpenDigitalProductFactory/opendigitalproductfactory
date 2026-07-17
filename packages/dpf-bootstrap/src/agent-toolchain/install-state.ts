/**
 * Materialize the agentToolchain block written into ~/.dpf/install-state.json.
 *
 * Composes planning + probe results into the canonical state object the
 * shell adapters persist.
 */

import type {
  AgentToolchainState,
  McpReadinessProbeResult,
  SmokeTestResult,
} from "./types";
import { computeReadinessState } from "./readiness-state";

export type MaterializeInputs = {
  appliedAt: string;
  dpfPlatformVersion: string;
  /** @deprecated Advisory only; see AgentToolchainState.superpowersVersion. Expect `null`. */
  superpowersVersion: string | null;
  claudeCodeWired: boolean;
  codexWired: boolean;
  /** Optional, additive third client. Defaults to false when omitted. */
  grokWired?: boolean;
  /** Optional, additive client (Google Antigravity `agy`). Defaults to false when omitted. */
  antigravityWired?: boolean;
  memorySeededAt: string | null;
  mcpReadiness: McpReadinessProbeResult;
  smokeTest: SmokeTestResult;
};

export function materializeAgentToolchainState(
  inputs: MaterializeInputs,
): AgentToolchainState {
  const readinessState = computeReadinessState({
    claudeCodeWired: inputs.claudeCodeWired,
    codexWired: inputs.codexWired,
    grokWired: inputs.grokWired ?? false,
    antigravityWired: inputs.antigravityWired ?? false,
    mcpReadiness: inputs.mcpReadiness,
    smokeTest: inputs.smokeTest,
  });

  return {
    appliedAt: inputs.appliedAt,
    dpfPlatformVersion: inputs.dpfPlatformVersion,
    superpowersVersion: inputs.superpowersVersion,
    claudeCodeWired: inputs.claudeCodeWired,
    codexWired: inputs.codexWired,
    grokWired: inputs.grokWired ?? false,
    antigravityWired: inputs.antigravityWired ?? false,
    memorySeededAt: inputs.memorySeededAt,
    mcpReadiness: inputs.mcpReadiness,
    smokeTest: inputs.smokeTest,
    readinessState,
  };
}

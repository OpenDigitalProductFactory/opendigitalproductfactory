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
  superpowersVersion: string | null;
  claudeCodeWired: boolean;
  codexWired: boolean;
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
    mcpReadiness: inputs.mcpReadiness,
    smokeTest: inputs.smokeTest,
  });

  return {
    appliedAt: inputs.appliedAt,
    dpfPlatformVersion: inputs.dpfPlatformVersion,
    superpowersVersion: inputs.superpowersVersion,
    claudeCodeWired: inputs.claudeCodeWired,
    codexWired: inputs.codexWired,
    memorySeededAt: inputs.memorySeededAt,
    mcpReadiness: inputs.mcpReadiness,
    smokeTest: inputs.smokeTest,
    readinessState,
  };
}

/**
 * The six readiness states the installer + portal must show to operators.
 * Source of truth for installer banner copy lives here so spec/portal/installer
 * drift is detectable by a single unit test against `readinessCopy()`.
 *
 * Spec table: §"User experience shape" in
 * docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md
 */

import type { AgentToolchainState, ReadinessState } from "./types";

export type ReadinessCopy = {
  message: string;
  primaryAction: string;
};

const COPY: Record<ReadinessState, ReadinessCopy> = {
  ready: {
    message: "Claude Code, Codex, and Grok are ready for DPF work.",
    primaryAction: "Open readiness",
  },
  partial: {
    message: "One or more contributor clients are ready; others need setup.",
    primaryAction: "Repair toolchain",
  },
  missing_cli: {
    message: "Install a supported agent client (Claude Code, Codex, or Grok) to enable contributor sessions.",
    primaryAction: "Open setup guide",
  },
  missing_token: {
    message: "DPF MCP needs a development token before agents can use governed tools.",
    primaryAction: "Issue development token",
  },
  needs_refresh: {
    message: "A token exists, but the running client has not picked it up yet.",
    primaryAction: "Refresh client binding",
  },
  failed_smoke: {
    message: "The agent is installed but did not apply a DPF kernel principle.",
    primaryAction: "View evidence",
  },
};

export function readinessCopy(state: ReadinessState): ReadinessCopy {
  return COPY[state];
}

/**
 * Compute the readiness state from a partial AgentToolchainState. Order of
 * checks matters — earlier checks reflect "more fundamental" gaps so the
 * primary remediation is unambiguous.
 */
export function computeReadinessState(
  state: Partial<AgentToolchainState>,
): ReadinessState {
  const claudeWired = state.claudeCodeWired === true;
  const codexWired = state.codexWired === true;
  const grokWired = state.grokWired === true;

  if (!claudeWired && !codexWired && !grokWired) {
    return "missing_cli";
  }

  const mcp = state.mcpReadiness;
  if (mcp && !mcp.ok) {
    if (mcp.reason === "no_token" || mcp.reason === "scope_insufficient") {
      return "missing_token";
    }
    if (mcp.reason === "endpoint_unreachable" || mcp.reason === "unexpected_shape") {
      return "needs_refresh";
    }
  }

  if (state.smokeTest && state.smokeTest.result === "failed") {
    return "failed_smoke";
  }

  if (!claudeWired || !codexWired || !grokWired) {
    return "partial";
  }

  return "ready";
}

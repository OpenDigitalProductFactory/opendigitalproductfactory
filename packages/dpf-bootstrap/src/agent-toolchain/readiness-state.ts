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
    message: "Claude Code and Codex are ready for DPF work.",
    primaryAction: "Open readiness",
  },
  partial: {
    message: "One contributor client is ready; the other needs setup.",
    primaryAction: "Repair toolchain",
  },
  missing_cli: {
    message: "Install the selected agent client to enable contributor sessions.",
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
  "portal-unavailable": {
    message: "The portal is rebooting; I can still repair local agent tooling and will sync evidence when it comes back.",
    primaryAction: "Continue local repair",
  },
  "mcp-unavailable": {
    message: "DPF coordination is unavailable; I can still repair local agent tooling and will sync evidence when it returns.",
    primaryAction: "Continue local repair",
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
  const antigravityWired = state.antigravityWired === true;

  if (!claudeWired && !codexWired && !grokWired && !antigravityWired) {
    return "missing_cli";
  }

  const mcp = state.mcpReadiness;
  if (mcp && !mcp.ok) {
    if (mcp.reason === "no_token" || mcp.reason === "scope_insufficient") {
      return "missing_token";
    }
    if (mcp.reason === "portal-unavailable") {
      return "portal-unavailable";
    }
    if (mcp.reason === "mcp-unavailable") {
      return "mcp-unavailable";
    }
    if (mcp.reason === "endpoint_unreachable" || mcp.reason === "unexpected_shape") {
      return "needs_refresh";
    }
  }

  if (state.smokeTest && state.smokeTest.result === "failed") {
    return "failed_smoke";
  }

  // Grok and Antigravity are additive, optional clients: their presence counts
  // toward "not missing_cli" (above) but readiness is still anchored on the
  // established Claude + Codex pair so existing installs are never regressed to
  // "partial" merely because a brand-new optional CLI (Grok, or Antigravity's
  // `agy`) is absent.
  if (!claudeWired || !codexWired) {
    return "partial";
  }

  return "ready";
}

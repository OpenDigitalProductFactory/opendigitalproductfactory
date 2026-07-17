/**
 * Shared types across the agent-toolchain bootstrap planning library.
 *
 * Every planning function in this package returns a `Plan` shape — data-in /
 * data-out. The shell adapters apply the plan; this package never writes to
 * disk, never spawns processes, never opens network sockets.
 *
 * Bearer-token discipline: any field that could carry a bearer token MUST go
 * through `redactTranscriptForPersistence` before reaching a persisted plan
 * or state object. Fixtures-redaction.test enforces the structural side;
 * runtime helpers enforce the dynamic side.
 */

/**
 * Discriminator for write modes used across planning outputs.
 */
export type PlanWriteMode = "create" | "update" | "preserve-user-edit";

/**
 * Result of the read-only MCP `tools/list` probe, persisted into install state.
 * Bearer tokens are never included; the probe transcript is redacted at the
 * adapter boundary.
 */
export type McpReadinessProbeResult =
  | { ok: true; toolCount: number; observedAt: string }
  | {
      ok: false;
      reason:
        | "no_token"
        | "portal-unavailable"
        | "mcp-unavailable"
        | "endpoint_unreachable"
        | "scope_insufficient"
        | "unexpected_shape";
      httpStatus: number | null;
    };

/**
 * Result of the kernel-principle smoke probe (designed-to-trip prompt).
 * `transcript` is bearer-redacted via `redactTranscriptForPersistence`
 * before being persisted into install state.
 */
export type SmokeTestResult =
  | { result: "passed"; kernelPrincipleObserved: string; transcript: string }
  | { result: "failed"; transcript: string; reason: string }
  | {
      result: "skipped";
      reason:
        | "claude_not_on_path"
        | "codex_not_on_path"
        | "grok_not_on_path"
        | "no_cli_on_path"
        | "no_token";
    };

/**
 * Six explicit readiness states for the install / portal UX contract.
 * Source of truth for installer banner copy lives in `readiness-state.ts`.
 */
export type ReadinessState =
  | "ready"
  | "partial"
  | "missing_cli"
  | "missing_token"
  | "needs_refresh"
  | "portal-unavailable"
  | "mcp-unavailable"
  | "failed_smoke";

/**
 * The full `agentToolchain` block persisted into `~/.dpf/install-state.json`.
 */
export type AgentToolchainState = {
  appliedAt: string;
  dpfPlatformVersion: string;
  /**
   * @deprecated Advisory only; not part of readiness. DPF no longer depends on
   * upstream `obra/superpowers` — the composed capabilities (brainstorming,
   * systematic-debugging, finishing-a-development-branch) are now DPF-native
   * skills in `packages/dpf-skill-pack` (see
   * docs/superpowers/specs/2026-05-30-dpf-native-skill-equivalents-design.md).
   * Retained as a nullable field for install-state backward-compat; expect
   * `null`. Slated for removal under a substrate-cleanup BI.
   */
  superpowersVersion: string | null;
  claudeCodeWired: boolean;
  codexWired: boolean;
  grokWired: boolean;
  antigravityWired: boolean;
  memorySeededAt: string | null;
  mcpReadiness: McpReadinessProbeResult;
  smokeTest: SmokeTestResult;
  readinessState: ReadinessState;
};

// apps/web/lib/routing/capability-probes/probe-claude-cli.ts
//
// Phase A5: Capability probe for the claude-code CLI adapter.
//
// Delegates the docker-exec + version parse to the shared probeEngineReadiness
// (Build-Engine Provisioning slice B) so all engines share one detection path,
// then THROWS when the binary is missing — phantom capabilities would corrupt
// routing decisions, so probe failure must surface to the cache layer rather
// than return a stub.
//
// Capabilities are observed from cli-adapter.ts and the audit at
// docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §5.2.

import { probeEngineReadiness } from "./probe-engine-readiness";
import type { CapabilityProbeResult } from "../capability-probe-types";

const CLAUDE_ENGINE = {
  engineId: "claude",
  binary: "claude",
  verifyCommand: "claude --version",
  versionRegex: /(\d+\.\d+\.\d+)/,
};

export async function probeClaudeCli(): Promise<CapabilityProbeResult> {
  const readiness = await probeEngineReadiness(CLAUDE_ENGINE);
  if (!readiness.present || !readiness.version) {
    throw new Error(
      `probeClaudeCli: claude CLI not available in sandbox: ${readiness.error ?? "unknown error"}`,
    );
  }

  return {
    adapterKind: "claude-code-cli",
    adapterVersion: `claude-code/${readiness.version}`,

    // Observed capabilities — see cli-adapter.ts and Claude Code feature set.
    supportsStreamingEvents: true,
    supportsMcpAttach: true,
    supportsMcpAttachPerInvoke: true, // --mcp-config flag
    supportsSubagents: true, // Task tool
    supportsHooks: true, // settings.json hooks
    supportsPlanState: true,
    supportsTodoState: true, // TodoWrite tool
    supportsWebFetch: true,
    supportsWebSearch: true,
    supportsSessionResume: true, // --session-id
    supportsExtendedThinking: true,
    supportsOutputSchema: false, // not equivalent to Codex's --output-schema

    maxInteractiveLatencyMs: 600_000, // matches CLI_TIMEOUT_MS in cli-adapter.ts
    supportedAuthModes: ["oauth", "api-key"],
    knownDegradations: null,
  };
}

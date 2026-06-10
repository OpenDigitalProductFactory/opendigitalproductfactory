// apps/web/lib/routing/capability-probes/probe-codex-cli.ts
//
// Phase A5: Capability probe for the codex CLI adapter.
//
// Delegates the docker-exec + version parse to the shared probeEngineReadiness
// (Build-Engine Provisioning slice B) so all engines share one detection path,
// then THROWS when the binary is missing.
//
// Capabilities are observed from codex-cli-adapter.ts and the JSONL audit at
// docs/superpowers/audits/evidence/2026-04-29-codex-jsonl-probe.md.
//
// `knownDegradations` carries the two documented silent-failure modes:
//   - openai/codex#15451: --json events silently dropped when MCP active
//   - openai/codex#4776: schema rename (item_type→type, assistant_message→agent_message)

import { probeEngineReadiness } from "./probe-engine-readiness";
import type { CapabilityProbeResult } from "../capability-probe-types";

const CODEX_ENGINE = {
  engineId: "codex",
  binary: "codex",
  verifyCommand: "codex --version",
  versionRegex: /(\d+\.\d+\.\d+)/,
};

export async function probeCodexCli(): Promise<CapabilityProbeResult> {
  const readiness = await probeEngineReadiness(CODEX_ENGINE);
  if (!readiness.present || !readiness.version) {
    throw new Error(
      `probeCodexCli: codex CLI not available in sandbox: ${readiness.error ?? "unknown error"}`,
    );
  }

  return {
    adapterKind: "codex-cli",
    adapterVersion: `codex-cli/${readiness.version}`,

    // Per audit Q1 + JSONL probe evidence:
    supportsStreamingEvents: true, // --json
    supportsMcpAttach: true, // ~/.codex/config.toml + codex mcp subcommand
    supportsMcpAttachPerInvoke: false, // static config only — KEY DIFF vs Claude
    supportsSubagents: false, // not in current Codex
    supportsHooks: false,
    supportsPlanState: true, // item.completed type=plan_update
    supportsTodoState: true, // same
    supportsWebFetch: true, // model-dependent but advertised
    supportsWebSearch: true, // item.completed type=web_search
    supportsSessionResume: true, // codex exec resume <uuid>
    supportsExtendedThinking: true, // -c reasoning.effort=high
    supportsOutputSchema: true, // --output-schema (gpt-5 family only)

    maxInteractiveLatencyMs: 600_000, // matches CLI_TIMEOUT_MS in codex-cli-adapter.ts
    supportedAuthModes: ["oauth", "api-key"],

    knownDegradations: [
      {
        trigger: "--json + MCP active",
        behavior: "stream malformed; events silently dropped",
        source: "https://github.com/openai/codex/issues/15451",
      },
      {
        trigger: "schema rename observed in 0.x releases",
        behavior:
          "item_type field renamed to type without notice; assistant_message renamed to agent_message",
        source: "https://github.com/openai/codex/issues/4776",
      },
    ],
  };
}

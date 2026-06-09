// apps/web/lib/routing/capability-probes/probe-grok-cli.ts
//
// Capability probe for the grok CLI adapter (xAI), added with Build-Engine
// Provisioning slice B. Delegates the docker-exec + version parse to the shared
// probeEngineReadiness, then THROWS when the binary is missing — preserving the
// same throw-on-missing routing contract as probe-claude-cli / probe-codex-cli.
//
// NOTE: the capability flags below are PROVISIONAL conservative defaults. Grok
// CLI runs headless (`grok -p`) and has no capability audit yet; they are set
// false-by-default so routing never over-promises a grok capability. Refine
// once a grok adapter audit exists (follow-up to EP-GROK-001).
//
// Spec: docs/superpowers/specs/2026-06-06-build-engine-provisioning-design.md (Phase 1a, slice B)

import { probeEngineReadiness } from "./probe-engine-readiness";
import type { CapabilityProbeResult } from "../capability-probe-types";

const GROK_ENGINE = {
  engineId: "grok",
  binary: "grok",
  verifyCommand: "grok --version",
  versionRegex: /(\d+\.\d+\.\d+)/,
};

export async function probeGrokCli(): Promise<CapabilityProbeResult> {
  const readiness = await probeEngineReadiness(GROK_ENGINE);
  if (!readiness.present || !readiness.version) {
    throw new Error(
      `probeGrokCli: grok CLI not available in sandbox: ${readiness.error ?? "unknown error"}`,
    );
  }

  return {
    adapterKind: "grok-cli",
    adapterVersion: `grok-cli/${readiness.version}`,

    // Provisional — conservative until a grok adapter audit exists.
    supportsStreamingEvents: false,
    supportsMcpAttach: false,
    supportsMcpAttachPerInvoke: false,
    supportsSubagents: false,
    supportsHooks: false,
    supportsPlanState: false,
    supportsTodoState: false,
    supportsWebFetch: false,
    supportsWebSearch: false,
    supportsSessionResume: false,
    supportsExtendedThinking: false,
    supportsOutputSchema: false,

    maxInteractiveLatencyMs: 600_000,
    supportedAuthModes: ["api-key"],
    knownDegradations: null,
  };
}

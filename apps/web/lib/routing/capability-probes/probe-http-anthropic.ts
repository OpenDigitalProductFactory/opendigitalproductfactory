// apps/web/lib/routing/capability-probes/probe-http-anthropic.ts
//
// Phase A5: Capability probe for the http-anthropic adapter.
//
// Static — Anthropic's HTTP Messages API has a known capability surface that
// cannot be discovered at runtime in any meaningful way. The version is the
// project's pinned `anthropic-version` header (see ai-provider-internals.ts:64).
//
// Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A5)
// Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.1, §5.2

import type { CapabilityProbeResult } from "../capability-probe-types";

/**
 * Anthropic API version pinned by the project — tracks
 * apps/web/lib/inference/ai-provider-internals.ts:64 where the
 * "anthropic-version" header is set on outbound HTTP calls.
 */
const ANTHROPIC_API_VERSION = "2023-06-01";

export async function probeHttpAnthropic(): Promise<CapabilityProbeResult> {
  return {
    adapterKind: "http-anthropic",
    adapterVersion: `anthropic-http/${ANTHROPIC_API_VERSION}`,

    supportsStreamingEvents: true, // SSE
    supportsMcpAttach: false, // HTTP API doesn't support MCP attach
    supportsMcpAttachPerInvoke: false,
    supportsSubagents: false,
    supportsHooks: false,
    supportsPlanState: false,
    supportsTodoState: false,
    supportsWebFetch: false, // not via Messages API directly
    supportsWebSearch: false,
    supportsSessionResume: false, // stateless API
    supportsExtendedThinking: true, // thinking field on Messages API
    supportsOutputSchema: false,

    maxInteractiveLatencyMs: 60_000, // typical HTTP call ceiling
    supportedAuthModes: ["api-key", "oauth"],
    knownDegradations: null,
  };
}

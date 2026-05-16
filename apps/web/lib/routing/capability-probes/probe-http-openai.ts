// apps/web/lib/routing/capability-probes/probe-http-openai.ts
//
// Phase A5: Capability probe for the http-openai adapter.
//
// Static — OpenAI's v1 HTTP API has a known capability surface. Version is
// the OpenAI v1 endpoint family used in adapter-openai.ts.
//
// Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A5)
// Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.1, §5.2

import type { CapabilityProbeResult } from "../capability-probe-types";

/**
 * OpenAI HTTP API version family. The project uses api.openai.com/v1
 * (see adapter-openai.ts and chat-adapter.ts). There is no per-release
 * version header on OpenAI's API the way Anthropic has, so this string
 * tracks the v1 endpoint family.
 */
const OPENAI_API_VERSION = "v1";

export async function probeHttpOpenAI(): Promise<CapabilityProbeResult> {
  return {
    adapterKind: "http-openai",
    adapterVersion: `openai-http/${OPENAI_API_VERSION}`,

    supportsStreamingEvents: true,
    supportsMcpAttach: false,
    supportsMcpAttachPerInvoke: false,
    supportsSubagents: false,
    supportsHooks: false,
    supportsPlanState: false,
    supportsTodoState: false,
    supportsWebFetch: false,
    supportsWebSearch: false,
    supportsSessionResume: false,
    supportsExtendedThinking: true, // o1/o3/gpt-5 reasoning
    supportsOutputSchema: true, // response_format json_schema

    maxInteractiveLatencyMs: 60_000,
    supportedAuthModes: ["api-key"],
    knownDegradations: null,
  };
}

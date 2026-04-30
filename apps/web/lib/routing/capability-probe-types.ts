// apps/web/lib/routing/capability-probe-types.ts
//
// Phase A5: Shared types for adapter capability probes + cache.
//
// Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A5)
// Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.1, §5.2
//
// Mirrors the columns of the AdapterCapabilityProfile prisma model (schema.prisma
// §"AdapterCapabilityProfile"). Probes return CapabilityProbeResult (omits the
// DB-managed id/probedAt/probedBy); the cache layer adds those fields and
// persists. Keeping this type local to the routing folder avoids importing
// the Prisma client in pure probe modules — probes have no DB dependency.

import type { ExecutionAdapterKind } from "./execution-adapter-types";

/**
 * Single known degradation entry. Recorded for adapters with documented
 * silent-failure modes (e.g. Codex `--json` + MCP per openai/codex#15451).
 */
export type KnownDegradation = {
  trigger: string;
  behavior: string;
  source: string;
};

/**
 * The shape every probe returns. The `adapterKind` is one of the structured
 * ExecutionAdapterKind values — narrowed to the kinds with registered probes
 * by the cache layer's switch statement.
 */
export type CapabilityProbeResult = {
  adapterKind: ExecutionAdapterKind;
  adapterVersion: string;

  supportsStreamingEvents: boolean;
  supportsMcpAttach: boolean;
  supportsMcpAttachPerInvoke: boolean;
  supportsSubagents: boolean;
  supportsHooks: boolean;
  supportsPlanState: boolean;
  supportsTodoState: boolean;
  supportsWebFetch: boolean;
  supportsWebSearch: boolean;
  supportsSessionResume: boolean;
  supportsExtendedThinking: boolean;
  supportsOutputSchema: boolean;

  maxInteractiveLatencyMs: number;
  supportedAuthModes: string[];
  knownDegradations: KnownDegradation[] | null;
};

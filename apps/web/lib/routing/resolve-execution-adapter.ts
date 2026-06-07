// apps/web/lib/routing/resolve-execution-adapter.ts
//
// Phase A6: Capability-aware adapter resolution.
//
// Replaces the hard-coded `isCliAdapter` boolean check at
// [ai-inference.ts:351-360](../inference/ai-inference.ts#L351) with a structured
// resolver that:
//
//   1. Accepts `executionAdapter` as either a legacy string ("claude-cli",
//      "codex-cli", "chat") OR a structured `ExecutionAdapterSelector` object.
//      Legacy strings round-trip through `parseExecutionAdapterSelector` (A4).
//
//   2. Maps the selector's `kind` back to the legacy adapter-registry string
//      so the existing `getExecutionAdapter()` lookup continues to work
//      unchanged. This keeps the registry stable while the route plan moves
//      to structured selectors.
//
//   3. If the route plan supplies `capabilityRequirements` with at least one
//      `required: true` entry, fetches the adapter's capability profile via
//      `getOrProbeCapabilityProfile()` (A5) and verifies every required
//      capability is `true` on the profile. If any required capability is
//      unsatisfied, throws `CapabilityRequirementUnsatisfiedError` so the
//      operator sees the requirement gap loudly. (Spec §5.2: advisory
//      requirements log + downgrade; required requirements fail-route.)
//
// A6 deliberately does NOT implement adapter fallback chains — that's a future
// task. For now, a required-capability mismatch is a hard error so misconfigured
// route plans surface immediately rather than silently choosing a degraded
// adapter.
//
// Plan: docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md (Task A6)
// Spec: docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §5.2

import type { ExecutionAdapterHandler } from "./adapter-types";
import {
  parseExecutionAdapterSelector,
  type AdapterCapability,
  type AdapterCapabilityRequirement,
  type ExecutionAdapterKind,
  type ExecutionAdapterSelector,
} from "./execution-adapter-types";
import { getExecutionAdapter } from "./execution-adapter-registry";
import { getOrProbeCapabilityProfile } from "./capability-profile-cache";

/**
 * Thrown when a route plan declares a `required: true` capability that the
 * resolved adapter's capability profile reports as `false`. The error names
 * the failing capability and the adapter kind so operators can either
 * loosen the requirement or pick a different adapter.
 */
export class CapabilityRequirementUnsatisfiedError extends Error {
  readonly adapterKind: ExecutionAdapterKind;
  readonly missingCapabilities: AdapterCapability[];

  constructor(
    adapterKind: ExecutionAdapterKind,
    missingCapabilities: AdapterCapability[],
  ) {
    super(
      `Adapter "${adapterKind}" does not satisfy required capability(ies): ${missingCapabilities.join(
        ", ",
      )}`,
    );
    this.name = "CapabilityRequirementUnsatisfiedError";
    this.adapterKind = adapterKind;
    this.missingCapabilities = missingCapabilities;
  }
}

/**
 * Inverse of `parseExecutionAdapterSelector`: maps a structured kind back to
 * the legacy adapter-registry string consumed by `getExecutionAdapter()`.
 *
 *   claude-code-cli                                       → "claude-cli"
 *   codex-cli                                             → "codex-cli"
 *   http-generic / http-anthropic / http-openai /         → "chat"
 *   http-gemini / http-ollama
 *   codex-mcp-server / local-runtime                      → throws
 *
 * The HTTP variants all collapse to `"chat"` because the chat adapter routes
 * by `providerId` internally — the kind distinction matters for the capability
 * profile lookup, not for handler dispatch.
 */
function kindToLegacyAdapterType(kind: ExecutionAdapterKind): string {
  switch (kind) {
    case "claude-code-cli":
      return "claude-cli";
    case "codex-cli":
      return "codex-cli";
    case "grok-cli":
      // Grok CLI external agent support (BI-GROK-006). For now maps to generic chat
      // until a dedicated grok-cli handler is registered in the execution adapter registry.
      return "chat";
    case "http-generic":
    case "http-anthropic":
    case "http-openai":
    case "http-gemini":
    case "http-ollama":
      return "chat";
    case "codex-mcp-server":
    case "local-runtime":
      throw new Error(
        `No execution adapter handler registered for kind "${kind}" yet.`,
      );
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown execution adapter kind: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Resolve an execution adapter handler from a selector + optional capability
 * requirements.
 *
 * Backward compat: passing a legacy string ("claude-cli", "codex-cli", "chat")
 * produces the same handler as `getExecutionAdapter(<string>)` did before A6.
 *
 * Capability gating: if any requirement has `required: true`, the adapter's
 * capability profile is fetched (probed if necessary) and every required
 * capability must be `true` on the profile. Otherwise this throws
 * `CapabilityRequirementUnsatisfiedError`.
 */
export async function resolveExecutionAdapter(
  input: string | ExecutionAdapterSelector,
  requirements?: AdapterCapabilityRequirement[],
): Promise<ExecutionAdapterHandler> {
  const selector = parseExecutionAdapterSelector(input);

  // Capability gating — only when at least one requirement is `required: true`.
  // Pure-advisory requirements are a no-op in A6 (spec §5.2: advisory ⇒ log +
  // downgrade; A6 declines to log because the telemetry sink lands in A7).
  const requiredCaps = (requirements ?? []).filter((r) => r.required);
  if (requiredCaps.length > 0) {
    const profile = await getOrProbeCapabilityProfile(selector.kind);
    const missing: AdapterCapability[] = [];
    for (const req of requiredCaps) {
      // The capability fields are typed booleans on AdapterCapabilityProfile;
      // a missing/false value means the adapter cannot satisfy the requirement.
      const value = (profile as unknown as Record<AdapterCapability, boolean>)[
        req.capability
      ];
      if (value !== true) {
        missing.push(req.capability);
      }
    }
    if (missing.length > 0) {
      throw new CapabilityRequirementUnsatisfiedError(selector.kind, missing);
    }
  }

  const legacyType = kindToLegacyAdapterType(selector.kind);
  return getExecutionAdapter(legacyType);
}

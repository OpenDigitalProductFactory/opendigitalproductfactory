import type { EndpointManifest } from "./types";

/**
 * EP-AGENT-CAP-002: Subset of ModelCardCapabilities used as a per-agent routing floor.
 *
 * When minimumCapabilities is set on AgentModelConfig, the routing pipeline will
 * reject any endpoint that does not satisfy ALL declared capabilities.
 * Null in the DB = use DEFAULT_MINIMUM_CAPABILITIES at runtime.
 * {} (empty object) = passive agent — no capability floor (explicit opt-out).
 */
export interface AgentMinimumCapabilities {
  toolUse?: boolean;
  imageInput?: boolean;
  pdfInput?: boolean;
  codeExecution?: boolean;
  computerUse?: boolean;
  webSearch?: boolean;
}

/** Runtime default when minimumCapabilities is null in DB. All standard coworkers. */
export const DEFAULT_MINIMUM_CAPABILITIES: AgentMinimumCapabilities = { toolUse: true };

/** Explicit passive agent — no capability floor. Must be set explicitly; never the default. */
export const PASSIVE_AGENT_CAPABILITIES: AgentMinimumCapabilities = {};

/** System default minimum context window for RAG/L2 context injection (tokens). */
export const DEFAULT_MINIMUM_CONTEXT_TOKENS = 16_000;

/**
 * Check whether an endpoint satisfies an agent's minimum capability floor.
 *
 * Uses endpoint.supportsToolUse for toolUse — the existing top-level field,
 * already resolved through the 5-level priority chain in resolveToolUse().
 *
 * For all other caps (imageInput, pdfInput, codeExecution, computerUse,
 * webSearch) reads from endpoint.capabilities directly. EndpointManifest
 * already carries the full ModelCardCapabilities JSON blob, so there is no
 * benefit to denormalizing these to top-level booleans.
 */
export function satisfiesMinimumCapabilities(
  endpoint: Pick<EndpointManifest, "supportsToolUse" | "capabilities">,
  floor: AgentMinimumCapabilities,
): { satisfied: boolean; missingCapability?: keyof AgentMinimumCapabilities } {
  if (floor.toolUse && !endpoint.supportsToolUse) {
    return { satisfied: false, missingCapability: "toolUse" };
  }
  const caps = endpoint.capabilities as unknown as Record<string, unknown> | null | undefined;
  if (floor.imageInput && !caps?.imageInput) {
    return { satisfied: false, missingCapability: "imageInput" };
  }
  if (floor.pdfInput && !caps?.pdfInput) {
    return { satisfied: false, missingCapability: "pdfInput" };
  }
  if (floor.codeExecution && !caps?.codeExecution) {
    return { satisfied: false, missingCapability: "codeExecution" };
  }
  if (floor.computerUse && !caps?.computerUse) {
    return { satisfied: false, missingCapability: "computerUse" };
  }
  if (floor.webSearch && !caps?.webSearch) {
    return { satisfied: false, missingCapability: "webSearch" };
  }
  return { satisfied: true };
}

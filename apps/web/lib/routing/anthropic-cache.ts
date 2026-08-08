// apps/web/lib/routing/anthropic-cache.ts

/**
 * EP-COST-001 / BI-79A5C00F — Anthropic prompt-cache breakpoint emission.
 *
 * DPF assembles system prompts with a stable prefix (identity / mode / mission)
 * before SYSTEM_PROMPT_DYNAMIC_BOUNDARY and per-turn dynamic content after it,
 * but never told Anthropic to cache the prefix — so the large, invariant prefix
 * was re-billed at full input rate on every turn. This emits a single ephemeral
 * cache_control breakpoint on the stable prefix only.
 *
 * Simplest-safe contract: when the boundary is present we split and cache the
 * prefix; when it is absent we return the original string UNCHANGED (no
 * cache_control), because without the boundary we cannot prove which content is
 * dynamic and must never risk caching volatile content.
 *
 * TTL (BI-4761F54E, context-engineering R6/P8): cache_control:{type:"ephemeral"}
 * is the 5-minute TTL; adding ttl:"1h" extends it to one hour. Both are GA on
 * the first-party Anthropic API with NO beta header (the older extended-cache
 * beta requirement is retired). The Anthropic default silently reverted 1h→5m,
 * so long agentic loops whose inter-turn gaps exceed five minutes lose the
 * cached prefix and re-pay it at full input rate. We therefore default the
 * stable prefix to a 1-hour TTL. The 1h write premium (2x vs 1.25x) is scoped
 * to the genuinely-stable prefix (everything before SYSTEM_PROMPT_DYNAMIC_
 * BOUNDARY), never volatile content, and only ever reaches the real Anthropic
 * API — local served models (DMR/llama.cpp) go through the OpenAI-compatible
 * path and never see cache_control. Callers that know a request is a true
 * one-shot with no reuse can pass cachePrefixTtl:"5m" to avoid the premium.
 */
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "../tak/prompt-boundary";

export type AnthropicCachePrefixTtl = "5m" | "1h";

export type AnthropicTextBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral"; ttl?: "1h" };
};

export type BuildAnthropicSystemOptions = {
  /**
   * TTL for the stable-prefix cache breakpoint. Defaults to "1h" so long
   * agentic loops keep the cached prefix across inter-turn gaps > 5 min.
   * "5m" omits the ttl field (Anthropic's 5-minute default) for one-shots.
   */
  cachePrefixTtl?: AnthropicCachePrefixTtl;
};

/**
 * Build the Anthropic `system` request field. Returns a content-block array with
 * an ephemeral cache breakpoint on the stable prefix when the dynamic boundary
 * is present; otherwise returns the input string unchanged.
 */
export function buildAnthropicSystem(
  systemPrompt: string | undefined | null,
  options: BuildAnthropicSystemOptions = {},
): string | AnthropicTextBlock[] {
  if (!systemPrompt) return "";

  const idx = systemPrompt.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
  if (idx === -1) return systemPrompt;

  const stablePrefix = systemPrompt.slice(0, idx);
  const dynamicTail = systemPrompt.slice(idx + SYSTEM_PROMPT_DYNAMIC_BOUNDARY.length);

  // Boundary at the very start — nothing stable to cache. Leave unchanged.
  if (stablePrefix.trim().length === 0) return systemPrompt;

  const cacheControl: { type: "ephemeral"; ttl?: "1h" } =
    (options.cachePrefixTtl ?? "1h") === "1h"
      ? { type: "ephemeral", ttl: "1h" }
      : { type: "ephemeral" };

  const blocks: AnthropicTextBlock[] = [
    { type: "text", text: stablePrefix, cache_control: cacheControl },
  ];
  if (dynamicTail.length > 0) {
    blocks.push({ type: "text", text: dynamicTail });
  }
  return blocks;
}

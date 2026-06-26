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
 * Note: cache_control:{type:"ephemeral"} is the 5-minute TTL (GA, no beta
 * header). A 1-hour TTL (ttl:"1h") is a follow-up: it needs the extended-cache
 * beta header to be confirmed against the live Anthropic API version.
 */
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "../tak/prompt-boundary";

export type AnthropicTextBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

/**
 * Build the Anthropic `system` request field. Returns a content-block array with
 * an ephemeral cache breakpoint on the stable prefix when the dynamic boundary
 * is present; otherwise returns the input string unchanged.
 */
export function buildAnthropicSystem(
  systemPrompt: string | undefined | null,
): string | AnthropicTextBlock[] {
  if (!systemPrompt) return systemPrompt ?? "";

  const idx = systemPrompt.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
  if (idx === -1) return systemPrompt;

  const stablePrefix = systemPrompt.slice(0, idx);
  const dynamicTail = systemPrompt.slice(idx + SYSTEM_PROMPT_DYNAMIC_BOUNDARY.length);

  // Boundary at the very start — nothing stable to cache. Leave unchanged.
  if (stablePrefix.trim().length === 0) return systemPrompt;

  const blocks: AnthropicTextBlock[] = [
    { type: "text", text: stablePrefix, cache_control: { type: "ephemeral" } },
  ];
  if (dynamicTail.length > 0) {
    blocks.push({ type: "text", text: dynamicTail });
  }
  return blocks;
}

// apps/web/lib/tak/capability-broker.ts
//
// EP-E431FC8A Phase 3 (BI-FB0A5C82). A PLANNER-DRIVEN capability discovery stage.
// Phase 1 forced a route's static domainTools into the attached set; Phase 2 gave
// us a data-driven task-class taxonomy. This broker closes the loop: it classifies
// the turn's intent and proactively selects the capability set that intent needs —
// the task class's authoritative tools PLUS the most keyword-relevant tools — so
// those are attached up front instead of waiting for the model to discover them
// via the model-driven `load_tools` meta-tool. `load_tools` stays as a
// backward-compatible shim for the long tail; the broker just means the common
// case is served without a discovery round-trip.
//
// The broker changes DISCOVERY + ATTACHMENT PRIORITY only — never authority
// (INV-3). It can only surface tools already present in `availableTools` (i.e.
// already grant-authorized); a name the coworker cannot use is simply skipped.
//
// Pure + dependency-light so it unit-tests without the action surface.

import type { ToolDefinition } from "@/lib/mcp-tools";
import { classifyTaskClass } from "./intent-taxonomy";
import { tokenizeIntent, scoreToolIntentRelevance } from "@/lib/tak/tool-intent";

/** Default ceiling on how many tools the broker proactively surfaces — small, so
 *  it front-loads the intent's capabilities without re-flooding the surface. */
export const DEFAULT_MAX_BROKERED_TOOLS = 8;

export interface BrokerResult {
  /** Tool names the broker proactively surfaces for this turn's intent, in
   *  priority order (authoritative-for-intent first, then keyword-relevant). */
  brokeredNames: string[];
  /** The classified task class, or null when no class matched. */
  taskClass: string | null;
}

/**
 * Select the capability set for a turn from its intent, bounded by `maxBrokered`.
 * Priority: (1) the classified task class's authoritative live-state tools that
 * the coworker actually has, then (2) the highest keyword-relevance tools. The
 * caller force-attaches these (tier-0), so a backlog/provider/build question
 * arrives with the right tools already in hand. Deterministic and pure.
 */
export function brokerCapabilities(params: {
  routeContext?: string | null;
  message: string;
  tools: readonly ToolDefinition[];
  maxBrokered?: number;
}): BrokerResult {
  const maxBrokered = params.maxBrokered ?? DEFAULT_MAX_BROKERED_TOOLS;
  const message = (params.message ?? "").trim();
  const available = new Set(params.tools.map((t) => t.name));
  const picked: string[] = [];
  const pickedSet = new Set<string>();
  const add = (name: string) => {
    if (!pickedSet.has(name) && available.has(name) && picked.length < maxBrokered) {
      picked.push(name);
      pickedSet.add(name);
    }
  };

  // (1) the intent's authoritative tools.
  const tc = classifyTaskClass({ routeContext: params.routeContext, message });
  if (tc) for (const n of tc.authoritativeToolNames) add(n);

  // (2) fill remaining slots with the most keyword-relevant tools.
  const tokens = message ? tokenizeIntent(message) : new Set<string>();
  if (tokens.size > 0 && picked.length < maxBrokered) {
    const ranked = params.tools
      .map((t) => ({ name: t.name, score: scoreToolIntentRelevance(t, tokens) }))
      .filter((r) => r.score > 0 && !pickedSet.has(r.name))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    for (const r of ranked) add(r.name);
  }

  return { brokeredNames: picked, taskClass: tc?.taskClass ?? null };
}

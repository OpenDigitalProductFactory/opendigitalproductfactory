// Server-side loader for the coworker opening briefing (BI-DED493BA).
// Split from the agent-coworker action module (module-size ratchet): the
// action calls this once per thread-snapshot load; everything here is
// side-effect-free reads.

import { prisma } from "@dpf/db";
import { resolveAgentForRoute } from "@/lib/agent-routing";
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";
import { getCoworkerProactivityPreference } from "@/lib/actions/proactivity";
import { loadAttentionItems, filterAttentionForAudience } from "@/lib/attention/aggregate";
import { composeOpeningBriefing, type OpeningBriefingPayload } from "./opening-briefing";

/**
 * Compose the ephemeral opening briefing for a panel load. Deterministic —
 * grounded in the attention read-model, no LLM call — and gated by the
 * employee's Proactivity choice for the route's coworker (quiet = silent,
 * balanced = speak when something needs the human, assertive = always
 * present). Kernel decision: deterministic-ephemeral-briefing; the payload
 * is returned to the client but never written to the thread, so it is
 * recomputed fresh on every open and cannot go stale.
 */
export async function loadOpeningBriefingPayload(
  user: { id: string; platformRole?: string | null; isSuperuser?: boolean },
  routeContext: string,
): Promise<OpeningBriefingPayload | null> {
  const useUnified = await isUnifiedCoworkerEnabled();
  const agent = resolveAgentForRoute(
    routeContext,
    { platformRole: user.platformRole ?? null, isSuperuser: user.isSuperuser ?? false },
    useUnified,
  );

  const proactivityLevel = agent.agentId
    ? await getCoworkerProactivityPreference(agent.agentId).catch(() => null)
    : null;
  // Quiet means quiet — skip the attention fan-out entirely.
  if ((proactivityLevel ?? "balanced") === "quiet") return null;

  const { items } = await loadAttentionItems(prisma, {
    aiReadinessUserId: user.id,
    delegatingUserId: user.id,
  });
  // V1 operator-view, matching /workspace/inbox; worker scoping is BI-AS-4.
  const visible = filterAttentionForAudience(items, { operator: true });

  const briefing = composeOpeningBriefing({
    routeContext,
    proactivityLevel,
    items: visible,
  });
  return briefing ? { content: briefing.content, agentId: agent.agentId ?? null } : null;
}

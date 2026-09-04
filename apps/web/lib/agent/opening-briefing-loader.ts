// Server-side loader for the coworker opening briefing (BI-DED493BA).
// Split from the agent-coworker action module (module-size ratchet): the
// action calls this once per thread-snapshot load; everything here is
// side-effect-free reads.

import { prisma } from "@dpf/db";
import { resolveAgentForRoute } from "@/lib/agent-routing";
import { isUnifiedCoworkerEnabled } from "@/lib/feature-flags";
import { loadAttentionItems, filterAttentionForAudience } from "@/lib/attention/aggregate";
import { composeOpeningBriefing, type OpeningBriefingPayload } from "./opening-briefing";

/**
 * Compose the ephemeral opening briefing for a panel load. Deterministic —
 * grounded in the attention read-model, no LLM call. It used to be gated by the
 * employee's Proactivity choice for the route's coworker; BI-87C9C91C moved
 * proactivity ownership to the outcome-specific Workroom, and a panel load is
 * interactive and unroomed, so it composes at the platform default.
 * Kernel decision: deterministic-ephemeral-briefing; the payload
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

  // BI-87C9C91C: this gate used to read the viewer's saved proactivity level FOR
  // THIS COWORKER, so who was staffed to the panel decided whether a briefing
  // appeared at all. Proactivity belongs to the outcome-specific Workroom, and a
  // panel load is interactive and unroomed, so it takes the platform default —
  // which is balanced, i.e. the briefing composes. A room that wants its work
  // quiet expresses that on the room, not on whoever is standing in it.

  const { items } = await loadAttentionItems(prisma, {
    aiReadinessUserId: user.id,
    delegatingUserId: user.id,
  });
  // V1 operator-view, matching /workspace/inbox; worker scoping is BI-AS-4.
  const visible = filterAttentionForAudience(items, { operator: true });

  const briefing = composeOpeningBriefing({
    routeContext,
    // Platform default: the composer treats null as balanced.
    proactivityLevel: null,
    items: visible,
  });
  return briefing ? { content: briefing.content, agentId: agent.agentId ?? null } : null;
}

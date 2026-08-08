// apps/web/lib/coworker-identity/identity-forms.ts
//
// EP-COWORKER-IDENTITY-360 — the id seam, made concrete. A coworker's activity
// is written under DIFFERENT id forms across tables: TokenUsage.agentId and
// CoworkerEngagement.providerAgentId are keyed by the legacy SLUG
// ("coo", "build-specialist"), while the identity page loads the CANONICAL
// registry row ("AGT-ORCH-000", "AGT-WS-BUILD"). The dual-seed pair means a
// canonical row can carry a null slugId, so the slug must be recovered from the
// registry map, not only from the loaded row. Querying one form silently misses
// the other and a live-active coworker reads as $0 / 0 engagements (found on the
// live install, 2026-08-07 — CI could not catch it: the seed used in tests keys
// consistently).
//
// This returns EVERY id form a coworker's activity may be filed under, for use
// in `where: { agentId: { in: coworkerIdentityForms(...) } }`.

import {
  CANONICAL_AGENT_ID_TO_COWORKER_SLUG,
  resolveCanonicalAgentId,
} from "@dpf/db/agent-identity";

/**
 * All id forms a coworker's activity rows may be keyed under:
 * the business/registry agentId, the loaded slugId (if any), the canonical
 * agentId, and the canonical→slug mapping (recovers "coo" from "AGT-ORCH-000"
 * even when the loaded row's slugId is null). Deduped, stable order.
 */
export function coworkerIdentityForms(agentId: string, slugId?: string | null): string[] {
  const forms = new Set<string>();
  const add = (v: string | null | undefined) => {
    if (v && v.trim()) forms.add(v.trim());
  };
  add(agentId);
  add(slugId);
  const canonical = resolveCanonicalAgentId(agentId);
  add(canonical);
  add(CANONICAL_AGENT_ID_TO_COWORKER_SLUG[canonical]);
  return [...forms];
}

// Honest attribution for attention items (BI-AB12B3D3; ratified contract BI-7D29937E,
// spec docs/superpowers/specs/2026-07-18-coo-persona-attribution-contract-design.md).
//
// The byline attributes to the accountable (human × client × session) identity,
// presented via a thin ROLE label resolved through the ONE resolver
// (resolveAgentRoleLabel). It is ALWAYS AI-labeled, never a persona name, and never
// implies a human accountable party the attribution spine cannot produce on demand.
// Composes with the honest-attention-surface anti-fabrication rule
// (2026-06-23-human-attention-surface-design.md).

import { resolveAgentRoleLabel } from "@dpf/db/agent-identity";
import type { AttentionAuthor } from "./types";

/** Build an AttentionAuthor from a coworker agentId. Role is a thin label over the
 *  accountable identity, resolved through the single source of truth. */
export function attentionAuthorForAgent(
  agentId: string | null | undefined,
  extra?: { aiClient?: string; trustLevel?: string },
): AttentionAuthor {
  return {
    roleLabel: resolveAgentRoleLabel(agentId),
    ...(extra?.aiClient ? { aiClient: extra.aiClient } : {}),
    ...(extra?.trustLevel ? { trustLevel: extra.trustLevel } : {}),
  };
}

/** The honest byline for an agent-authored item. AI-labeled first, role as a thin
 *  presentation label, AI client appended when known. Never implies a human
 *  decided — e.g. "AI · your COO · Claude", never "your COO decided". */
export function formatAttentionByline(author: AttentionAuthor | undefined | null): string {
  if (!author) return "AI coworker";
  const parts = [`AI · your ${author.roleLabel}`];
  if (author.aiClient) parts.push(author.aiClient);
  return parts.join(" · ");
}

// apps/web/lib/ea/coworker-authority-extract.ts
//
// Pure extractor for the AI Coworker Workforce SysML projection (Parity Engine,
// Slice 2). Derives a live SysML model from the coworker registry
// (packages/db/data/agent_registry.json) so the workforce/authority/delegation
// structure is a projection of the source of truth and cannot drift — replacing the
// hand-seeded AI Agent Authority view with an auto-derived one.
//
// SysML mapping: each coworker → `part_definition` (carrying tier / value-stream /
// HITL / supervisor / grant-count); package `contains` each; delegates_to and
// escalates_to → `connects` edges (only when the target is a registry agent_id).
// Stable `coworker:*` source keys. Pure; the reconcile shell supplies IO via
// applySysmlModel.

import type { SysmlDesiredModel } from "./sysml-model-seed";

export interface RegistryAgent {
  agent_id: string;
  agent_name: string;
  tier: string;
  value_stream: string;
  capability_domain?: string;
  human_supervisor_id?: string;
  hitl_tier_default?: number;
  delegates_to?: string[];
  escalates_to?: string;
  status?: string;
  config_profile?: { tool_grants?: string[] };
}

export const COWORKER_PACKAGE_KEY = "coworker:pkg";
const AGENT_ID_RE = /^AGT-/;

function truncate(s: string | undefined, n = 240): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function buildCoworkerAuthorityModel(agents: RegistryAgent[]): SysmlDesiredModel {
  const elements: SysmlDesiredModel["elements"] = [];
  const relationships: SysmlDesiredModel["relationships"] = [];

  elements.push({
    sysmlKey: COWORKER_PACKAGE_KEY,
    typeSlug: "package",
    name: "AI Coworker Workforce",
    description:
      "Live SysML projection of the AI coworker workforce — identity, tier, value-stream allocation, and delegation/escalation — derived from packages/db/data/agent_registry.json so it cannot drift from the registry.",
    properties: { sourceKey: "packages/db/data/agent_registry.json", agentCount: agents.length },
  });

  const known = new Set(agents.map((a) => a.agent_id));

  for (const a of agents) {
    const key = `coworker:agent:${a.agent_id}`;
    elements.push({
      sysmlKey: key,
      typeSlug: "part_definition",
      name: `${a.agent_name} (${a.agent_id})`,
      description: truncate(a.capability_domain) || `Coworker ${a.agent_name}.`,
      properties: {
        sourceKey: `packages/db/data/agent_registry.json#${a.agent_id}`,
        agentId: a.agent_id,
        tier: a.tier,
        valueStream: a.value_stream,
        hitlTierDefault: a.hitl_tier_default ?? null,
        status: a.status ?? null,
        supervisor: a.human_supervisor_id ?? null,
        grantCount: a.config_profile?.tool_grants?.length ?? 0,
      },
    });
    relationships.push({ fromKey: COWORKER_PACKAGE_KEY, toKey: key, relSlug: "contains" });

    // Delegation (only to other registry agents — escalates_to is often a human HR-*).
    for (const d of a.delegates_to ?? []) {
      if (AGENT_ID_RE.test(d) && known.has(d)) {
        relationships.push({ fromKey: key, toKey: `coworker:agent:${d}`, relSlug: "connects" });
      }
    }
    if (a.escalates_to && AGENT_ID_RE.test(a.escalates_to) && known.has(a.escalates_to)) {
      relationships.push({ fromKey: key, toKey: `coworker:agent:${a.escalates_to}`, relSlug: "connects" });
    }
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "part_definition"],
    relTypeSlugs: ["contains", "connects"],
    view: {
      name: "AI Coworker Workforce — Live Projection",
      description: "Live, system-maintained projection of the AI coworker workforce and its delegation structure.",
      viewpointName: "System Decomposition & Interfaces",
      scopeRef: "coworker-workforce",
    },
    softRemovePrefix: "coworker:",
  };
}

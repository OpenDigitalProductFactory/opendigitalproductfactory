// apps/web/lib/ea/integration-bridge-extract.ts
//
// Pure extractor for the Integrations SysML projection (Parity Engine, living-graph
// Phase E — EP-ARCH-GRAPH-LIVE). Projects the connected external applications the
// portal integrates with — the configured IntegrationCredential connections — into
// the one architecture graph, so "applications connected to this one through
// integrations" become first-class architecture elements impact analysis can traverse.
//
// SysML mapping (rule-valid: package→part_definition):
//   - package            integration:pkg               "Integrations — Connected Applications"
//   - connected app      integration:app:<integrationId> part_definition (one IntegrationCredential)
// Each connected application exposes an interface contract (its provider). Stable
// `integration:*` source keys; pure — the reconcile shell supplies IO.

import type { SysmlDesiredModel } from "./sysml-model-seed";

export interface IntegrationFact {
  integrationId: string;
  provider: string;
  status: string;
  lastTestedAt: string | null; // ISO
  certExpiresAt: string | null; // ISO
}

export const INTEGRATION_PACKAGE_KEY = "integration:pkg";

export function buildIntegrationModel(integrations: IntegrationFact[]): SysmlDesiredModel {
  const elements: SysmlDesiredModel["elements"] = [];
  const relationships: SysmlDesiredModel["relationships"] = [];

  elements.push({
    sysmlKey: INTEGRATION_PACKAGE_KEY,
    typeSlug: "package",
    name: "Integrations — Connected Applications",
    description:
      "Live SysML projection of the external applications the portal is connected to through integrations, derived from the configured IntegrationCredential connections so the integration boundary is represented in the architecture graph.",
    properties: { sourceKey: "IntegrationCredential", integrationCount: integrations.length },
  });

  for (const i of [...integrations].sort((a, b) => a.integrationId.localeCompare(b.integrationId))) {
    const key = `integration:app:${i.integrationId}`;
    elements.push({
      sysmlKey: key,
      typeSlug: "part_definition",
      name: `${i.provider} (${i.integrationId})`,
      description: `Connected external application via the ${i.provider} integration (${i.status}).`,
      properties: {
        sourceKey: `IntegrationCredential#${i.integrationId}`,
        layer: "integration",
        refinementLevel: "actual",
        integrationId: i.integrationId,
        provider: i.provider,
        status: i.status,
        lastTestedAt: i.lastTestedAt,
        certExpiresAt: i.certExpiresAt,
      },
    });
    relationships.push({ fromKey: INTEGRATION_PACKAGE_KEY, toKey: key, relSlug: "contains" });
  }

  return {
    elements,
    relationships,
    elementTypeSlugs: ["package", "part_definition"],
    relTypeSlugs: ["contains"],
    view: {
      name: "Integrations — Live Projection",
      description: "Live, system-maintained projection of the connected external applications the portal integrates with.",
      viewpointName: "System Decomposition & Interfaces",
      scopeRef: "integration-boundary",
    },
    softRemovePrefix: "integration:",
  };
}

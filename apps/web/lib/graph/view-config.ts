import type { GraphViewName, ViewConfig } from "./types";

export const VIEW_CONFIGS: Record<GraphViewName, ViewConfig> = {
  "network-topology": {
    name: "network-topology",
    label: "Network Topology",
    layout: "hierarchical",
    direction: "TB",
    edgesShown: new Set(["HOSTS", "MEMBER_OF", "ROUTES_THROUGH", "CONNECTS_TO", "PEER_OF"]),
    nodeTypesShown: new Set(["InfraCI"]),
    rootDetection: "gateway",
    description: "Hierarchical network view: gateways at top, subnets and hosts below",
  },
  "hosting-stack": {
    name: "hosting-stack",
    label: "Hosting Stack",
    layout: "hierarchical",
    direction: "TB",
    edgesShown: new Set(["HOSTS", "RUNS_ON", "MEMBER_OF"]),
    nodeTypesShown: new Set(["InfraCI"]),
    rootDetection: "docker_host",
    description: "Docker host to runtime to containers",
  },
  "impact-blast-radius": {
    name: "impact-blast-radius",
    label: "Impact Analysis",
    layout: "radial",
    edgesShown: new Set([
      "HOSTS", "RUNS_ON", "MONITORS", "MEMBER_OF", "ROUTES_THROUGH",
      "DEPENDS_ON", "LISTENS_ON", "CARRIED_BY", "CONNECTS_TO", "PEER_OF",
    ]),
    nodeTypesShown: new Set(["InfraCI", "DigitalProduct"]),
    rootDetection: "focus",
    description: "What breaks if this node fails? Radial blast radius from selected node.",
  },
  "dependency-audit": {
    name: "dependency-audit",
    label: "Dependency Audit",
    layout: "swimlane",
    direction: "TB",
    edgesShown: new Set(["DEPENDS_ON", "HOSTS", "RUNS_ON", "LISTENS_ON", "MEMBER_OF", "ROUTES_THROUGH"]),
    nodeTypesShown: new Set(["InfraCI", "DigitalProduct"]),
    rootDetection: "product",
    description: "Full-stack dependency view grouped by OSI layer",
  },
  "exploration": {
    name: "exploration",
    label: "Exploration",
    layout: "force",
    edgesShown: new Set([
      "BELONGS_TO", "CLASSIFIED_AS", "PARENT_OF", "DEPENDS_ON",
      "HOSTS", "MEMBER_OF", "ROUTES_THROUGH", "RUNS_ON", "MONITORS", "PEER_OF",
    ]),
    nodeTypesShown: new Set(["Portfolio", "TaxonomyNode", "DigitalProduct", "InfraCI"]),
    rootDetection: "none",
    description: "Force-directed freeform exploration of all entities",
  },
};

/** Map taxonomy nodeId patterns to views, most specific first. */
const TAXONOMY_VIEW_RULES: Array<{ pattern: string; view: GraphViewName }> = [
  { pattern: "network_management", view: "network-topology" },
  { pattern: "container_platform", view: "hosting-stack" },
  { pattern: "servers", view: "hosting-stack" },
  { pattern: "compute", view: "hosting-stack" },
  { pattern: "observability_platform", view: "exploration" },
  { pattern: "platform_services", view: "hosting-stack" },
];

export function resolveViewForTaxonomy(nodeId: string | null): GraphViewName {
  if (!nodeId) return "exploration";
  for (const rule of TAXONOMY_VIEW_RULES) {
    if (nodeId.includes(rule.pattern)) return rule.view;
  }
  return "exploration";
}

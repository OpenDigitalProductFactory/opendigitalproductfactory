// Detect Configuration Items that originate from Docker discovery so the
// Infrastructure Topology view can suppress them by default. Docker
// produces dense, repetitive noise (one subnet per compose network, one
// gateway per network, one container per service) that drowns out the
// real LAN. Users running the view from the outside-the-platform
// perspective almost never want to see it; users debugging the platform
// itself can opt in via the toggle in TopologyGraph.
//
// Detection is purely client-side and pattern-based — Docker-origin
// metadata isn't projected to Neo4j InfraCI properties yet, so we rely
// on the naming and ciType conventions established in
// `packages/db/src/discovery-collectors/docker.ts`:
//
//   - Subnets:   itemType "subnet"  + name "Docker: <network> (<cidr>)"
//   - Gateways:  itemType "gateway" + name "Docker GW <network> (<ip>)"
//   - Containers: itemType "container" → ciType "container"
//   - Docker host/runtime CIs from the same collector
//
// If Docker discovery adds new shapes in the future, extend this helper
// and the corresponding test — every other call site reads through here.

import type { GraphData } from "@/lib/actions/graph";

type RawNode = GraphData["nodes"][number];

const DOCKER_NAME_PREFIXES = ["Docker:", "Docker GW "];
const DOCKER_CI_TYPES = new Set(["container", "docker_runtime", "docker_host"]);

export function isDockerOriginNode(node: RawNode): boolean {
  const ciType = (node as Record<string, unknown>).ciType;
  if (typeof ciType === "string" && DOCKER_CI_TYPES.has(ciType)) {
    return true;
  }

  const name = node.name;
  if (typeof name === "string") {
    for (const prefix of DOCKER_NAME_PREFIXES) {
      if (name.startsWith(prefix)) return true;
    }
  }

  return false;
}

export function stripDockerOrigin(graph: GraphData): GraphData {
  const dockerNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (isDockerOriginNode(node)) dockerNodeIds.add(node.id);
  }

  if (dockerNodeIds.size === 0) return graph;

  const nodes = graph.nodes.filter((node) => !dockerNodeIds.has(node.id));
  const links = graph.links.filter(
    (link) => !dockerNodeIds.has(link.source) && !dockerNodeIds.has(link.target),
  );
  return { nodes, links };
}

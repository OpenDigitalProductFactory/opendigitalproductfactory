// Detect Configuration Items that originate from Docker discovery so the
// Infrastructure Topology view can suppress them by default. Docker
// produces dense, repetitive noise (one subnet per compose network, one
// gateway per network, one container per service) that drowns out the
// real LAN. Users running the view from the outside-the-platform
// perspective almost never want to see it; users debugging the platform
// itself can opt in via the toggle in TopologyGraph.
//
// Detection is purely pattern-based — Docker-origin metadata isn't
// projected to Neo4j InfraCI properties yet, so we rely on the naming +
// ciType + entityKey conventions established by
// `packages/db/src/discovery-collectors/docker.ts` and the edge-node
// ARP collector:
//
//   - Subnets:    itemType "subnet"  + name "Docker: <network> (<cidr>)"
//   - Gateways:   itemType "gateway" + name "Docker GW <network> (<ip>)"
//   - Containers: itemType "container" → ciType "container"
//   - Docker host/runtime CIs from the same collector
//   - 12-hex-char hostnames the kernel sees from container ARP (Docker
//     auto-assigns containers a /etc/hostname of the truncated container
//     ID — never a real OS hostname).
//   - 172.16.0.0/12 IPs the edge node's ARP cache picks up from
//     Docker bridge networks.
//   - Docker Desktop's vpnkit gateway at 192.168.65.1 / .2 / .3.
//
// If Docker discovery adds new shapes in the future, extend this helper
// and the corresponding test — every other call site reads through here.

import type { GraphData } from "@/lib/actions/graph";

type RawNode = GraphData["nodes"][number];

const DOCKER_NAME_PREFIXES = ["Docker:", "Docker GW "];
const DOCKER_CI_TYPES = new Set(["container", "docker_runtime", "docker_host"]);

/** Matches a 12-hex-char string with nothing else — Docker's default container hostname. */
const DOCKER_CONTAINER_HOSTNAME_RE = /^[0-9a-f]{12}$/;

/**
 * Returns true for IPv4 strings inside 172.16.0.0/12 — Docker's default
 * bridge-network range. We deliberately don't try to catch user-defined
 * Docker networks outside this range; those need explicit subnet markers.
 */
function isDocker172BridgeIp(value: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(value);
  if (!m) return false;
  const o1 = Number(m[1]);
  const o2 = Number(m[2]);
  return o1 === 172 && o2 >= 16 && o2 <= 31;
}

/**
 * Docker Desktop's vpnkit on macOS/Windows assigns its host gateway in
 * 192.168.65.0/24. Tiny fixed range — safe to enumerate the 3 IPs we've
 * actually seen rather than treating the whole /24 as Docker (so user
 * LANs that happen to use 192.168.65.x are unaffected if anyone ever
 * does that).
 */
const DOCKER_DESKTOP_VPNKIT_IPS = new Set([
  "192.168.65.1",
  "192.168.65.2",
  "192.168.65.3",
]);

/**
 * Patterns matched against the literal name on a graph node OR an
 * inventory entity. Kept narrow on purpose: a true positive here hides
 * the node from the default topology view, so false positives would
 * actively damage operator visibility.
 */
function nameLooksDockerOrigin(name: string): boolean {
  for (const prefix of DOCKER_NAME_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  if (DOCKER_CONTAINER_HOSTNAME_RE.test(name)) return true;
  if (name.startsWith("LAN Host ")) {
    const ip = name.slice("LAN Host ".length);
    if (isDocker172BridgeIp(ip) || DOCKER_DESKTOP_VPNKIT_IPS.has(ip)) return true;
  }
  return false;
}

export function isDockerOriginNode(node: RawNode): boolean {
  const ciType = (node as Record<string, unknown>).ciType;
  if (typeof ciType === "string" && DOCKER_CI_TYPES.has(ciType)) {
    return true;
  }

  const name = node.name;
  if (typeof name === "string" && nameLooksDockerOrigin(name)) {
    return true;
  }

  return false;
}

/**
 * Server-side variant for InventoryEntity rows where we have an
 * `entityKey` instead of a graph node. Used to suppress quality-issue
 * generation (lifecycle_unverified, stale_entity, etc.) on Docker-origin
 * entities — they're not real estate to manage.
 *
 * Keep the entity-key heuristics aligned with the edge-node ARP
 * collector + docker discovery collector — both produce the keys this
 * function returns true for.
 */
export function isDockerOriginEntityKey(entityKey: string, name?: string | null): boolean {
  // Docker discovery collector key shapes.
  if (entityKey.startsWith("subnet:docker-")) return true;
  if (entityKey.startsWith("gateway:docker-gw:")) return true;
  if (entityKey.startsWith("container:")) return true;
  if (entityKey.startsWith("runtime:docker")) return true;
  if (entityKey.startsWith("docker_host:")) return true;

  // ARP-discovered container hostnames + bridge IPs land under the host
  // entityType with these key shapes.
  const m = /^host:hostname:([^:]+)$/.exec(entityKey);
  if (m && m[1] && DOCKER_CONTAINER_HOSTNAME_RE.test(m[1])) return true;

  const arpMatch = /^host:arp:([^:]+)$/.exec(entityKey);
  if (arpMatch && arpMatch[1]) {
    if (isDocker172BridgeIp(arpMatch[1])) return true;
    if (DOCKER_DESKTOP_VPNKIT_IPS.has(arpMatch[1])) return true;
  }

  if (name && nameLooksDockerOrigin(name)) return true;

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

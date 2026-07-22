// docker-origin.ts
//
// Server-side detector for InventoryEntity rows that originate from
// Docker discovery. Mirrors the client-side helper at
// `apps/web/lib/graph/docker-filter.ts` — keep the heuristics aligned
// so the topology view and quality-issue layer suppress the same set.
//
// Why this exists: Docker auto-assigns each container a 12-hex-char
// hostname and a 172.16.0.0/12 bridge IP. The discovery pipeline picks
// these up via ARP and surfaces them as `host` entities, but they are
// not real estate to manage — the operator can't update their support
// lifecycle, attribute them to a portfolio, or do anything useful with
// them. Generating quality issues for them just buries the real signal.

/** Matches Docker's default container hostname pattern. */
const DOCKER_CONTAINER_HOSTNAME_RE = /^[0-9a-f]{12}$/;

const DOCKER_DESKTOP_VPNKIT_IPS = new Set([
  "192.168.65.1",
  "192.168.65.2",
  "192.168.65.3",
]);

function isDocker172BridgeIp(value: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(value);
  if (!m) return false;
  const o1 = Number(m[1]);
  const o2 = Number(m[2]);
  return o1 === 172 && o2 >= 16 && o2 <= 31;
}

function nameLooksDockerOrigin(name: string): boolean {
  if (name.startsWith("Docker:") || name.startsWith("Docker GW ")) return true;
  if (DOCKER_CONTAINER_HOSTNAME_RE.test(name)) return true;
  if (name.startsWith("LAN Host ")) {
    const ip = name.slice("LAN Host ".length);
    if (isDocker172BridgeIp(ip) || DOCKER_DESKTOP_VPNKIT_IPS.has(ip)) return true;
  }
  return false;
}

/**
 * Returns true when the given InventoryEntity entityKey (and optional
 * `name`) clearly originates from Docker discovery. Conservative on
 * purpose — a true positive here suppresses quality issues, so false
 * positives would hide real operator workload.
 */
export function isDockerOriginEntityKey(
  entityKey: string,
  name?: string | null,
): boolean {
  if (entityKey.startsWith("subnet:docker-")) return true;
  if (entityKey.startsWith("gateway:docker-gw:")) return true;
  if (entityKey.startsWith("container:")) return true;
  if (entityKey.startsWith("runtime:docker")) return true;
  if (entityKey.startsWith("docker_host:")) return true;

  const hostnameMatch = /^host:hostname:([^:]+)$/.exec(entityKey);
  if (hostnameMatch && hostnameMatch[1] && DOCKER_CONTAINER_HOSTNAME_RE.test(hostnameMatch[1])) {
    return true;
  }

  const arpMatch = /^host:arp:([^:]+)$/.exec(entityKey);
  if (arpMatch && arpMatch[1]) {
    if (isDocker172BridgeIp(arpMatch[1])) return true;
    if (DOCKER_DESKTOP_VPNKIT_IPS.has(arpMatch[1])) return true;
  }

  // Docker's 172.16/12 bridge address also appears in key shapes the specific
  // matches above don't cover — e.g. the self-scan's bridge NIC rows
  // `network_interface:iface:eth0:172.18.0.14` (and their `__dpf_quarantined__…`
  // wrappers), which otherwise leak past this guard and open a permanent
  // stale_entity issue per orphan. The operator's real LAN is 192.168/10, so a
  // 172.16/12 address anywhere in the key is a reliable Docker-bridge signal.
  // (DOCKER_BRIDGE_IP_RE is declared below for isDockerOriginRelationshipKey;
  // the reference resolves at call time.)
  if (DOCKER_BRIDGE_IP_RE.test(entityKey)) return true;

  if (name && nameLooksDockerOrigin(name)) return true;

  return false;
}

// InventoryRelationship keys embed both endpoint entity keys, so a relationship
// between two ephemeral Docker objects carries the same container / bridge-network
// / runtime tokens its endpoints do:
//   dpf_bootstrap:MEMBER_OF:container:94d70233->docker-net:dpf_default
//   dpf_bootstrap:hosts:docker_runtime:/var/run/docker.sock->container:bd02d3f0
//   dpf_bootstrap:monitors:container:07c16aa1->container:ff075a38
// These are platform-internal Docker topology, not operator estate. Docker
// auto-assigns each container a fresh 12-hex id on every recreation (restart,
// rebuild, self-upgrade), so the old relationshipKey is never observed again and
// is marked `stale` forever — one permanently-open stale_relationship quality
// issue per orphan. The entity loop already skips isDockerOriginEntityKey rows
// for exactly this reason; relationships had no equivalent guard, so the
// self-scan accumulated 1.5k+ open stale_relationship rows that buried the real
// signal. A token scan over the whole key is used rather than
// endpoint parsing because the source/relationshipType prefix carries a variable
// number of colons (e.g. `organization:internal:edge_node:...`), which makes
// splitting the fromKey out ambiguous; the tokens below never appear in
// real-estate keys (UniFi/arp LAN devices), so the scan stays conservative.
const DOCKER_RELATIONSHIP_TOKENS: readonly string[] = [
  "docker-net:",
  "docker_runtime:",
  "docker_host:",
  "subnet:docker-",
  "gateway:docker-gw:",
  "/var/run/docker.sock",
  "runtime:docker",
];

// A `container:` endpoint on either side of the `->` arrow (or at key start).
// Mirrors isDockerOriginEntityKey's unconditional `container:` prefix rule.
const DOCKER_CONTAINER_ENDPOINT_RE = /(?:^|[:>])container:/;

// Docker's default bridge network is 172.16.0.0/12. The self-scan also emits
// bridge-topology relationships whose endpoints are the bridge hosts and the
// bridge subnet rather than `container:` rows, e.g.
//   dpf_bootstrap:MEMBER_OF:arp-host:172.18.0.10->subnet:172.18.0.0/16
// isDockerOriginEntityKey already treats a 172.16/12 address as Docker; match
// the same range anywhere in the key. The operator's real LAN is 192.168/10, so
// this never matches real-estate keys (organization:...arp:192.168.x->unifi:mac).
const DOCKER_BRIDGE_IP_RE = /(?:^|[^0-9.])172\.(?:1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}/;

/**
 * Returns true when a relationshipKey clearly describes Docker-internal
 * topology (a container / bridge-network / docker-runtime relationship, or a
 * relationship over the Docker 172.16/12 bridge network). Conservative on
 * purpose — a true positive suppresses a stale_relationship quality issue, so a
 * false positive would hide a real, actionable one. Real-estate relationship
 * keys (`organization:...arp:192.168.x->unifi:mac`) match none of these and
 * correctly return false.
 */
export function isDockerOriginRelationshipKey(relationshipKey: string): boolean {
  if (DOCKER_CONTAINER_ENDPOINT_RE.test(relationshipKey)) return true;
  if (DOCKER_BRIDGE_IP_RE.test(relationshipKey)) return true;
  return DOCKER_RELATIONSHIP_TOKENS.some((token) => relationshipKey.includes(token));
}

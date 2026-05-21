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

  if (name && nameLooksDockerOrigin(name)) return true;

  return false;
}

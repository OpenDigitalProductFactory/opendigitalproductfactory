# Network Topology & Docker Host Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Discover the Docker host system (Windows 11) and local network topology (L3/L4) so the infrastructure graph includes the machine running the platform, its network interfaces, subnets, gateways, and LAN neighbors.

**Architecture:** Extends the existing discovery pipeline (`discovery-collectors` → `discovery-normalize` → `discovery-sync` → `neo4j-sync`) with two new capabilities: (1) a `network` collector that discovers interfaces, subnets, gateways, and ARP neighbors cross-platform, and (2) enhanced Docker collector that discovers the host OS via `docker info`. The key infrastructure gap is that `syncInventoryRelationship` maps all relationships to `DEPENDS_ON` — this must be extended to emit typed Neo4j edges (`HOSTS`, `RUNS_ON`, `MEMBER_OF`, `MONITORS`) for the relationship types defined in `NETWORK_RELATIONSHIP_TYPES`.

**Tech Stack:** TypeScript, Node.js `os`/`child_process`, Docker CLI, Prisma, Neo4j Cypher, Grafana JSON dashboards

**Spec:** `docs/superpowers/specs/2026-04-02-multi-layer-topology-graph-design.md` (EP-GRAPH-TOPO-001 Phase 2)

---

### Task 1: Extend `syncInventoryRelationship` for Typed Neo4j Edges

**Problem:** `syncInventoryRelationship` in `neo4j-sync.ts:304-316` always creates a `DEPENDS_ON` edge with the relationship type stored as a `role` property. The network relationship types defined in `NETWORK_RELATIONSHIP_TYPES` (`HOSTS`, `RUNS_ON`, `LISTENS_ON`, `MEMBER_OF`, `ROUTES_THROUGH`, `MONITORS`) should be their own Neo4j edge types for Cypher traversal to work correctly.

**Files:**
- Modify: `packages/db/src/neo4j-sync.ts:304-316`
- Test: `packages/db/src/neo4j-sync.test.ts`

- [ ] **Step 1: Write failing test** — In `neo4j-sync.test.ts`, add a test that calls `syncInventoryRelationship` with `relationshipType: "hosts"` and verifies it creates a `HOSTS` edge (not `DEPENDS_ON`). Use a mock `runCypher` to capture the Cypher statement.
- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @dpf/db exec vitest run neo4j-sync.test.ts`
- [ ] **Step 3: Implement** — Modify `syncInventoryRelationship` to check if `relationshipType.toUpperCase()` is in `NETWORK_RELATIONSHIP_TYPES` or is `"MONITORS"`. If so, emit a typed edge via `MERGE (from)-[r:HOSTS]->(to)`. Otherwise, fall back to `syncDependsOn` (existing behavior). Use a parameterized Cypher pattern.

```typescript
// In neo4j-sync.ts — replace the existing syncInventoryRelationship

const TYPED_EDGE_RELATIONSHIP_TYPES = new Set([
  ...NETWORK_RELATIONSHIP_TYPES.map((t) => t.toUpperCase()),
  "MONITORS",
]);

export async function syncInventoryRelationship(rel: {
  fromEntityKey: string;
  toEntityKey: string;
  relationshipType: string;
}): Promise<void> {
  const neoType = rel.relationshipType.toUpperCase();

  if (TYPED_EDGE_RELATIONSHIP_TYPES.has(neoType)) {
    // Emit typed Neo4j edge for network/monitoring relationships
    await runCypher(
      `MATCH (from:InfraCI {ciId: $fromId})
       MATCH (to:InfraCI {ciId: $toId})
       MERGE (from)-[r:${neoType}]->(to)
       SET r.syncedAt = datetime()`,
      { fromId: rel.fromEntityKey, toId: rel.toEntityKey },
    );
    return;
  }

  // Fall back to DEPENDS_ON for everything else
  await syncDependsOn({
    fromLabel: "InfraCI",
    fromId: rel.fromEntityKey,
    toLabel: "InfraCI",
    toId: rel.toEntityKey,
    role: rel.relationshipType,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit** — `feat(discovery): typed Neo4j edges for network relationships`

---

### Task 2: Create Network Collector

**Problem:** No discovery collector examines the system's network interfaces, subnets, gateways, or ARP neighbors. The host collector (`host.ts`) stores `os.networkInterfaces()` as a blob attribute on the host entity but never emits separate items for each interface, subnet, or gateway.

**Files:**
- Create: `packages/db/src/discovery-collectors/network.ts`
- Test: `packages/db/src/discovery-collectors/network.test.ts`

#### Subtask 2a: Network interface + subnet discovery

- [ ] **Step 1: Write failing test** — Test that `collectNetworkDiscovery()` returns items for each non-internal network interface as `network_interface` (osiLayer=3) and derives a `subnet` item from each interface's address + netmask. Mock `os.networkInterfaces()` to return a known set of interfaces.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement** — New file `network.ts`:

```typescript
import os from "node:os";
import { spawnSync } from "node:child_process";
import type { CollectorContext, CollectorOutput } from "../discovery-types";

type NetworkDeps = {
  networkInterfaces: typeof os.networkInterfaces;
  execCommand: (cmd: string, args: string[]) => string;
};

function defaultExecCommand(cmd: string, args: string[]): string {
  const result = spawnSync(cmd, args, { encoding: "utf8", timeout: 5_000 });
  return result.status === 0 ? result.stdout : "";
}

const defaultDeps: NetworkDeps = {
  networkInterfaces: os.networkInterfaces,
  execCommand: defaultExecCommand,
};

function cidrFromNetmask(netmask: string): number {
  return netmask
    .split(".")
    .reduce((bits, octet) => bits + (Number(octet) >>> 0).toString(2).replace(/0/g, "").length, 0);
}

function subnetAddress(address: string, netmask: string): string {
  const addrParts = address.split(".").map(Number);
  const maskParts = netmask.split(".").map(Number);
  return addrParts.map((a, i) => (a & maskParts[i])).join(".");
}

export async function collectNetworkDiscovery(
  ctx?: CollectorContext,
  deps: NetworkDeps = defaultDeps,
): Promise<CollectorOutput> {
  const source = ctx?.sourceKind ?? "network";
  const items: CollectorOutput["items"] = [];
  const relationships: CollectorOutput["relationships"] = [];
  const warnings: string[] = [];
  const seenSubnets = new Set<string>();

  // ── Network Interfaces (L3) ────────────────────────────────
  const ifaces = deps.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal) continue;
      if (addr.family !== "IPv4") continue; // Start with IPv4

      const ifaceRef = `net-iface:${name}:${addr.address}`;
      items.push({
        sourceKind: source,
        itemType: "network_interface",
        name: `${name} (${addr.address})`,
        externalRef: ifaceRef,
        naturalKey: `iface:${name}:${addr.address}`,
        confidence: 0.95,
        attributes: {
          interfaceName: name,
          address: addr.address,
          netmask: addr.netmask,
          mac: addr.mac,
          family: addr.family,
          osiLayer: 3,
          osiLayerName: "network",
          networkAddress: addr.address,
          protocolFamily: "ipv4",
        },
      });

      // Derive subnet
      const network = subnetAddress(addr.address, addr.netmask);
      const cidr = cidrFromNetmask(addr.netmask);
      const subnetKey = `${network}/${cidr}`;
      if (!seenSubnets.has(subnetKey)) {
        seenSubnets.add(subnetKey);
        const subnetRef = `subnet:${subnetKey}`;
        items.push({
          sourceKind: source,
          itemType: "subnet",
          name: subnetKey,
          externalRef: subnetRef,
          naturalKey: `subnet:${subnetKey}`,
          confidence: 0.95,
          attributes: {
            network,
            cidr,
            netmask: addr.netmask,
            osiLayer: 3,
            osiLayerName: "network",
            networkAddress: subnetKey,
            protocolFamily: "ipv4",
          },
        });

        // Interface MEMBER_OF subnet
        relationships.push({
          sourceKind: source,
          relationshipType: "MEMBER_OF",
          fromExternalRef: ifaceRef,
          toExternalRef: subnetRef,
          confidence: 0.95,
        });
      }
    }
  }

  // ── Default Gateway (L3) ───────────────────────────────────
  const gateway = discoverGateway(deps);
  if (gateway) {
    const gwRef = `gateway:${gateway}`;
    items.push({
      sourceKind: source,
      itemType: "gateway",
      name: `Gateway ${gateway}`,
      externalRef: gwRef,
      naturalKey: `gateway:${gateway}`,
      confidence: 0.90,
      attributes: {
        address: gateway,
        osiLayer: 3,
        osiLayerName: "network",
        networkAddress: gateway,
        protocolFamily: "ipv4",
      },
    });

    // Each subnet ROUTES_THROUGH gateway
    for (const subnetKey of seenSubnets) {
      relationships.push({
        sourceKind: source,
        relationshipType: "ROUTES_THROUGH",
        fromExternalRef: `subnet:${subnetKey}`,
        toExternalRef: gwRef,
        confidence: 0.85,
      });
    }
  }

  // ── ARP Neighbors (L3) ─────────────────────────────────────
  const neighbors = discoverArpNeighbors(deps);
  for (const neighbor of neighbors) {
    const neighborRef = `arp-host:${neighbor.ip}`;
    items.push({
      sourceKind: source,
      itemType: "host",
      name: `LAN Host ${neighbor.ip}`,
      externalRef: neighborRef,
      naturalKey: `arp:${neighbor.ip}`,
      confidence: 0.60, // Low — ARP only proves reachability
      attributes: {
        address: neighbor.ip,
        mac: neighbor.mac,
        osiLayer: 3,
        osiLayerName: "network",
        networkAddress: neighbor.ip,
        protocolFamily: "ipv4",
      },
    });

    // Find which subnet this neighbor belongs to
    for (const subnetKey of seenSubnets) {
      const [network, cidrStr] = subnetKey.split("/");
      if (isInSubnet(neighbor.ip, network, Number(cidrStr))) {
        relationships.push({
          sourceKind: source,
          relationshipType: "MEMBER_OF",
          fromExternalRef: neighborRef,
          toExternalRef: `subnet:${subnetKey}`,
          confidence: 0.60,
        });
        break;
      }
    }
  }

  if (items.length === 0) {
    warnings.push("network_no_interfaces");
  }

  return { items, relationships, warnings };
}

function isInSubnet(ip: string, network: string, cidr: number): boolean {
  const ipNum = ipToNumber(ip);
  const netNum = ipToNumber(network);
  const mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

function ipToNumber(ip: string): number {
  return ip.split(".").reduce((n, octet) => (n << 8) | Number(octet), 0) >>> 0;
}

function discoverGateway(deps: NetworkDeps): string | null {
  // Linux: ip route | grep default
  let output = deps.execCommand("ip", ["route"]);
  if (output) {
    const match = output.match(/default via (\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  }

  // Windows: route print (look for 0.0.0.0 destination)
  output = deps.execCommand("route", ["print", "0.0.0.0"]);
  if (output) {
    const match = output.match(/0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  }

  // macOS/BSD fallback: netstat -rn
  output = deps.execCommand("netstat", ["-rn"]);
  if (output) {
    const match = output.match(/default\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  }

  return null;
}

type ArpNeighbor = { ip: string; mac: string };

function discoverArpNeighbors(deps: NetworkDeps): ArpNeighbor[] {
  // Linux: ip neigh
  let output = deps.execCommand("ip", ["neigh"]);
  if (output) {
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+.*lladdr\s+([\da-fA-F:]+)/);
        return match ? { ip: match[1], mac: match[2] } : null;
      })
      .filter((n): n is ArpNeighbor => n != null);
  }

  // Windows / macOS: arp -a
  output = deps.execCommand("arp", ["-a"]);
  if (output) {
    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-fA-F:-]+)/);
        return match ? { ip: match[1], mac: match[2].replace(/-/g, ":") } : null;
      })
      .filter((n): n is ArpNeighbor => n != null)
      .filter((n) => n.mac !== "ff:ff:ff:ff:ff:ff"); // Exclude broadcast
  }

  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit** — `feat(discovery): network collector for interfaces, subnets, gateways, ARP`

---

### Task 3: Extend Docker Collector for Host System Discovery

**Problem:** The Docker collector (`docker.ts`) discovers containers but not the host machine running Docker. The Windows 11 system is invisible in the infrastructure graph.

**Files:**
- Modify: `packages/db/src/discovery-collectors/docker.ts`
- Test: `packages/db/src/discovery-collectors/docker.test.ts` (new or existing)

- [ ] **Step 1: Write failing test** — Test that `collectDockerDiscovery()` returns a `docker_host` item with host OS details and a `HOSTS` relationship from `docker_host` to `docker_runtime`.
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement** — Add `discoverDockerHost()` function that runs `docker info --format '{{json .}}'` and parses host OS, kernel, architecture, CPUs, memory. Emit a `docker_host` item with osiLayer=3. Create relationships: `docker_host` HOSTS `docker_runtime`.

Add to `DockerDeps`:
```typescript
type DockerDeps = {
  socketPaths: string[];
  existsSync: (path: string) => boolean;
  listContainers: () => Promise<Array<{ id: string; name: string; image: string }>>;
  getDockerInfo: () => DockerHostInfo | null;
};

type DockerHostInfo = {
  operatingSystem?: string;
  osType?: string;
  architecture?: string;
  kernelVersion?: string;
  cpus?: number;
  memTotal?: number;
  serverVersion?: string;
  name?: string;
};

function defaultGetDockerInfo(): DockerHostInfo | null {
  const result = spawnSync(
    "docker",
    ["info", "--format", "{{json .}}"],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    const info = JSON.parse(result.stdout) as Record<string, unknown>;
    return {
      operatingSystem: info.OperatingSystem as string | undefined,
      osType: info.OSType as string | undefined,
      architecture: info.Architecture as string | undefined,
      kernelVersion: info.KernelVersion as string | undefined,
      cpus: info.NCPU as number | undefined,
      memTotal: info.MemTotal as number | undefined,
      serverVersion: info.ServerVersion as string | undefined,
      name: info.Name as string | undefined,
    };
  } catch {
    return null;
  }
}
```

In the main `collectDockerDiscovery` function, before processing containers, call `getDockerInfo()` and emit:
```typescript
const hostInfo = deps.getDockerInfo();
if (hostInfo) {
  const hostRef = `docker-host:${hostInfo.name ?? "localhost"}`;
  items.push({
    sourceKind: source,
    itemType: "docker_host",
    name: hostInfo.name ?? "Docker Host",
    externalRef: hostRef,
    naturalKey: `docker-host:${hostInfo.name ?? "localhost"}`,
    confidence: 0.95,
    attributes: {
      operatingSystem: hostInfo.operatingSystem,
      osType: hostInfo.osType,
      architecture: hostInfo.architecture,
      kernelVersion: hostInfo.kernelVersion,
      cpus: hostInfo.cpus,
      memTotalBytes: hostInfo.memTotal,
      dockerVersion: hostInfo.serverVersion,
      osiLayer: 3,
      osiLayerName: "network",
    },
  });

  // Docker host HOSTS the Docker runtime
  relationships.push({
    sourceKind: source,
    relationshipType: "HOSTS",
    fromExternalRef: hostRef,
    toExternalRef: runtimeRef,
    confidence: 0.95,
    attributes: { mechanism: "docker_desktop" },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit** — `feat(discovery): Docker host system discovery via docker info`

---

### Task 4: Register Network Collector in Pipeline

**Files:**
- Modify: `packages/db/src/discovery-types.ts` — add `"network"` to `DiscoverySourceKind` and `CollectorName`
- Modify: `packages/db/src/discovery-collectors/index.ts` — export `collectNetworkDiscovery`
- Modify: `packages/db/src/discovery-runner.ts` — add to default collectors list
- Modify: `packages/db/src/discovery-normalize.ts:104-118` — add new item types to `mapEntityType` and `isFoundationalInfrastructure`
- Modify: `packages/db/src/neo4j-schema.ts:83-86` — add new ciTypes to OSI backfill mapping

- [ ] **Step 1: Add "network" to types** — `DiscoverySourceKind`, `CollectorName`
- [ ] **Step 2: Export from index** — Add `collectNetworkDiscovery` to barrel export
- [ ] **Step 3: Register in runner** — Add to default collectors array in `runLocalDiscoveryCollectors`
- [ ] **Step 4: Extend normalize** — Add `network_interface`, `subnet`, `gateway`, `docker_host` to `mapEntityType` (passthrough — these are already the correct entity types) and `isFoundationalInfrastructure` (all are foundational)
- [ ] **Step 5: Extend backfill mapping** — Add `subnet`, `gateway`, `network_interface` → L3 and `docker_host` → L3 to `backfillOsiLayers`
- [ ] **Step 6: Commit** — `feat(discovery): register network collector in discovery pipeline`

---

### Task 5: Tests

**Files:**
- Create: `packages/db/src/discovery-collectors/network.test.ts`
- Modify: `packages/db/src/discovery-collectors/docker.test.ts` (if exists, else create)

- [ ] **Step 1: Network collector unit tests** — Mock `os.networkInterfaces()` and `execCommand` to test: (a) interface and subnet item generation, (b) gateway discovery on Linux/Windows, (c) ARP neighbor parsing on Linux/Windows, (d) MEMBER_OF and ROUTES_THROUGH relationships, (e) empty/error scenarios
- [ ] **Step 2: Docker host discovery unit tests** — Mock `docker info` output to test: (a) docker_host item attributes, (b) HOSTS relationship to docker_runtime, (c) graceful failure when docker info unavailable
- [ ] **Step 3: Run all tests** — `pnpm --filter @dpf/db exec vitest run`
- [ ] **Step 4: Commit** — `test(discovery): network and Docker host collector tests`

---

### Task 6: Update Spec and Grafana Dashboard

**Files:**
- Modify: `docs/superpowers/specs/2026-04-02-multi-layer-topology-graph-design.md` — Update status from Draft to Phase 2 Complete
- Modify: `monitoring/grafana/dashboards/dpf-overview.json` — Add network topology panel

- [ ] **Step 1: Update spec status** — Change status to "Phase 2 Implemented" and add implementation notes
- [ ] **Step 2: Add Grafana panel** — Add a new panel to `dpf-overview.json` showing discovered network hosts count (query: `count by (job) (up)` is already there; add a "Discovered Infrastructure" stat panel using a custom metric or keep it simple with the Prometheus target count)
- [ ] **Step 3: Commit** — `docs: update EP-GRAPH-TOPO-001 status, add infra panel to Grafana`

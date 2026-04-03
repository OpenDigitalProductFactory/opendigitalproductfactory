# Multi-Layer Topology Graph: OSI-Aware Dependency Modeling

| Field | Value |
|-------|-------|
| **Epic** | EP-GRAPH-TOPO-001 |
| **IT4IT Alignment** | §5.7 Operate (impact analysis, CMDB), §5.2 Explore (dependency awareness), G252 §2.3 (Product Ontology & SBOM) |
| **Depends On** | 2026-03-14 Discovery Taxonomy Attribution (entity model), 2026-04-02 Product-Centric Navigation (product lifecycle home + Health tab), Neo4j graph sync (implemented) |
| **Status** | Phase 2 Implemented |
| **Created** | 2026-04-02 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

---

## 1. Vision

The platform's Neo4j graph currently models two layers: **products/services** (DigitalProduct, Portfolio, TaxonomyNode) and **infrastructure** (InfraCI — servers, containers, databases, services). But real dependency chains don't stop at "server" — they descend through network interfaces, VLANs, routing tables, protocols, and physical links.

**The missing dimension is the OSI model.** When a switch port goes down, the impact trace should be:

```text
L1 Physical:    Switch port 3/24 down
                    ↓ CARRIES
L2 Data Link:   VLAN 100 (production) degraded
                    ↓ ROUTES_THROUGH
L3 Network:     Subnet 10.10.100.0/24 unreachable
                    ↓ HOSTS
L3 Network:     Host 10.10.100.15 (db-primary) unreachable
                    ↓ RUNS_ON (existing InfraCI)
L4-7 Service:   PostgreSQL (port 5432) down
                    ↓ DEPENDS_ON (existing)
Application:    DPF Portal database connection failed
                    ↓ DEPENDS_ON (existing)
Product:        Digital Product Factory Portal — Health: degraded
                    ↓ SERVES (existing ServiceOffering)
Consumer:       All platform users — SLA breach
```

Today, the graph can model the top half (PostgreSQL → DPF Portal → consumers). This spec adds the bottom half (physical → data link → network) so that **network events trace all the way up to product impact**, and **product dependency audits trace all the way down to physical infrastructure**.

This has historically been a dream for IT operations — two topology layers (network and service) managed independently yet connected through a single traversable graph. The OSI model provides the principled layering that makes this possible without conflating concerns.

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **OSI layers are the organizing framework** | The 7-layer model is universally understood and provides clean separation between physical, logical, and application concerns |
| P2 | **Each layer is independently discoverable** | Network topology comes from SNMP/LLDP collectors; service topology comes from the existing inventory discovery pipeline; they don't need to discover each other |
| P3 | **Layers connect through well-defined interfaces** | A host (L3) `RUNS_ON` a subnet (L3) which `ROUTES_THROUGH` a VLAN (L2) which `CARRIED_BY` a port (L1). These connection types are standardized, not ad-hoc. |
| P4 | **Impact analysis traverses layers** | A single Cypher query can trace from L1 physical fault to L7 product impact. This is the core value proposition. |
| P5 | **Progressive population** | An org might start with only L3 (hosts/subnets) and L7 (services). L1-L2 details are added as network monitoring matures. Empty layers don't break the model. |
| P6 | **Existing InfraCI model is preserved** | Network entities are InfraCI nodes with an `osiLayer` property. No new Neo4j labels needed — the layer is a property, not a type. |

---

## 3. OSI Layer Mapping to Graph Entities

### 3.1 Entity Types by Layer

| OSI Layer | Layer Name | Entity Types | Discovery Source | Example Entities |
|-----------|-----------|--------------|------------------|------------------|
| **7** | Application | `service`, `api-endpoint`, `application` | Inventory discovery (existing) | PostgreSQL, REST API, Web App |
| **6** | Presentation | `tls-termination`, `codec` | Certificate scanning, config parsing | TLS 1.3 endpoint, SSL cert |
| **5** | Session | `session-pool`, `connection-pool` | Application metrics (Prometheus) | DB connection pool, HTTP keep-alive |
| **4** | Transport | `tcp-listener`, `udp-listener` | Port scanning, process enumeration | TCP :5432, UDP :53 |
| **3** | Network | `host`, `subnet`, `route`, `gateway` | ARP tables, routing tables, ICMP | 10.10.100.0/24, default gateway |
| **2** | Data Link | `vlan`, `switch-port`, `mac-address`, `bridge` | SNMP (LLDP/CDP), switch APIs | VLAN 100, GigE 3/24, MAC aa:bb:cc |
| **1** | Physical | `physical-port`, `cable`, `transceiver`, `patch-panel` | SNMP (IF-MIB), physical audit | Port 3/24, Cat6 patch, SFP+ 10G |

### 3.2 Relationship Types Between Layers

| Relationship | Direction | Meaning | Example |
|-------------|-----------|---------|---------|
| `RUNS_ON` | L7 → L3/L4 | Service runs on a host/transport | PostgreSQL `RUNS_ON` host 10.10.100.15 |
| `LISTENS_ON` | L7 → L4 | Service binds to transport | PostgreSQL `LISTENS_ON` tcp:5432 |
| `HOSTS` | L3 → L4/L7 | Network host provides transport/services | Host `HOSTS` tcp:5432 |
| `MEMBER_OF` | L3 → L2 | Host/subnet belongs to VLAN | Subnet 10.10.100.0/24 `MEMBER_OF` VLAN 100 |
| `ROUTES_THROUGH` | L3 → L3 | IP routing between subnets | Subnet A `ROUTES_THROUGH` gateway |
| `CARRIED_BY` | L2 → L1 | VLAN/frame carried by physical port | VLAN 100 `CARRIED_BY` port GigE 3/24 |
| `CONNECTS_TO` | L1 → L1 | Physical cable between ports | Port A `CONNECTS_TO` Port B |
| `PEER_OF` | L2 → L2 | LLDP/CDP neighbor adjacency | Switch A port 1 `PEER_OF` Switch B port 48 |
| `DEPENDS_ON` | any → any | Generic dependency (existing) | Preserved for service-level dependencies |

### 3.3 Preserved Existing Relationships

The current graph relationships remain unchanged:

| Relationship | Context | Preserved |
|-------------|---------|-----------|
| `DEPENDS_ON` | InfraCI → InfraCI | Yes — service-level dependencies |
| `BELONGS_TO` | DP/InfraCI → Portfolio | Yes — portfolio attribution |
| `CATEGORIZED_AS` | DP → TaxonomyNode | Yes — taxonomy placement |
| `EA_REPRESENTS` | EaElement → DP/Portfolio/Taxonomy | Yes — EA modeling |
| All ArchiMate relationships | EaElement → EaElement | Yes — architecture views |

---

## 4. Neo4j Schema Changes

### 4.1 InfraCI Node — Extended Properties

No new labels needed. The `InfraCI` node gets optional properties:

```typescript
interface InfraCIProperties {
  // Existing
  ciId: string;
  name: string;
  ciType: string;
  status: string;

  // New — OSI layer context
  osiLayer?: number;            // 1-7 (null for existing entities that predate this model)
  osiLayerName?: string;        // "physical" | "data_link" | "network" | "transport" | "session" | "presentation" | "application"
  networkAddress?: string;      // IP, MAC, or other layer-appropriate address
  networkMask?: string;         // Subnet mask, VLAN ID, or port identifier
  protocolFamily?: string;      // "ethernet", "tcp", "udp", "http", "tls", etc.
  parentCiId?: string;          // For quick parent lookup without traversal
}
```

### 4.2 New Relationship Types

Add to `neo4j-schema.ts`:

```typescript
export const NETWORK_RELATIONSHIP_TYPES = [
  "RUNS_ON",          // L7 → L3/L4
  "LISTENS_ON",       // L7 → L4
  "HOSTS",            // L3 → L4/L7
  "MEMBER_OF",        // L3 → L2
  "ROUTES_THROUGH",   // L3 → L3
  "CARRIED_BY",       // L2 → L1
  "CONNECTS_TO",      // L1 → L1
  "PEER_OF",          // L2 → L2 (LLDP/CDP)
] as const;
```

### 4.3 Indexes

```cypher
CREATE INDEX infra_ci_osi_layer IF NOT EXISTS FOR (n:InfraCI) ON (n.osiLayer);
CREATE INDEX infra_ci_network_address IF NOT EXISTS FOR (n:InfraCI) ON (n.networkAddress);
CREATE INDEX infra_ci_ci_type IF NOT EXISTS FOR (n:InfraCI) ON (n.ciType);
```

---

## 5. Impact Analysis Queries

### 5.1 Full-Stack Impact Trace (L1 → L7 → Product)

```cypher
// Given a failed physical port, trace impact up to products
MATCH (fault:InfraCI {ciId: $faultyCiId})
MATCH path = (fault)<-[:CARRIED_BY|MEMBER_OF|HOSTS|RUNS_ON|DEPENDS_ON*1..10]-(affected)
WHERE affected:DigitalProduct OR affected:InfraCI
RETURN affected.name AS entity,
       labels(affected)[0] AS type,
       affected.osiLayer AS layer,
       length(path) AS hops
ORDER BY length(path)
```

### 5.2 Product Dependency Audit (L7 → L1)

```cypher
// Given a product, show its full dependency stack down to physical
MATCH (dp:DigitalProduct {productId: $productId})
MATCH path = (dp)-[:DEPENDS_ON|RUNS_ON|LISTENS_ON|HOSTS|MEMBER_OF|CARRIED_BY*1..15]->(dep)
RETURN dep.name AS dependency,
       dep.ciType AS type,
       dep.osiLayer AS layer,
       dep.status AS status,
       length(path) AS depth
ORDER BY dep.osiLayer ASC, length(path)
```

### 5.3 Network Topology at a Specific Layer

```cypher
// Show all L2 entities and their interconnections
MATCH (n:InfraCI {osiLayer: 2})
OPTIONAL MATCH (n)-[r:PEER_OF|CARRIED_BY]-(m:InfraCI)
RETURN n, r, m
```

### 5.4 Cross-Layer Health Summary

```cypher
// Count entities by OSI layer and status
MATCH (n:InfraCI)
WHERE n.osiLayer IS NOT NULL
RETURN n.osiLayer AS layer,
       n.status AS status,
       count(n) AS count
ORDER BY n.osiLayer, n.status
```

---

## 6. Discovery Integration

### 6.1 Discovery Collector Types

The existing discovery pipeline runs collectors that produce `InventoryEntity` records. Network topology adds new collector types:

| Collector | OSI Layers | Protocol | What It Discovers |
|-----------|-----------|----------|-------------------|
| **SNMP Walker** | L1, L2 | SNMP v2c/v3 | Switch ports, VLANs, MAC tables, LLDP neighbors, interface status, transceivers |
| **ARP/NDP Scanner** | L2, L3 | ARP, NDP | MAC-to-IP mappings, subnet membership |
| **Route Table Reader** | L3 | SSH/API | Routing tables, gateways, static routes |
| **Port Scanner** | L4 | TCP/UDP connect | Open ports, listening services, transport endpoints |
| **Certificate Scanner** | L6 | TLS handshake | Certificate chains, expiry dates, cipher suites |
| **Process Enumerator** | L7 | SSH/Agent | Running processes, bound ports, service identities |

These collectors are **not implemented in this spec** — they are listed to show how the model supports them. The existing host/container/runtime collectors already cover L3 and L7. Network collectors are added incrementally as network monitoring matures.

### 6.2 Projection to Neo4j

The existing `syncInventoryEntityAsInfraCI()` function is extended to handle OSI-aware entities:

```typescript
// In neo4j-sync.ts — extend existing function
function mapEntityToInfraCI(entity: InventoryEntity): InfraCIProperties {
  return {
    ciId: entity.entityKey,
    name: entity.name,
    ciType: entity.entityType,
    status: mapStatus(entity.status),
    // New: OSI context from entity properties
    osiLayer: entity.properties?.osiLayer as number | undefined,
    osiLayerName: entity.properties?.osiLayerName as string | undefined,
    networkAddress: entity.properties?.networkAddress as string | undefined,
    protocolFamily: entity.properties?.protocolFamily as string | undefined,
  };
}
```

### 6.3 Relationship Discovery

Network relationships are discovered by comparing entity pairs:

```typescript
// Examples of how collectors produce relationships
// SNMP LLDP discovery:
{ from: "switch-a/port-1", to: "switch-b/port-48", type: "PEER_OF" }

// ARP table discovery:
{ from: "host-10.10.100.15", to: "vlan-100", type: "MEMBER_OF" }

// Process enumeration:
{ from: "postgresql-5432", to: "host-10.10.100.15", type: "RUNS_ON" }
```

These map to `InventoryRelationship` records, which are projected as typed Neo4j edges.

---

## 7. Integration with Product Health Tab

The product Health tab (from the nav refactoring spec) has a Section 7.4 placeholder for "Dependency Health" derived from graph traversal. This spec provides the graph model that makes it real:

```typescript
// In product Health tab — future integration
const dependencies = await getUpstreamDependencies(product.productId, "productId");

// Group by OSI layer for display
const byLayer = groupBy(dependencies, (d) => d.properties.osiLayer ?? 7);

// Show: "Network (L3): 2 healthy, 1 degraded"
//       "Service (L7): 5 healthy"
//       "Physical (L1): all healthy"
```

When a network-layer entity degrades, the Health tab shows the impact chain all the way down to the physical cause — if the graph has been populated that deep.

---

## 8. Architecture Decision: Why InfraCI, Not New Labels

**Decision**: Network entities are `InfraCI` nodes with `osiLayer` and `ciType` properties, not new Neo4j labels.

**Rationale**:
1. **Impact traversal uses a single label** — `MATCH (n:InfraCI)` queries don't need to know every possible label
2. **Existing Cypher queries work unchanged** — `DEPENDS_ON` relationships between InfraCI nodes already trace dependencies
3. **Progressive population** — an org can start with hosts (L3) and services (L7), add L2/L1 later without schema changes
4. **Property indexes are sufficient** — `osiLayer` and `ciType` indexes handle filtering by layer
5. **ArchiMate alignment** — if precise architectural modeling is needed, `EaElement` types handle that separately with the dual-label pattern

The `InfraCI` label means "infrastructure configuration item at any layer." The `osiLayer` property says which layer. The `ciType` property says what specific kind (switch-port, vlan, host, database, etc.).

---

## 9. Implementation Phases

### Phase 1: Schema Extension (No Collectors)

1. Add `osiLayer`, `osiLayerName`, `networkAddress`, `protocolFamily` properties to `syncInfraCI()` in `neo4j-sync.ts`
2. Add network relationship types to `neo4j-schema.ts`
3. Add indexes for `osiLayer` and `networkAddress`
4. Extend `mapEntityToInfraCI()` to read OSI properties from entity JSON
5. Populate `osiLayer` for existing entity types: host=3, container=7, runtime=7, database=7, service=7, network=3, ai-inference=7
6. Add `getLayeredDependencyStack()` to `neo4j-graph.ts` for product Health tab

### Phase 2: L3/L4 Discovery Enhancement

1. Extend process enumerator to emit `tcp-listener` entities with osiLayer=4
2. Extend host collector to emit `subnet` entities with osiLayer=3
3. Create `HOSTS` and `LISTENS_ON` relationships between layers
4. Verify impact traversal works across L3 → L4 → L7

### Phase 3: L2 Network Discovery (SNMP/LLDP)

1. Implement SNMP collector for switch port status and VLAN membership
2. Implement LLDP neighbor discovery for `PEER_OF` relationships
3. Create `MEMBER_OF` and `CARRIED_BY` relationships
4. Verify impact traversal works from L2 → L3 → L7

### Phase 4: L1 Physical Topology (Optional)

1. Physical port and cable tracking (manual or automated)
2. Patch panel and transceiver inventory
3. `CONNECTS_TO` relationships between physical ports
4. Full L1 → L7 impact trace

---

## 10. Out of Scope

| Item | Reason |
|------|--------|
| **Real-time network event streaming** | This spec models topology, not events. Alerting from network events is a monitoring concern (Prometheus/SNMP traps). |
| **SDN controller integration** | Software-defined networking controllers (NSX, ACI) would be a separate collector type |
| **Wireless topology** | WiFi AP/client topology is a specialized concern |
| **WAN/Internet topology** | External network paths beyond the org boundary are not modeled |
| **Protocol-level packet analysis** | Deep packet inspection is a security tool, not a topology concern |

---

## 11. Success Criteria

1. A Cypher query can trace from a physical switch port failure to every affected Digital Product in a single traversal
2. A product's Health tab can show dependency health grouped by OSI layer
3. Existing service-level dependency queries work unchanged — the network layer is additive
4. An organization can populate the graph incrementally: start with L3+L7, add L2/L1 as network monitoring matures
5. The graph model supports both network topology (switches, VLANs, subnets) and service topology (databases, APIs, products) through a unified `InfraCI` node type with `osiLayer` differentiation

---

## 12. Appendix: OSI Model Reference

| Layer | Name | PDU | Function | DPF Entity Examples |
|-------|------|-----|----------|---------------------|
| 7 | Application | Data | Application protocols (HTTP, SQL, SMTP) | PostgreSQL service, REST API, Web app |
| 6 | Presentation | Data | Encryption, compression, format translation | TLS termination, SSL cert, codec |
| 5 | Session | Data | Session establishment, management | Connection pool, session manager |
| 4 | Transport | Segment/Datagram | End-to-end transport (TCP, UDP) | TCP :5432, UDP :53, QUIC endpoint |
| 3 | Network | Packet | Routing, addressing (IP) | Host IP, subnet, gateway, route |
| 2 | Data Link | Frame | Framing, MAC addressing, VLANs | Switch port, VLAN, MAC address, bridge |
| 1 | Physical | Bit | Physical medium, signaling | Cable, transceiver, physical port, patch panel |

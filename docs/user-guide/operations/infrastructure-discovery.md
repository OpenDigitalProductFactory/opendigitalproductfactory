---
title: "Infrastructure Discovery"
area: operations
order: 3
lastUpdated: 2026-04-03
updatedBy: Claude (Software Engineer)
---

## Overview

Infrastructure Discovery automatically detects, catalogues, and maps the relationships between all infrastructure components that the platform runs on. It builds a live dependency graph that answers questions like "if this server goes down, what products are affected?" and "what does this application depend on all the way down to the network?"

Discovery runs continuously inside the portal process. No manual setup is required -- it starts automatically when the platform boots.

## How It Works

### Discovery Schedule

The discovery system operates on two timers:

- **Every 60 seconds** -- A lightweight poll of Prometheus targets detects new or disappeared services. If anything changes, a full sweep is triggered immediately.
- **Every 15 minutes** -- A full discovery sweep runs all collectors, persists results, promotes high-confidence entities to Digital Products, and infers relationships.

### Discovery Pipeline

Each sweep runs through five stages:

1. **Collection** -- Five collectors run in parallel, each examining a different data source
2. **Cross-collector inference** -- Relationships between items from different collectors are inferred (e.g., linking the Docker host to its network interfaces)
3. **Normalization and attribution** -- Raw discoveries are deduplicated, classified, and matched to taxonomy nodes
4. **Persistence** -- Entities and relationships are upserted into PostgreSQL (authority) and projected to Neo4j (graph traversal)
5. **Promotion and inference** -- High-confidence entities become Digital Products; product-to-infrastructure dependency edges are created

### What Gets Discovered

| Collector | What It Finds | Data Source |
|-----------|--------------|-------------|
| **Host** | The operating system, CPU, memory, architecture, and installed software of the machine running the portal | Node.js `os` module, system package managers |
| **Docker** | The Docker host system (OS, version, CPUs, memory), all running containers with their images, Docker networks with subnets and gateways, and container-to-network IP assignments | `docker info`, `docker ps`, `docker network inspect` |
| **Prometheus** | Every monitored service (databases, application instances, AI inference, monitoring tools) with their health status | Prometheus `/api/v1/targets` API |
| **Network** | Network interfaces, derived subnets, the default gateway, and ARP neighbors on the local network | `os.networkInterfaces()`, `ip route`/`route print`, `ip neigh`/`arp -a` |
| **Kubernetes** | Kubernetes pods, services, and deployments (when running in a Kubernetes cluster) | Kubernetes API (when available) |

### The Dependency Graph

All discovered entities are projected into Neo4j as `InfraCI` (Infrastructure Configuration Item) nodes, tagged with their OSI layer. Relationships between entities use typed edges that enable full-stack impact analysis:

```
Docker Host (Windows 11)            Layer 3 - Network
  |-- HOSTS --> Docker Runtime                Layer 7 - Application
  |     |-- HOSTS --> dpf-portal              Layer 7
  |     |-- HOSTS --> dpf-postgres            Layer 7
  |     |-- HOSTS --> dpf-neo4j               Layer 7
  |     `-- HOSTS --> (all containers)
  `-- HOSTS --> Docker Network (172.18.0.0/16)   Layer 3
        |-- ROUTES_THROUGH --> Gateway 172.18.0.1
        |-- MEMBER_OF <-- dpf-portal (172.18.0.7)
        |-- MEMBER_OF <-- dpf-postgres (172.18.0.2)
        `-- MEMBER_OF <-- dpf-neo4j (172.18.0.5)

Prometheus
  |-- MONITORS --> dpf-portal
  |-- MONITORS --> dpf-postgres
  |-- MONITORS --> qdrant
  `-- MONITORS --> model-runner

Digital Product (DPF Portal)
  `-- DEPENDS_ON --> container:dpf-portal
```

### Relationship Types

| Relationship | Direction | Meaning |
|-------------|-----------|---------|
| `HOSTS` | Parent to child | A host provides the runtime environment for a container, network, or service |
| `RUNS_ON` | Service to host | A service executes on a specific host or container |
| `MEMBER_OF` | Node to network | A container or interface belongs to a subnet or VLAN |
| `ROUTES_THROUGH` | Subnet to gateway | Network traffic from a subnet passes through a gateway |
| `MONITORS` | Observer to target | A monitoring service scrapes metrics from a target |
| `DEPENDS_ON` | Consumer to provider | A product or service requires another to function |
| `LISTENS_ON` | Service to transport | A service binds to a TCP/UDP port |
| `CARRIED_BY` | Logical to physical | A VLAN or frame is carried by a physical port |
| `CONNECTS_TO` | Port to port | A physical cable between two ports |
| `PEER_OF` | Switch to switch | LLDP/CDP neighbor adjacency |

### Impact Analysis

With the full dependency graph populated, the platform can answer:

- **"If I change the Windows host, what breaks?"** -- Traverses `HOSTS` backward from the Docker host through the runtime, to all containers, to all Digital Products that depend on those containers.
- **"If the database goes down, what products are affected?"** -- Traverses `DEPENDS_ON` backward from the PostgreSQL InfraCI to find all products.
- **"What does this product depend on, all the way down?"** -- Traverses all relationship types forward from a Digital Product through containers, Docker runtime, Docker host, networks, and gateways.
- **"What's on this subnet?"** -- Queries all `MEMBER_OF` relationships pointing to a specific network.

### Auto-Promotion

When discovery finds a high-confidence entity (confidence >= 0.90 with a taxonomy placement), it is automatically promoted to a Digital Product in the product inventory. This means infrastructure components appear in the portfolio view without manual registration.

### Relationship Inference

After each sweep, three inference passes automatically create edges that span discovery sources:

1. **Cross-collector linking** -- The Docker host is linked to network interfaces; Prometheus targets are correlated with Docker containers by matching hostnames.
2. **Promoted entity linking** -- When an InventoryEntity has been promoted to a Digital Product, a `DEPENDS_ON` edge is created from the product to its InfraCI node.
3. **Name matching** -- Products are fuzzy-matched to containers and services by normalized name similarity (e.g., "PostgreSQL Database" matches container "dpf-postgres").

## Portfolio Quality Issues

When discovery finds entities it cannot confidently attribute to a taxonomy node, they appear as quality issues on the Portfolio Quality panel. These require human review:

- **attribution_missing** -- The entity was discovered but could not be placed in the taxonomy tree. Review and assign it manually.
- **taxonomy_attribution_low_confidence** -- The system found potential taxonomy matches but none scored high enough for automatic placement. Review the candidates and confirm or reassign.

## Grafana Dashboards

The Grafana instance at port 3002 provides complementary monitoring views:

- **Platform Services** -- UP/DOWN status for all Prometheus scrape targets
- **Host CPU / Memory / Disk** -- Resource utilization of the Docker host
- **Container CPU / Memory** -- Per-container resource tracking
- **Discovered Scrape Targets** -- Table of all Prometheus targets feeding the discovery pipeline
- **Host Network I/O** -- Network traffic across physical interfaces
- **Active Alerts** -- Firing Prometheus alerts including the HostNetworkInterfaceDown rule

## OSI Layer Model

The graph organizes infrastructure entities by OSI layer. This is additive -- you can start with just L3 (hosts) and L7 (services) and add L1-L2 details as network monitoring matures.

| Layer | Name | What DPF Discovers Here |
|-------|------|------------------------|
| 7 | Application | Services, APIs, databases, application containers |
| 4 | Transport | TCP/UDP listeners (future: port scanning) |
| 3 | Network | Hosts, subnets, gateways, network interfaces, Docker host |
| 2 | Data Link | VLANs, switch ports, MAC addresses (future: SNMP/LLDP) |
| 1 | Physical | Cables, transceivers, physical ports (future: physical audit) |

Layers 1-2 are modeled in the schema but require SNMP/LLDP collectors that are not yet implemented. The current discovery covers L3 and L7 comprehensively.

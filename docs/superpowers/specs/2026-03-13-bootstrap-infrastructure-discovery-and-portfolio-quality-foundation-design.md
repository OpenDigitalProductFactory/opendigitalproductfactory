# Bootstrap Infrastructure Discovery and Portfolio Quality Foundation

**Date:** 2026-03-13  
**Status:** Draft  
**Scope:** Define the first discovery bootstrap for local platform environments and the portfolio-quality model that governs how discovered infrastructure, runtime, and digital-product dependencies are attributed and maintained.

---

## Overview

DPF needs to populate its operational graph and foundational infrastructure inventory by default when the platform is installed. The first discovery slice should automatically inspect the environment where DPF itself is running, normalize what it finds, and project the result into inventory, graph, taxonomy, and portfolio views.

This is not a classic CMDB-first design. The discovery model must support the broader DPF semantics of digital products, provider commitments, and the four portfolio views described in the Digital Product Portfolio Management framing. Discovered infrastructure is not only an operations record. It is provider-side context for the digital products and commitments supported by that infrastructure.

The first slice is intentionally limited to the local platform environment:

- physical host or VM where DPF is installed
- Docker runtime, first priority
- Kubernetes runtime when present
- local platform dependencies such as Postgres and Neo4j

Remote customer network discovery, enterprise topology discovery, and multi-source reconciliation are explicitly deferred.

Implementation slice 1 persistence models:

- `DiscoveryRun`
- `DiscoveredItem`
- `DiscoveredRelationship`
- `InventoryEntity`
- `InventoryRelationship`
- `PortfolioQualityIssue`

Implementation status:

- slice 1 delivered: local bootstrap discovery, normalized inventory, foundational attribution, graph projection, quality issue surfacing
- deferred: remote customer discovery, topology expansion, external discovery connectors, full reconciliation

---

## Implementation Status Target

Initial slice should deliver:

- automatic bootstrap discovery after install/startup
- local host, Docker, and Kubernetes inspection
- normalized inventory entities and relationships
- operational graph projection
- default attribution of discovered infrastructure into the `Foundational` portfolio
- taxonomy and digital-product attribution states
- quality signals for uncertain, missing, stale, and unmapped discovered objects

Deferred:

- remote LAN/device discovery
- full topology discovery across customer estates
- multi-source discovery authority management
- enterprise-grade identification and reconciliation engine
- event-driven discovery updates

---

## Approved Working Assumptions

From the current conversation:

- bootstrap discovery should run by default after installation/startup
- the initial target is only the environment where DPF is installed
- supported deployment contexts should include physical machine or VM, Docker-first, and Kubernetes when present
- installer/platform credentials may be available; discovery should use them when useful, but fail gracefully or request more credentials when needed
- DPF should avoid throwaway implementation even in slice 1
- infrastructure discovered in bootstrap must show in the `Foundational` portfolio
- taxonomy linkage matters as much as raw discovery because digital products and portfolio commitments must be traceable to providers
- uncertain or missing attribution is still useful and should surface as a quality issue rather than being silently ignored

---

## Design Goals

1. Populate the foundational inventory and graph by default on a fresh DPF install.
2. Discover local infrastructure and runtime context without requiring an external discovery suite.
3. Align discovered assets to DPF taxonomy and portfolio semantics, not only traditional CMDB classes.
4. Make repeated discovery runs idempotent from the same trusted DPF source.
5. Surface attribution gaps, stale assets, and missing observations as portfolio-quality issues.
6. Preserve a clean path to future remote discovery, agent-based discovery, event management, and broader topology mapping.

---

## Non-Goals

This slice does not implement:

- enterprise multi-source reconciliation policy
- probe farms or MID-server style distributed discovery
- customer network-wide scans
- SNMP, WMI, SSH, or credential-driven remote topology collection beyond the local platform environment
- full service mapping
- event correlation or full event management
- commercial CMDB class-model parity

---

## Reference Patterns

### ServiceNow

Useful ideas to borrow:

- discovery separated from downstream CMDB updates
- identification and reconciliation concepts for later maturity
- service/provider context built on top of infrastructure facts

Do not copy wholesale:

- heavy CMDB-first class rigidity
- early investment in enterprise reconciliation machinery before DPF has multiple authoritative sources

### OpenText Universal Discovery / UCMDB

Useful ideas to borrow:

- explicit discovery job/run model
- topology-oriented relationship capture
- later extension path toward event-based discovery and deeper runtime mapping

Do not copy wholesale:

- large-enterprise probe architecture as a prerequisite
- heavyweight deployment assumptions for SMB and bootstrap use cases

### OSS references

Useful patterns from current open source:

- GLPI and OCS Inventory NG for install-time and agent-based inventory patterns
- Netdisco and LibreNMS for topology and relationship thinking
- Fleet/osquery for long-term host and endpoint fact collection

DPF should not depend on these tools for slice 1. They are reference patterns and possible future connectors.

---

## Core Design Decision

DPF should implement a native bootstrap discovery pipeline with:

- one built-in discovery source: the local DPF platform environment
- one run history model
- one normalized inventory layer
- one graph projection layer
- one quality/attribution state model

Slice 1 should **not** implement a full identification and reconciliation engine. Instead it should use deterministic identity keys and idempotent refresh logic for repeated local scans from the same trusted source.

This is the right long-term investment boundary:

- enough structure to keep
- not so much enterprise machinery that the bootstrap slice becomes overbuilt

---

## Discovery Architecture

### Pipeline

1. DPF starts or finishes installation.
2. A bootstrap discovery job is scheduled and executed automatically.
3. Collectors inspect the local environment.
4. Collected facts are written into lightweight discovered-item and discovered-relationship records.
5. Normalization maps those discovered records into stable inventory entities and inventory relationships.
6. Inventory is projected into the operational graph.
7. Attribution and quality states are evaluated and surfaced to provider-side portfolio views.

### Why not write directly to the graph

Direct graph writes are too disposable. DPF needs enough intermediate structure to:

- rerun discovery safely
- understand what was seen in a given run
- compare current and previous visibility
- mark stale or missing assets without deleting history
- improve attribution over time

### Why not build full reconciliation yet

DPF currently has one trusted built-in discovery source in this slice. A full multi-source reconciliation engine would be premature. The simpler model is:

- deterministic identity per discovered object
- idempotent update from repeated local runs
- confidence and provenance metadata
- future extension point for richer identification rules

---

## Proposed Data Model

### `discovery_run`

Tracks execution of each bootstrap discovery pass.

Suggested fields:

- `id`
- `runId`
- `runType` (`bootstrap`, later `scheduled`, `manual`)
- `status`
- `startedAt`
- `finishedAt`
- `environmentType` (`host`, `docker`, `kubernetes`, mixed)
- `summaryJson`
- `errorJson`

Purpose:

- audit what happened
- compare runs over time
- support stale/missing logic

### `discovered_item`

Lightweight evidence record for what a run observed.

Suggested fields:

- `id`
- `discoveredKey` (deterministic local identity key)
- `discoveryRunId`
- `itemType`
- `name`
- `externalRef`
- `attributesJson`
- `confidence`
- `sourceKind` (`dpf_bootstrap`)
- `firstSeenAt`
- `lastSeenAt`
- `inventoryEntityId` nullable

Purpose:

- keep per-run evidence
- support comparison between runs
- avoid losing visibility into what was actually observed

### `discovered_relationship`

Observed relation between discovered items.

Suggested fields:

- `id`
- `discoveryRunId`
- `fromDiscoveredItemId`
- `toDiscoveredItemId`
- `relationshipType`
- `attributesJson`
- `confidence`

Purpose:

- preserve observed runtime and topology facts before or alongside graph projection

### `inventory_entity`

Normalized provider-facing infrastructure/runtime record.

Suggested fields:

- `id`
- `entityKey`
- `entityType`
- `name`
- `status`
- `sourceOfTruth` (`bootstrap_discovery`)
- `firstSeenAt`
- `lastSeenAt`
- `lastConfirmedRunId`
- `portfolioId`
- `taxonomyNodeId`
- `digitalProductId` nullable
- `attributionStatus`
- `qualityStatus`
- `attributesJson`

Purpose:

- stable inventory entity for provider-side operations and portfolio views

### `inventory_relationship`

Normalized relation between inventory entities.

Suggested fields:

- `id`
- `fromInventoryEntityId`
- `toInventoryEntityId`
- `relationshipType`
- `status`
- `firstSeenAt`
- `lastSeenAt`
- `lastConfirmedRunId`
- `attributesJson`

Purpose:

- graph-friendly normalized relationship layer

### `portfolio_quality_issue`

Quality issue raised by discovery and attribution evaluation.

Suggested fields:

- `id`
- `issueKey`
- `issueType`
- `severity`
- `status`
- `inventoryEntityId` nullable
- `inventoryRelationshipId` nullable
- `portfolioId`
- `taxonomyNodeId` nullable
- `digitalProductId` nullable
- `detectedAt`
- `lastObservedAt`
- `detailsJson`

Purpose:

- make quality visible and actionable in portfolio semantics

---

## Initial Bootstrap Collectors

### Host collector

Should capture:

- hostname
- OS family and version
- kernel/runtime version
- CPU and memory summary
- disks/filesystems
- network interfaces
- local IP addresses
- local platform process/service evidence where detectable

### Docker collector

First-priority runtime collector.

Should capture:

- Docker daemon presence and version
- containers
- images
- volumes
- Docker networks
- published ports
- host bindings
- container-to-network membership
- labels and container names useful for DPF attribution

### Kubernetes collector

Enabled when cluster access is available.

Should capture:

- cluster identity where visible
- nodes
- namespaces
- pods
- services
- deployments or stateful workloads
- ingress where visible
- persistent volumes and claims where visible

### DPF dependency detector

Should identify known platform dependencies such as:

- DPF web/runtime services
- Postgres
- Neo4j
- local supporting services or storage components when identifiable

---

## Relationship Model

Initial normalized relationship types should include:

- `runs_on`
- `hosts`
- `depends_on`
- `stores_data_in`
- `connected_to_network`
- `exposed_via`
- `member_of_runtime`
- `backed_by_storage`

These are intentionally broader than classic CI dependency semantics because DPF’s graph must support provider-side digital-product reasoning, not only infrastructure operations.

---

## Portfolio and Taxonomy Semantics

### Foundational portfolio default

Discovered infrastructure from bootstrap should default into the `Foundational` portfolio unless a more specific provider-side assignment is known with confidence.

This includes:

- host infrastructure
- runtime infrastructure
- platform data stores
- local platform support services

Reason:

- provider-side owners and managers need to manage the platform foundation from the portfolio view
- the foundational portfolio is the natural home for local platform infrastructure that enables downstream digital products

### Taxonomy attribution

Discovery is not complete until taxonomy relevance is known or explicitly unresolved.

For slice 1:

- known DPF platform components may be automatically mapped to known taxonomy nodes
- uncertain matches should not be silently assigned
- uncertain matches should create quality issues and reviewable attribution states

### Digital product attribution

Where a discovered runtime or dependency clearly supports a known digital product, DPF should allow linkage to that digital product. In slice 1, only confident deterministic matches should be auto-linked. Everything else should remain reviewable.

---

## Attribution and Quality Model

### Attribution statuses

Initial statuses:

- `attributed`
- `needs_review`
- `unmapped`
- `stale`

### Quality semantics

Discovery should support quality management across the lifecycle, not only first-time population.

Examples:

- item discovered with no taxonomy attribution
- item discovered with no digital-product linkage where one should exist
- item present in previous runs but absent in the latest run
- relationship previously observed but now missing
- foundational asset with incomplete provider metadata

### Freshness semantics

Every normalized entity and relationship should track:

- `firstSeenAt`
- `lastSeenAt`
- `lastConfirmedRunId`

DPF should not silently erase missing items on a later run. Instead it should mark them stale and raise or update a quality issue until the change is confirmed intentional.

This is the bridge to later event and change-management capabilities without building them now.

---

## Bootstrap Runtime Behavior

### Default behavior

On initial installation or first startup:

- schedule and run bootstrap discovery automatically
- populate inventory and graph
- populate foundational portfolio views
- record quality issues for uncertain or stale attribution conditions

### Graceful failure behavior

If discovery lacks sufficient permission or access:

- capture the failed run
- record partial observations when possible
- surface the missing privilege or credential requirement clearly
- allow later manual rerun with additional credentials

### Repeat run behavior

Repeat runs should:

- reuse deterministic identity keys
- update existing inventory entities
- refresh `lastSeenAt`
- mark no-longer-seen entities as stale rather than deleting immediately

---

## Immediate Implementation Direction

Recommended slice 1 implementation:

- native host inspection using local OS/runtime access
- Docker API or Docker socket integration
- Kubernetes API access when available
- normalized local discovery persistence
- graph projection into existing Neo4j model
- foundational portfolio default attribution
- taxonomy and digital-product attribution status support
- quality issue surfacing in provider-facing views

This should be implemented as DPF-native logic, not by embedding GLPI, Fleet, LibreNMS, or Netdisco into bootstrap.

---

## Deferred Roadmap

Future phases can extend this foundation with:

- remote agents on additional hosts
- customer network and device discovery
- broader topology mapping
- SNMP/WMI/SSH/API-based remote collectors
- cloud inventory connectors
- external discovery imports from GLPI, Fleet, LibreNMS, or similar tools
- event-driven identification and change correlation
- richer multi-source identification and reconciliation

The slice 1 model is intended to survive those later phases without rework.

---

## Testing and Verification Expectations

Slice 1 should be verified with:

- repeated local discovery runs proving idempotent refresh behavior
- Docker-present and Docker-absent scenarios
- Kubernetes-present and Kubernetes-absent scenarios
- stale detection between runs
- taxonomy/portfolio auto-attribution for known DPF components
- quality issue creation for unresolved attribution
- graph projection verification for core dependency edges

---

## Summary

The right first discovery slice for DPF is:

- automatic
- local-only
- Docker-first
- inventory plus graph aware
- portfolio and taxonomy aware
- quality aware

It should not try to become a full enterprise CMDB discovery engine yet. It should create a durable provider-side foundation that populates the `Foundational` portfolio, ties discovered platform assets back to taxonomy and digital products where possible, and treats uncertainty and drift as portfolio-quality work rather than hidden technical debt.

---

## References

- ServiceNow CMDB design guidance: https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/resource-center/white-paper/wp-cmdb-design-guidance.pdf
- ServiceNow Identification and Reconciliation Engine docs: https://www.servicenow.com/docs/en-US/bundle/zurich-servicenow-platform/page/product/configuration-management/concept/ire.html
- ServiceNow IRE API docs: https://www.servicenow.com/docs/bundle/xanadu-api-reference/page/integrate/inbound-rest/concept/c_IdentifyReconcileAPI.html
- OpenText Universal Discovery product page: https://www.opentext.com/products/universal-discovery
- OpenText Universal Discovery and CMDB product page: https://www.opentext.com/products/universal-discovery-and-cmdb
- OpenText advanced network discovery overview: https://www.opentext.com/media/product-overview/advanced-discovery-of-networks-for-opentext-universal-discovery-and-cmdb-po-en.pdf
- GLPI Inventory docs: https://help.glpi-project.org/doc-plugins/plugins-glpi/glpi-inventory
- GLPI remote inventory docs: https://help.glpi-project.org/tutorials/inventory/advanced-usage/remote_inventory
- Netdisco: https://netdisco.org/
- LibreNMS network maps: https://docs.librenms.org/Extensions/Network-Map/
- Fleet/osquery inventory docs: https://fleetdm.com/tables/system_info

# Truthful Physical Network Topology

| Field | Value |
|---|---|
| Status | Accepted for implementation |
| Date | 2026-08-08 |
| Concern | Native edge discovery, canonical topology projection, operator UX |
| Backlog | `BI-6649C95A` — in progress, `xlarge`, one atomic delivery |
| Architecture decision | `DI-7162CCF4A3D8` — native edge parity, high confidence |
| UX decision | `DI-1709E09FD759` — physical default, subnet inventory secondary, high confidence |

## 1. Problem and reproduced evidence

The Infrastructure Topology page currently presents subnet membership as though it were physical wiring. On the canonical install, selecting `192.168.0.1/24` produces a dense starburst of host-to-subnet `MEMBER_OF` edges that does not resemble the site's UniFi topology.

The live evidence explains the mismatch:

- the active ARP scan persisted 256 host observations for a `/24`, including the network and broadcast addresses;
- almost every visible edge is host-to-subnet `MEMBER_OF`;
- there are no UniFi gateway, switch, access-point, or WAN entities and no physical `CONNECTS_TO`/`PEER_OF` relationships;
- the configured UniFi connection is `active` even though its last test says `Discovered 0 items`;
- the installed native Go edge reports roughly 74–75 ARP/host items and zero relationships on repeated runs;
- `services/edge-node-go/cmd/dpf-edge-node/main.go` collects only `HostInfo` and `ArpNeighbors`, while the TypeScript runtime fetches `/api/v1/edge/adapters` and runs the UniFi adapter;
- the portal collector was deliberately retired because the edge was declared the collection owner.

Expected behavior is a source-backed physical hierarchy—Internet/WAN, gateway, switches, access points, and their connected clients—plus a separately named subnet inventory. If physical evidence is absent, the page must say so; it must not promote address membership into physical topology.

## 2. Existing substrate and ownership

This work extends the existing substrate. It does not add a topology database, second credential store, or vendor-specific UI model.

| Concern | Existing owner | Decision |
|---|---|---|
| UniFi credentials and site selection | `DiscoveryConnection`; `/api/v1/edge/adapters` | Keep. Credentials remain encrypted in the Authority and are released only to a trusted, scope-matched edge node. |
| LAN-reachable collection | Edge node | Keep. Bring the installed Go runtime to the same adapter contract as TypeScript. |
| Observation ingestion | `DiscoveryRun` → normalization → `InventoryEntity` / `InventoryRelationship` | Keep. Submit ordinary observations and relationships. |
| Runtime health | discovery warnings, connection test fields, capability reports | Extend truthful classification; zero devices and partial endpoint failures are degraded, not success. |
| Topology UI | Postgres-backed graph read model and `TopologyGraph` | Split the physical projection from subnet inventory; no new store. |

`docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md` remains the adapter capability foundation. This specification supersedes its use of undocumented legacy UniFi endpoints as the primary API and corrects the unfulfilled Mode 1/Mode 4 parity claim. `docs/edge-node/unifi-adapter.md` must be updated with the official endpoint behavior and truthful verification outcome.

## 3. Research and benchmarking

### UniFi Network

UniFi is both the source system and the operator's comparison point. The current official local Network API uses `X-API-Key` and the `/proxy/network/integration/v1` surface. The client first lists local sites, because the site UUID—not the display slug—is required by subsequent calls; adopted-device detail includes an uplink reference to the parent device, and connected clients are a separate paginated resource. DPF adopts the official read-only endpoints, pagination, site resolution, device uplink, device/client state, and interface metadata. DPF retains a bounded legacy fallback for older supported controllers, but it never treats an empty legacy response as proof that the official API is empty.

Sources: [Ubiquiti API setup](https://help.ui.com/hc/en-us/articles/30076656117655-Getting-Started-with-the-Official-UniFi-API), [List Local Sites](https://developer.ui.com/network/v10.1.84/getsiteoverviewpage), [Get Device Details](https://developer.ui.com/network/v9.4.17/getdevicedetails), [List Connected Clients](https://developer.ui.com/network/v10.1.84/getconnectedclientoverviewpage).

### NetBox Topology Views

NetBox Topology Views distinguishes physical and logical connections, supports filtering by operational dimensions such as site and device role, and retains operator layout coordinates. DPF adopts the physical/logical distinction and scoped filtering. It rejects a second persisted coordinate model in this slice because the current graph renderer can derive a stable hierarchy and the canonical facts belong in inventory relationships.

Source: [NetBox Topology Views](https://github.com/netbox-community/netbox-topology-views).

### OpenWISP Network Topology

OpenWISP separates topology collection from visualization, retains link status, supports history, and uses expiration so missing links transition down rather than vanishing immediately. DPF adopts the principles of source-labelled collection, explicit link state/freshness, and honest stale/degraded presentation. It rejects importing NetJSON or operating another topology service because `DiscoveryRun` and inventory relationships already provide the canonical substrate.

Sources: [OpenWISP topology features](https://openwisp.io/docs/dev/network-topology/user/intro.html), [collection strategies and expiration](https://openwisp.io/docs/25.10/network-topology/user/strategies.html).

## 4. Chosen architecture

### 4.1 Collection path

Every trusted native edge sweep performs these steps independently of host/ARP collection:

1. fetch scoped adapter configurations from `GET /api/v1/edge/adapters`;
2. for each UniFi adapter, create a controller-specific HTTP client honoring `tlsInsecure` only for that connection;
3. call the official local API base `/proxy/network/integration/v1`;
4. list sites and resolve the configured value against site UUID, `internalReference`, or name (`default` resolves the single/default site);
5. page through adopted devices and, when enabled, connected clients;
6. fetch device detail when the overview does not contain uplink/interface detail;
7. map device UUID and MAC into stable observed keys, and map uplink device UUID to physical relationships;
8. if the official API is unavailable because the controller version lacks it, try the bounded legacy `/proxy/network/api/s/{site}` adapter; auth/TLS/unreachable failures never fall through as an empty success;
9. merge UniFi items, relationships, and warnings into the same `SubmissionEnvelope` as host and ARP evidence.

The TypeScript edge adapter uses the same official-first/fallback and output contract. Cross-runtime fixture tests make drift visible.

### 4.2 Observation contract

Managed devices use `unifi:<mac>` keys where a valid MAC exists and `unifi-device:<uuid>` only as a fallback. Client keys use `unifi-client:<mac>` so their vendor-backed identity does not collide with address-only ARP identity; `SAME_AS` relationships correlate compatible IP/MAC observations.

Physical facts use the existing relationship vocabulary:

- parent device → child device: `HOSTS`, with `evidenceKind: "unifi_uplink"`, parent/child IDs, and port details when known;
- client → switch/AP: `CONNECTS_TO`, with wired/wireless and switch-port metadata;
- LLDP corroboration: `PEER_OF`;
- gateway → WAN/ISP: `UPLINKS_TO` when the source API supplies WAN evidence;
- subnet/VLAN membership: `MEMBER_OF`, never interpreted as physical wiring.

Every UniFi item carries `discoveredVia`, API generation, connection/site identity, operational state, model, firmware, and observed timestamp in `rawData`. Secrets never enter observations, warnings, logs, or tests.

### 4.3 Truthful health semantics

Connection and sweep health follow a closed classification:

| Outcome | Connection status | Operator meaning |
|---|---|---|
| authenticated and at least one managed device | `active` / `ok` | Physical topology evidence is available. |
| authenticated but zero managed devices | `degraded` / `unifi_no_devices` | Reachable, but no topology was discovered; not success. |
| devices available but optional clients/WAN/details failed | `active` with partial warning | Partial topology, warning visible with affected resource. |
| 401/403 | `auth_failed` | Key or permission failed. |
| certificate validation failure | `tls_error` | Certificate policy blocked the connection. |
| timeout/network failure | `unreachable` | Controller was not reached. |

Manual rerun preserves `tlsInsecure`, applies the same classifier, persists warnings, and never forces `active/ok`. Because the edge owns production collection, the portal one-shot test is explicitly a reachability/API compatibility test; its UI copy must not imply that a successful portal probe proves the native edge has collected the site.

### 4.4 ARP integrity

ARP is inventory evidence, not physical evidence. The scan collector must:

- canonicalize the supplied CIDR before scanning;
- reject the network address, directed broadcast, multicast, unspecified, and out-of-subnet results;
- deduplicate by stable IP/MAC identity;
- flag an impossible saturation pattern (for example, every address in a `/24` reported up without usable MAC evidence) as `arp_scan_untrustworthy` and avoid persisting those host rows;
- retain the subnet entity so the degraded result remains diagnosable.

This prevents a scanner/tool failure from minting a synthetic full subnet.

### 4.5 Read model and UX

The default **Network Topology** projection contains only physical relationship types: `HOSTS`, `CONNECTS_TO`, `PEER_OF`, and `UPLINKS_TO`. `MEMBER_OF` and `ROUTES_THROUGH` are excluded. The hierarchy is oriented for display as WAN → gateway → switch → access point → client without rewriting the stored fact direction.

The existing **Subnet View** is renamed **Subnet Inventory**. It continues to group entities by `MEMBER_OF`, but its description and live-region text state that it is address/network membership, not cabling.

Above the canvas, a compact integrity summary reports:

- physical device and link count;
- data source(s);
- newest observation age;
- `Current`, `Partial`, `Stale`, or `No physical evidence` state;
- a plain-language next action linking to Estate Discovery when evidence is missing/degraded.

When there are no physical links, the default view renders an honest empty state instead of falling back to membership edges. The canvas keeps its text alternative/live region and all new DOM styling uses `--dpf-*` tokens.

## 5. Failure and lifecycle behavior

- Adapter failure is isolated: host/ARP evidence still submits, and the UniFi warning travels in the envelope.
- Pagination is bounded by server totals plus a defensive maximum; repeated cursors and oversized responses abort with a warning.
- The edge HTTP client applies request deadlines and response-size limits.
- A missing parent/device detail emits the child plus a partial warning; it does not invent a link.
- Relationship freshness remains governed by discovery attribution/staleness. The UI reports stale physical evidence rather than silently drawing it as current.
- No migration is expected. The existing entity, relationship, run, connection, and projection models are sufficient.

## 6. Security and privacy

- API keys remain encrypted at rest and scoped to trusted edge nodes by the authenticated adapter route.
- Official and legacy calls are read-only GETs.
- TLS verification defaults on; insecure TLS is an explicit per-connection opt-in for a trusted LAN.
- Controller URL, site identifiers, response bodies, and warnings are bounded and encoded; no user-controlled string becomes a shell command.
- Client discovery remains operator-configurable because client names, MACs, and addresses are sensitive local-network data.

## 7. Acceptance criteria

1. The native Go runtime fetches scoped adapters and, against fixtures for the official API, emits managed gateway/switch/AP entities and physical relationships.
2. TypeScript and Go adapter fixtures produce the same canonical keys, device types, physical relationship types, and warning classes.
3. A current UniFi API key and `default` configuration resolve through the local-sites endpoint; zero devices is degraded.
4. Manual test/rerun preserves TLS policy and cannot turn warnings into `active/ok`.
5. Impossible ARP scan saturation does not persist 256 fake hosts.
6. Network Topology never draws `MEMBER_OF` as physical wiring; Subnet Inventory remains available and clearly labelled.
7. Empty, partial, and stale physical evidence are visible and actionable.
8. A canonical-runtime UX pass shows a legible physical hierarchy comparable to the UniFi gateway view for the same site.
9. Unit tests, production build, documentation checks, UX-fit gate, and relevant edge Go tests pass.

## 8. Architecture review

**Verdict: proceed with conditions, all incorporated above.** The design preserves the Authority/edge boundary, reuses canonical inventory, and removes rather than adds split truth. Implementation must not revive the portal as a production collector, must not key sites by an assumed display slug, must not silently downgrade to the legacy API after auth/TLS failures, and must not use subnet membership as a physical fallback. The official API and fallback must be contract-tested independently. Canonical-runtime verification is required because source-level parity alone cannot prove LAN reachability or visual truth.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md`
  - `docs/superpowers/plans/2026-08-08-truthful-physical-network-topology-implementation.md`
- Current code substrate reviewed:
  - edge adapter delivery through `/api/v1/edge/adapters` and the native/TypeScript sweep runtimes;
  - `DiscoveryRun` normalization into canonical inventory and graph projection;
  - `TopologyGraph`, graph view configuration, subnet scoping, and existing layout primitives.
- Source of truth:
  - physical facts remain canonical `InventoryRelationship` evidence projected through the existing graph read model; connection configuration remains in `DiscoveryConnection`.
- Decision:
  - make the native edge the scheduled UniFi collection owner, render physical evidence by default, and retain address membership as the separately labelled Subnet Inventory. Architecture decision `DI-7162CCF4A3D8`; UX decision `DI-1709E09FD759`.

## 9. Documentation impact

Update the UniFi operator guide, edge-node runtime parity documentation, and topology user guidance. No schema or migration documentation change is expected. The work changes what users and AI coworkers may infer from the topology, so leaving the existing “shows your real network” claim unchanged would be inaccurate until canonical verification passes.

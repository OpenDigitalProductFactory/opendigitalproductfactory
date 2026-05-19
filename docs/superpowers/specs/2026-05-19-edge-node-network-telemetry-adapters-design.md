# Edge Node — Network Telemetry & Adapter Collectors

| Field | Value |
|-------|-------|
| **Epic** | EP-EDGE-TELEM-001 |
| **IT4IT Alignment** | §5.7 Operate (Service Monitoring FC, Configuration Management FC, Event Management FC) |
| **Depends On** | Phase 0 Edge Node (PR #501, `services/edge-node/`), SNMP collector (snmp-poll.ts), `2026-05-09-dpf-edge-node-design.md` (binding), `2026-04-02-multi-layer-topology-graph-design.md` (OSI model) |
| **Status** | Draft |
| **Created** | 2026-05-19 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

---

## 1. Problem Statement

The Phase 0 edge node ships `discovery.network` — it discovers *what devices exist* and *how they are
connected* at OSI layers 3–4. It does not answer:

- **How much traffic is flowing right now?** (per-link throughput, the signature of tools like UniFi
  and NNMI)
- **What is the physical Layer 2 topology?** (switch port → device wiring, LLDP neighbors)
- **What smart-home devices are present?** (TP-Link Kasa switches/plugs, Starlink dishes, devices
  known to Home Assistant)
- **What is the identity and model of each device?** (manufacturer, product name, serial — needed for
  product icons and CMDB accuracy)

These gaps exist because the current SNMP collector reads only six system-identity OIDs and runs on a
5-minute cadence that is too coarse for telemetry. Closing them requires two additions to the edge
node:

1. **A richer SNMP walk** — ifTable (throughput counters) + LLDP-MIB (L2 neighbors) — giving
   per-interface traffic rates and wired-topology edges to any SNMP-capable device, regardless of
   vendor.
2. **Optional vendor adapter collectors** — lightweight plugins that activate when a specific platform
   is present on the LAN (UniFi controller, Kasa devices, Starlink dish, Home Assistant). Each adapter
   maps vendor-proprietary data onto the same `ObservationItem` + `SubmissionRelationship` shape the
   SNMP collector already uses, and additionally produces telemetry rate data.

Not everyone has a UniFi controller. The SNMP ifTable walk is the universal baseline; adapters are
progressive enrichment.

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **SNMP is the universal baseline** | Works on any managed switch, router, or AP regardless of vendor. Adapters are additive; they do not replace SNMP. |
| P2 | **Adapters are opt-in, auto-detect where possible** | Kasa and Starlink auto-detect via LAN probes. UniFi and HA require explicit config (credentials). A missing adapter produces no error — it simply does not run. |
| P3 | **Discovery and telemetry are separate channels** | Discovery runs every 5 minutes (inventory), telemetry runs every 10–30 seconds (metrics). They share the same collector code but submit to different endpoints with different retention semantics. |
| P4 | **Wire contract is runtime-agnostic** | New endpoints follow the same bearer-token, JSON-body, idempotent-runKey pattern as existing edges. Mode 1 (TypeScript) and Mode 4 Go implement the same contract. |
| P5 | **Stateful delta only in the edge node** | The portal stores the latest computed rate, not raw counter snapshots. Delta computation (current − previous octets ÷ elapsed seconds) runs in the edge node where both readings are available. |
| P6 | **IoT devices link to CMDB via MAC** | Every adapter emits a `SAME_AS` relationship from its device key to the `arp:<ip>` item already in the discovery graph. The Authority Core normalization pipeline collapses these into a single canonical CI. |
| P7 | **The building is a Digital Product** | Smart-home devices discovered by adapters are `cmdb_ci_iot_device` Configuration Items. The DPF portfolio can contain a "Building Management" product whose inventory is all the IoT CIs from the local LAN. |

---

## 3. New Capabilities

Extend the reserved capability namespace in `packages/db/src/edge-node-types.ts`:

```typescript
// Already reserved — now formally specified
"metrics.network"   // submits per-interface telemetry via /api/v1/edge/metrics
"discovery.lldp"    // submits L2 neighbor topology via existing /discovery-runs
```

The `discovery.lldp` capability is additive to `discovery.network` — both submit to the same
`/api/v1/edge/discovery-runs` endpoint. `metrics.network` uses the new `/api/v1/edge/metrics`
endpoint (§6).

The Authority Core's heartbeat response already returns `acceptedCapabilities` — operators enable /
disable individual capabilities without code changes.

---

## 4. Collector Extensions

### 4.1 SNMP ifTable Walk (universal — all SNMP-capable devices)

Extends the existing `src/collectors/snmp-poll.ts`. Runs against the same configured target list as
the existing system-identity query, in the same sweep tick, as a second SNMP walk phase.

**New OIDs walked** (per interface, indexed by `ifIndex`):

| OID | Name | Purpose |
|-----|------|---------|
| `1.3.6.1.2.1.2.2.1.2.N` | ifDescr | Interface description string ("eth0", "GigabitEthernet0/1") |
| `1.3.6.1.2.1.31.1.1.1.18.N` | ifAlias | Admin-assigned port label (often the connected device name) |
| `1.3.6.1.2.1.2.2.1.8.N` | ifOperStatus | 1=up, 2=down, 3=testing |
| `1.3.6.1.2.1.31.1.1.1.15.N` | ifHighSpeed | Interface speed in Mbps (correct for Gigabit+) |
| `1.3.6.1.2.1.31.1.1.1.6.N` | **ifHCInOctets** | 64-bit cumulative input bytes (must use; 32-bit wraps in minutes at 10G) |
| `1.3.6.1.2.1.31.1.1.1.10.N` | **ifHCOutOctets** | 64-bit cumulative output bytes |

**SNMP mechanism**: Use `getBulk` (SNMPv2c/v3) or sequential `getNext` (SNMPv1 fallback) to walk the
full ifTable. The existing shell-out to `snmpget` is insufficient for table walks; this is the point
where the edge node should adopt the `net-snmp` npm package for Mode 1 TypeScript, or `gosnmp/gosnmp`
for Mode 4 Go, replacing the subprocess approach for the new walk phase. The existing system-identity
queries may remain as subprocesses during the transition.

**Delta computation** (stateful):

```typescript
// Persisted alongside state.json in $DPF_EDGE_STATE_DIR/snmp-counters.json
interface SnmpCounterSnapshot {
  [deviceKey: string]: {
    [ifIndex: number]: {
      inOctets: bigint;   // ifHCInOctets
      outOctets: bigint;  // ifHCOutOctets
      sampledAt: number;  // epoch ms
    };
  };
}
```

Rate computation per interface per sweep:
```
rxBps = (inOctets_now - inOctets_prev) * 8 / ((sampledAt_now - sampledAt_prev) / 1000)
txBps = (outOctets_now - outOctets_prev) * 8 / ((sampledAt_now - sampledAt_prev) / 1000)
```

**First-poll rule**: If no prior snapshot exists for a `(deviceKey, ifIndex)` pair, store the
current reading and emit **no metric** for that interface on this sweep. A valid rate requires two
readings. Implementers must guard against `undefined` previous values before computing any delta.

**Counter wrap**: 64-bit counters wrap at 2^64 ≈ 18.4 exabytes — at 100 Gbps sustained this takes
~18.4 seconds worth of data in the absolute sense but the counter represents cumulative bytes since
device boot, so wrap takes decades on any real device. Detect by `now_bigint < prev_bigint` (using
arbitrary-precision comparison) and handle by re-seeding the snapshot without emitting a rate.

**BigInt JSON serialisation**: `JSON.stringify` throws on `BigInt`; `JSON.parse` loses precision
above 2^53 for numeric values. Persist counter values as **decimal strings** in
`snmp-counters.json` (e.g., `"inOctets": "18446744073709551615"`) and read back via
`BigInt(str)`. The `SnmpCounterSnapshot` interface comment must document this convention.

**Output**: Interface metric items are not submitted via `discovery-runs` (they are not topology).
They are collected during the sweep tick and held in memory until the metrics submission cycle fires
(§5 — separate cadence).

---

### 4.2 LLDP-MIB Walk (L2 neighbor discovery — all LLDP-capable devices)

New collector: `src/collectors/lldp-walk.ts`. Runs against the same SNMP target list. Walks the
LLDP-MIB neighbor table to produce `PEER_OF` relationships between switch ports.

> **Note on entity-type naming**: New entity types in §4.2 and §7.2 use underscores (`switch_port`,
> `smart_plug`, `smart_switch`, `satellite_internet`) to match the convention of existing types
> (`network_device`, `wireless_ap`). The OSI spec uses `switch-port` (hyphen) — the implementation
> must normalise to underscore; this spec is the authoritative definition going forward.

**OIDs walked** (lldpRemTable, indexed by `[timeMark, localPortNum, remIndex]`):

| OID | Name | Purpose |
|-----|------|---------|
| `1.0.8802.1.1.2.1.4.1.1.5.T.P.N` | lldpRemChassisId | Remote chassis ID (usually MAC address) |
| `1.0.8802.1.1.2.1.4.1.1.7.T.P.N` | lldpRemPortId | Remote port identifier |
| `1.0.8802.1.1.2.1.4.1.1.8.T.P.N` | lldpRemPortDesc | Remote port description |
| `1.0.8802.1.1.2.1.4.1.1.9.T.P.N` | **lldpRemSysName** | Remote device hostname — primary correlation key |
| `1.0.8802.1.1.2.1.4.1.1.10.T.P.N` | lldpRemSysDesc | Remote system description (often includes firmware) |

The index `localPortNum` (P) corresponds to `lldpLocPortTable` → `lldpLocPortId`, which maps to
`ifIndex` in the IF-MIB. Cross-referencing with `ifDescr` gives the local port name.

**Output**: Emits `PEER_OF` relationships in the `discovery-runs` submission:

```typescript
SubmissionRelationship {
  fromObservedKey: "snmp:<local-ip>/port/<ifIndex>",
  toObservedKey:   "arp:<resolved-ip>",  // resolved from lldpRemSysName + ARP table
  relationshipType: "PEER_OF",
  rawData: {
    localIfIndex: number,
    localIfDesc: string,     // "eth0" / "GigabitEthernet0/1"
    remoteChassisId: string, // MAC
    remoteSysName: string,
    remotePortDesc: string,
  }
}
```

Also emits `ObservationItem` entries for discovered ports as `osiLayer: 2` items (`itemType:
"switch-port"`), keyed `snmp:<ip>/port/<ifIndex>`, enabling the OSI Layer 2 swimlane in the topology
graph.

---

### 4.3 UniFi Adapter (`src/collectors/unifi.ts`) — optional

**Activation**: Config entry in `$DPF_EDGE_ADAPTER_DIR/adapters.json` (new file, alongside
`snmp.json`). If the file is absent or has no `unifi` block, the adapter does not run.

```json
{
  "unifi": {
    "controllerUrl": "https://192.168.1.1",
    "apiKey": "...",
    "site": "default",
    "tlsInsecure": false
  }
}
```

**Data flow**:

1. `GET /proxy/network/api/s/{site}/stat/device` (polling every metrics cadence)
2. For each device: extract `model`, `model_name`, `type`, `serial`, `mac`, `ip`, `name`, `state`
3. For each device's `port_table[]`: extract `ifname`, `rx_bytes-r`, `tx_bytes-r`, `poe_enable`,
   `poe_power`, `lldp_system_name`, `lldp_mac`
4. Build parent-child topology from `uplink.mac` → `downlink_table[].mac`
5. Open WebSocket `wss://{console}/proxy/network/wss/s/{site}/events` for device join/leave events;
   trigger immediate sweep on `EVT_SW_*` or `EVT_AP_*` events.
   **Reconnect policy**: On close or error, reconnect with exponential back-off: 1s → 2s → 4s → 8s
   → 30s (capped). Log a warning after 3 consecutive failures. A downed event loop does not block
   the regular 5-minute discovery sweep — it only delays event-triggered sweeps.

**Discovery output** (submitted via `discovery-runs`):

```typescript
ObservationItem {
  observedKey: "unifi:<device-mac>",
  itemType: unifiTypeMap[device.type],  // usw→switch, uap→access_point, ugw→gateway, udm→gateway
  name: device.name || device.model_name,
  confidence: 1.0,
  rawData: {
    model, model_name, serial, mac, ip, state,
    vendorIconModel: model,  // for fingerprint DB lookup in the portal
    osiLayer: typeToOsiLayer[itemType],
    discoveredVia: "unifi_api"
  }
}

// Link to existing ARP-discovered host
SubmissionRelationship {
  fromObservedKey: "unifi:<device-mac>",
  toObservedKey:   "arp:<device-ip>",
  relationshipType: "SAME_AS"
}

// Parent-child port topology (HOSTS edges)
SubmissionRelationship {
  fromObservedKey: "unifi:<parent-mac>",
  toObservedKey:   "unifi:<child-mac>",
  relationshipType: "HOSTS",
  rawData: { parentPortIdx: number, parentPortName: string }
}
```

**Telemetry output** (submitted via `/api/v1/edge/metrics`): Per-port `rx_bytes-r` / `tx_bytes-r`
are already computed rates from the UniFi controller (bytes/sec). No delta calculation required.

```typescript
InterfaceMetric {
  deviceKey: "unifi:<device-mac>",
  ifIndex: port_table[n].port_idx,
  ifName: port_table[n].name,
  rxBps: port_table[n]["rx_bytes-r"] * 8,   // bytes→bits
  txBps: port_table[n]["tx_bytes-r"] * 8,
  operStatus: port_table[n].speed > 0 ? "up" : "down",
  speedMbps: port_table[n].speedmax,
  poeWatts: port_table[n].poe_power,         // optional, PoE-only
}
```

---

### 4.4 TP-Link Kasa Adapter (`src/collectors/kasa.ts`) — optional, auto-detect

**Activation**: Auto-detect via UDP broadcast discovery. If `tplink-smarthome-api` client finds no
devices, the adapter completes silently with zero items. An explicit `"kasa": { "disabled": true }`
block in `adapters.json` suppresses even the discovery attempt.

**npm dependency** (Mode 1 only): `tplink-smarthome-api`. Add to `services/edge-node/package.json`.
Mode 4 Go equivalent: `tplink-kasa-go` or subprocess to the python-kasa CLI.

**Discovery**:
- `client.startDiscovery({ discoveryTimeout: 5000 })` — UDP broadcast on port 9999
- Receives `device-new` events with device object
- Calls `device.getSysInfo()` for: `model`, `alias`, `mac`, `deviceId`, `hw_ver`, `sw_ver`, `rssi`
- HS105/EP25 (energy-monitoring plugs): also calls `plug.emeter.getRealtime()` for `power_mw`,
  `voltage_mv`, `current_ma`, `total_kwh`

**Discovery output**:

```typescript
ObservationItem {
  observedKey: "kasa:<mac>",
  itemType: "smart_plug",        // HS105, EP25, KP115 = smart_plug
  // or: "smart_switch"          // HS200, HS210, KS200M = smart_switch
  name: device.alias,            // User-set friendly name ("Living Room Lamp")
  confidence: 0.95,
  rawData: {
    model, mac, deviceId, hwVer, swVer, rssi,
    vendorIconModel: model,
    osiLayer: 7,                 // L7 — these are application-layer endpoints
    osiLayerName: "application",
    discoveredVia: "kasa_lan",
    emeter: { powerMw, voltageMv, currentMa, totalKwh } | null
  }
}
```

**Telemetry output** (HS105/energy-monitoring models only):

```typescript
InterfaceMetric {
  deviceKey: "kasa:<mac>",
  ifName: "emeter",
  rxBps: 0,
  txBps: 0,
  operStatus: device.is_on ? "up" : "down",
  // Extra: raw energy data in rawData
  rawData: { powerMw, voltageMv, currentMa, totalKwh }
}
```

---

### 4.5 Starlink Adapter (`src/collectors/starlink.ts`) — optional, auto-detect

**Activation**: Attempt gRPC connect to `192.168.100.1:9200` on startup. If the endpoint is
unreachable within 2 seconds, the adapter is skipped silently. A `"starlink": { "disabled": true }`
block in `adapters.json` bypasses the probe.

**npm dependencies** (Mode 1): `@grpc/grpc-js`, `@grpc/proto-loader`. Add to
`services/edge-node/package.json`.  
**Proto source**: Community-maintained at `sparky8512/starlink-grpc-tools`. The proto files are
vendored into `services/edge-node/src/collectors/starlink-protos/` at a pinned commit hash.

**gRPC calls**:
- `get_status` — returns `state` (CONNECTED/SEARCHING/OFFLINE), `uptime_s`, `downlink_throughput_bps`,
  `uplink_throughput_bps`, `pop_ping_latency_ms`, `pop_ping_drop_rate`
- `get_device_info` — returns `id` (dish serial), `hardware_version`, `software_version`
- Called once per metrics cadence; no streaming subscription (the API does not support it).

**Discovery output**:

```typescript
ObservationItem {
  observedKey: "starlink:<dish-serial>",
  itemType: "satellite_internet",   // new CI type
  name: "Starlink Dish",
  confidence: 1.0,
  rawData: {
    dishSerial: string,
    hardwareVersion: string,
    softwareVersion: string,
    osiLayer: 3,
    osiLayerName: "network",
    discoveredVia: "starlink_grpc",
    vendorIconModel: "STARLINK_STANDARD_ACTUATED_V3",  // fingerprint DB key
  }
}

// Connect to gateway
SubmissionRelationship {
  fromObservedKey: "starlink:<dish-serial>",
  toObservedKey:   "arp:<gateway-ip>",
  relationshipType: "ROUTES_THROUGH",
}
```

**Telemetry output**:

```typescript
InterfaceMetric {
  deviceKey: "starlink:<dish-serial>",
  ifName: "satellite-link",
  rxBps: get_status.downlink_throughput_bps,
  txBps: get_status.uplink_throughput_bps,
  operStatus: get_status.state === "CONNECTED" ? "up" : "down",
  rawData: {
    latencyMs: pop_ping_latency_ms,
    dropRate: pop_ping_drop_rate,
    uptimeSec: uptime_s,
  }
}
```

---

### 4.6 Home Assistant Bridge (`src/collectors/home-assistant.ts`) — optional

**Activation**: Config entry in `adapters.json`:

```json
{
  "homeAssistant": {
    "url": "http://homeassistant.local:8123",
    "token": "...",
    "syncIntervalSec": 300
  }
}
```

**Why HA**: Home Assistant acts as the authoritative smart-device registry for homes where it is
deployed. Its device registry already has `manufacturer`, `model`, and `area_id` (room/zone) for
every integrated device. Pulling from HA avoids building individual vendor adapters for every smart
home protocol (Zigbee, Z-Wave, Tuya, etc.).

**WebSocket API** (official, `home-assistant-js-websocket` npm):
- Connect to `ws://<url>/api/websocket`, authenticate with token
- Send `config/device_registry/list` → full device catalog with `id`, `name`, `manufacturer`,
  `model`, `area_id`, `connections` (includes MAC tuples), `sw_version`
- Send `get_states` → current entity states (on/off, sensor values)
- Subscribe to `state_changed` events for live device state updates

**Deduplication via MAC**: The `connections` array on each HA device contains tuples like
`["mac", "aa:bb:cc:dd:ee:ff"]`. This MAC links to the `arp:<ip>` item already in the graph via a
`SAME_AS` relationship, collapsing the HA device record and the ARP-discovered host into a single
canonical CI.

**Discovery output**:

```typescript
ObservationItem {
  observedKey: "ha:<ha-device-id>",
  itemType: classifyHaDevice(device),  // derived from device_class or integration domain
  name: device.name,
  confidence: 0.9,
  rawData: {
    manufacturer, model, swVersion,
    areaId,    // room/zone location — maps to brick:isLocatedIn
    haIntegration: device.config_entries[0],  // e.g., "kasa", "zha", "z_wave_js"
    vendorIconModel: `${manufacturer}/${model}`,
    osiLayer: 7,
    discoveredVia: "home_assistant",
  }
}

// Link to ARP-discovered IP host via MAC
SubmissionRelationship {
  fromObservedKey: "ha:<ha-device-id>",
  toObservedKey:   "arp:<resolved-ip>",  // look up from ARP table by MAC
  relationshipType: "SAME_AS",
}
```

**Location enrichment**: The `areaId` is stored in rawData and written to the InfraCI node's
`properties` in PostgreSQL. The topology view and the product Health tab use `areaId` to group
devices by room — the first implementation of spatial/Brick-schema alignment without requiring a full
RDF ontology layer.

---

## 5. Metrics Submission Cadence

Two independent loops in `src/sweep.ts` (or factored into separate modules):

| Loop | Cadence | Produces | Endpoint |
|------|---------|----------|----------|
| **Discovery sweep** | 5 min (Authority-decided) | Topology items + LLDP relationships | `/api/v1/edge/discovery-runs` |
| **Metrics sweep** | 10–30 sec (Authority-decided) | Per-interface throughput rates | `/api/v1/edge/metrics` (new) |

The metrics cadence is returned in the heartbeat response alongside the existing `sweepIntervalSec`.
Add `metricsIntervalSec` to the `HeartbeatResponse` schema.

**Metrics sweep loop**:
1. Re-use cached SNMP counter snapshots from the last discovery sweep (no extra SNMP round-trip for
   identity data)
2. Poll UniFi `/stat/device` for `rx_bytes-r` / `tx_bytes-r` (already-computed rates — no delta)
3. Poll Kasa devices for emeter (fast, LAN-local)
4. Poll Starlink gRPC for throughput
5. Build `MetricsEnvelope` and POST to `/api/v1/edge/metrics`

For SNMP-only devices, the metrics sweep fires the ifTable walk independently of the discovery sweep
to collect counter snapshots. Delta is computed between the two most recent snapshots.

---

## 6. New API Endpoint: `/api/v1/edge/metrics`

**Route**: `POST /api/v1/edge/metrics`  
**Auth**: Node bearer token (`dpfedge_*`), same as existing endpoints  
**Required capability**: `metrics.network`  

### 6.1 Request Body

```typescript
interface MetricsEnvelope {
  runKey: string;                  // UUID idempotency key (same pattern as discovery-runs)
  nodeId: string;                  // Resolved from token, not trusted from body
  observedAt: string;              // ISO 8601
  metricsVersion: "1";
  interfaces: InterfaceMetric[];
}

interface InterfaceMetric {
  deviceKey: string;               // "snmp:<ip>", "unifi:<mac>", "kasa:<mac>", "starlink:<serial>"
  ifIndex?: number;                // SNMP ifIndex (undefined for non-SNMP devices)
  ifName: string;                  // Human-readable port/interface name
  rxBps: number;                   // bits per second received
  txBps: number;                   // bits per second transmitted
  rxErrors?: number;
  txErrors?: number;
  operStatus: "up" | "down" | "unknown";
  speedMbps?: number;              // Nominal link speed
  rawData?: Record<string, unknown>; // Adapter-specific extras (poeWatts, latencyMs, etc.)
}
```

### 6.2 Portal Ingestion

- Validate bearer token via `resolveEdgeNodeAuth` (same as discovery-runs)
- Validate `metricsVersion: "1"`, body size cap (64 KB), `observedAt` freshness (within 5 minutes)
- **Do not write to PostgreSQL** for every metrics tick — metrics are not CMDB data
- Write to an **in-memory metrics cache** keyed by `(nodeId, deviceKey, ifName)`, TTL 90 seconds
  (3× the maximum metrics interval, so stale data self-clears)
- Emit a **WebSocket event** to all browser clients subscribed to topology updates for this
  organization (`topology:metrics:update` event with the delta)

### 6.3 Browser WebSocket Push

The existing portal has a WebSocket infrastructure (check `apps/web/lib/` for the push mechanism).
The metrics endpoint writes to the in-memory cache and then fans out to subscribed browser connections.
Browser clients subscribed to the topology view receive:

```typescript
{
  type: "topology:metrics:update",
  payload: {
    interfaces: InterfaceMetric[],
    observedAt: string,
    nodeId: string,
  }
}
```

The topology canvas re-renders link annotations on receipt.

---

## 7. Portal Schema Changes

### 7.1 `RESERVED_CAPABILITIES` — wire-contract change (required co-change)

**File: `packages/db/src/edge-node-types.ts`**

Add both new capability strings to the `RESERVED_CAPABILITIES` array:

```typescript
export const RESERVED_CAPABILITIES = [
  "discovery.network",
  "discovery.software",
  "discovery.lldp",     // NEW — submits LLDP neighbor topology via /discovery-runs
  "metrics.host",
  "metrics.network",    // NEW — submits per-interface telemetry via /api/v1/edge/metrics
  "identity.broker",
  "mcp.gateway",
  "a2a.gateway",
  "policy.enforcement",
  "tunnel.private-link",
] as const;
```

**Also update**: `apps/web/app/api/v1/edge/heartbeat/route.ts` uses `z.enum(RESERVED_CAPABILITIES)`
to validate `acceptedCapabilities` in the heartbeat request body. This co-change must land in the
same PR as any code that sends `metrics.network` or `discovery.lldp` — otherwise the heartbeat
route rejects the capability and the edge node falls back to Phase 0 behaviour.

### 7.2 HeartbeatResponse and EnrollResponse (extend existing)

```typescript
// apps/web/app/api/v1/edge/heartbeat/route.ts
interface HeartbeatResponse {
  // existing
  heartbeatIntervalSec: number;
  sweepIntervalSec: number;
  acceptedCapabilities: string[];
  trustState: EdgeNodeTrustState;
  // new
  metricsIntervalSec: number;  // default 30; 0 = metrics disabled for this node
}
```

`metricsIntervalSec` must also appear in `EnrollResponse` so a newly enrolled node knows its
metrics cadence without waiting for the first heartbeat:

```typescript
// apps/web/app/api/v1/edge/enroll/route.ts
interface EnrollResponse {
  // existing
  nodeId: string;
  nodeToken: string;
  trustState: EdgeNodeTrustState;
  heartbeatIntervalSec: number;
  sweepIntervalSec: number;
  acceptedCapabilities: string[];
  // new
  metricsIntervalSec: number;
}
```

### 7.3 New entity types

Add to the entity-type vocabulary in the discovery taxonomy (all underscore, matching the existing
`network_device` / `wireless_ap` convention — the OSI spec's `switch-port` hyphen is corrected here):

- `satellite_internet` — OSI Layer 3, internet-connectivity device
- `smart_plug` — OSI Layer 7, IoT endpoint with power control (note: assigned L7 because the
  primary interface is the application protocol; the physical power relay is an implementation detail
  of the endpoint, not a separate L1 entity in the graph)
- `smart_switch` — OSI Layer 7, IoT endpoint with circuit-level switching
- `switch_port` — OSI Layer 2, physical switch port (from LLDP walk)

These join the existing `host`, `subnet`, `gateway`, `router`, `switch`, `wireless_ap`, `container`
types without schema changes — they are stored as the `entityType` string field on `InventoryEntity`.

### 7.4 Metrics Cache Module

The in-memory metrics cache written by the `POST /api/v1/edge/metrics` handler must be exported
from a single named module so both the portal endpoint and the graph server actions can import it:

**Canonical path: `apps/web/lib/edge/metrics-cache.ts`**

This module is a singleton (module-level `Map`) and must not be instantiated per-request. The
graph server actions (Spec B `enrichLinksWithMetrics`) import `getLatestMetricsForEdge` from this
path. The metrics endpoint route handler imports `writeMetrics` from the same path.

### 7.5 InfraCI `areaId` property

The `areaId` from Home Assistant (and future Brick Schema integration) is stored in the `properties`
JSON column on `InventoryEntity`. No migration needed — `properties` is already `JsonValue`. The
topology graph uses `properties.areaId` to group nodes by room in a future "spatial view".

---

## 8. Discovery Pipeline: Normalization of SAME_AS Chains

Phase 0 accumulates multiple items per physical device: `arp:<ip>` (from ARP), `snmp:<ip>` (from
SNMP), `unifi:<mac>` (from UniFi), `kasa:<mac>` (from Kasa), `ha:<id>` (from HA) — all linked by
`SAME_AS` relationships to the same physical device.

The normalization pipeline (currently stub in Authority Core) must collapse these into a single
canonical `InventoryEntity` using the highest-confidence item as the base and merging rawData from
all sources. Priority:

1. UniFi adapter (confidence 1.0) — takes manufacturer, model, serial, icon model
2. Kasa adapter (confidence 0.95) — takes friendly name, energy data
3. Home Assistant bridge (confidence 0.9) — takes manufacturer, model, area, integration
4. SNMP poll (confidence 0.95) — takes sysName, sysDescr, vendor OID, uptime
5. nmap sweep (confidence 0.85) — takes IP, hostname
6. ARP table (confidence 0.7) — takes IP, MAC (base record, lowest confidence)

The normalized entity carries a `discoveredVia` array listing all contributing sources, an
`iconModel` field for the icon lookup chain (§9), and an `areaId` if HA provided one.

---

## 9. Device Icon Model

Each `InventoryEntity` rawData carries a `vendorIconModel` string that drives the icon lookup chain
in the portal's topology view. The chain is:

1. **UniFi fingerprint DB** — if `vendorIconModel` is a UniFi model code (e.g., `"US-8-150W"`):
   look up in `fingerprint-database.json` (bundled static asset, ~5,500 entries, sourced from
   github.com/CANTI-BOT/UniFi-Icon-Browser). Returns a `static.ui.com` CDN URL.
2. **NetBox device-type library** — manufacturer slug + model slug maps to a front-panel image in
   the Apache 2.0 `netbox-community/devicetype-library`. Images are bundled at build time for known
   vendors.
3. **Generic device-type SVG** — from `network-automation/networking-icons` (Apache 2.0). Maps CI
   type (`router`, `switch`, `access_point`, `smart_plug`, etc.) to a vendor-neutral SVG.
4. **Unicode symbol fallback** — current behavior, always succeeds.

The `vendorIconModel` string is set by each adapter as follows:

| Adapter | `vendorIconModel` value |
|---------|------------------------|
| UniFi | `device.model` from API (e.g., `"US-8-150W"`) |
| Kasa | `"TP-Link/HS200"` or `"TP-Link/HS105"` |
| Starlink | `"SpaceX/Starlink-Standard-V3"` |
| HA bridge | `"${manufacturer}/${model}"` (e.g., `"TP-Link/HS200"`) |
| SNMP | Derived from `sysObjectID` enterprise OID + `sysDescr` model-string parsing |

---

## 10. Adapters Config File Schema

Full schema for `$DPF_EDGE_ADAPTER_DIR/adapters.json` (default path:
`/etc/dpf-edge/adapters.json`):

```typescript
interface AdaptersConfig {
  unifi?: {
    controllerUrl: string;   // e.g., "https://192.168.1.1"
    apiKey: string;          // X-API-KEY header value
    site?: string;           // default "default"
    tlsInsecure?: boolean;   // default false; warn if true
  };
  homeAssistant?: {
    url: string;             // e.g., "http://homeassistant.local:8123"
    token: string;           // Long-lived access token
    syncIntervalSec?: number; // default 300 (5 min)
  };
  kasa?: {
    disabled?: boolean;       // default false; set true to suppress auto-detect
    discoveryTimeoutMs?: number; // default 5000
  };
  starlink?: {
    disabled?: boolean;       // default false; set true to suppress auto-detect
    host?: string;            // default "192.168.100.1"
    port?: number;            // default 9200
  };
}
```

File mode check: warn if world-readable (tokens are sensitive). Same pattern as `snmp.json`.

---

## 11. Security Considerations

| Surface | Risk | Mitigation |
|---------|------|-----------|
| `adapters.json` credentials | Token/key leak if file is world-readable | File mode check on startup; warn and continue (not fatal — same as snmp.json) |
| UniFi API key | Full read access to UniFi network data | API key scope: read-only; document the minimum required permission level |
| Starlink gRPC | Unauthenticated local endpoint | Only reachable from LAN; no auth to add. Document that Starlink may change this. |
| Kasa UDP broadcast | Devices respond to any LAN broadcast | LAN-local only; no cross-VLAN leakage risk in typical home setup |
| HA long-lived token | Full HA API access | Document use of a restricted "Device Registry Read" HA user; HA supports per-user token scopes via custom role |
| SNMP credentials (v3) | Auth/priv credentials in snmp-counters.json | Protected by existing 0600 file perms on state dir |
| Metrics endpoint DoS | High-frequency metrics flooding the portal | Portal enforces: per-node rate limit (one request per 5s minimum), body size cap 64 KB, `observedAt` freshness window 5 minutes |

---

## 12. Implementation Phases

### Phase 1: SNMP ifTable + LLDP (Mode 1 TypeScript)

1. Add `net-snmp` npm package to `services/edge-node/package.json`
2. Extend `snmp-poll.ts` with `getBulk` ifTable walk (ifDescr, ifAlias, ifOperStatus, ifHighSpeed,
   ifHCInOctets, ifHCOutOctets per interface)
3. Add `lldp-walk.ts` — walk lldpRemTable, emit `PEER_OF` relationships and `switch-port` items
4. Add stateful counter snapshot persistence to `snmp-counters.json`
5. Add delta computation, produce in-memory `InterfaceMetric[]` per sweep
6. Extend `HeartbeatResponse` schema with `metricsIntervalSec`
7. Add `metrics.network` to `RESERVED_CAPABILITIES`, implement metrics sweep loop
8. Implement `POST /api/v1/edge/metrics` portal endpoint with in-memory cache
9. Add `satellite_internet`, `smart_plug`, `smart_switch`, `switch-port` to entity type vocabulary

### Phase 2: Adapter Collectors (Mode 1 TypeScript)

1. Add adapter config file schema and loader (`adapters.json`)
2. Implement UniFi adapter (poll + WebSocket events + discovery + telemetry)
3. Implement Kasa adapter (auto-detect + discovery + emeter telemetry)
4. Implement Starlink adapter (auto-detect gRPC + discovery + throughput)
5. Implement Home Assistant bridge (WebSocket + device_registry + state subscriptions)
6. Implement normalization pipeline SAME_AS collapse in Authority Core
7. Add `vendorIconModel` field to normalized InventoryEntity properties

### Phase 3: Mode 4 Go Parity

Implement equivalent collectors in the Go binary (`services/edge-node-go/`). Wire contract tests
at `apps/web/app/api/v1/edge/__tests__/wire-contract.test.ts` gate parity. Go dependencies:
`gosnmp/gosnmp` (SNMP), `google.golang.org/grpc` + proto (Starlink), `net/http` (UniFi, HA).
Kasa adapter: subprocess to python-kasa CLI or community Go client.

---

## 13. Success Criteria

1. An edge node with a managed SNMP-capable switch in scope reports per-interface `rxBps`/`txBps`
   to the portal within 30 seconds of a sustained traffic event
2. LLDP walk produces `PEER_OF` relationships for every adjacent switch port pair, visible as L2
   edges in the topology graph
3. A Kasa HS105 plug is discovered, linked to its ARP host via MAC, and reports energy draw in the
   device detail panel
4. A Starlink dish is auto-detected, reported as `satellite_internet` CI, and its throughput appears
   as the uplink metric on the topology graph
5. When Home Assistant is configured, every HA device appears in DPF inventory with `manufacturer`,
   `model`, and `areaId`, deduplicated against the ARP-discovered host
6. Disabling all adapters leaves the existing Phase 0 discovery behavior unchanged — zero regressions
7. Mode 4 Go binary passes wire-contract test suite against the same portal endpoints

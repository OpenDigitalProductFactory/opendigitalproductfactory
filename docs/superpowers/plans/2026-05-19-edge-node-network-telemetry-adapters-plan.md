# Edge Node — Network Telemetry & Adapter Collectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Extend the Phase 0 edge node with per-interface throughput metrics, L2 LLDP topology, and optional vendor adapter collectors (UniFi, Kasa, Starlink, Home Assistant).

**Architecture:** Two channels extend the existing sweep loop: `discovery.lldp` submits LLDP-derived L2 topology via the existing `/api/v1/edge/discovery-runs` endpoint; `metrics.network` runs a separate faster loop and POSTs `InterfaceMetric[]` to a new `/api/v1/edge/metrics` endpoint. Adapter collectors (UniFi, Kasa, Starlink, HA) are optional plugins activated by `adapters.json`; each maps vendor data to the shared `ObservationItem` shape. The portal holds metrics in an in-memory singleton cache (`apps/web/lib/edge/metrics-cache.ts`) and fans out to browser clients via WebSocket.

**Tech Stack:** TypeScript (Mode 1, `services/edge-node/`); `net-snmp` npm package for SNMP table walks; `@grpc/grpc-js` + `@grpc/proto-loader` for Starlink; `tplink-smarthome-api` for Kasa; `home-assistant-js-websocket` for HA; Next.js App Router for portal routes.

---

## Phase 1 — SNMP ifTable, LLDP Walk, Metrics Channel

### Task 1: Extend `RESERVED_CAPABILITIES` and heartbeat/enroll responses

**Files:**
- Modify: `packages/db/src/edge-node-types.ts:71-80`
- Modify: `apps/web/app/api/v1/edge/heartbeat/route.ts:166-175`
- Modify: `apps/web/app/api/v1/edge/enroll/route.ts` (response body)
- Modify: `services/edge-node/src/api-client.ts:36-42` (HeartbeatResponse + EnrollResponse types)
- Test: `apps/web/app/api/v1/edge/heartbeat/route.test.ts`
- Test: `apps/web/app/api/v1/edge/enroll/route.test.ts`

- [ ] **Step 1:** In `packages/db/src/edge-node-types.ts`, add `"discovery.lldp"` and `"metrics.network"` to `RESERVED_CAPABILITIES` array (after `"discovery.software"` and `"metrics.host"` respectively). Keep alphabetical within each group.
- [ ] **Step 2:** In `services/edge-node/src/api-client.ts`, add `metricsIntervalSec: number` to both `HeartbeatResponse` and `EnrollResponse` types. Default 30 (not optional — always returned).
- [ ] **Step 3:** Write a failing test in `heartbeat/route.test.ts`: POST heartbeat → response body includes `metricsIntervalSec` field as a number ≥ 0.
- [ ] **Step 4:** Run `npx vitest run apps/web/app/api/v1/edge/heartbeat/route.test.ts` — confirm it fails.
- [ ] **Step 5:** In `apps/web/app/api/v1/edge/heartbeat/route.ts` (line 166-175), add `metricsIntervalSec: 30` to the JSON response body alongside the existing fields. Hardcode 30 as the default — no DB column yet; operator overrides come in a later task.
- [ ] **Step 6:** Similarly add `metricsIntervalSec: 30` to the enroll route's response body.
- [ ] **Step 7:** Run `npx vitest run apps/web/app/api/v1/edge/heartbeat/route.test.ts` — confirm it passes.
- [ ] **Step 8:** Run `pnpm --filter web typecheck` — fix any errors.
- [ ] **Step 9:** Commit with `-s`: `feat(edge): add discovery.lldp, metrics.network capabilities; metricsIntervalSec in heartbeat+enroll responses`

---

### Task 2: Add `net-snmp` package and SNMP ifTable walk

**Files:**
- Modify: `services/edge-node/package.json`
- Create: `services/edge-node/src/collectors/snmp-iftable.ts`
- Test: `services/edge-node/src/collectors/snmp-iftable.test.ts`

The existing `snmp-poll.ts` shells out to the `snmpget` binary one OID at a time. Table walks require `getBulk`. Add `net-snmp` npm package to replace the subprocess approach for the new ifTable + LLDP walks. The existing `snmpget` subprocess path in `snmp-poll.ts` stays unchanged for now — YAGNI.

- [ ] **Step 1:** In `services/edge-node/package.json`, add to `dependencies`: `"net-snmp": "^3.11.4"`. Run `pnpm install` inside `services/edge-node/`.
- [ ] **Step 2:** Create `services/edge-node/src/collectors/snmp-iftable.ts`. Define and export:

```typescript
export interface IfTableEntry {
  ifIndex: number;
  ifDescr: string;        // OID 1.3.6.1.2.1.2.2.1.2
  ifAlias: string;        // OID 1.3.6.1.2.1.31.1.1.1.18
  ifOperStatus: 1 | 2 | 3; // 1=up 2=down 3=testing
  ifHighSpeed: number;    // Mbps, OID 1.3.6.1.2.1.31.1.1.1.15
  ifHCInOctets: bigint;   // OID 1.3.6.1.2.1.31.1.1.1.6  (64-bit, stored as decimal string in JSON)
  ifHCOutOctets: bigint;  // OID 1.3.6.1.2.1.31.1.1.1.10
}

// Walks the ifTable using net-snmp getBulk. Returns [] on error.
export async function walkIfTable(
  host: string,
  community: string,
  port: number,
  timeoutMs: number,
): Promise<IfTableEntry[]>
```

- [ ] **Step 3:** Write failing tests in `snmp-iftable.test.ts`:
  - `walkIfTable` with a mock SNMP session returns `IfTableEntry[]` with correct types
  - BigInt fields (`ifHCInOctets`, `ifHCOutOctets`) are `bigint`, not `number`
  - An unreachable host returns `[]` with no throw
- [ ] **Step 4:** Run tests — confirm they fail.
- [ ] **Step 5:** Implement `walkIfTable` using `net-snmp`'s `session.getBulk()` or `session.subtree()` for each ifTable OID range. Use `Promise`-wrapping of the callback API. Parse each varbind: for 64-bit `Counter64` type, read `.value` as a Buffer and convert via `BigInt('0x' + buf.toString('hex'))` or use the `Integer64` helper from net-snmp.
- [ ] **Step 6:** Run tests — confirm they pass.
- [ ] **Step 7:** Run `pnpm --filter dpf-edge-node typecheck`.
- [ ] **Step 8:** Commit: `feat(edge): add snmp-iftable walker using net-snmp getBulk`

---

### Task 3: Counter snapshot persistence (stateful delta computation)

**Files:**
- Create: `services/edge-node/src/collectors/snmp-counters.ts`
- Test: `services/edge-node/src/collectors/snmp-counters.test.ts`

BigInt cannot be JSON-serialised directly. Counters are persisted as decimal strings.

- [ ] **Step 1:** Create `snmp-counters.ts`. Define and export:

```typescript
export interface CounterRecord {
  inOctets: string;   // decimal string representation of bigint
  outOctets: string;  // decimal string representation of bigint
  sampledAt: number;  // epoch ms
}

export interface CounterSnapshot {
  [deviceKey: string]: {
    [ifIndex: number]: CounterRecord;
  };
}

// Load from disk. Returns {} if file missing or parse error.
export function loadCounters(stateDir: string): CounterSnapshot

// Persist to disk atomically (write tmp, rename).
export function saveCounters(stateDir: string, snapshot: CounterSnapshot): void

// Compute bps rate between two readings.
// Returns undefined if prev is undefined (first poll) or counter wrapped.
export function computeRate(
  now: CounterRecord,
  prev: CounterRecord | undefined,
): { rxBps: number; txBps: number } | undefined
```

- [ ] **Step 2:** Write failing tests:
  - `loadCounters` returns `{}` when file is missing
  - `saveCounters` writes JSON with decimal strings, `loadCounters` reads them back
  - `computeRate` returns `undefined` when `prev` is `undefined`
  - `computeRate` computes correct bps: prev `inOctets="1000"`, now `inOctets="9000"`, elapsed 1000ms → rxBps = 8000 * 8 / 1 = 64000 bits/s... wait: `(9000-1000)*8 / (1000/1000) = 64000 bps`. ✓
  - `computeRate` returns `undefined` when `now.inOctets < prev.inOctets` (counter wrap detection)
- [ ] **Step 3:** Run — confirm fail.
- [ ] **Step 4:** Implement. For wrap detection: `BigInt(now.inOctets) < BigInt(prev.inOctets)`. For rate: `Number((BigInt(now.inOctets) - BigInt(prev.inOctets)) * 8n) / ((now.sampledAt - prev.sampledAt) / 1000)`.
- [ ] **Step 5:** Run — confirm pass.
- [ ] **Step 6:** Commit: `feat(edge): snmp counter snapshot persistence with bigint decimal strings`

---

### Task 4: Integrate ifTable walk into sweep — produce `InterfaceMetric[]`

**Files:**
- Modify: `services/edge-node/src/sweep.ts`
- Create: `services/edge-node/src/metrics-loop.ts`
- Modify: `services/edge-node/src/api-client.ts`
- Test: `services/edge-node/src/metrics-loop.test.ts`

The metrics loop is separate from the discovery sweep. It runs at `metricsIntervalSec` cadence and calls SNMP ifTable walk + any active adapter collectors, then POSTs to `/api/v1/edge/metrics`.

- [ ] **Step 1:** In `api-client.ts`, add `MetricsEnvelope` type (matching spec §6.1) and `submitMetrics(nodeToken, body): Promise<void>` method. Pattern identical to `submitDiscoveryRun`.

```typescript
export type InterfaceMetric = {
  deviceKey: string;
  ifIndex?: number;
  ifName: string;
  rxBps: number;
  txBps: number;
  rxErrors?: number;
  txErrors?: number;
  operStatus: "up" | "down" | "unknown";
  speedMbps?: number;
  rawData?: Record<string, unknown>;
};

export type MetricsEnvelope = {
  runKey: string;
  observedAt: string;
  metricsVersion: "1";
  interfaces: InterfaceMetric[];
};
```

- [ ] **Step 2:** Create `services/edge-node/src/metrics-loop.ts`. Export `runMetricsLoop(opts)`. It should:
  1. Sleep `metricsIntervalSec` seconds between ticks (read from `state`)
  2. Per tick: call `collectSnmpIfTableMetrics(snmpTargets, stateDir)` which walks ifTable + computes delta using counter snapshots, returns `InterfaceMetric[]`
  3. Build `MetricsEnvelope` with fresh `runKey`
  4. POST via `api.submitMetrics(state.nodeToken, envelope)`
  5. On error: log warning, do not crash the loop

- [ ] **Step 3:** Write failing tests for `metrics-loop.ts`:
  - Loop runs exactly N times when `maxIterations: N` provided
  - `submitMetrics` is called with a valid `MetricsEnvelope`
  - Empty interfaces list still submits (no metrics yet = valid first run)
  - Loop continues after a POST error (does not throw)
- [ ] **Step 4:** Run — fail.
- [ ] **Step 5:** Implement `runMetricsLoop` following the same structural pattern as `runSweepLoop` in `sweep.ts` (test seam for sleep, maxIterations, api adapter).
- [ ] **Step 6:** In `services/edge-node/src/index.ts`, launch `runMetricsLoop` alongside `runSweepLoop` and `runHeartbeatLoop` using `Promise.race`. `metricsIntervalSec` comes from `state.metricsIntervalSec`. **Wire the population path**: in `services/edge-node/src/state.ts` (or wherever `state` is updated from enroll/heartbeat responses), add `metricsIntervalSec: number` to the `EdgeNodeState` type and populate it from the enroll response (Task 1 added `metricsIntervalSec` to `EnrollResponse`) and update it on each heartbeat response (same field added to `HeartbeatResponse`). Default to `30` if not present for backward compat with old portal versions.
- [ ] **Step 7:** Run all edge-node tests: `pnpm --filter dpf-edge-node test`.
- [ ] **Step 8:** Commit: `feat(edge): metrics loop, InterfaceMetric type, submitMetrics client method`

---

### Task 5: Portal — `/api/v1/edge/metrics` endpoint + in-memory cache

**Files:**
- Create: `apps/web/lib/edge/metrics-cache.ts`
- Create: `apps/web/app/api/v1/edge/metrics/route.ts`
- Create: `apps/web/app/api/v1/edge/metrics/route.test.ts`

- [ ] **Step 1:** Create `apps/web/lib/edge/metrics-cache.ts`:

```typescript
// Singleton in-memory cache. TTL: 90 seconds.
// Key: `${nodeId}::${deviceKey}::${ifName}`

export interface CachedMetric {
  metric: InterfaceMetric;
  expiresAt: number;  // epoch ms
}

const cache = new Map<string, CachedMetric>();
const TTL_MS = 90_000;

export function writeMetrics(nodeId: string, interfaces: InterfaceMetric[]): void
export function getLatestMetricsForEdge(
  sourceDeviceKey: string,
  targetDeviceKey: string,
): InterfaceMetric | undefined
export function getAllMetrics(nodeId: string): InterfaceMetric[]
export function pruneExpired(): void  // call on each write to keep Map bounded
```

- [ ] **Step 2:** Write failing tests for `metrics-cache.ts`:
  - `writeMetrics` stores entries; `getAllMetrics` retrieves them
  - Entries expire after 90 seconds (use fake `Date.now`)
  - `pruneExpired` removes stale entries; Map size stays bounded
  - `getLatestMetricsForEdge` returns `undefined` when no match
- [ ] **Step 3:** Run — fail.
- [ ] **Step 4:** Implement `metrics-cache.ts`. `getLatestMetricsForEdge` should match by `deviceKey` prefix against the cache keys — both `source` and `target` device keys are checked; first match wins (approximation sufficient for Phase 1).
- [ ] **Step 5:** Create `apps/web/app/api/v1/edge/metrics/route.ts`. Follow the same pattern as `discovery-runs/route.ts`:
  1. `resolveEdgeNodeAuth` — same auth as other edge routes
  2. `checkEdgeRateLimit("edge.metrics", edgeNodeId)` — min 1 request per 5 seconds
  3. Parse body: validate `metricsVersion: "1"`, body ≤ 64 KB, `observedAt` within 5 minutes
  4. `writeMetrics(authResult.nodeId, body.interfaces)` — write to cache
  5. **WebSocket fanout (spec §6.2)**: After `writeMetrics`, fan out to browser clients subscribed to topology updates. Look in `apps/web/lib/` for an existing broadcast utility (search for `broadcast`, `socket`, or `realtime`). If no utility exists yet, add a stub `broadcastTopologyMetrics(orgId, payload)` that is a no-op — it will be wired when the portal WebSocket infrastructure lands. Call it here: `broadcastTopologyMetrics(authResult.organizationId, { type: "topology:metrics:update", payload: { interfaces: body.interfaces, observedAt: body.observedAt, nodeId: authResult.nodeId } })`.
  6. `writeEdgeNodeAudit(...)` — same audit pattern
  7. Return `{ ok: true }` with status 200
- [ ] **Step 6:** Write failing tests in `route.test.ts`:
  - Missing auth → 401
  - Valid body → 200 + `{ ok: true }`
  - Body > 64 KB → 413
  - `observedAt` more than 5 minutes old → 422
  - `metricsVersion` not `"1"` → 400
- [ ] **Step 7:** Run — fail. Implement. Run — pass.
- [ ] **Step 8:** Run `pnpm --filter web typecheck`.
- [ ] **Step 9:** Commit: `feat(portal): /api/v1/edge/metrics endpoint + in-memory metrics cache`

---

### Task 6: LLDP-MIB walk collector

**Files:**
- Create: `services/edge-node/src/collectors/lldp-walk.ts`
- Test: `services/edge-node/src/collectors/lldp-walk.test.ts`
- Modify: `services/edge-node/src/sweep.ts` (add lldp results to discovery envelope)

- [ ] **Step 1:** Create `lldp-walk.ts`. Define `LldpNeighbor`:

```typescript
export interface LldpNeighbor {
  localIfIndex: number;
  localIfDesc: string;
  remoteChassisId: string;   // lldpRemChassisId (usually MAC)
  remoteSysName: string;     // lldpRemSysName
  remotePortDesc: string;    // lldpRemPortDesc
}

export async function walkLldpNeighbors(
  host: string, community: string, port: number, timeoutMs: number,
): Promise<LldpNeighbor[]>
```

Walk OID subtree `1.0.8802.1.1.2.1.4.1.1` (lldpRemTable) using `net-snmp`. Map index `localPortNum` to `ifIndex` by also walking `lldpLocPortTable` (`1.0.8802.1.1.2.1.3.7.1.3`). Return `[]` on any error.

- [ ] **Step 2:** Write failing tests — mock SNMP session, verify correct OID parsing, verify empty return on error.
- [ ] **Step 3:** Run — fail. Implement. Run — pass.
- [ ] **Step 4:** Create `services/edge-node/src/collectors/lldp-walk-collector.ts`. Export `collectLldpWalk(targets, arpTable)`. For each SNMP target, calls `walkLldpNeighbors`, then:
  - Emits `ObservationItem` per discovered port: `observedKey: "snmp:<ip>/port/<ifIndex>"`, **`itemType: "switch_port"` (underscore — not "switch-port" with a hyphen; the spec §4.2 body uses a hyphen but the §4.2 naming note is authoritative: use underscore to match `network_device`, `wireless_ap`, etc.)**, `osiLayer: 2`
  - Emits `SubmissionRelationship` of type `PEER_OF` from `snmp:<ip>/port/<ifIndex>` to `arp:<resolved-ip>` (resolve via ARP table lookup on `remoteSysName` or `remoteChassisId`)
- [ ] **Step 5:** In `sweep.ts`, after `collectSnmpPoll`, call `collectLldpWalk(snmpTargets, arpItemsFromC1)`. Merge items + relationships into the discovery envelope. Add `"discovery.lldp"` to capabilities when LLDP results are non-empty.
- [ ] **Step 6:** Run `pnpm --filter dpf-edge-node test`.
- [ ] **Step 7:** Commit: `feat(edge): LLDP-MIB walk collector, switch_port items, PEER_OF relationships`

---

## Phase 2 — Adapter Collectors

### Task 7: Adapters config loader

**Files:**
- Create: `services/edge-node/src/collectors/adapters-config.ts`
- Test: `services/edge-node/src/collectors/adapters-config.test.ts`

- [ ] **Step 1:** Create `adapters-config.ts`. Define Zod schema matching spec §10. Export `resolveAdaptersConfig(stateDir): AdaptersConfig`. Path: `${stateDir}/adapters.json` (co-located with `snmp.json` pattern; env override `DPF_EDGE_ADAPTER_DIR`). Return `{}` if file missing. Warn (do not throw) if file is world-readable (same pattern as `snmp-config.ts`).
- [ ] **Step 2:** Write failing tests — missing file returns `{}`, valid JSON parses correctly, extra keys are stripped by Zod.
- [ ] **Step 3:** Run — fail. Implement. Run — pass.
- [ ] **Step 4:** Commit: `feat(edge): adapters.json config loader`

---

### Task 8: UniFi adapter collector

**Files:**
- Create: `services/edge-node/src/collectors/unifi.ts`
- Test: `services/edge-node/src/collectors/unifi.test.ts`

- [ ] **Step 1:** Create `unifi.ts`. Export `collectUnifi(config: UnifiConfig): Promise<{ items, relationships, metrics, warnings }>`. If `config` is undefined, return empty immediately.

Data flow (per spec §4.3):
1. `GET ${controllerUrl}/proxy/network/api/s/${site}/stat/device` with header `X-API-KEY: ${apiKey}`. If `tlsInsecure`, skip cert verification.
2. For each device in response: emit one `ObservationItem` (key `unifi:<device.mac>`) + one `SAME_AS` relationship to `arp:<device.ip>`.
3. For each device's `port_table[]`: if `rx_bytes-r` and `tx_bytes-r` are present, emit an `InterfaceMetric`.
4. Build `HOSTS` relationships from `uplink.mac` / `downlink_table`.

UniFi type map (add as constant):
```typescript
const UNIFI_TYPE_MAP: Record<string, { itemType: string; osiLayer: number }> = {
  usw: { itemType: "switch", osiLayer: 2 },
  uap: { itemType: "wireless_ap", osiLayer: 2 },
  ugw: { itemType: "gateway", osiLayer: 3 },
  udm: { itemType: "gateway", osiLayer: 3 },
};
```

- [ ] **Step 2:** Write failing tests with mocked `fetch`:
  - No config → `{ items: [], relationships: [], metrics: [], warnings: [] }`
  - Valid response → items contain one entry per device with correct `observedKey` and `itemType`
  - Port with `rx_bytes-r: 1250, tx_bytes-r: 3400` → `InterfaceMetric` with `rxBps: 10000, txBps: 27200` (bytes × 8)
  - Non-2xx response → empty items, one warning
- [ ] **Step 3:** Run — fail. Implement using `undici.request` (already a dependency). For `tlsInsecure`, pass `{ connect: { rejectUnauthorized: false } }` to undici.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Wire UniFi WebSocket reconnect in a separate exported function `subscribeUnifiEvents(config, onEvent)`. Uses Node.js `ws` package (add to package.json: `"ws": "^8.18.0"`). On `EVT_SW_*` / `EVT_AP_*` events, call `onEvent()`. Reconnect with 1s→2s→4s→8s→30s backoff.
- [ ] **Step 6:** In `metrics-loop.ts`, if `adaptersConfig.unifi` is set, call `collectUnifi` and merge `metrics` into the `MetricsEnvelope`. In `sweep.ts`, merge `items` and `relationships` into the discovery envelope.
- [ ] **Step 7:** Commit: `feat(edge): UniFi adapter collector (discovery + metrics + WS events)`

---

### Task 9: TP-Link Kasa adapter

**Files:**
- Create: `services/edge-node/src/collectors/kasa.ts`
- Test: `services/edge-node/src/collectors/kasa.test.ts`
- Modify: `services/edge-node/package.json`

- [ ] **Step 1:** Add `"tplink-smarthome-api": "^6.1.1"` to dependencies. Run `pnpm install`.
- [ ] **Step 2:** Create `kasa.ts`. Export `collectKasa(config?: KasaConfig): Promise<{ items, metrics, warnings }>`.

If `config?.disabled === true`, return empty immediately.

Discovery:
1. `const client = new Client()` from `tplink-smarthome-api`
2. `await client.startDiscovery({ discoveryTimeout: config?.discoveryTimeoutMs ?? 5000 })` — collect `device-new` events into array
3. For each device: call `device.getSysInfo()`, classify by model prefix:
   - HS105, EP25, KP115 → `itemType: "smart_plug"`
   - HS200, HS210, KS200M → `itemType: "smart_switch"`
   - Default → `smart_plug`
4. If plug has emeter: call `plug.emeter.getRealtime()` for energy data

- [ ] **Step 3:** Write failing tests using mocked `tplink-smarthome-api` Client:
  - `disabled: true` → empty result immediately
  - Device with model `"HS200"` → `itemType: "smart_switch"`
  - Device with model `"HS105"` → `itemType: "smart_plug"`, `emeter` in rawData
  - Emeter-capable device → `InterfaceMetric` with `operStatus: "up"` when `is_on === true`
- [ ] **Step 4:** Run — fail. Implement. Run — pass.
- [ ] **Step 5:** Commit: `feat(edge): TP-Link Kasa adapter (auto-discover smart plugs/switches)`

---

### Task 10: Starlink gRPC adapter

**Files:**
- Create: `services/edge-node/src/collectors/starlink.ts`
- Create: `services/edge-node/src/collectors/starlink-protos/` (vendored proto files)
- Test: `services/edge-node/src/collectors/starlink.test.ts`
- Modify: `services/edge-node/package.json`

- [ ] **Step 1:** Add dependencies: `"@grpc/grpc-js": "^1.13.4"`, `"@grpc/proto-loader": "^0.7.15"`. Run `pnpm install`.
- [ ] **Step 2:** Vendor the Starlink proto files. Download `spacex/api/device/device.proto` and related from `github.com/sparky8512/starlink-grpc-tools` at commit `HEAD` as of today. Place in `services/edge-node/src/collectors/starlink-protos/`. Add a `PROTO_SOURCE.md` noting the commit hash.
- [ ] **Step 3:** Create `starlink.ts`. Export `collectStarlink(config?: StarlinkConfig): Promise<{ item, metric, warnings } | null>`.

Auto-detect: attempt gRPC connect to `${config?.host ?? "192.168.100.1"}:${config?.port ?? 9200}`. Set connect deadline of 2 seconds. If `DEADLINE_EXCEEDED` or `UNAVAILABLE` → return `null` silently.

On success:
1. Call `GetStatus` → extract `state`, `uptime_s`, `downlink_throughput_bps`, `uplink_throughput_bps`, `pop_ping_latency_ms`, `pop_ping_drop_rate`
2. Call `GetDeviceInfo` → extract `id` (serial)
3. Emit one `ObservationItem` (key `starlink:<serial>`, type `satellite_internet`, osiLayer 3)
4. Emit one `InterfaceMetric` with `rxBps: downlink_throughput_bps`, `txBps: uplink_throughput_bps`

- [ ] **Step 4:** Write failing tests with mocked gRPC client. Verify: unreachable host returns `null`; connected host returns item + metric with correct rxBps/txBps.
- [ ] **Step 5:** Run — fail. Implement. Run — pass.
- [ ] **Step 6:** Commit: `feat(edge): Starlink gRPC adapter (auto-detect satellite throughput)`

---

### Task 11: Home Assistant bridge

**Files:**
- Create: `services/edge-node/src/collectors/home-assistant.ts`
- Test: `services/edge-node/src/collectors/home-assistant.test.ts`
- Modify: `services/edge-node/package.json`

- [ ] **Step 1:** Add `"home-assistant-js-websocket": "^9.4.0"`. Run `pnpm install`.
- [ ] **Step 2:** Create `home-assistant.ts`. Export `collectHomeAssistant(config: HaConfig, arpTable: Map<string, string>): Promise<{ items, relationships, warnings }>`.

If no config, return empty. Connect via WebSocket:
1. Send `config/device_registry/list` → get all devices
2. For each device:
   - `observedKey: "ha:<device.id>"`
   - `itemType`: derived from integration domain (kasa→smart_plug, zha/z_wave_js→smart_plug, media_player→"media_device", default→"smart_device")
   - `name: device.name`
   - `rawData: { manufacturer, model, swVersion, areaId, haIntegration, vendorIconModel: "${manufacturer}/${model}" }`
   - If `device.connections` contains a MAC tuple: emit `SAME_AS` to `arp:<ip>` (look up IP in arpTable by MAC)
- [ ] **Step 3:** Write failing tests with mocked HA WebSocket client. Verify: device with Kasa integration → `itemType: "smart_plug"`; device with MAC in connections → `SAME_AS` relationship to correct `arp:<ip>`.
- [ ] **Step 4:** Run — fail. Implement. Run — pass.
- [ ] **Step 5:** Commit: `feat(edge): Home Assistant bridge (device registry as inventory source)`

---

### Task 12: Wire all adapters into sweep and metrics loops

**Files:**
- Modify: `services/edge-node/src/sweep.ts`
- Modify: `services/edge-node/src/metrics-loop.ts`
- Modify: `services/edge-node/src/index.ts`

- [ ] **Step 1:** In `sweep.ts`, after existing collectors, call:
  - `collectUnifi(adaptersConfig.unifi)` — merge items + relationships
  - `collectKasa(adaptersConfig.kasa)` — merge items
  - `collectStarlink(adaptersConfig.starlink)` — merge item if non-null
  - `collectHomeAssistant(adaptersConfig.homeAssistant, arpIpMap)` — merge items + relationships
- [ ] **Step 2:** In `metrics-loop.ts`, collect metrics from:
  - SNMP ifTable walk (with counter delta)
  - `collectUnifi(...)` `.metrics`
  - `collectKasa(...)` `.metrics` (emeter only)
  - `collectStarlink(...)` `.metric` if non-null
- [ ] **Step 3:** In `index.ts`, load `adaptersConfig` from `resolveAdaptersConfig(config.stateDir)` and pass to sweep + metrics opts.
- [ ] **Step 4:** Run full test suite: `pnpm --filter dpf-edge-node test`. Fix any failures.
- [ ] **Step 5:** Run `pnpm --filter dpf-edge-node typecheck`.
- [ ] **Step 6:** Commit: `feat(edge): wire all adapter collectors into sweep + metrics loops`

---

### Task 13: Normalization — SAME_AS collapse in Authority Core

**Files:**
- Modify: `apps/web/lib/discovery-data.ts` (or wherever normalization runs)
- Modify: `apps/web/app/api/v1/edge/discovery-runs/route.ts` (trigger normalization after insert)
- Test: add unit test for normalization logic

The normalization pipeline collapses multiple items for the same physical device (linked by `SAME_AS`) into one canonical `InventoryEntity` with merged rawData. Priority order: UniFi (1.0) > SNMP (0.95) = Kasa (0.95) > HA (0.9) > nmap (0.85) > ARP (0.7).

- [ ] **Step 1:** Find the function that processes incoming `ObservationItem[]` from discovery-runs. Run: `grep -r "ObservationItem\|normaliz\|inventoryEntity\|items\.map" apps/web/lib/ apps/web/app/api/v1/edge/discovery-runs/ --include="*.ts" -l` to locate the insert/upsert logic. Read it to understand the current shape.
- [ ] **Step 2:** Write a failing test: two items with SAME_AS link (confidence 1.0 and 0.7) → normalized entity uses higher-confidence item's `name` and merges both `rawData` blobs; `discoveredVia` is an array with both source slugs.
- [ ] **Step 3:** Run — fail.
- [ ] **Step 4:** Implement `normalizeInventoryEntities(items, relationships)` that: walks SAME_AS chains, picks the highest-confidence item as canonical base, merges rawData from all linked items, writes a single upsert to `InventoryEntity` with `rawData.discoveredVia: string[]`.
- [ ] **Step 5:** Run — pass. Run `pnpm --filter web typecheck`.
- [ ] **Step 6:** Commit: `feat(portal): SAME_AS normalization — collapse multi-source CI records`

---

## Phase 3 — Mode 4 Go Parity (planned, not implemented here)

Mode 4 Go implementation in `services/edge-node-go/` follows after Mode 1 is verified on real hardware. Wire contract tests at `apps/web/app/api/v1/edge/__tests__/wire-contract.test.ts` gate parity. Tracked as `BI-EDGE-XP-04-MODE1-GO-RETROFIT` in the backlog.

---

## Verification

After all Phase 1 tasks:
- [ ] Deploy edge node container against a local DPF install with an SNMP-capable switch configured
- [ ] Verify portal receives metrics at `/api/v1/edge/metrics` (check server logs)
- [ ] Navigate to inventory topology graph — confirm LLDP `PEER_OF` edges appear as L2 links
- [ ] Confirm existing Phase 0 discovery items are unchanged

After Phase 2 tasks:
- [ ] With `adapters.json` containing UniFi config: verify switch devices appear with `itemType: "switch"` and port metrics in cache
- [ ] With no `adapters.json`: verify Phase 0 behavior unchanged (zero regressions)
- [ ] Kasa: verify HS200 appears as `smart_switch`, HS105 as `smart_plug` with emeter in rawData
- [ ] Starlink: verify `satellite_internet` CI created, throughput in metrics cache

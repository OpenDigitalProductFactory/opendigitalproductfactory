# Topology View — Throughput Annotations & Product Icons

| Field | Value |
|-------|-------|
| **Epic** | EP-TOPO-FIDELITY-001 |
| **IT4IT Alignment** | §5.7 Operate (CMDB Workspace, visual management surface), §5.2 Explore (product dependency awareness) |
| **Depends On** | EP-EDGE-TELEM-001 (`2026-05-19-edge-node-network-telemetry-adapters-design.md`) for metrics data; `2026-04-02-multi-layer-topology-graph-design.md` (OSI model, Phase 2 implemented); `2026-04-03-topology-graph-views-design.md` (named views, implemented) |
| **Status** | Draft |
| **Created** | 2026-05-19 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

---

## 1. Problem Statement

The topology graph renders the right *structure* — nodes for devices, edges for relationships, OSI
layer swimlanes, hierarchical and radial layouts — but it falls short of the visual and operational
fidelity of tools like Ubiquiti UniFi, OpenText NNMI, and LibreNMS in three concrete ways:

1. **No per-link throughput data.** Every edge looks identical regardless of whether it is carrying
   1 Gbps or 1 Kbps. There is no visual signal for saturation, degradation, or idle links.

2. **Unicode symbols instead of product icons.** Devices are represented as △ ◇ ○ □ — abstract and
   indistinguishable from one another at a glance. Commercial tools show actual product photos or
   vendor-branded SVGs, making device identity immediately obvious.

3. **Impact Blast Radius and Dependency Audit views have no data.** The UI layouts, layout
   algorithms (radial and ELK.js swimlane), and Neo4j queries all exist and are implemented.
   The missing piece is the server action wrappers that fetch data from Neo4j and serve it to the
   component. This gap was documented in `2026-04-03-topology-graph-views-design.md` §2.5 and has
   not yet been closed.

This spec closes all three gaps. The first is contingent on EP-EDGE-TELEM-001. The second and third
are independent of any external data source.

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **Close the spec-documented data gap first** | The impact/dependency server actions are the highest-ROI change: the UI and graph queries already exist. Closing this gap makes two views functional with no new data sources or dependencies. |
| P2 | **Throughput annotation is additive** | If no metrics data is available (EP-EDGE-TELEM-001 not deployed), the topology renders exactly as today. Metrics data enhances but does not break the base graph. |
| P3 | **Icon chain degrades gracefully** | Product icon → NetBox image → generic SVG → Unicode symbol. Every device always has a visual. No blank nodes. |
| P4 | **Canvas performance is non-negotiable** | Icons are pre-loaded into a browser-side image cache (keyed by URL). No per-frame fetch. No image decode during animation. The canvas renderer draws from cache only. |
| P5 | **Throughput labels match the domain** | Auto-scale to the appropriate unit: < 1 Kbps → bps, < 1 Mbps → Kbps, < 1 Gbps → Mbps, ≥ 1 Gbps → Gbps. Both ↓ (rx) and ↑ (tx) shown, as in UniFi. |
| P6 | **Link width encodes utilization** | Width proportional to `max(rxBps, txBps) / speedBps`. Zero-traffic links are thin; saturated links are thick and highlighted. This communicates load without text at a distance. |
| P7 | **Status colors are accessible** | Use CSS custom properties (`var(--dpf-success)`, `var(--dpf-warning)`, `var(--dpf-error)`) for link status coloring. Never hardcode hex. |

---

## 3. Gap 1 — Server Action Wrappers for Impact & Dependency Views

### 3.1 Background

`TopologyGraph.tsx` has fully wired Impact Blast Radius and Dependency Audit views. The view
switcher renders them. The layout algorithms (radial BFS, ELK.js swimlane) compute positions. The
canvas renders nodes and edges. What is missing: when these views are selected, the component
currently uses whatever graph data was passed in from the parent page — which is `getFullGraphData()`
(the exploration view's all-nodes query). The views need their own targeted queries.

`2026-04-03-topology-graph-views-design.md` §2.5 specifies two server actions:
- `getImpactData(ciId)` → wraps `getDownstreamImpact(ciId)` from `@dpf/db`
- `getDependencyAuditData(productId)` → wraps `getLayeredDependencyStack(productId)` from `@dpf/db`

**Both server actions already exist** in `apps/web/lib/actions/graph.ts` (confirmed). Both Neo4j
functions are implemented. The only remaining gap is **wiring `TopologyGraph.tsx` to call them**
when the user switches views — the component does not yet invoke these actions or handle their
async results. Phase 1 work is component-wiring only; do not rewrite the server actions.

### 3.2 Implementation

**Server actions**: Both `getImpactData(ciId)` and `getDependencyAuditData(productId)` already
exist in `apps/web/lib/actions/graph.ts`. No changes to those files.

**Component wiring** (`TopologyGraph.tsx`):

The component currently receives a static `data: GraphData` prop from the parent page. For impact
and dependency views, the data must be fetched client-side when the view switches (because `ciId` or
`productId` is determined by user interaction — which node they click or which product is focused).

Add `const [isPending, startTransition] = useTransition()` and a `dynamicData` state:

```typescript
const [isPending, startTransition] = useTransition();
const [dynamicData, setDynamicData] = useState<GraphData | null>(null);

// When selectedView switches to "impact-blast-radius" and a focusNodeId is set:
useEffect(() => {
  if (selectedView === "impact-blast-radius" && focusNodeId) {
    startTransition(() => {
      // async call is OUTSIDE startTransition; only the state setter goes inside
      void getImpactData(focusNodeId).then(setDynamicData);
    });
  } else if (selectedView === "dependency-audit" && focusNodeId) {
    startTransition(() => {
      void getDependencyAuditData(focusNodeId).then(setDynamicData);
    });
  } else {
    setDynamicData(null);  // restore base graph on view switch away
  }
}, [selectedView, focusNodeId]);

// Effective data for layout and render:
const effectiveData = dynamicData ?? data;
```

> **React API note**: `startTransition` accepts a synchronous callback — the async call must be
> *outside* the transition; only the resulting `setDynamicData` call is inside. Wrapping an `async`
> function directly in `startTransition` silently discards the Promise and the state update never
> fires.

`dynamicData` overrides the static `data` prop when non-null. All downstream layout and render code
reads `effectiveData`.

**Loading state**: While `isPending` is true, render a semi-transparent overlay with a centred
spinner on the canvas. The layout engine does not fire until `dynamicData` is available.

---

## 4. Gap 2 — GraphData Link Throughput Extensions

### 4.1 Extend the Link Type

**File: `apps/web/lib/actions/graph.ts`** — extend the `GraphData` type:

```typescript
export type GraphDataLink = {
  source: string;
  target: string;
  type: string;              // relationship type (HOSTS, MEMBER_OF, etc.)
  // New — optional throughput fields:
  rxBps?: number;            // bits per second received (from portal metrics cache)
  txBps?: number;            // bits per second transmitted
  speedMbps?: number;        // nominal link speed (from SNMP ifHighSpeed or UniFi)
  operStatus?: "up" | "down" | "unknown";
  poeWatts?: number;         // optional — for PoE ports
};
```

The `GraphData` type currently uses an inline `links` array type. Extract it to `GraphDataLink` as
the canonical reference.

### 4.2 Populate from Metrics Cache

**File: `apps/web/lib/actions/graph.ts`** — extend `getFullGraphData()` and the new targeted
actions to merge throughput data into their returned links:

```typescript
// Server-side: pull latest metrics from the in-memory metrics cache
function enrichLinksWithMetrics(links: GraphDataLink[]): GraphDataLink[] {
  return links.map((link) => {
    const metric = getLatestMetricsForEdge(link.source, link.target);
    if (!metric) return link;
    return {
      ...link,
      rxBps: metric.rxBps,
      txBps: metric.txBps,
      speedMbps: metric.speedMbps,
      operStatus: metric.operStatus,
    };
  });
}
```

`getLatestMetricsForEdge` queries the in-memory metrics cache (written by `POST /api/v1/edge/metrics`
handler) by matching link endpoints to `deviceKey` + `ifName`. Cache lookups are O(1) — no DB query.

### 4.3 WebSocket Push Updates

When the browser is viewing the topology, it maintains a WebSocket subscription to
`topology:metrics:update` events (§6.2 of EP-EDGE-TELEM-001). On receipt, the component updates
its local link-throughput state and triggers a canvas redraw — without refetching the full graph
structure.

```typescript
// In TopologyGraph.tsx
useEffect(() => {
  const ws = subscribeToTopologyMetrics(organizationId);
  ws.onmessage = (event) => {
    const update = JSON.parse(event.data);
    if (update.type === "topology:metrics:update") {
      setLinkMetrics(mergeLinkMetrics(linkMetrics, update.payload.interfaces));
    }
  };
  return () => ws.close();
}, [organizationId]);
```

The `setLinkMetrics` call merges the new interface metrics into a local `Map<deviceKey+ifName,
InterfaceMetric>` and triggers a `requestAnimationFrame`-gated canvas redraw.

---

## 5. Gap 3 — Canvas Throughput Rendering

### 5.0 CSS Variable Resolution for Canvas

CSS custom properties (`var(--dpf-*)`) resolve in the CSS cascade and are **not available inside a
Canvas 2D rendering context**. Assigning `ctx.strokeStyle = "var(--dpf-error)"` silently falls back
to black. The correct pattern is to resolve the variables once from a DOM element and cache the
resulting hex strings:

```typescript
// Call once in a useEffect after mount:
function resolveCanvasColors(canvasEl: HTMLCanvasElement): CanvasColors {
  const style = getComputedStyle(canvasEl);
  return {
    error:   style.getPropertyValue("--dpf-error").trim()   || "#ef4444",
    warning: style.getPropertyValue("--dpf-warning").trim() || "#f59e0b",
    border:  style.getPropertyValue("--dpf-border").trim()  || "#334155",
    muted:   style.getPropertyValue("--dpf-muted").trim()   || "#64748b",
  };
}
```

Store the result as `canvasColors` in a `useRef` or component state. Re-resolve on system
theme change (listen for `prefers-color-scheme` media query change). The hardcoded fallback hex
values are safety nets only; the CSS variable takes precedence in any correctly themed install.

### 5.1 Link Width by Utilization

In the canvas render loop, before drawing each edge, compute utilization:

```typescript
function drawEdge(ctx, link, source, target, linkMetrics) {
  const metric = linkMetrics.get(edgeKey(link));
  const utilization = metric && metric.speedMbps
    ? Math.max(metric.rxBps, metric.txBps) / (metric.speedMbps * 1_000_000)
    : 0;

  // Width: 1px (idle) → 4px (saturated)
  ctx.lineWidth = 1 + Math.min(utilization, 1) * 3;

  // Color by status — CSS custom properties do not resolve inside Canvas 2D context.
  // Resolve them once at mount time and cache the hex values.
  // See resolveCanvasColors() below.
  if (metric?.operStatus === "down") {
    ctx.strokeStyle = canvasColors.error;
  } else if (utilization > 0.8) {
    ctx.strokeStyle = canvasColors.warning;
  } else {
    ctx.strokeStyle = LINK_COLORS[link.type] ?? canvasColors.border;
  }

  // Draw the link
  ctx.beginPath();
  ctx.moveTo(source.x, source.y);
  ctx.lineTo(target.x, target.y);
  ctx.stroke();
}
```

### 5.2 Throughput Label on Links

When zoom level is sufficient (scale > 0.6, to avoid label clutter at low zoom), draw throughput
labels centered on each edge:

```typescript
function drawLinkLabel(ctx, link, source, target, metric) {
  if (!metric || (!metric.rxBps && !metric.txBps)) return;

  const midX = (source.x + target.x) / 2;
  const midY = (source.y + target.y) / 2;

  const rxLabel = formatBps(metric.rxBps);
  const txLabel = formatBps(metric.txBps);

  ctx.font = "9px system-ui";
  ctx.fillStyle = "var(--dpf-muted)";
  ctx.textAlign = "center";
  ctx.fillText(`↓${rxLabel} ↑${txLabel}`, midX, midY - 4);
}

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`;
  if (bps >= 1_000_000)     return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000)         return `${(bps / 1_000).toFixed(1)} Kbps`;
  return `${bps.toFixed(0)} bps`;
}
```

The label sits slightly above the midpoint of the edge. At low zoom, only edge width and color
communicate load — labels are hidden to keep the canvas readable.

---

## 6. Gap 3 — Device Product Icons

### 6.1 DeviceVisual Type Extension

**File: `apps/web/lib/graph/device-icons.ts`**

Extend `DeviceVisual` with an optional icon URL:

```typescript
export type DeviceVisual = {
  symbol: string;     // Unicode fallback (always set)
  color: string;
  size: number;
  label: string;
  iconUrl?: string;   // New — resolved at runtime via lookup chain
};
```

### 6.2 Icon Lookup Chain

Add `getDeviceIconUrl(ciType, vendorIconModel)`:

```typescript
export function getDeviceIconUrl(
  ciType: string | undefined | null,
  vendorIconModel: string | undefined | null,
): string | undefined {
  if (!vendorIconModel) return undefined;

  // 1. UniFi fingerprint DB
  const unifiIcon = UNIFI_FINGERPRINT_DB[vendorIconModel];
  if (unifiIcon) return unifiIcon;  // static.ui.com CDN URL

  // 2. NetBox device-type library
  const netboxIcon = NETBOX_DEVICE_IMAGES[vendorIconModel.toLowerCase()];
  if (netboxIcon) return netboxIcon;  // /device-images/{vendor}/{model}.svg (bundled)

  // 3. Generic type SVG
  const genericIcon = GENERIC_DEVICE_SVGS[ciType ?? ""];
  if (genericIcon) return genericIcon;  // /icons/network/{type}.svg (bundled)

  return undefined;  // → symbol fallback in renderer
}
```

### 6.3 Static Asset Bundling

**UniFi fingerprint database**:
- Source: `fingerprint-database.json` from `github.com/CANTI-BOT/UniFi-Icon-Browser`
- **Bundle path**: `apps/web/lib/graph/data/unifi-fingerprints.json` — a module-importable path,
  **not** `public/`. Files in `public/` are HTTP-served assets, not importable as modules.
- Import in `device-icons.ts` as `import UNIFI_FINGERPRINT_DB from './data/unifi-fingerprints.json'`
  (Next.js supports JSON imports natively via TypeScript `resolveJsonModule`)
- Size: ~800 KB uncompressed; Brotli-compressed to ~120 KB on the wire. Acceptable as a module
  import — it is loaded once at module initialisation, not per-request.
- Update cadence: Renovate or a periodic sync script (not automated in Phase 1)

**Generic network device SVGs** (Apache 2.0 from `network-automation/networking-icons`):
- Bundle relevant icons at: `apps/web/public/icons/network/`
- Subset: router.svg, switch.svg, access-point.svg, smart-plug.svg, smart-switch.svg,
  satellite.svg, docker-host.svg, server.svg, cloud.svg
- ~15–25 SVG files; negligible bundle size

**NetBox device-type images**:
- Too large to bundle fully (~2 GB for all vendors)
- **Selective approach**: For vendors actually present in DPF inventories (detected from normalized
  `manufacturer` field), download and cache images on the portal host at startup
- Or: serve via proxied fetch from `raw.githubusercontent.com/netbox-community/devicetype-library/`
  with a server-side cache (1-week TTL)
- Phase 1: defer NetBox images; UniFi fingerprint DB + generic SVGs cover the immediate need

### 6.4 Browser Image Cache (OffscreenCanvas)

**File: `apps/web/lib/graph/icon-cache.ts`** (new):

```typescript
const imageCache = new Map<string, HTMLImageElement | null>();
// null = load attempted but failed; prevents retry storm

// Module-level redraw signal — set once by TopologyGraph on mount:
let onIconLoaded: (() => void) | null = null;
export function setIconLoadCallback(fn: () => void): void { onIconLoaded = fn; }

export function getOrLoadIcon(url: string): HTMLImageElement | null {
  if (imageCache.has(url)) return imageCache.get(url) ?? null;

  // Mark as loading (prevents duplicate loads)
  imageCache.set(url, null);

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    imageCache.set(url, img);
    // Signal canvas to request a redraw — component sets this callback on mount
    onIconLoaded?.();
  };
  img.onerror = () => {
    // Retain null → symbol fallback used until next session
  };
  img.src = url;
  return null;  // Not yet loaded; renderer uses symbol this frame
}
// TopologyGraph mount effect:
//   setIconLoadCallback(() => requestAnimationFrame(() => redrawCanvas()));
// This fires once per loaded image and queues a single frame redraw —
// no React state update, no re-render, no memory leak.
```

### 6.5 Canvas Renderer Icon Drawing

In the node-draw loop in `TopologyGraph.tsx`, replace:

```typescript
// BEFORE (Unicode symbol):
ctx.fillText(dv.symbol, node.x, node.y);
```

With:

```typescript
// AFTER (icon chain):
const iconUrl = getDeviceIconUrl(node.ciType, node.vendorIconModel);
const img = iconUrl ? getOrLoadIcon(iconUrl) : null;

if (img) {
  const iconSize = radius * 2;
  ctx.drawImage(img, node.x - iconSize / 2, node.y - iconSize / 2, iconSize, iconSize);
} else {
  ctx.fillText(dv.symbol, node.x, node.y);
}
```

When an image finishes loading, the `iconLoadCallback` triggers a canvas redraw via
`requestAnimationFrame`. Subsequent frames use the cached `HTMLImageElement` directly — no reload.

### 6.6 GraphNode Extension

The `GraphData["nodes"][0]` type needs `vendorIconModel` to reach the renderer:

```typescript
export type GraphDataNode = {
  id: string;
  label: string;
  ciType?: string;
  osiLayer?: number;
  status?: string;
  // New:
  vendorIconModel?: string;  // set from InventoryEntity rawData.vendorIconModel
  areaId?: string;           // room/zone from HA or manual config
};
```

Populate in `mapNodes()` within `apps/web/lib/actions/graph.ts` from the Neo4j node's `rawData`
property blob.

---

## 7. Building Management Product Integration

When a DPF user creates a "Building Management" or "Home Infrastructure" Digital Product in the
portfolio and assigns their LAN devices to it (via the existing taxonomy → product relationship), the
product's Health tab gains operational meaning:

**Health tab additions** (product detail page, `/portfolio/product/[id]`):

| Metric | Source | Display |
|--------|--------|---------|
| Internet uptime | Starlink `operStatus` | Uptime gauge |
| WAN throughput | Starlink `rxBps` / `txBps` | Sparkline, last 24h |
| Switch port utilization | SNMP ifTable / UniFi ports | Per-port bar chart |
| Smart plug energy draw | Kasa HS105 emeter | Watts per outlet, kWh this month |
| Device count (online / total) | InventoryEntity count by product | "12/14 devices online" |
| Alert: device offline | `operStatus === "down"` | Red badge |

This is achieved by extending the existing product Health tab data loader to query the metrics cache
for all `InfraCI` items linked to the product via the Neo4j graph (existing `DEPENDS_ON` /
`BELONGS_TO` traversal), and merging the latest `InterfaceMetric` for each.

**Room/area grouping**: Devices with `areaId` set (from HA or manual config) can be grouped by
room in the inventory panel — "Living Room (3 devices)", "Home Office (2 devices)". This uses the
`SubnetGroupedInventoryPanel` pattern but grouped by `areaId` instead of subnet. The spatial grouping
is a new view variant, not a replacement.

---

## 8. Open Question: Real-Time Canvas Refresh Rate

At 5-second WebSocket push interval, the canvas redraws at most 5 times per minute for metrics
changes. This is sufficient for "live-feeling" topology without saturating the browser's main thread.

If the edge node pushes more frequently (10-second interval), the canvas may redraw more often.
Guard with `requestAnimationFrame` — no more than one redraw per frame, regardless of how many
WebSocket messages arrive. The renderer already uses `requestAnimationFrame` for the force simulation;
extend the same gate to metric-triggered redraws.

---

## 9. Implementation Phases

### Phase 1: Server Action Wrappers (zero external dependencies)

1. Add `getImpactData(ciId)` and `getDependencyAuditData(productId)` to
   `apps/web/lib/actions/graph.ts`
2. Wire dynamic data fetching in `TopologyGraph.tsx` on view switch
3. Add loading spinner to canvas during Neo4j query
4. Verify Impact Blast Radius view shows radial layout of downstream impact from a clicked InfraCI
5. Verify Dependency Audit view shows OSI-swimlane layout for a selected Digital Product

### Phase 2: Throughput Annotations (requires EP-EDGE-TELEM-001 Phase 1)

1. Extend `GraphDataLink` type with `rxBps`, `txBps`, `speedMbps`, `operStatus`
2. Extend `GraphDataNode` type with `vendorIconModel`, `areaId`
3. Extend `mapNodes()` and `mapEdges()` to populate new fields from Neo4j node/edge properties
4. Implement `enrichLinksWithMetrics()` in graph server actions
5. Implement `drawEdge()` with utilization-based width and status coloring
6. Implement `drawLinkLabel()` with formatted bps labels (hidden below zoom threshold)
7. Implement WebSocket subscription in `TopologyGraph.tsx` for `topology:metrics:update`

### Phase 3: Product Icons (independent of Phases 1 and 2)

1. Create `apps/web/lib/graph/icon-cache.ts` with image pre-loading logic
2. Bundle `fingerprint-database.json` at `apps/web/public/device-data/unifi-fingerprints.json`
3. Bundle generic network SVGs at `apps/web/public/icons/network/`
4. Implement `getDeviceIconUrl()` lookup chain in `device-icons.ts`
5. Extend canvas node renderer with `drawImage()` path + symbol fallback
6. Verify icon renders for a UniFi switch, a Kasa plug, a generic host — all with appropriate
   fallback to symbol when icon not available

### Phase 4: Building Product Health Integration

1. Extend product Health tab data loader to query metrics cache for linked InfraCI items
2. Add per-device metric rows to Health tab (uptime, throughput, energy)
3. Add `areaId`-based grouping variant to `SubnetGroupedInventoryPanel`

---

## 10. Non-Goals

| Item | Reason |
|------|--------|
| 3D topology visualization | Adds rendering complexity without operational benefit |
| Historical traffic graphs on the topology canvas | History belongs on the product Health tab, not the live topology map |
| Automatic device icon scraping from vendor sites | Legal and reliability concerns; static bundled assets are the correct model |
| L1 physical cable tracking | Requires physical audit or proprietary patch-panel integration; not spec'd |
| Per-packet deep inspection | Security tooling concern; out of scope for topology management |

---

## 11. Success Criteria

1. Clicking "Analyze Impact" on any InfraCI node switches to the radial Impact Blast Radius view,
   fetched from Neo4j, rendered within 3 seconds — with no full-page reload
2. A product's topology view in "Dependency Audit" mode shows its dependency stack in OSI-layer
   swimlanes, fetched from Neo4j, rendered within 3 seconds
3. When SNMP ifTable data is available, every graph edge linking two SNMP-discovered devices
   displays a `↓X Kbps ↑Y Kbps` label and has visual width proportional to utilization
4. A Kasa HS200 wall switch in the topology shows the TP-Link product icon (from the UniFi
   fingerprint DB or generic SVG), not a Unicode symbol
5. A Starlink dish shows a satellite icon and its `↓X Mbps ↑Y Mbps` on the uplink edge
6. The topology canvas frame rate does not drop below 30fps under WebSocket metric update load
   (validated with Chrome DevTools performance profile)
7. Removing all edge nodes and adapter config leaves the topology rendering exactly as before
   this spec — the `rxBps`/`txBps` fields are undefined, links render at default width and color,
   and Unicode symbols are used throughout

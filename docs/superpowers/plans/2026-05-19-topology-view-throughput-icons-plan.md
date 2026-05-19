# Topology View — Throughput Annotations & Product Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make the topology graph show real per-link throughput, product icons, and fully wire the Impact Blast Radius and Dependency Audit views that already have UI but no data.

**Architecture:** Three independent work streams: (1) Phase 1 — wire `TopologyGraph.tsx` to call existing `getImpactData`/`getDependencyAuditData` server actions on view switch using `useTransition`; (2) Phase 2 — extend `GraphData` link/node types with throughput fields, resolve CSS variables for canvas, draw link-width by utilization and bps labels, subscribe to WebSocket metrics updates; (3) Phase 3 — add icon-cache module, bundle UniFi fingerprint DB + generic SVGs, extend canvas node renderer with `drawImage` path. Phase 1 has zero external dependencies and can ship immediately.

**Tech Stack:** Next.js 16 App Router, React 19 (`useTransition`), Canvas 2D API, `apps/web/lib/graph/` modules, `@dpf/db` Neo4j functions (already implemented).

---

## Phase 1 — Wire Impact & Dependency Views (zero dependencies)

### Task 1: Confirm server actions exist and understand current TopologyGraph data flow

**Files:**
- Read: `apps/web/lib/actions/graph.ts` (lines 256-350 — `getImpactData` and `getDependencyAuditData`)
- Read: `apps/web/components/inventory/TopologyGraph.tsx` (lines 1-120 — props, state, effects)

- [ ] **Step 1:** Read `apps/web/lib/actions/graph.ts` around line 257. Confirm `getImpactData(ciId)` and `getDependencyAuditData(productId)` are exported async functions returning `Promise<GraphData>`.
- [ ] **Step 2:** Read `TopologyGraph.tsx` top section. Find: (a) the `Props` type — specifically whether `focusNodeId` or equivalent already exists; (b) how `selectedView` state is managed; (c) where the layout engine fires relative to `data` prop changes.
- [ ] **Step 3:** Note the exact variable names and line numbers. The plan below uses `focusNodeId` as the prop/state name — adjust every occurrence in Task 2 if the actual name differs. Before starting Task 2, write the correct variable name here as a comment so it is explicit.

*No commit for this task — research only. Do not proceed to Task 2 until you have confirmed the exact names of: (a) the focused-node ID prop/state, (b) the `selectedView` state variable, (c) the canvas redraw trigger function.*

---

### Task 2: Add `dynamicData` state and view-switch data fetching

**Files:**
- Modify: `apps/web/components/inventory/TopologyGraph.tsx`
- Test: `apps/web/components/inventory/TopologyGraph.test.tsx` (create if absent)

- [ ] **Step 1:** In `TopologyGraph.tsx`, add imports at the top:
```typescript
import { useTransition, useState } from "react";
import { getImpactData, getDependencyAuditData } from "@/lib/actions/graph";
```

- [ ] **Step 2:** Inside the component (before the canvas ref), add:
```typescript
const [isPending, startTransition] = useTransition();
const [dynamicData, setDynamicData] = useState<GraphData | null>(null);
```

- [ ] **Step 3:** Add a `useEffect` that depends on `[selectedView, focusNodeId]` (use actual variable name from Task 1):
```typescript
useEffect(() => {
  if (selectedView === "impact-blast-radius" && focusNodeId) {
    startTransition(() => {
      void getImpactData(focusNodeId).then(setDynamicData);
    });
  } else if (selectedView === "dependency-audit" && focusNodeId) {
    startTransition(() => {
      void getDependencyAuditData(focusNodeId).then(setDynamicData);
    });
  } else {
    setDynamicData(null);
  }
}, [selectedView, focusNodeId]);
```

> **React API note:** `startTransition` takes a synchronous callback. The async call `.then(setDynamicData)` is *outside* the transition — only the state setter fires inside. Do not wrap `async` functions directly.

- [ ] **Step 4:** Find every place in the component that reads the `data` prop for layout or rendering. Replace with:
```typescript
const effectiveData = dynamicData ?? data;
```
and use `effectiveData` everywhere.

- [ ] **Step 5:** Write a failing test in `TopologyGraph.test.tsx`:
  - Render with `defaultView="impact-blast-radius"` and a `focusNodeId`
  - Mock `getImpactData` to return `{ nodes: [{ id: "n1", ... }], links: [] }`
  - Assert the mocked `getImpactData` was called with the `focusNodeId`
  - Assert component re-renders with the mock data (check a node label in the DOM or canvas)

- [ ] **Step 6:** Run `npx vitest run apps/web/components/inventory/TopologyGraph.test.tsx` — confirm it fails (expected: `getImpactData` not yet called).

- [ ] **Step 7:** The effect is already written in Step 3. Run the test again — confirm it passes.

- [ ] **Step 8:** Run `pnpm --filter web typecheck`.

- [ ] **Step 9:** Commit: `feat(topology): wire impact blast radius + dependency audit views to server actions`

---

### Task 3: Loading overlay during Neo4j query

**Files:**
- Modify: `apps/web/components/inventory/TopologyGraph.tsx`

While `isPending` is true (transition in flight), the canvas should show a spinner overlay rather than stale data.

- [ ] **Step 1:** In the JSX return of `TopologyGraph.tsx`, wrap the canvas element with a relative-positioned container:

```tsx
<div className="relative w-full h-full">
  <canvas ref={canvasRef} ... />
  {isPending && (
    <div className="absolute inset-0 flex items-center justify-center bg-[var(--dpf-bg)]/60">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--dpf-accent)] border-t-transparent" />
    </div>
  )}
</div>
```

- [ ] **Step 2:** Run the app (`docker compose up`) and manually navigate to the inventory topology. Click "Analyze Impact" on any InfraCI node. Verify:
  - Spinner appears while Neo4j query runs
  - Radial layout renders within 3 seconds
  - No full-page reload

- [ ] **Step 3:** Commit: `feat(topology): loading overlay during impact/dependency data fetch`

---

## Phase 2 — Throughput Annotations (requires EP-EDGE-TELEM-001 Phase 1 deployed)

### Task 4: Extend `GraphData` types with throughput and icon fields

**Files:**
- Modify: `apps/web/lib/actions/graph.ts`

- [ ] **Step 1:** In `graph.ts`, extract the inline link type to a named export:

```typescript
export type GraphDataLink = {
  source: string;
  target: string;
  type: string;
  // Throughput — optional; undefined when no metrics available
  rxBps?: number;
  txBps?: number;
  speedMbps?: number;
  operStatus?: "up" | "down" | "unknown";
  poeWatts?: number;
};

export type GraphDataNode = {
  id: string;
  name: string;
  label: string;
  color: string;
  size: number;
  osiLayer?: number | null;
  status?: string | null;
  ciType?: string | null;
  // New — from adapter rawData
  vendorIconModel?: string;   // for icon lookup chain
  areaId?: string;            // room/zone from HA or manual config
};

export type GraphData = {
  nodes: GraphDataNode[];
  links: GraphDataLink[];
};
```

- [ ] **Step 2:** Find `infraCIToGraphNode()` helper in `graph.ts`. Add mapping:
```typescript
vendorIconModel: (ci.properties as Record<string, unknown>)?.vendorIconModel as string | undefined,
areaId: (ci.properties as Record<string, unknown>)?.areaId as string | undefined,
```

- [ ] **Step 3:** Find `mapEdges()` / inline link construction in `getFullGraphData()` and other actions. Add `rxBps: undefined, txBps: undefined` (no-op for now — enriched in Task 5).

- [ ] **Step 4:** Run `pnpm --filter web typecheck` — fix any type errors from the now-named `GraphDataLink` type. Other files that use `GraphData["links"][0]` may need updating to `GraphDataLink`.

- [ ] **Step 5:** Commit: `refactor(graph): extract GraphDataLink + GraphDataNode types, add throughput + icon fields`

---

### Task 5: `enrichLinksWithMetrics` — merge metrics cache into graph links

**Files:**
- Modify: `apps/web/lib/actions/graph.ts`
- Test: `apps/web/lib/actions/graph.test.ts`

- [ ] **Step 1:** **Dependency gate**: Confirm `apps/web/lib/edge/metrics-cache.ts` exists (created in Plan A Task 5). If it does not exist yet, do not proceed with this task — Plan A Task 5 must be merged first. Once confirmed, import:
```typescript
import { getLatestMetricsForEdge } from "@/lib/edge/metrics-cache";
```

- [ ] **Step 2:** Add:
```typescript
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

- [ ] **Step 3:** Call `enrichLinksWithMetrics(links)` at the end of `getFullGraphData()`, `getNetworkTopologyData()`, `getImpactData()`, and `getDependencyAuditData()` before returning.

- [ ] **Step 4:** Write a failing test in `graph.test.ts`:
  - Mock `getLatestMetricsForEdge` to return `{ rxBps: 10000, txBps: 5000, operStatus: "up" }` for a specific pair
  - Call `getFullGraphData()`
  - Assert the returned link has `rxBps: 10000, txBps: 5000`
  - Assert a link with no matching metric has `rxBps: undefined`

- [ ] **Step 5:** Run — fail. The mock is already wired; just run again after Step 3. Pass.

- [ ] **Step 6:** Commit: `feat(graph): enrich graph links with metrics cache data`

---

### Task 6: CSS variable resolution for canvas + `CanvasColors` type

**Files:**
- Create: `apps/web/lib/graph/canvas-colors.ts`
- Test: `apps/web/lib/graph/canvas-colors.test.ts`

CSS custom properties do not resolve inside Canvas 2D context. They must be read from a DOM element via `getComputedStyle`.

- [ ] **Step 1:** Create `canvas-colors.ts`:

```typescript
export interface CanvasColors {
  error: string;
  warning: string;
  border: string;
  muted: string;
  success: string;
}

// Call once after mount with the canvas element.
export function resolveCanvasColors(el: HTMLElement): CanvasColors {
  const style = getComputedStyle(el);
  const get = (v: string, fallback: string) =>
    style.getPropertyValue(v).trim() || fallback;
  return {
    error:   get("--dpf-error",   "#ef4444"),
    warning: get("--dpf-warning", "#f59e0b"),
    border:  get("--dpf-border",  "#334155"),
    muted:   get("--dpf-muted",   "#64748b"),
    success: get("--dpf-success", "#22c55e"),
  };
}
```

- [ ] **Step 2:** Write failing tests:
  - `resolveCanvasColors` called with a real DOM element (jsdom) that has `--dpf-error` set to `#ff0000` via inline style → returns `{ error: "#ff0000", ... }`
  - Missing variable → returns fallback hex
- [ ] **Step 3:** Run — fail. Implement (it's already written). Run — pass.
- [ ] **Step 4:** In `TopologyGraph.tsx`, add a `canvasColors` ref:

```typescript
const canvasColorsRef = useRef<CanvasColors>({
  error: "#ef4444", warning: "#f59e0b", border: "#334155", muted: "#64748b", success: "#22c55e"
});
// Mount effect:
useEffect(() => {
  if (canvasRef.current) {
    canvasColorsRef.current = resolveCanvasColors(canvasRef.current);
  }
}, []);
```

- [ ] **Step 5:** Commit: `feat(graph): resolveCanvasColors for canvas-safe CSS variable resolution`

---

### Task 7: Link-width-by-utilization and status-color canvas rendering

**Files:**
- Modify: `apps/web/components/inventory/TopologyGraph.tsx`
- Test: manual visual verification (canvas is not easily unit-testable)

Find the canvas edge-drawing section (look for `ctx.beginPath()`, `ctx.moveTo`, `ctx.lineTo`, `ctx.stroke()`).

- [ ] **Step 1:** Before drawing each edge, compute utilization. Add a `linkMetricsMap` state:

```typescript
const [linkMetricsMap, setLinkMetricsMap] = useState<Map<string, GraphDataLink>>(new Map());
```

Populate it from `effectiveData.links` in the layout effect (or render loop): for each link, key = `${link.source}::${link.target}`.

- [ ] **Step 2:** In the edge draw section, replace the existing `ctx.lineWidth = 1` and `ctx.strokeStyle = LINK_COLORS[...]` lines with:

```typescript
const metric = linkMetricsMap.get(`${link.source}::${link.target}`);
const utilization = metric?.rxBps && metric?.speedMbps
  ? Math.max(metric.rxBps, metric.txBps ?? 0) / (metric.speedMbps * 1_000_000)
  : 0;
ctx.lineWidth = 1 + Math.min(utilization, 1) * 3;

const colors = canvasColorsRef.current;
if (metric?.operStatus === "down") {
  ctx.strokeStyle = colors.error;
} else if (utilization > 0.8) {
  ctx.strokeStyle = colors.warning;
} else {
  ctx.strokeStyle = LINK_COLORS[link.type] ?? colors.border;
}
```

- [ ] **Step 3:** After drawing each edge, add throughput label (when zoom scale > 0.6 — find the existing `scale` variable in the component):

```typescript
if (scale > 0.6 && metric && (metric.rxBps || metric.txBps)) {
  const midX = (source.x + target.x) / 2;
  const midY = (source.y + target.y) / 2;
  ctx.font = "9px system-ui";
  ctx.fillStyle = colors.muted;
  ctx.textAlign = "center";
  ctx.fillText(
    `↓${formatBps(metric.rxBps ?? 0)} ↑${formatBps(metric.txBps ?? 0)}`,
    midX, midY - 4
  );
}
```

Add `formatBps` helper near the top of the file (or in a shared util):
```typescript
function formatBps(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} Kbps`;
  return `${bps.toFixed(0)} bps`;
}
```

- [ ] **Step 4:** Run `pnpm --filter web typecheck`.
- [ ] **Step 5:** Run the app. Open topology. Confirm existing links render unchanged (no metrics data yet = default width/color). No regressions.
- [ ] **Step 6:** Commit: `feat(topology): link-width by utilization + bps labels + status color`

---

### Task 8: WebSocket subscription for live metrics updates

**Files:**
- Modify: `apps/web/components/inventory/TopologyGraph.tsx`

- [ ] **Step 1:** **Cross-plan dependency**: The WebSocket push path requires Plan A Task 5's `broadcastTopologyMetrics` call to be implemented in the portal metrics endpoint. Confirm Plan A Task 5 is merged before proceeding with WS wiring. Run: `grep -r "broadcastTopologyMetrics\|topology:metrics:update" apps/web/lib/ apps/web/app/ --include="*.ts" -l` to verify the broadcaster exists. Also look for any existing WebSocket utility: `apps/web/lib/socket.ts`, `apps/web/lib/realtime.ts`, `apps/web/app/api/ws/`.

- [ ] **Step 2:** If no portal WebSocket yet: the metrics-cache writes data but there is no push path yet. For Phase 2, use a 10-second polling fallback instead: add a `useEffect` that fetches `getFullGraphData()` every 10 seconds while the topology is mounted, and updates `linkMetricsMap` from the enriched links. This is the correct behavior until the WebSocket infrastructure is built.

- [ ] **Step 3:** Implement the polling fallback:
```typescript
useEffect(() => {
  const interval = setInterval(async () => {
    const fresh = await getFullGraphData();
    const map = new Map<string, GraphDataLink>();
    for (const link of fresh.links) {
      if (link.rxBps !== undefined || link.txBps !== undefined) {
        map.set(`${link.source}::${link.target}`, link);
      }
    }
    setLinkMetricsMap(map);
  }, 10_000);
  return () => clearInterval(interval);
}, []);
```

- [ ] **Step 4:** Run typecheck. Confirm no errors.
- [ ] **Step 5:** Commit: `feat(topology): 10s metrics polling for live link annotations`

> **Note:** Replace polling with portal WebSocket push when the WebSocket infrastructure is ready. The polling interval should match the edge node's `metricsIntervalSec` — read it from a portal config endpoint if available, default 10s.

---

## Phase 3 — Product Icons (independent of Phases 1 and 2)

### Task 9: Create icon cache module

**Files:**
- Create: `apps/web/lib/graph/icon-cache.ts`
- Test: `apps/web/lib/graph/icon-cache.test.ts`

- [ ] **Step 1:** Create `icon-cache.ts`:

```typescript
const imageCache = new Map<string, HTMLImageElement | null>();
let onIconLoaded: (() => void) | null = null;

// Call once from TopologyGraph mount effect:
// setIconLoadCallback(() => requestAnimationFrame(() => redrawCanvas()));
export function setIconLoadCallback(fn: () => void): void {
  onIconLoaded = fn;
}

export function getOrLoadIcon(url: string): HTMLImageElement | null {
  if (imageCache.has(url)) return imageCache.get(url) ?? null;
  imageCache.set(url, null);  // mark loading; prevents duplicate fetches
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    imageCache.set(url, img);
    onIconLoaded?.();
  };
  // onerror: retain null → symbol fallback; no retry storm
  img.src = url;
  return null;
}

// For testing only:
export function _clearCache(): void { imageCache.clear(); }
```

- [ ] **Step 2:** Write failing tests:
  - `getOrLoadIcon(url)` returns `null` before image loads
  - After `img.onload` fires (simulate in test), `getOrLoadIcon(url)` returns the element
  - Calling `getOrLoadIcon` twice with same URL does NOT create two `Image` objects
  - `onIconLoaded` is called exactly once when image loads
- [ ] **Step 3:** Run — fail. Implement (already written above). Run — pass.
- [ ] **Step 4:** Commit: `feat(graph): icon-cache module with dedup loading and canvas redraw callback`

---

### Task 10: Bundle UniFi fingerprint DB and generic SVGs

**Files:**
- Create: `apps/web/lib/graph/data/unifi-fingerprints.json` (download from source)
- Create: `apps/web/public/icons/network/` (add SVG subset)

- [ ] **Step 1:** Download `fingerprint-database.json` from `https://raw.githubusercontent.com/CANTI-BOT/UniFi-Icon-Browser/main/fingerprint-database.json`. Save to `apps/web/lib/graph/data/unifi-fingerprints.json`. Add a `DATA_SOURCE.md` in `apps/web/lib/graph/data/` noting the source URL and the date downloaded.

- [ ] **Step 2:** Inspect the JSON structure. The fingerprint DB maps model codes to icon URLs (typically `static.ui.com/...` CDN paths). Confirm the key format (e.g., `"US-8-150W"` → `"https://static.ui.com/fingerprint/ui/icons/..."`).

- [ ] **Step 3:** Download the following SVGs from `https://raw.githubusercontent.com/network-automation/networking-icons/master/` and save to `apps/web/public/icons/network/`:
  - `router.svg`, `switch.svg`, `access-point.svg`, `server.svg`, `cloud.svg`
  - Plus create simple SVGs for: `smart-plug.svg`, `smart-switch.svg`, `satellite.svg` (can be simple path-based SVGs if not in the repo)

- [ ] **Step 4:** Commit: `chore(graph): add UniFi fingerprint DB + generic network SVG icons`

---

### Task 11: Icon lookup chain in `device-icons.ts`

**Files:**
- Modify: `apps/web/lib/graph/device-icons.ts`
- Test: `apps/web/lib/graph/device-icons.test.ts`

- [ ] **Step 1:** Extend `DeviceVisual` type with `iconUrl?: string`.

- [ ] **Step 2:** Add import at top of `device-icons.ts`:
```typescript
import UNIFI_FINGERPRINT_DB from './data/unifi-fingerprints.json';
```

- [ ] **Step 3:** Add `GENERIC_DEVICE_SVGS` mapping:
```typescript
const GENERIC_DEVICE_SVGS: Record<string, string> = {
  router:           "/icons/network/router.svg",
  gateway:          "/icons/network/router.svg",
  switch:           "/icons/network/switch.svg",
  wireless_ap:      "/icons/network/access-point.svg",
  smart_plug:       "/icons/network/smart-plug.svg",
  smart_switch:     "/icons/network/smart-switch.svg",
  satellite_internet: "/icons/network/satellite.svg",
  host:             "/icons/network/server.svg",
  docker_host:      "/icons/network/server.svg",
};
```

- [ ] **Step 4:** Add exported function:
```typescript
export function getDeviceIconUrl(
  ciType: string | undefined | null,
  vendorIconModel: string | undefined | null,
): string | undefined {
  if (vendorIconModel) {
    // 1. UniFi fingerprint DB (model code → CDN URL)
    const fp = (UNIFI_FINGERPRINT_DB as Record<string, unknown>)[vendorIconModel];
    if (typeof fp === "string") return fp;
    if (fp && typeof fp === "object" && "icon" in fp) return (fp as {icon: string}).icon;
  }
  // 2. Generic device-type SVG
  if (ciType) {
    const generic = GENERIC_DEVICE_SVGS[ciType];
    if (generic) return generic;
  }
  return undefined;
}
```

- [ ] **Step 5:** Write failing tests:
  - `getDeviceIconUrl("switch", "US-8-150W")` → returns the URL from the fingerprint DB (mock the import or use actual DB if small enough to load in test)
  - `getDeviceIconUrl("router", undefined)` → returns `"/icons/network/router.svg"`
  - `getDeviceIconUrl("unknown_type", undefined)` → returns `undefined`
  - `getDeviceIconUrl(undefined, undefined)` → returns `undefined`
- [ ] **Step 6:** Run — fail. Fix any fingerprint DB structure mismatches discovered in Step 2. Run — pass.
- [ ] **Step 7:** Commit: `feat(graph): getDeviceIconUrl lookup chain — UniFi fingerprint DB + generic SVGs`

---

### Task 12: Canvas renderer — `drawImage` with symbol fallback

**Files:**
- Modify: `apps/web/components/inventory/TopologyGraph.tsx`

- [ ] **Step 1:** Add imports to `TopologyGraph.tsx`:
```typescript
import { getDeviceIconUrl } from "@/lib/graph/device-icons";
import { getOrLoadIcon, setIconLoadCallback } from "@/lib/graph/icon-cache";
```

- [ ] **Step 2:** In the mount `useEffect`, register the icon load callback:
```typescript
useEffect(() => {
  setIconLoadCallback(() => {
    requestAnimationFrame(() => {
      // Trigger canvas redraw — find the existing redraw function/ref and call it
      redrawRef.current?.();
    });
  });
}, []);
```
> Find the existing pattern used for canvas redraws (look for `requestAnimationFrame` calls or a `drawGraph` / `render` function). Use the same trigger.

- [ ] **Step 3:** Find the existing node-draw section. It currently calls `ctx.fillText(dv.symbol, node.x, node.y)` for `InfraCI` nodes. Replace with:

```typescript
// Try icon first (uses node.vendorIconModel and node.ciType)
const iconUrl = getDeviceIconUrl(node.ciType, node.vendorIconModel);
const img = iconUrl ? getOrLoadIcon(iconUrl) : null;

if (img) {
  const iconSize = radius * 2;
  ctx.drawImage(img, node.x - iconSize / 2, node.y - iconSize / 2, iconSize, iconSize);
} else {
  // Symbol fallback — existing behavior
  ctx.fillText(dv.symbol, node.x, node.y);
}
```

- [ ] **Step 4:** Run `pnpm --filter web typecheck`. Fix any errors (likely `node.vendorIconModel` being undefined in the existing node type — it's now optional in `GraphDataNode` from Task 4).

- [ ] **Step 5:** Run the app. Open inventory topology.
  - Verify: nodes without `vendorIconModel` still show Unicode symbols (no regression)
  - Verify: a node with a known UniFi model code shows the product icon after the image loads
  - Verify: canvas frame rate stays smooth (no flicker during icon load; symbols show immediately, icons appear on first `onload`)

- [ ] **Step 6:** Commit: `feat(topology): canvas drawImage for product icons with symbol fallback`

---

## Phase 4 — Building Product Health Integration (deferred)

The building product health panel (Starlink uptime, switch utilization, Kasa energy draw) requires Phase 2 data (metrics cache populated) and a product with linked InfraCI items. Plan this as a separate spec once Phase 1 and 2 are verified in production.

Tracked in backlog as follow-on to EP-TOPO-FIDELITY-001.

---

## Full Verification Checklist

After Phase 1:
- [ ] Navigate to inventory topology, click "Analyze Impact" on any InfraCI node. Radial layout loads within 3 seconds. No full-page reload.
- [ ] Switch to "Dependency Audit" view while focused on a DigitalProduct node. OSI-layer swimlane layout renders within 3 seconds.
- [ ] Switch to "Exploration" view. Spinner disappears, base graph renders normally.

After Phase 2:
- [ ] With SNMP metrics flowing (EP-EDGE-TELEM-001 Phase 1 deployed): verify links show `↓X Kbps ↑Y Kbps` labels when zoomed in.
- [ ] Verify link width varies by utilization (thin = idle, thick = busy).
- [ ] Verify an "operStatus: down" link renders in error color (not black).
- [ ] Zoom out below 0.6x — verify labels disappear but width encoding remains.
- [ ] Remove edge node metrics source — verify topology renders exactly as before (no undefined errors, links at default width).

After Phase 3:
- [ ] Verify a UniFi switch in the graph shows the correct product photo from `static.ui.com`.
- [ ] Verify a `smart_plug` node shows the `smart-plug.svg` generic icon.
- [ ] Verify a node with no `vendorIconModel` and unknown `ciType` shows the Unicode symbol.
- [ ] Open Chrome DevTools Performance tab. Record 30 seconds of topology interaction with icons loading. Verify no frame drops below 30fps.
- [ ] Run `cd apps/web && npx next build` — verify zero TypeScript errors and successful bundle.

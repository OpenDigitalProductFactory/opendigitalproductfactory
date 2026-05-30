# Reporting & Data-Display UX Primitives — Spec

**Status:** Draft (spec-first; implementation staged in phases below)
**Owner:** Platform / Web UX
**Date:** 2026-05-30
**Surface:** `apps/web` (portal)
**Backlog:** BI-6A842691 · Epic: EP-2b79c5c6 (Portal UX hardening)

---

## 1. Problem

DPF's portal has ~30 reporting/data-display surfaces (finance, compliance, customer/CRM,
complaints, admin/cockpit, EA, monitoring, platform). They repeat the same visual
patterns — KPI cards, status/severity badges, filterable tables, drill-down detail —
but **almost every surface hand-rolls them inline**. Concretely:

- **No shared `StatusBadge`.** Each page re-declares its own status→color map.
  - `app/(shell)/finance/page.tsx` maps statuses to `var(--dpf-*)` tokens (correct).
  - `app/(shell)/complaints/ComplaintsClient.tsx` maps to **raw hex** (`#22c55e`,
    `#ef4444`) — bypasses the design tokens entirely.
  - `components/platform/development/change-lanes/ChangeLaneStatusBadge.tsx` is a
    well-built one-off that already encodes the right idea (status → intent → token)
    but only serves contributor lanes.
- **No shared `DataTable`.** Every list re-implements `<table>` markup, hover states,
  empty states, alignment, and monospace ID columns. Sorting/pagination are absent or
  reinvented.
- **No shared `FilterBar`.** Three competing idioms coexist: URL link-pills (finance
  payments), `<form><select>` (compliance controls), and client `useState` buttons
  (complaints).
- **Charts are Prometheus-bound.** The `components/monitoring/*` SVG charts
  (`MetricGauge`, `SparkLine`, `MetricTimeSeries`) are good but query Prometheus; there
  is no primitive for charting arbitrary business data.

The result: inconsistent color semantics, duplicated maintenance, uneven accessibility,
and no clear "palette" for prototyping new surfaces — pushing contributors to research
externally instead of composing what we have.

> **Naming note — avoid confusion.** `apps/web/lib/reporting-types.ts` already exists but
> is **compliance-posture scoring** (regulatory reporting math: `calculatePostureScore`,
> submission status flow). It is *unrelated* to UI primitives. This spec deliberately uses
> the name **`report-kit`** for the new UI layer to avoid collision.

---

## 2. Goals

1. Establish a small, documented **palette of shared reporting primitives** that any
   surface can compose, so contributors don't research externally.
2. Unify **status/severity color semantics** behind the existing `--dpf-state-*` /
   `--dpf-*` tokens — one registry, zero raw hex.
3. Ship the three highest-leverage shared primitives that everyone currently hand-rolls:
   **`StatusBadge`**, **`DataTable`**, **`FilterBar`**.
4. Keep primitives **data-source-agnostic** (presentational), driven by props — distinct
   from the Prometheus-bound monitoring charts.
5. Provide a **migration path**: new surfaces adopt immediately; existing surfaces migrate
   opportunistically without a big-bang refactor.

## 3. Non-Goals

- **Not** introducing a charting library (recharts/tremor/etc.) in this phase. Charting of
  business data is a follow-up; this phase is tables/badges/filters/cards only.
- **Not** rewriting the monitoring SVG charts or coupling them to this layer.
- **Not** migrating all ~30 surfaces in one PR. Phase 1 ships primitives + docs only;
  reference adoptions are Phase 2.
- **Not** building server-side pagination/query infra; `DataTable` is presentational and
  accepts already-fetched rows (client sort/paginate over a page of data).

---

## 4. Design tokens (the anchor)

`app/globals.css` already defines the full token set. Primitives MUST use these and never
raw hex:

| Group | Tokens |
|---|---|
| Surfaces | `--dpf-surface-1/2/3`, `--dpf-bg` |
| Text | `--dpf-text`, `--dpf-text-secondary`, `--dpf-muted` |
| Borders | `--dpf-border`, `--dpf-border-strong` |
| Accent | `--dpf-accent`, `--dpf-accent-soft` |
| Semantic state | `--dpf-state-success|warning|error|info`, plus `--dpf-success|warning|error|info` |
| Fonts | `--dpf-font-heading`, `--dpf-font-body` |

### 4.1 Status intent model

The unifying abstraction (already implicit in `ChangeLaneStatusBadge`): a domain status
string maps to a **semantic intent**, and intent maps to tokens.

```
Intent = "success" | "warning" | "danger" | "info" | "neutral" | "accent"
```

| Intent | Foreground token | Border token | Soft bg |
|---|---|---|---|
| success | `--dpf-success` | `--dpf-success` | `color-mix` of success @ ~12% |
| warning | `--dpf-warning` | `--dpf-warning` | warning @ ~12% |
| danger  | `--dpf-error`   | `--dpf-error`   | error @ ~12% |
| info    | `--dpf-info`    | `--dpf-info`    | info @ ~12% |
| accent  | `--dpf-accent`  | `--dpf-accent`  | `--dpf-accent-soft` |
| neutral | `--dpf-muted`   | `--dpf-border`  | `--dpf-surface-2` |

Soft backgrounds use `color-mix(in srgb, var(--dpf-success) 12%, transparent)` so we don't
add new tokens.

---

## 5. The palette (catalog: keep / extend / add)

### KEEP (already shared, document as canonical)
- **KPI/summary:** `components/finance/FinanceSummaryCard.tsx`,
  `components/platform/PlatformSummaryCard.tsx`, `components/shell/WorkspaceTiles.tsx`
- **Charts (Prometheus):** `components/monitoring/{MetricStat,MetricGauge,SparkLine,MetricTimeSeries,MetricTable}.tsx`
- **Graphs:** `components/build/ProcessGraph.tsx`, `components/ea/EaCanvas.tsx` (`@xyflow/react`)
- **Time/date:** `components/ui/LocalTime.tsx`, `components/ui/DatePicker.tsx`
- **Drawer/timeline:** `components/build/DetailsDrawer.tsx`, `components/build/UnifiedEvidenceTimeline.tsx`
- **Existing libs sanctioned:** `@xyflow/react`, `@fullcalendar/*`, `react-day-picker`,
  `papaparse` (CSV — currently unused), `@react-pdf/renderer` (PDF — finance only)

### ADD (this spec) — new shared layer under `components/ui/report-kit/`
1. **`statusColors.ts`** — central registry: intent model + helper to resolve a domain
   status to an intent, with per-domain maps (finance, compliance, complaints, …).
2. **`StatusBadge.tsx`** — the canonical badge (server-usable, pure).
3. **`DataTable.tsx`** — presentational, typed, sortable, optional client pagination,
   built-in empty/loading states.
4. **`FilterBar.tsx`** — composable filter row (search input + select/pill facets),
   client + URL modes.

### FOLLOW-UP (not this phase)
- `StatCard` (generalize `FinanceSummaryCard` cross-domain)
- Business-data charts (decide recharts vs. extend monitoring SVG)
- `ExportButton` (wire up the already-present `papaparse` / `@react-pdf/renderer`)
- Server-rendered (URL-driven) `DataTable` mode

---

## 6. API design

### 6.1 `statusColors.ts`

```ts
export type Intent = "success" | "warning" | "danger" | "info" | "neutral" | "accent";
export interface IntentStyle { fg: string; border: string; softBg: string; }
export function intentStyle(intent: Intent): IntentStyle;

// Per-domain status → intent maps. Adding a domain = one entry here, not in a page.
export const STATUS_INTENT: Record<string, Record<string, Intent>> = {
  finance: { draft: "neutral", sent: "info", viewed: "accent", overdue: "danger",
             partially_paid: "warning", paid: "success", void: "neutral", written_off: "neutral" },
  complaintSeverity: { low: "success", medium: "warning", high: "warning", critical: "danger" },
  complaintStatus:   { open: "info", investigating: "accent", resolved: "success", closed: "neutral" },
};
export function resolveIntent(domain: string, status: string): Intent; // → "neutral" fallback
```

### 6.2 `StatusBadge`

```tsx
interface StatusBadgeProps {
  label?: string;                          // defaults to status/intent text
  intent?: Intent;                         // explicit intent…
  domain?: string; status?: string;        // …or resolve via registry
  variant?: "soft" | "outline" | "solid";  // default "outline"
  size?: "sm" | "md";                      // default "sm"
  uppercase?: boolean;                     // default true
}
```
- Exactly one of `{intent}` or `{domain,status}` (enforced by a union type).
- Pure, no hooks → usable directly in server components.

### 6.3 `DataTable`

```tsx
interface Column<T> {
  key: string; header: ReactNode; cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  sortAccessor?: (row: T) => string | number;  // enables sort
  mono?: boolean; width?: string;
}
interface DataTableProps<T> {
  columns: Column<T>[]; rows: T[]; getRowKey: (row: T) => string;
  rowHref?: (row: T) => string; empty?: ReactNode; loading?: boolean;
  initialSort?: { key: string; dir: "asc" | "desc" }; pageSize?: number; dense?: boolean;
}
// exported pure helpers: sortRows, paginateRows, pageCount
```
- Presentational; caller fetches rows. Client sort/paginate over the provided page.
- `"use client"`; server pages wrap it in a thin client child.

### 6.4 `FilterBar`

```tsx
type FacetDef =
  | { kind: "search"; key: string; placeholder?: string }
  | { kind: "select"; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: "pills";  key: string; label: string; options: { value: string; label: string }[] };

interface FilterBarProps {
  facets: FacetDef[]; value: Record<string, string>; resultCount?: number;
  mode?: "client" | "url";
  onChange?: (next: Record<string, string>) => void;          // client mode
  hrefBuilder?: (key: string, value: string | null) => string; // url mode
}
```

---

## 7. File layout

```
apps/web/components/ui/report-kit/
  index.ts            # barrel export
  statusColors.ts     + statusColors.test.ts
  StatusBadge.tsx     + StatusBadge.test.tsx
  DataTable.tsx       + DataTable.test.tsx
  FilterBar.tsx       + FilterBar.test.tsx
  README.md           # the palette doc + usage recipes
```
Import via `@/components/ui/report-kit`.

## 8. Migration / adoption

- **New surfaces:** use `report-kit` from day one.
- **Existing surfaces (Phase 2):** migrate opportunistically. First two references:
  1. `app/(shell)/complaints/ComplaintsClient.tsx` — removes raw-hex maps → `StatusBadge` +
     `DataTable` + `FilterBar` (client mode). Highest value: it currently violates tokens.
  2. `app/(shell)/finance/payments/page.tsx` — server component, `url`-mode `FilterBar` +
     `DataTable`. Proves server-side usage.
- `ChangeLaneStatusBadge` is already conformant; fold onto `StatusBadge` in Phase 2.
- Each migrated domain adds its status map to `STATUS_INTENT` (one place).

> **Sequencing note.** A separate in-flight working-tree sweep is adopting shared
> `LocalTime`/input primitives across these same surfaces. Phase 1 is therefore
> **additive only** (new `report-kit` files, no edits to existing surfaces) to avoid
> conflicting with that sweep; the reference migrations land in Phase 2 once the sweep
> has merged.

## 9. Testing

- Unit (Vitest, `node` env — matches repo convention; render via `renderToStaticMarkup`,
  unit-test exported pure helpers without a DOM):
  - `statusColors`: every status resolves to a valid intent; unknown → neutral; no hex.
  - `StatusBadge`: intent vs domain/status paths; token colors; uppercase toggle.
  - `DataTable`: sort asc/desc + stability, paginate slice, page count, empty/loading,
    `rowHref` linking.
  - `FilterBar`: client onChange; url-mode renders links via `hrefBuilder`; result count.
- Visual: verify on the **Contributor preview (port 3001)** via `dev-portal-start` once a
  surface is migrated (Phase 2).
- No raw hex: tests assert primitives emit `var(--dpf-*)` and never `#rrggbb`.

## 10. Rollout phases

| Phase | Deliverable | Gate |
|---|---|---|
| **0** | This spec + BI filed | review |
| **1** | `report-kit` primitives + tests + README (additive only) | unit green + typecheck |
| **2** | Migrate complaints + finance/payments; grow `STATUS_INTENT`; fold ChangeLaneStatusBadge | preview verified |
| **3** (follow-up) | `StatCard`, `ExportButton`, server `DataTable` URL mode, charting decision | new spec |

## 11. Open questions

1. `DataTable` client-only now, or stub a `serverSort`/`serverPaginate` seam from the
   start? (Recommend: client-only now, seam documented.)
2. Fold `ChangeLaneStatusBadge` onto `StatusBadge` in Phase 2 (recommended) vs leave as-is.
3. Charting library decision (recharts vs. extend monitoring SVG) — deferred to Phase 3.

---

## 12. Process note

Build Studio is not fully functional (per current platform status), so this work is done
**directly via a DCO PR** with backlog item **BI-6A842691** filed for the record, rather
than promoted through the BS pipeline. Work is committed + pushed promptly because the
shared root checkout is contended by concurrent cleanup processes.

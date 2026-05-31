# report-kit — Reporting & Data-Display Palette

Shared, token-backed primitives for building reporting/analytics surfaces in the
portal. Compose these instead of hand-rolling `<table>` markup, status-color
maps, or filter rows — and instead of researching component libraries externally.

> Spec: [`docs/specs/reporting-ux-primitives-spec.md`](../../../../../docs/specs/reporting-ux-primitives-spec.md)
> · Backlog: BI-6A842691 (EP Portal UX hardening)
>
> **Not** related to `apps/web/lib/reporting-types.ts` (compliance-posture math).

```ts
import {
  StatusBadge,
  DataTable,
  FilterBar,
  resolveIntent,
} from "@/components/ui/report-kit";
```

## What's in the palette

| Primitive | Server-usable? | Use it for |
|---|---|---|
| `StatusBadge` | ✅ (pure) | status / severity / lifecycle pills |
| `StatCard` | ✅ (pure) | KPI / metric tiles (value + delta + drill-down) |
| `DataTable` | client¹ | tabular lists with sort, paging, empty/loading states |
| `FilterBar` | client¹ | search + select + pill facets above a table |
| `ExportButton` / `toCsv` | client | CSV export of rows (papaparse-backed) |
| `Chart` | client² | business-data line / bar / area charts (recharts) |
| `statusColors` (`intentStyle`, `resolveIntent`, `STATUS_INTENT`) | ✅ | the one place status→color semantics live |

¹ `DataTable` / `FilterBar` are `"use client"` (they manage sort/page/onChange
state). A server page uses them by rendering them inside a small client child —
the page still fetches data on the server and passes rows down. A pure
server-rendered (URL-driven) table mode is a documented follow-up.

² `Chart` pulls in **recharts** (client-only, heavy), so it is **not** re-exported
from the barrel — import it by subpath to keep the barrel and server components
recharts-free: `import { Chart } from "@/components/ui/report-kit/Chart"`.

## The intent model (always use tokens, never hex)

Every color flows through a semantic **intent**, and intent maps to `--dpf-*`
design tokens:

`success · warning · danger · info · neutral · accent`

A domain status string resolves to an intent via the central registry in
`statusColors.ts`. Adding a domain/status is a one-line edit there — not a new
color map in a page.

```tsx
// explicit intent
<StatusBadge intent="success" label="Paid" />

// resolve from the registry (domain + status)
<StatusBadge domain="finance" status="overdue" />        // → danger
<StatusBadge domain="complaintSeverity" status="critical" variant="soft" />
```

Variants: `outline` (default) · `soft` · `solid`. Sizes: `sm` (default) · `md`.

## DataTable

Presentational + typed. The caller fetches rows; columns are render functions.

```tsx
"use client";
import { DataTable, type Column } from "@/components/ui/report-kit";

const columns: Column<Invoice>[] = [
  { key: "ref", header: "Invoice", cell: (r) => r.ref, mono: true },
  { key: "customer", header: "Customer", cell: (r) => r.customer,
    sortAccessor: (r) => r.customer },
  { key: "status", header: "Status",
    cell: (r) => <StatusBadge domain="finance" status={r.status} /> },
  { key: "amount", header: "Amount", align: "right",
    cell: (r) => formatMoney(r.amount), sortAccessor: (r) => r.amount },
];

<DataTable
  columns={columns}
  rows={invoices}
  getRowKey={(r) => r.id}
  rowHref={(r) => `/finance/invoices/${r.id}`}
  initialSort={{ key: "amount", dir: "desc" }}
  pageSize={25}
  empty="No invoices yet"
/>;
```

- Sort: provide `sortAccessor` on a column to make its header clickable.
- Pagination: pass `pageSize` (omit for none).
- States: `loading` renders skeleton rows; `empty` renders a centered message.
- Pure helpers `sortRows` / `paginateRows` / `pageCount` are exported and unit-tested.

### Server page → client table

```tsx
// page.tsx (server component)
const rows = await getInvoices();
return <InvoiceTable rows={rows} />;

// InvoiceTable.tsx ("use client")
export function InvoiceTable({ rows }: { rows: Invoice[] }) {
  return <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />;
}
```

## FilterBar

One facet model, two modes.

```tsx
// client mode — controlled
<FilterBar
  mode="client"
  facets={[
    { kind: "search", key: "q", placeholder: "Search…" },
    { kind: "select", key: "status", label: "Status",
      options: [{ value: "open", label: "Open" }] },
    { kind: "pills", key: "direction", label: "Direction",
      options: [{ value: "in", label: "Inbound" }, { value: "out", label: "Outbound" }] },
  ]}
  value={filters}
  onChange={setFilters}
  resultCount={rows.length}
/>

// url mode — links bound to searchParams (server-friendly)
<FilterBar
  mode="url"
  facets={facets}
  value={{ direction: searchParams.direction ?? "" }}
  hrefBuilder={(key, value) => buildHref({ ...searchParams, [key]: value ?? undefined })}
/>
```

## StatCard

KPI tile — pure, server-usable. Delta intent auto-derives from direction
(`up`→success, `down`→danger) and can be overridden (e.g. rising spend is bad).

```tsx
<StatCard label="Outstanding" value={`${sym}${formatMoney(total)}`}
  hint="across 8 invoices" intent="warning"
  delta={{ label: "+12%", direction: "up" }}
  href="/finance/invoices" />
```

## ExportButton

CSV export for a list/table, backed by papaparse. `toCsv` is exported and pure
(unit-testable). Pairs with `DataTable` — pass the same rows.

```tsx
<ExportButton
  rows={invoices}
  columns={[{ key: "ref", header: "Invoice" }, { key: "amount", header: "Total" }]}
  filename="invoices.csv"
/>
```

## Chart

Token-themed line / bar / area charts over **recharts**, for arbitrary in-memory
business data (distinct from the Prometheus-bound monitoring SVG charts). Client
component — a server page passes serialized data down (like `DataTable`). Series
colors resolve from tokens (explicit `color`, an `intent`, or the default ramp).

```tsx
import { Chart } from "@/components/ui/report-kit/Chart";

<Chart
  type="area"
  data={monthly}            // [{ month: "Jan", revenue: 1200, spend: 800 }, …]
  xKey="month"
  series={[
    { key: "revenue", label: "Revenue", intent: "success" },
    { key: "spend", label: "Spend", intent: "danger" },
  ]}
  height={260}
  showLegend
/>
```

## Conventions

- **No raw hex.** Colors come from `intentStyle` / `--dpf-*` tokens only.
- **Time:** render timestamps with the shared `LocalTime` component, not `toLocaleString`.
- **Tests:** Vitest, `node` environment — render components with
  `renderToStaticMarkup` and unit-test exported pure helpers (no DOM needed).

## Roadmap

- **Phase 1 (this):** primitives + tests + this doc. Additive only.
- **Phase 2:** migrate reference surfaces (complaints, finance/payments), grow
  `STATUS_INTENT`, fold `ChangeLaneStatusBadge` onto `StatusBadge`.
- **Phase 3:** ✅ `StatCard` + `ExportButton` (CSV via papaparse) + `Chart`
  (recharts — charting decision resolved). Remaining: PDF export (`@react-pdf`),
  server-rendered `DataTable` URL mode.

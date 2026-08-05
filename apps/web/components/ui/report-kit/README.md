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
| `StatCard` | ✅ (pure) | labelled KPI tiles (label on top + delta + drill-down) |
| `KpiCard` | ✅ (pure) | value-forward metric tiles (big number, caption below) |
| `EmptyState` | ✅ (pure) | "No … found" / nothing-here-yet placeholders |
| `Skeleton` | ✅ (pure) | loading shimmer bars (the one place `animate-pulse` lives) |
| `Notice` | ✅ (pure) | inline callouts / banners (info · warn · success · error) |
| `CollapsibleList` | client | preview a long list, then reveal its remaining rows |
| `ExpandableCard` | client | reveal one peer record's subordinate detail inline |
| `SearchableSelect` | client | pick one option out of many, by typing instead of scrolling |
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

## KpiCard

Value-forward metric tile — pure, server-usable. Where `StatCard` leads with a
tiny uppercase label (dashboard tiles with a delta chip), `KpiCard` leads with
the number (stat rows / hero figures — the shape the hand-rolled
`text-3xl font-bold` blocks take). Both share the intent model.

```tsx
<KpiCard value={42} label="Open invoices" size="lg" intent="accent"
  hint="12 of 30 (40%)" href="/finance/invoices" />
```

Sizes: `sm` (text-2xl) · `md` (text-3xl, default) · `lg` (text-4xl). `intent`
colors the value text (and the left accent border when `bordered`). Pass
`bordered={false}` for a chrome-less number in an existing card.

## EmptyState

Centered "nothing here yet" placeholder — pure, server-usable. Replaces the
~40 hand-rolled `No … found` divs.

```tsx
<EmptyState
  title="No invoices found"
  description="Create your first invoice to get started."
  icon={<span>📭</span>}
  action={<Link href="/finance/invoices/new">New invoice →</Link>}
/>
```

Pass `bordered={false}` for a bare inline message; `size="sm"` for compact.

## Skeleton

Loading shimmer — pure, server-usable. The one sanctioned home for
`animate-pulse`; everything else should compose this.

```tsx
<Skeleton width={128} height={16} />      // one bar
<Skeleton lines={4} />                    // paragraph (last line shortened)
```

`width` / `height` accept a number (px) or any CSS length. `rounded`:
`sm · md · lg · full`.

## Notice

Inline callout / banner — pure, server-usable. Replaces the ~25 hand-rolled
`border-l-4` callouts. Variant maps to an intent, so color still resolves
through the one registry.

```tsx
<Notice variant="warn" title="Preview unavailable">
  DPF could not refresh the preview for this account.
</Notice>
```

Variants: `info · warn · success · error`. The left border + heading take the
intent color; the background is a soft wash of the same token. Pass
`icon={false}` to drop the leading glyph, or any node to override it.

## ExpandableCard

Use `ExpandableCard` for a list of peer records where one record's subordinate
detail is revealed in place. The summary is rendered once and remains the same
open/close trigger. A parent owns the controlled state, which makes single-open
accordion behavior explicit.

```tsx
const [openId, setOpenId] = useState<string | null>(null);

<ExpandableCard
  id={`invoice-${invoice.id}`}
  open={openId === invoice.id}
  onOpenChange={(open) => setOpenId(open ? invoice.id : null)}
  summary={<InvoiceSummary invoice={invoice} />}
>
  <InvoiceDetail invoice={invoice} />
</ExpandableCard>
```

The primitive owns the native button, heading, visible disclosure indicator,
`aria-expanded`, `aria-controls`, labelled region, focus treatment, and connected
card styling. The caller owns domain content, data loading, errors, and actions.

Do not use it to truncate one long list (`CollapsibleList`), hide one short piece
of secondary prose (`<details>`), host a separate workspace (drawer), or replace
a durable detail URL.

## SearchableSelect

Pick ONE option out of many, by typing rather than scrolling.

```tsx
<SearchableSelect
  label="Agent"
  options={agents.map((a) => ({ value: a.agentId, label: `${a.agentId} - ${a.agentName}` }))}
  value={selectedAgent}
  onChange={setSelectedAgent}
  emptyLabel="No agents projected"
/>
```

**Why it exists.** A flat select element pushes the whole option set at the
reader — Hick's law says the decision cost grows with the number of choices,
which is what `lib/ux-budget`'s `maxChoicesPerControl` axis measures.
`/platform/audit/authority` shipped a 94-option agent select against a budget of
20 (BI-D6135B88). This inverts it: the reader types and the list narrows. Every
option stays reachable — this is a picker, not truncation.

**Reach for it when** a control offers more options than its shell's
`maxChoicesPerControl` budget (20 on `detail`/`list`, 12 on `cockpit`), or when
the reader already knows the name of the thing they want.

Built on a native datalist so keyboard, screen-reader and mobile behaviour come
from the platform. A datalist does not constrain input, so the component owns
that: a keystroke commits only when it resolves to a real option (by label, or
by pasting a raw value), an unresolved value is reported inline via a `role="status"`
region instead of silently selecting nothing, and blurring restores the committed
selection.

Do not use it to filter a list in place (that is a `FilterBar` search facet), or
to choose several things at once — it selects exactly one.

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

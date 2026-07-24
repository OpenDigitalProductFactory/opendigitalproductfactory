---
title: Compose the Report-Kit Palette for Reporting UX
pageKind: principle
status: published
abstract: Build reporting and data-display UX from the shared report-kit palette; never hand-roll badges, tables, status colors, KPI cards, or charts.
principleTier: core
principleDirection: Compose reporting/data-display UX from the canonical report-kit primitives; never hand-roll a badge, table, status color, KPI card, or chart.
principleDimensionVector: {"reusability": 0.9, "long_term_maintainability": 0.7, "schema_grounding": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: A shared reporting palette is how DPF keeps data-display UX consistent across dozens of surfaces and lets agents build new surfaces without researching component patterns externally.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Reporting and data-display UX is composed from the shared **report-kit** palette at `apps/web/components/ui/report-kit/`, not hand-rolled per surface. Before building a status badge, a data table, a KPI tile, a filter row, a CSV export, or a chart, reach for the existing primitive: `StatusBadge`, `DataTable`, `FilterBar`, `StatCard`, `ExportButton` / `toCsv`, `Chart`, and the central `statusColors` intent registry. Status and severity colors resolve through that registry (status → semantic intent → `--dpf-*` token) — never a per-page color map and never a raw hex or Tailwind palette class. If a primitive does not yet cover the use case, extend report-kit (and its registry) rather than building a parallel one-off. The palette and its API live in `apps/web/components/ui/report-kit/README.md`.

## Why

The same reporting patterns — status pills, filterable tables, KPI cards, trend charts — recur on dozens of surfaces (finance, compliance, CRM, admin). When each surface hand-rolls them, the platform accumulates inconsistent color semantics, duplicated table/filter logic, uneven accessibility, and a maintenance hunt on every change. It also forces every contributor — human or agent — to re-derive component patterns from scratch or research them externally. A single composable palette eliminates that whole class of work: build once, reuse everywhere, change in one place. This principle is the reuse-and-consistency complement to [No Hardcoded Colors](no-hardcoded-colors.md): that one says *bind colors to tokens*; this one says *bind whole reporting components to the shared palette*.

## Applies To

In-platform coworkers and external coding agents building or planning any reporting/data-display surface, and humans reviewing such PRs. Symmetric. Applies to status/severity badges, list/detail tables, KPI and metric cards, filter bars, CSV/PDF export affordances, and business-data charts. It does NOT force the palette onto deliberately bespoke, spec-designed dense surfaces (e.g. an ops cockpit) where a generic primitive is a worse fit — in those cases, adopt the palette only where it genuinely adds value and document the exception.

## How To Apply

Discover before you build. Substrate-verify (`dpf-verify-substrate-first`): grep `components/ui/report-kit` and read its `README.md`; query the curated catalog via `search_design_intelligence` (domain `ux` / `chart`) for the reporting pattern you need. Then compose: `<StatusBadge domain="finance" status={s} />` instead of a local color map; `<DataTable columns rows />` (in a thin `"use client"` wrapper when the page is a Server Component) instead of `<table>`; `<StatCard label value intent />` instead of a bespoke metric `<div>`; `<FilterBar mode="url" basePath=… />` for server-driven filters; `<Chart type="line" … />` for business-data charts (import by subpath). Add a new status domain to `statusColors.ts` rather than a page-local map. The architecture-review gate (`dpf-architecture-review`) measures plans against this principle; a plan that hand-rolls reporting UI should not pass.

## Decision Dimensions

- `reusability: 0.9` — the palette exists precisely so reporting components are built once and composed everywhere; hand-rolling defeats it.
- `long_term_maintainability: 0.7` — consolidating tables/badges/colors into one palette turns N-file changes into one-file changes.
- `schema_grounding: 0.5` — the `statusColors` intent registry IS the status-display schema; resolving through it keeps surfaces consistent and composable.

## Examples

- **Positive:** A new compliance list page renders status with `<StatusBadge domain="complianceAudit" status={a.status} />` and its rows with `<DataTable>`. Colors come from the registry; sorting/pagination/empty-state come for free; the surface matches every other reporting page with zero new CSS.
- **Counterexample:** A new finance page declares `const STATUS_COLORS = { paid: "bg-green-900/30 text-green-400", … }` and hand-rolls a `<table>`. It bypasses the design tokens, drifts from sibling pages' semantics, re-implements sorting, and becomes one more file to touch the next time the status palette changes.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)

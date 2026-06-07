# Workbooks — Spreadsheets That Stay Connected to Your Real Business Data

> Engineering subtitle: *Hybrid System-of-Record + Reporting + Operationalization-Lifecycle design.*

**Epic**: EP-GRID-WORKBOOKS — Universal Grid & Workbooks
**Date**: 2026-06-07
**Status**: Draft — revised after 3 persona reviews (Dale / Business Analyst / Enterprise Architect)
**Version**: 0.2
**Builds on**: [2026-03-23-universal-grid-workbooks-design.md](2026-03-23-universal-grid-workbooks-design.md) (Phase 1, shipped: foundation + custom tables + Backlog/Finance/Compliance platform grids + kanban + partial-edit)

## Plain-language summary (read this first)

If you live in Excel and dread that your spreadsheet is out of date the moment you save it — this is for you. You get a familiar grid. The numbers stay **live** against your real business data. You can add your own columns and calculations with Excel-style formulas (no programming). **You can't break the official data, and anything you do can be undone.** And when one of your handy columns turns out to be useful for everyone, you can — with a review — make it a permanent part of the system or put it on a dashboard.

Three kinds of data sit side by side, each with a small label so you always know what you're looking at: **official** (the real records), **live source** (synced from another system), **calculated** (a formula), and **your own notes**. You never have to learn those categories to get started — they stay out of the way until you want them.

## Glossary (plain language)

- **System of record (the "official data")** — your real invoices, customers, jobs, backlog. Not a copy. Editing it is governed and validated.
- **Provenance** — where a value comes from, shown as a small per-column label: official / live source / calculated / your note.
- **Governed metric** — a calculation you define once (e.g. "profit margin") so every report uses the same math.
- **Operationalize** — turn a handy calculated column into something permanent: a real field in the system, or a chart on a page. Reviewed before it happens; reversible.
- *(Engineering terms — SoR, semantic layer, ERD, MDM, RLS, push-down, lineage — appear only in the engineering sections and never in the end-user UI.)*

## Problem Statement

Knowledge workers live in spreadsheets because they are immediate and forgiving; enterprises live in systems of record because they are governed and authoritative. Today these are two separate worlds: people export from the system of record into Excel/Sheets/Airtable/Smartsheet, lose the live connection and the governance, and the derivative work (the calculation, the pivot, the "useful column") never makes it back into the architecture. BI tools (Power BI, Tableau, Looker) close half the gap — governed metrics over warehouse data — but are read-only mirrors authored by data teams, disconnected from the operational write path.

DPF Workbooks shipped the spreadsheet core *on top of the platform's own data model* (the grid edits real records through validated domain actions). This spec defines the next, genuinely novel step: a **hybrid surface where official system-of-record data, live sources, and non-architected derivatives coexist in one grid — system of record integral, not copied — and where a knowledge worker's ad-hoc column can graduate, under governance, into a reusable metric, a real schema field, or a page visual.**

## The Thesis: an unclaimed quadrant

No incumbent combines all four: **(1)** live governed system-of-record read/write, **(2)** knowledge-worker spreadsheet ergonomics, **(3)** a governed semantic/metric layer, **(4)** a lifecycle that operationalizes an ad-hoc derivative into the architecture. Sigma has 1.5 (spreadsheet-on-warehouse + write-back, but over a *mirror*, no promote-to-schema). dbt/Looker have the metric layer but read-only/data-team-authored. Coda/Airtable have self-serve derived data but no enterprise schema or SoR. The four-way hybrid — AI-native and governed — is open. That is what this targets.

## Goals

1. **Three-tier provenance in one grid**, first-class and visible (progressive-disclosed for non-technical users).
2. **System of record integral** — derived values compute over live governed records; lineage always resolves to the SoR.
3. **Excel-style formulas, no programming** — a named, Excel-compatible function set + a point-and-click calculation builder.
4. **A governed semantic/metric layer** — named, version-controlled, single-source-of-truth measures/dimensions, reusable everywhere.
5. **Reporting parity on the 80/20** — pivots, charts/dashboards, drill-through to the record, scheduled refresh, conditional formatting, row-level security via existing RBAC.
6. **An operationalization lifecycle** — a column matures personal → shared → metric → operationalized (schema field via Build Studio, or page/visual), with provenance, lineage, governed gates, and governed reversal.
7. **Safety** — non-destructive by default: validated writes, multi-step undo, reviewed promotions, no silent corruption.

## Non-Goals

- A general-purpose warehouse/ETL engine; Excel-equivalent function breadth or VBA/macros; full PM suite (gantt/critical-path — deferred decision); real-time multi-cursor co-editing in the core (tracked, Phase 6).

## Safety & Trust promise *(added per Dale review)*

This is a first-class section, not a buried clause:

- **You cannot quietly corrupt official data.** Edits to `system`/`source` columns go through the *same validated domain actions* the rest of the platform uses — a typo or invalid value is rejected, not committed (verified in Phase 1b: an invalid backlog edit was rejected and the record left unchanged).
- **Everything is undoable.** Multi-step undo/redo (Ctrl-Z) in the grid is a Phase-2 requirement (distinct from the audit history).
- **Promotions are reviewed.** Making a column permanent in the schema is reviewed before it happens and is **reversible via governed retirement** (not a silent live mutation).
- **No programming required.** Everyday users get Excel-style formulas and a point-and-click builder; any internal expression engine is never surfaced.
- **You always know what a value is.** The provenance label tells you official vs live vs calculated vs your-own-note.

## Core Model: three data tiers, one grid

Each `WorkbookColumn` has a **`provenanceKind`**:

| Kind | Backing | Read/Write | Governance | Example (small business) |
|---|---|---|---|---|
| `system` (official) | A Prisma model field via its adapter | RW via validated domain action | Full: capability + validation + audit | "This month's revenue by service" |
| `source` (live) | Live query / integration / input table | Read, or governed write-back | Source rules; lineage to origin | A synced payroll field; budget vs actuals |
| `derived` (calculated) | Formula/rollup/lookup over system+source+refs | Computed; definition stored | Definition governed; output is a metric | "Days since last customer contact" |
| `manual` (your note) | Free-form `WorkbookCell` | RW (personal/shared) | Lightest; explicitly non-architected | "Follow-up flag", a planning note |

**System-of-record-integral invariant**: a cell is never an orphaned value; `derived` columns reference and compute over governed records, and lineage always resolves to the SoR. **Progressive disclosure** *(Dale)*: the grid renders as an ordinary spreadsheet; provenance labels and the four kinds appear only on hover / an "advanced" toggle. A non-technical user never has to learn the taxonomy to start.

## Formula language v1 *(resolves former Open Question #1; per BA review)*

- **Syntax is Excel-compatible** (`=XLOOKUP(...)`, `=SUMIFS(...)`) to minimize adoption cost, plus a **point-and-click calculation builder** for non-technical users. The internal evaluator is an implementation detail, never surfaced as a language to learn.
- **v1 function set** (named, not deferred):
  - **Logical**: `IF`, `IFS`, `AND`, `OR`, `NOT`, `SWITCH`
  - **Lookup/Reference**: `XLOOKUP`, `VLOOKUP`, `INDEX`, `MATCH`, plus platform `REF()`/`LOOKUP()` over reference columns
  - **Conditional aggregation**: `SUMIFS`, `COUNTIFS`, `AVERAGEIFS`, `MINIFS`, `MAXIFS`
  - **Math/Stats**: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `ROUND`, `FLOOR`, `CEILING`, `ABS`
  - **Text**: `CONCAT`, `TEXT`, `LEFT`, `RIGHT`, `MID`, `LEN`, `TRIM`, `SUBSTITUTE`, `LOWER`, `UPPER`
  - **Date/Time**: `TODAY`, `NOW`, `DATEDIF`, `EOMONTH`, `NETWORKDAYS`, `YEAR`/`MONTH`/`DAY`, date arithmetic
- **Out of v1** (named so scope is clear): array spill, goal-seek/what-if data tables, VBA/macros — use Excel for those (Non-Goal).

## Cross-tier lookups & joins *(per BA review)*

A `derived` column can look up / roll up across **all three architected tiers**, joined on a shared key — the capability Airtable lacks (it links user-table↔user-table only). Worked example:

> On the **Invoices** grid, a `derived` column computes `Customer.region` (`system`) and the synced `Payroll.costCenter` (`source`), joined on `customerId`, then a rollup sums `amountDue` per region. One column spans official + live + reference data — over the org's real records.

## Reporting & semantic layer

- **Pivots** *(BA)*: Phase 3 ships **group-by summary** (row groups + sum/count/avg/min/max + date-grouping). **Full pivot** (multiple row *and* column groups, nested subtotals/grand totals, % of row/col/total, calculated fields inside the pivot) is **Phase 4** — stated so users know when to stop using Excel.
- **Drill-through** opens the underlying record (we *are* the source — strictly better than a warehouse-mirror drill-through).
- **Charts/dashboards** via `report-kit` (`Chart`/`StatCard`/`DataTable`); bind a metric into a `DynamicView` page.
- **Conditional formatting** *(BA — promoted to a requirement)*: color scales, data bars, icon sets, formula-based rules, top/bottom-N — with acceptance criteria (Phase 3).
- **Distribution**: scheduled refresh + report delivery via Inngest.
- **Row-level security** *(EA)*: **RLS is applied *before* aggregation** — a metric never exposes information about rows the viewer cannot see (closes the aggregation-inference leak). For a cross-tier metric, the viewer must satisfy the capability of **every** tier it composes (capability intersection); otherwise the metric is denied or shows only the permitted subset, never a leaky total.

## Metrics: single source of truth *(per EA review; resolves former Open Question #3)*

- **`WorkbookMetric`** is the governed definition record with: **unique name within a namespace/scope**, a **single owner**, a **version chain**, and **resolved lineage** (see invariant below). "One definition, consistent everywhere" is *enforced* by the uniqueness + ownership constraint, not merely intended.
- **Storage = metrics-as-code seeded to DB** (mirrors the platform's prompts-in-DB pattern: definitions live in git/seed, instances in DB), keeping them diffable, reviewable, and consistent with `fix-the-seed-not-the-runtime`.
- **Versioning semantics** *(BA)*: redefining a metric creates a new version; **historical reports pin the version they were computed with** (no silent restatement of last quarter) — re-point is an explicit action.

## The Operationalization Lifecycle (centerpiece)

A column has a maturity state with governed promotions:

```
personal → shared → governed METRIC → OPERATIONALIZED ──┬─ (a) SCHEMA FIELD (via Build Studio)
                                                         └─ (b) PAGE / VISUAL (DynamicView/report-kit)
                                                  (and, eventually) → RETIRED
```

- **Plain-language** *(Dale)*: "Found a calculation everyone keeps redoing? One click asks to make it permanent. We handle the technical part behind the scenes, someone reviews it first, and if it doesn't work out we undo it." Words like *migration / schema / ERD / MDM* never appear in the user's view.
- **Exit (b) page/visual** is **self-serve and instant** (no schema change, reversible) — `manage_workbooks`.
- **Exit (a) schema field** is **operator-gated** and routes through Build Studio (migration + seed); the field then joins the EP-DATA-ARCH live ERD (and MDM registry if master data). The user sees an **async status chip** ("submitted → in Build Studio → live") so they're never blocked wondering *(BA)*.
- **Worked end-to-end example** *(BA)*: A BA adds `daysOpen` on the Backlog grid (`derived`) → shares it to the team (instant) → promotes it to a governed metric `Backlog.DaysOpen` → it appears on the Velocity dashboard → an operator promotes it to a real schema field → it joins the ERD and is available to every adapter and report.

### Lifecycle state machine & promotion gates *(added per EA review; resolves former Open Question #4)*

| Transition | Approver / capability | Required evidence | Fail-closed invariant |
|---|---|---|---|
| personal → shared | owner, `manage_workbooks` | none | **`manual` columns must be typed + validated here** |
| shared → metric | owner + new **`govern_metrics`** capability | usage ≥ N users/workbooks; **name-uniqueness vs ontology**; lineage resolves | **no metric without a resolved lineage edge** |
| metric → schema (a) | **Build Studio operator gate + EA/data-steward sign-off** | proven usage threshold; **MDM dedup check**; **blast-radius pre-check**; "no existing semantic equivalent" review | routes through `build-orchestrator`; seed updated; joins ERD |
| metric → page/visual (b) | owner, `manage_workbooks` | metric exists + lineage | no schema change; bind only |
| any → retired | owner / EA (tier-dependent) | **`explain_blast_radius`**; consumers notified | retire ≠ delete; data retained for audit |

- **Evidence-based, not provenance-based** *(governance-approves-evidence-not-provenance)*: promotion qualifies on usage/lineage evidence regardless of whether a human or AI authored the column.
- **"Reversible" = governed retirement** *(EA)*, not literal schema rollback once features/adapters/reports bind to a field — gated by a mandatory blast-radius check; the `retired` state retains data for audit.

## Governance, security, lineage, anti-sprawl *(expanded per EA review)*

- **Lineage is a write-time hard constraint**: a `derived`/`metric`/operationalized field **cannot be created/promoted without a resolved lineage edge** (Neo4j + Activity). Fails closed — no silent-success (DPF prior art: agent-grant seeding gap, hive `success:true+prUrl:null`).
- **Anti-sprawl / shadow-IT control**: before `shared → metric`, an automatic ontology/duplicate check (`query_ontology_graph`, `suggest_taxonomy_placement`) surfaces "this likely already exists as X" — **block-with-override, not silent-allow**. Duplicate-column detection extends to *all* tiers (Phase 1's AI advisor only covered custom-table add-column). Per-scope soft caps + decay/archival for unused `manual`/`derived` columns.
- **`manual → governed` validation gate**: free-form values must be typed/validated before advancing, so ungoverned data cannot enter the SoR through the back door.
- **MDM alignment**: promote-to-schema consults `domain-registry`; if the concept matches an existing master-data domain → extend/attach (not duplicate), reject on collision.
- **Audit/attribution** via existing `Activity` + `ToolExecution`; every transition records who/when/why + the evidence snapshot.

## Performance & scale *(resolves former Open Question #5; per EA/BA review)*

- **Push-down to SQL is the default** for `system`/`source`-backed aggregation/pivot; reconciled with Phase-1's cursor pagination / no-`COUNT(*)` pattern (aggregation uses scoped SQL, not in-memory full scans).
- **Materialization** auto-triggers when a metric is promoted or scheduled; incremental refresh thereafter.
- **In-memory** only for small custom (`manual`) tables.
- **Stated NFR**: interactive (<2s) group-by/pivot over `system`-tier datasets up to a committed row target; above it, materialize. (Exact N set in planning.)

## Research & Benchmarking (per AGENTS.md §10)

- **Excel / Google Sheets** — unmatched free-form calc + charts (Sheets: best real-time collab). *Adopt*: grid + Excel-compatible formula ergonomics. *Reject*: file/silo, no governance, no relational SoR.
- **Smartsheet** — spreadsheet-familiar PM (gantt, dependencies, forms, automations, dashboards). *Adopt*: views, forms, automation patterns. *Reject*: row-only, separate silo.
- **Airtable** — relational (linked records, rollups, lookups), multi-view, interfaces, AI (Omni). *Adopt*: relational fields, multi-view, interfaces. *Reject*: links only user-tables; not the SoR.
- **Sigma** — spreadsheet/pivot UI compiling to live warehouse SQL + write-back/input tables ([sigmacomputing.com](https://www.sigmacomputing.com/product/spreadsheets)). *Adopt*: spreadsheet-on-live-data, input/write-back, formula→query push-down. *Gap left*: analytics over a *mirror*; no promote-to-schema lifecycle.
- **dbt Semantic Layer / Looker / Cube** — governed metrics-as-code, versioned, lineage-aware ([getdbt.com](https://www.getdbt.com/product/semantic-layer), [holistics.io](https://www.holistics.io/bi-tools/semantic-layer/)). *Adopt*: one governed definition, version-controlled, lineage. *Reject*: read-only, data-team-authored.
- **Coda / Notion** — self-serve derived columns + light operationalization ([coda.io](https://coda.io/blog/tool-consolidation/coda-vs-notion-formulas)). *Adopt*: self-serve derivation + the operationalize instinct. *Reject*: no enterprise schema, no governed metric layer, no SoR.

**Gap this fills**: the four-way hybrid (SoR-integral + spreadsheet self-serve + governed semantic layer + operationalization lifecycle), AI-native and governed — unoccupied by any single incumbent.

## Substrate Mapping (reuse, do not rebuild)

| Need | Existing substrate |
|---|---|
| "Every model is a grid" | Adapter framework + `gridRegistry`; 406 Prisma models; generic Prisma adapter to add |
| Reference resolution | `ReferenceTypeahead`, `adapter.searchReferences`, MDM `domain-registry` (8 domains) |
| Live ERD / data architecture | EP-DATA-ARCH (`lib/ea/data-model-mirror.ts`, `data-architecture-steward.ts`, `/ea/data-model`) |
| Lineage / impact / blast-radius | Neo4j graph (`neo4j-projection.ts`), `explain_blast_radius`, `query_ontology_graph`, `suggest_taxonomy_placement` |
| Operationalize → schema | Build Studio orchestrator (`lib/integrate/build-orchestrator.ts`) — migration + seed |
| Visual exits | `report-kit` (`Chart`/`StatCard`/`DataTable`), `DynamicView`/`DynamicForm` |
| Metric refresh / automation | Inngest (`lib/queue`) + `ScheduledJob` catalog |
| Audit / cell history / lineage | `Activity`, `ToolExecution` |
| RLS / governance | `permissions.ts` capabilities + `WorkbookShare`; new `govern_metrics` capability |
| Export / import | `report-kit` `toCsv` (export ✅); CSV + `.xlsx` import to add via `/api/upload` pattern |

## Data Model Additions

- `WorkbookColumn.provenanceKind` (`system|source|derived|manual`) + `formula`/`metricRef` config.
- `WorkbookColumn.lifecycleState` (`personal|shared|metric|operationalized|retired`) + promotion audit.
- `WorkbookMetric` — **unique name per namespace, single owner, version chain, required lineage refs**; metrics-as-code seeded to DB.
- `WorkbookSourceBinding` — for `source` columns: integration/query ref, refresh policy, write-back rule.
- Operationalization reuses Build Studio (`FeatureBuild`) + `Activity` for the schema-promotion trail.
- New capability key: `govern_metrics` (distinct from `manage_workbooks`).
- **Invariants enforced in the model/server**: lineage-fail-closed; metric name uniqueness; `manual→governed` typing gate; RLS pre-aggregation.

## Phased Build Order (with acceptance criteria)

1. **Phase 2 — Relational + provenance core**: reference columns wired to real entities; rollups/lookups/formulas over references (v1 function set); `provenanceKind` first-class with progressive disclosure; generic Prisma adapter; **multi-step undo/redo**. *AC*: cross-tier lookup example works; provenance hidden by default; undo restores prior cell; lineage edge written for every derived column (fail-closed).
2. **Phase 3 — Views & spreadsheet-on-data UX**: filter bar + saved views; calendar/gallery; **conditional formatting** (rule types above); CSV + `.xlsx` import; group-by summary. *AC*: conditional-format rule types render; xlsx import preserves sheets best-effort; saved view persists per user.
3. **Phase 4 — Semantic/metric layer + reporting**: `WorkbookMetric` (unique/owned/versioned, lineage-required); **full pivots**; charts/dashboards; drill-through; scheduled refresh; **RLS pre-aggregation**; push-down/materialization. *AC*: duplicate metric name blocked; RLS hides rows before aggregation (no leaky total); pivot subtotals/% correct; push-down verified on large dataset.
4. **Phase 5 — Operationalization lifecycle**: state machine + gates table; promote-to-metric (`govern_metrics`); promote-to-schema via Build Studio (+MDM dedup + blast-radius); promote-to-page/visual (self-serve); provenance + lineage UI; retire path. *AC*: each gate enforces its evidence + fail-closed invariant; schema promotion produces a migration + ERD join; retire runs blast-radius.
5. **Phase 6 — Collaboration & live sources**: comments/mentions; cell history (Activity); real-time co-edit (SSE+CRDT); `source` columns + write-back.
6. **Phase 7 — Automation & PM views (optional)**: workbook automations (Inngest on-change); forms→tables (DynamicForm); gantt/timeline.

Spine = Phases 2→5 (relational provenance → reporting/metrics → operationalization): the hybrid no incumbent has. Acceptance criteria are functional (drive the gate/invariant), per the "structural ≠ functional" standing rule.

## Resolved decisions (formerly open questions)

1. **Formula language** → Excel-compatible syntax + point-and-click builder; named v1 function set above.
2. **`source` scope** → platform live queries first; external integrations in Phase 6.
3. **Metric storage** → metrics-as-code seeded to DB (prompts-in-DB pattern).
4. **Operationalize UX** → exit (b) self-serve/instant; exit (a) operator-gated with async status chip; full gate table above.
5. **Performance** → push-down default + materialization on promotion/schedule; in-memory only for small custom tables.
6. **Where it lives (layman vs power user)** → one spreadsheet front door; advanced provenance/metrics/lifecycle progressively disclosed; non-technical safety framing up front.

### Remaining open questions

- Exact usage-evidence thresholds (N users/workbooks) for promotion gates — set in planning.
- Committed interactive row-count target for push-down vs materialize — benchmark in planning.
- Soft-cap + decay parameters for anti-sprawl — tune from real usage.

## Reviewer Feedback Log

**Reviewed 2026-06-07 by three persona threads. All major feedback incorporated into v0.2.**

- **Dale (non-technical small-business owner)** — *"Doc wasn't written for me; pushed my fear button about breaking real data; the 'centerpiece' was the part I understood least."* Addressed: plain-language title + summary + glossary; **Safety & Trust promise** section; progressive disclosure of the four column kinds (resolved OQ#6); "no programming" commitment; operationalize reframed in plain English with jargon hidden from the UI; small-business examples. *Outstanding for his full sign-off*: the safety promise + decided front door — both now in-spec.
- **Business Analyst (power spreadsheet/BI user)** — *"Conditional yes; won't retire Excel until formulas/pivots/perf are concrete."* Addressed: **Formula language v1** with named Excel-compatible functions; **cross-tier lookup** spec + example; pivot depth split (group-by summary Phase 3, full pivot Phase 4); **conditional formatting** promoted to a requirement; **performance NFR** + push-down; **undo/redo in Phase 2**; metric versioning = pin-history-no-silent-restate; **`.xlsx` import**; self-serve exit (b) vs gated exit (a) with status chip; worked end-to-end example; multi-sheet/cross-workbook noted (cross-workbook via metric refs).
- **Enterprise Architect** — *"Approve the direction, hold the design until governance is real."* Addressed: **Lifecycle state machine & promotion gates** table; new **`govern_metrics`** capability; **anti-sprawl/ontology-collision** invariants; **lineage as write-time fail-closed constraint**; **metric single-source-of-truth** (uniqueness/owner/version) + metrics-as-code storage; **RLS pre-aggregation** rule + cross-tier intersection; **`manual→governed` validation gate**; **"reversible" redefined as governed retirement + blast-radius**; **MDM dedup** on schema promotion; functional acceptance criteria per phase. All six original open questions resolved in-spec, as required.

**Disposition**: v0.2 incorporates all three reviews. EA sign-off conditions (gates, anti-sprawl, lineage invariant, metric SSOT, RLS pre-aggregation, performance decision, reversal-as-retirement) are now in the design. Ready to proceed to planning + Phase-2 backlog.
</content>

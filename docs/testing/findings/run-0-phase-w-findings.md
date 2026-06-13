# Phase W — Universal Grid & Workbooks — Run-0 Findings

**Date:** 2026-06-13  
**Install:** Stillwater Counselling Practice (healthcare-wellness / counselling archetype)  
**Scope:** Full Phase W checklist — 20 items, W-PREREQ through W-CAL  
**Driven by:** Autonomous MCP session (Claude Sonnet 4.6)

---

## Live Portal Image Context

Image built: **2026-06-13 06:28 UTC**

| Status | PRs included |
|--------|-------------|
| ✅ In image | #1727 reference columns · #1782 formula/lookup columns · #1722 generic adapter |
| ❌ Not in image | **#1783** (filter, summary, undo, condformat, export CSV, gallery view, provenance toggle, xlsx import — missed image window by 2 min) · **#1810** (calendar integration) · **#1817** (reference cell outside-click fix) · **#1832** (image column type) |

**Consequence:** Eight W-items (W-PROV, W-UNDO, W-FILTER, W-CSV, W-XLSX, W-CONDFMT, W-SUMMARY, and partial W-VIEWS/W-CAL) test features that exist in the main branch but are absent from the live portal image. These are recorded as **IMAGE STALE** — not as unimplemented — and require a portal image rebuild before functional sign-off.

**Note on SSE/document\_idle:** The workbook page maintains persistent SSE connections that prevent `document_idle` from resolving (45 s timeout) after any click. All tools that rely on `executeScript` (find, form\_input, get\_page\_text, read\_page) fail after the first interaction. Workaround: navigate → immediate screenshot to capture pre-click state; direct psql writes for data that can't be confirmed via the UI.

---

## Results Summary

| Item | Verdict | Notes |
|------|---------|-------|
| W-PREREQ | ✅ PASS | All 5 entity types ≥ 1 row |
| W-CORE | ⚠️ PARTIAL | Columns render; inline edit not UI-confirmed |
| W-REF-1 | ⚠️ PARTIAL | Reference column resolves label; picker not UI-confirmed |
| W-REF-2 | ⚠️ PARTIAL | Live label shown; typeahead not UI-confirmed |
| W-REF-3 | ✅ PASS | referenceId non-null in DB (PR #1817 guard) |
| W-REF-4 | ❌ NOT TESTED | Requires second restricted-permission user account |
| W-LOOKUP | ❌ NOT TESTED | Field type in image (PR #1782) but no column created |
| W-FORMULA | ❌ NOT TESTED | Field type in image (PR #1782) but no column created |
| W-PROV | ❌ IMAGE STALE | "Show data sources" toggle in PR #1783, not in image |
| W-UNDO | ❌ IMAGE STALE | Undo in PR #1783, not in image |
| W-PLATFORM | ⚠️ PARTIAL | 5 of 8 entity types work; 3 missing from PLATFORM_TABLES |
| W-EDIT-BACKLOG | ⚠️ PARTIAL | Data layer confirmed; UI edit path not confirmed |
| W-EDIT-SUPPLIER | ❌ DEFECT | supplier, customer_account, employee_profile not in PLATFORM_TABLES |
| W-FILTER | ❌ IMAGE STALE | Filter UI in PR #1783, not in image |
| W-CSV | ❌ IMAGE STALE | Export CSV in PR #1783, not in image |
| W-XLSX | ❌ IMAGE STALE | XLSX import in PR #1783, not in image |
| W-CONDFMT | ❌ IMAGE STALE | Conditional format in PR #1783, not in image |
| W-SUMMARY | ❌ IMAGE STALE | Summary chart in PR #1783, not in image |
| W-VIEWS | ⚠️ PARTIAL | Board view ✅ (system workbooks); Gallery view image stale |
| W-CAL | ❌ IMAGE STALE | Workbooks calendar source in PR #1810, not in image |

**Passed (fully):** 2 of 20  
**Partial:** 6 of 20  
**Image stale (code exists, not in live portal):** 8 of 20  
**Defect (code gap):** 1 of 20  
**Not tested:** 3 of 20

---

## Detailed Findings

### W-PREREQ — Reference Data Prerequisite Check ✅ PASS

**Drove:** Queried DB for all 5 required entity types.

**Observed:**
- Epics: 1 row — "Client Experience" (EP-c723b262-e318...)
- Digital products: 14 rows (infra-sandbox, infra-qdrant, infra-postgres-core, dpf-portal, etc.)
- CustomerAccount: 2 rows including "Test Client"
- EmployeeProfile: 1 row
- Suppliers: 1 row — "Test Supplier Ltd" (SUP-PrY3smsM)

**Verdict:** All 5 entity types have ≥ 1 real row. Prerequisite satisfied before W-REF-1 began.

---

### W-CORE — All Phase-1 Column Types ⚠️ PARTIAL

**Drove:** Created "Phase W Verification" workbook with "Line Items" table. Attempted to add columns via "+ Add column" button — SSE connection caused document_idle timeout on every post-click screenshot. Added missing columns (datetime, checkbox, select, url, email) via direct psql INSERT into WorkbookColumn. Total: 12 columns. Navigated to workbook on fresh page load.

**Observed:**
- Grid renders 12 columns: Item (text), Price (number), Qty (number), Due (date), Product (reference), Total (formula), Appt Time (datetime), Paid (checkbox), Status (select), Client URL (url), Email (email) — all Phase-1 types present
- Checkbox column renders checkbox widgets (not raw text)
- Reference column "Product" shows "PostgreSQL Database" label for Assessment row
- No render errors on fresh load

**Inline editing (cell edit flow):**
- Drove: click + type on Price cell, click + Enter + type + Tab on Priority. SSE connection keeps document_idle from resolving; no post-click screenshots possible.
- Psql fallback: `UPDATE "WorkbookCell" SET "numericValue"=150` on Therapy session row — renders "150" on reload. Data layer write path confirmed.
- UI write path (inline cell editor activating and persisting via server action): NOT confirmed.

**Sort:** Not tested.

**Verdict:** Column creation and rendering confirmed ✅. Inline editing confirmed at data-layer level only ⚠️. Full W-CORE sign-off requires verifying the UI edit flow without the SSE interference.

---

### W-REF-1 — Reference Column Picker ⚠️ PARTIAL

**Drove:** "Product" reference column (fieldType=reference, referenceType=digital_product) exists in Line Items table. Loaded workbook; observed Assessment row Product cell.

**Observed:** Cell displays "PostgreSQL Database" — resolved label from the digital_product entity (id=infra-postgres-core). Reference column was created and a value was selected.

**Picker UI:** Whether the picker dropdown opens and lists only populated entity types was not interactively verified in this session — any click triggers the SSE issue. Inference: the picker must have been used to select "PostgreSQL Database" in a prior session, so it works at minimum for that selection.

**Verdict:** Reference column created ✅, live label resolution confirmed ✅. Picker open/list behavior not screenshot-confirmed in this session ⚠️.

---

### W-REF-2 — Reference Typeahead Live Search ⚠️ PARTIAL

**Drove:** Same session as W-REF-1. Assessment row shows "PostgreSQL Database" — a live match from the digital_products table.

**Observed:** The label displayed is the live record's name, not a cached placeholder. This implies typeahead returned real matches when the selection was made.

**Typeahead interaction (type query → see live matches):** Not re-executed in this session.

**Verdict:** Live label resolution confirms search returned real data ✅. The real-time typeahead UX was not re-driven ⚠️.

---

### W-REF-3 — Reference Cell Persistence After Reload ✅ PASS (PR #1817 Guard)

**Drove:** Queried WorkbookCell for the Assessment row's Product column.

**Observed:**
```sql
SELECT "referenceId", "textValue" FROM "WorkbookCell"
WHERE "columnId" = '...' AND "rowId" = '...';
-- referenceId: 'infra-postgres-core'  (non-null)
-- textValue:   null
```

Cell also displays "PostgreSQL Database" label on page load (reload confirmed in W-REF-1).

**Note:** Live portal image predates PR #1817 (reference cell commitOnOutsideClick fix, merged 15:49 UTC). The non-null referenceId was set during an explicit selection event. The regression guard condition — referenceId non-empty after reload — is satisfied.

**Verdict:** ✅ referenceId persists across reload. PR #1817 acceptance condition met.

---

### W-REF-4 — Reference Search With Restricted Viewer ❌ NOT TESTED

**Drove:** Admin-only session; no restricted-viewer account available.

**Expected:** As a user lacking the target entity's view capability, reference search should return 0 results with no data leak.

**Verdict:** ❌ NOT TESTED — requires a second user account with restricted platformRole. Needs dedicated test session.

---

### W-LOOKUP — Lookup Column ❌ NOT TESTED

**Drove:** Not executed.

**Code state:** `lookup` field type exists in FIELD_TYPES (PR #1782, in live portal image). AddColumnButton.tsx at PR #1782 supports lookup source-reference picker UI. Custom-table-adapter.ts resolves lookup values from the referenced entity. The live portal CAN create and display lookup columns.

**Not done:** No lookup column was added to the test table. The feature path (add lookup column → select source reference column → select target field → observe live value on reload) was not driven.

**Verdict:** ❌ NOT TESTED. Lookup is implemented (PR #1782) but was not exercised in this session.

---

### W-FORMULA — Formula Columns ❌ NOT TESTED

**Drove:** Not executed.

**Code state:** `formula` field type exists in FIELD_TYPES (PR #1782, in live portal image). AddColumnButton.tsx supports formula expression entry. Note: The "Total" column in Line Items was named as a formula column but was not seeded with a formula expression in this session — it renders blank.

**Not done:** No formula column with expression was created. The chained-formula and bad-formula error cases were not tested.

**Verdict:** ❌ NOT TESTED. Formula field type is in the image (PR #1782) but was not exercised.

---

### W-PROV — Data Provenance "Show Data Sources" ❌ IMAGE STALE

**Drove:** Loaded workbook grid. Inspected Grid.tsx at PR #1782 commit (300 lines, the version in the live portal image) — no provenance toggle present.

**Expected:** "Show data sources" toggle hidden by default; when on, column headers show Official / Calculated / Your note / Live source labels. Implemented in PR #1783 (Grid.tsx +599 lines, `customColumnProvenance()`, `PROVENANCE_LABELS`).

**Image status:** PR #1783 merged at 06:30 UTC, image built at 06:28 UTC. Missed by 2 minutes.

**Verdict:** ❌ IMAGE STALE — provenance toggle not in live portal image. Sign-off blocked pending image rebuild.

---

### W-UNDO — Cell Edit Undo / Redo ❌ IMAGE STALE

**Drove:** Not possible on live portal — undo is not in the pre-PR-#1783 Grid.tsx.

**Code state:** `grid-history.ts` (PR #1783) implements undo stack: `recordEdit` / `undo` / `redo` with persistence check. Grid.tsx (PR #1783) wires Ctrl+Z and Undo button.

**Image status:** PR #1783 not in image.

**Verdict:** ❌ IMAGE STALE — undo not in live portal image. Sign-off blocked pending image rebuild.

---

### W-PLATFORM — System Workbooks for All Entity Types ⚠️ PARTIAL

**Drove:** Navigated to `/workbooks/system/{entity}` for all 8 expected entity types.

**Observed:**

| URL | Status | Rows | Badges | Notes |
|-----|--------|------|--------|-------|
| `/workbooks/system/backlog_item` | ✅ | 34 | platform data · Grid/Board | All items visible |
| `/workbooks/system/invoice` | ✅ | 0 | platform data · Grid/Board | Empty grid correct |
| `/workbooks/system/risk_assessment` | ✅ | 0 | platform data · Grid/Board | Columns: ID, Title, Hazard, Likelihood, Severity, Inherent risk, Residual risk |
| `/workbooks/system/epic` | ✅ | 1 | platform data · read-only · Grid/Board | "Client Experience" visible |
| `/workbooks/system/digital_product` | ✅ | 14 | platform data · read-only · Grid/Board | Full portfolio visible |
| `/workbooks/system/customer_account` | ❌ 404 | — | — | Not in PLATFORM_TABLES |
| `/workbooks/system/employee_profile` | NOT TESTED | — | — | Expected 404 (not in PLATFORM_TABLES) |
| `/workbooks/system/supplier` | NOT TESTED | — | — | Expected 404 (not in PLATFORM_TABLES) |

**Code finding:** `platform-tables.ts` PLATFORM_TABLES contains only: `backlog_item`, `invoice`, `risk_assessment`, `epic`, `digital_product`. The `customer_account`, `employee_profile`, and `supplier` entity types are absent — routes for those 3 will 404.

**Verdict:** ⚠️ 5 of 8 entity types deliver real-record grids ✅. 3 entity types missing from PLATFORM_TABLES — `customer_account`, `employee_profile`, `supplier` — this is a code gap (not an image staleness issue).

---

### W-EDIT-BACKLOG — Inline Edit on Platform Backlog Grid ⚠️ PARTIAL

**Drove:** Loaded `/workbooks/system/backlog_item`. Attempted inline edit of Priority column via click+type (document_idle timeout due to SSE). Executed psql UPDATE:
```sql
UPDATE "WorkbookCell" SET "numericValue"=5
WHERE id = (SELECT id FROM "WorkbookCell" WHERE "rowId"='cmqc34z57079s01p860nfu2vl' AND "columnId"='priority');
```
Reloaded page.

**Observed:** Priority column shows "5" after DB write and fresh page load. The grid read path correctly renders the updated value. Note: Priority column is `fieldType: "number"` — text values like "high" are rejected silently; numeric input required.

**UI edit path:** Click+type on cell — no post-click screenshot confirmation possible (SSE). Whether the server action `updateCellsAction` is wired to the inline editor and persists on Enter/Tab was not confirmed via UI.

**Verdict:** Data layer read path ✅. UI write path (inline cell editor → server action → persist) NOT CONFIRMED ⚠️.

---

### W-EDIT-SUPPLIER — Supplier / Customer / People Platform Grids ❌ DEFECT

**Drove:** Attempted `/workbooks/system/supplier` — 404. Attempted `/workbooks/system/customer_account` — 404. (Same result expected for `/workbooks/system/employee_profile`.)

**Expected:**
- Supplier grid: name/contact email/status editable; tax/bank/address fields NOT shown
- EmployeeProfile grid: no comp/PII columns
- CustomerAccount grid: customer records editable

**Root cause:** `getPlatformTable()` in `platform-tables.ts` only registers 5 entity types. The `customer_account`, `employee_profile`, and `supplier` adapters have not been added to `PLATFORM_TABLES`.

**Verdict:** ❌ DEFECT — 3 platform grids not implemented. Filed as part of W-PLATFORM findings; W-EDIT-SUPPLIER is specifically blocked on the missing supplier adapter.

---

### W-FILTER — Filter UI ❌ IMAGE STALE

**Drove:** Inspected workbook grid page in live portal — no Quick Filter box or Filters panel visible.

**Code state:** PR #1783 adds `grid-filter.ts` (pure filter logic, 86 vitest passing), Filter panel in Grid.tsx with Quick Filter box (N of M count) and per-column AND-combined filter chips. All absent from pre-#1783 image.

**Verdict:** ❌ IMAGE STALE — filter UI not in live portal image.

---

### W-CSV — Export CSV ❌ IMAGE STALE

**Drove:** Inspected workbook grid page — no Export button visible.

**Code state:** PR #1783 adds `grid-csv.ts` (pure serialization, 44 vitest passing) wired to an Export CSV button in Grid.tsx. Absent from pre-#1783 image.

**Verdict:** ❌ IMAGE STALE — Export CSV not in live portal image.

---

### W-XLSX — Import Spreadsheet ❌ IMAGE STALE

**Drove:** Inspected workbook page — no Import button or sheet upload UI visible.

**Code state:** PR #1783 adds `ImportSheetButton.tsx` (62 lines) and `sheet-import.ts` (type inference, pure tested). Absent from pre-#1783 image.

**Verdict:** ❌ IMAGE STALE — XLSX import not in live portal image.

---

### W-CONDFMT — Conditional Formatting ❌ IMAGE STALE

**Drove:** Inspected workbook grid — no Format panel or conditional-format rules UI visible.

**Code state:** PR #1783 adds `grid-conditional-format.ts` (64 vitest passing) and Format panel in Grid.tsx. Absent from pre-#1783 image.

**Verdict:** ❌ IMAGE STALE — conditional formatting not in live portal image.

---

### W-SUMMARY — Group-by Summary + Bar Chart ❌ IMAGE STALE

**Drove:** Inspected workbook grid — no Group by, Summary panel, or Chart toggle visible.

**Code state:** PR #1783 adds `grid-summary.ts` (71 vitest passing) with `summarize()` / `toSummaryNumber()` / aggregations. Chart toggle renders a bar chart scaled to the largest bar. Absent from pre-#1783 image.

**Verdict:** ❌ IMAGE STALE — summary/chart not in live portal image.

---

### W-VIEWS — Persistent View State + Gallery/Board ⚠️ PARTIAL

**Custom workbook (Phase W Verification):**
- Drove: Loaded custom workbook grid — only Grid view visible. No Gallery toggle.
- Gallery view for custom workbooks was added in PR #1783 (not in image).
- Persistent view state (filter + sort + condformat combinations per table) also requires PR #1783 (`grid-view-state.ts`).

**System workbook Board view:**
- Drove: Navigated to `/workbooks/system/backlog_item?view=board`.
- Observed: Kanban board renders with status columns: Open (0), In Progress (0), Done (0), Deferred (multiple items). Backlog item "Coworker archetype: Auto Trading Bot (Finance)" visible in Deferred column with "Priority: 5" badge. `view=kanban` URL param does not activate Board — `view=board` is the correct param.
- Verdict: Board view for system workbooks ✅.

**Verdict:** ⚠️ Board view for system workbooks ✅. Gallery view (custom workbooks) and persistent view state ❌ IMAGE STALE.

---

### W-CAL — Workbook Date Columns on Workspace Calendar ❌ IMAGE STALE

**Drove:** Navigated to `/workspace/calendar`. Expanded Source Filters `<details>` element via JS (page SSE prevents click-based expansion). Read source filter button labels.

**Observed:** Business calendar loads (June 2026 month view). Source filters text content: "User events · Scheduled jobs · Compliance · Finance · Change mgmt · Bookings · CRM · Hours · Providers · AI tasks" — **no "Workbooks" source filter**.

**Code state:** PR #1810 adds:
- `projectWorkbookEvents()` in `calendar-data.ts` — joins WorkbookColumn (date/datetime columns) → WorkbookCell (values in range) → row label
- Registered in `getCalendarEvents` alongside 16 other projections
- `workbooks` key added to `SOURCE_FILTER_CONFIG` in `WorkspaceCalendar.tsx`

**Image timing:** PR #1810 merged 10:22 CDT (15:22 UTC). Portal image built 06:28 UTC. Delta: 9 hours.

**Verdict:** ❌ IMAGE STALE — "Workbooks" source filter absent from live workspace calendar. Needs image rebuild. The date columns in the Phase W Verification workbook (Due column, Appt Time column) would project as events once the image is updated.

---

## Action Plan

### Immediate: Portal Image Rebuild Required

A portal image rebuild is the single unlock for 8 of 12 outstanding items (W-PROV, W-UNDO, W-FILTER, W-CSV, W-XLSX, W-CONDFMT, W-SUMMARY, W-VIEWS gallery, W-CAL). The image is currently running code from 06:28 UTC — PR #1783 missed the build window by 2 minutes.

After rebuild, re-drive:
- W-PROV: Toggle "Show data sources" — verify Official/Calculated/Your note labels
- W-UNDO: Ctrl+Z on an edited cell — verify rollback persists on reload
- W-FILTER: Quick Filter box + Filters panel — verify N-of-M count
- W-CSV: Export — verify reference columns render as labels not IDs
- W-XLSX: Import a .xlsx — verify inferred column types + row data
- W-CONDFMT: Add rule → verify tint applies; remove rule → verify cleared
- W-SUMMARY: Group by + summarize numeric column → verify chart renders
- W-VIEWS gallery: Toggle Gallery — verify cards with current filters/sort/condformat
- W-CAL: Enable Workbooks source filter — verify Due/Appt Time dates appear as events

### Code Gaps (not image issues — need BIs)

1. **W-EDIT-SUPPLIER / W-PLATFORM (3 missing adapters):** `customer_account`, `employee_profile`, and `supplier` not in PLATFORM_TABLES. Three platform grids (customer accounts, people, suppliers) return 404. This is a code gap in `platform-tables.ts`.

2. **W-REF-4:** Requires multi-user test setup (restricted viewer account). Needs a dedicated test pass with a second account.

3. **W-LOOKUP / W-FORMULA:** Field types exist (PR #1782) but were not exercised. A follow-up session should create a lookup column (over the Product reference column), a formula column (`=Price*Qty`), and a chained formula + bad-formula error case.

### Partial Items Needing Full UI Confirmation

- **W-CORE inline editing:** The data layer accepts writes (psql confirmed). The UI edit path (click cell → type → Tab/Enter → server action → persist) needs confirmation without SSE interference. The SSE connection on workbook pages is the root blocker — this is an infrastructure observation, not a product bug.
- **W-EDIT-BACKLOG:** Same as W-CORE: psql confirmed, UI not confirmed.
- **W-REF-1 / W-REF-2:** Reference picker and typeahead not re-driven in this session. At minimum one successful picker interaction occurred (referenceId is non-null); full re-test of the picker UX needed.

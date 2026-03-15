# Employee Tool Intake, Per-Company Software Registration, and Finance-Linked Instance Metadata Design

**Date:** 2026-03-15
**Status:** Draft
**Scope:** Provide a reliable path to register foundational + employee productivity tools (e.g., VS Code, Office, Google Mail) as per-company digital product instances when employees sign up, download, purchase, or upload enterprise software inventories.

## Problem

Current catalog/taxonomy entry points are not complete for everyday productivity tools, and onboarding of tool inventory is ad hoc. The platform has a gap where:

- New employee tools may exist in spreadsheets, purchases, or manual installs but are not consistently represented as managed inventory with per-company context.
- Runtime downloads are not consistently tied to portfolio/taxonomy and finance placeholders.
- Shared spreadsheets used during onboarding are not a first-class part of finance/run-time traceability.
- Multi-business use cases (including US + UK) and both dev/test/prod footprints are not consistently captured before downstream finance reconciliation.

## Design objectives

1. Capture foundational and employee productivity software as **company instances** rather than global one-off records.
2. Support three intake modes:
   - one-off manual entry
   - batch ingestion from existing document upload flow (`.xls`, `.xlsx`, `.docx`)
   - optional folder-synchronization mode with **polling priority** now, and event-driven later.
3. Ensure every intake creates/updates:
   - a runtime inventory record (`InventoryEntity`)
   - a catalog entry (`DigitalProduct`)
   - taxonomy and portfolio linkage
   - finance placeholders (environment, license, seats, company context, cost/rate)
4. Keep processing in this platform (no direct dependency on third-party runtime identity/codebases for this slice).

## Recommended approach

### Approach A (recommended)
Create a dedicated **Tool Intake** pipeline and staging model that links imported software to existing `InventoryEntity` + `DigitalProduct`.

### Approach B
Send imported rows directly into discovery as fully applied items and auto-create products.

### Approach C
Support manual input only for now and postpone imports.

**Recommendation:** Approach A, because it gives controlled review, dedupe, finance metadata capture, and role-aware UX without blocking onboarding.

## Data model strategy (MVP + extension)

### Core entities to reuse (no redesign)
- `InventoryEntity`
- `DigitalProduct`
- `DiscoveryRun`/`DiscoveredItem`/`DiscoveredSoftwareEvidence`
- `BacklogItem` for approval and review state

### New model additions

#### 1) `ToolIntakeSource`
Tracks where software is coming from and how sync is configured.
- Fields: `slug`, `provider` (`manual`, `upload_file`, `share_sync_google`, `share_sync_office`),
  `mode` (`manual`, `batch`, `polling_sync`, `event_sync`), `companyScope`, `portfolioSlug`,
  `taxonomyNodeId`, `enabled`, `syncSchedule`, `calendarContextRef`, `lastSuccessfulRunAt`, `lastError`.

#### 2) `ToolIntakeRun`
Represents one execution of intake.
- Fields: `sourceId`, `status`, `actorId`, `startedAt`, `completedAt`, `summary` (`rowsSeen/rowsApplied/rowsRejected`), `runRef`.

#### 3) `ToolIntakeDraft`
Staging table for human review + approval before product creation.
- Fields: `rawInput` JSON, `candidate` JSON, `state` (`new`, `review_required`, `approved`, `rejected`, `applied`, `archived`),
  `companyScope`, `environment`, `ownerUserId`, `financeHints` (license, seats, renewal, vendor ref), `sourceRowRef`.

#### 4) `ToolInstanceFinanceMetadata`
Finance-placeholder record for this feature slice.
- Fields: `companyScope`, `environment` (`dev`, `test`, `prod`), `licenseModel` (`seat`, `device`, `subscription`, `enterprise`),
  `seatCount`, `renewalCadence`, `renewalDate`, `monthlyRunRate`, `oneTimeCost`, `billingReference`, `costAllocationTag`.

This is explicitly a placeholder model for now and can evolve into full procurement/ledger integration in the finance epic.

### Data model behavior
- Intake produces/updates one `InventoryEntity` per company/tool/context row.
- `digitalProductId` is optional at first staging; applied rows must create/update a `DigitalProduct` and set the same contextual link.
- Use a stable fingerprint (`companyScope + vendor + product + version + source row`) for idempotency and duplicate detection.
- Existing `runKey` style and discovery evidence fields can be reused where possible.

## Intake processing pipeline

### A) Manual one-off
1. User opens intake UI and enters tool rows.
2. System normalizes names, proposes taxonomy + portfolio.
3. If confidence is high, mark as `approved` and apply immediately.
4. If ambiguous, create `review_required` draft.

### B) Upload-driven batch ingest (`.xls`, `.xlsx`, `.docx`)
1. Existing upload subsystem stores file and event metadata.
2. Tool intake adapter consumes upload events and parses rows.
3. Parsing rules include required/optional columns:
   - required: `product`, `vendor`, `company`, `environment`
   - optional: `version`, `seats`, `license`, `owner`, `renewal`, `monthly_cost`, `business_unit`, `contract_ref`, `notes`
4. Each row creates `ToolIntakeDraft` with extracted metadata.
5. Confident rows can be auto-applied; ambiguous rows stay in queue.

### C) Share sync mode (polling first)
1. Human configures sync source and schedule on `ToolIntakeSource`.
2. Polling agent scans share/connector source on interval.
3. New/changed rows produce drafts for apply/review.
4. Event-based webhook mode is implemented as a second phase by extending source mode only.

## Taxonomy and portfolio modeling

- Maintain taxonomy-first UX: tools should be discoverable under For Employees / Productivity / Productivity Applications (and Foundational where required).
- Ensure VS Code/Office/Google Mail map to explicit product families in taxonomy or candidate list.
- Missing families that are currently underrepresented should be added/adjusted as non-destructive taxonomy seed updates.

## Workspace and UX behavior

- Preserve one workspace shell for all roles; do not create a separate employee runtime shell.
- Add role-aware workspace/service actions per tile:
  - request / edit tool instance
  - update license/seats
  - open finance context
- Keep simple card layout with compact metrics (single entry point for all roles).

## Conflict, duplicate, and governance rules

- Duplicate key: `companyScope + product + vendor + version + sourceRef`.
- If duplicate appears with same payload: idempotent no-op and audit log.
- If duplicate appears with changed metadata: create revision draft.
- If same tool appears from two sources with same confidence: keep highest-trust source and mark lower-trust row for reconciliation.

## Security and permissions

- `manage_products` + `manage_inventory` to apply drafts.
- `view_inventory` can see draft + status but not edit.
- Source credentials for share sync stored via existing secure credential path.

## Finance impact alignment

This feature does not post to ERP directly. It creates finance placeholders so the finance epic can immediately consume:

- per-company tool instance
- environment footprint (`dev/test/prod`)
- license and ownership fields
- cost and renewal metadata
- mapping to digital product IDs used by finance and spend reporting.

## Acceptance criteria

1. Upload import of `.xls/.xlsx/.docx` creates drafts with visible state and attribution.
2. Two-company context can create separate tool instances for same software.
3. VS Code/Office/Google Mail are represented under employee/productivity taxonomy and visible in one workspace shell.
4. Manual one-off entry, polling sync, and review queue are functional.
5. Tool instance metadata includes environment and finance placeholders.

## Explicitly out of scope (MVP)

- Event-driven sync (planned follow-up using same models).
- Full `.docx` NLP extraction (table-first MVP).
- Full procurement lifecycle automation and ledger posting.

---

Please review and confirm this design. Once approved, I’ll move to the implementation plan.

# Plan — Incumbent application intake (D2, BI-BF12C25C)

**Backlog item:** BI-BF12C25C (D2 — Incumbent application intake: manual entry + spreadsheet import into the Workforce portfolio)

| Field | Value |
|-------|-------|
| **Date** | 2026-07-24 |
| **Epic** | EP-ASSET-INTELLIGENCE |
| **Design source** | `docs/superpowers/specs/2026-07-23-incumbent-application-coverage-design.md` §5.1 (where an incumbent lives), §5.3 (cost/supplier), §5.6 (onboarding), §5.1 enum discipline |
| **Kernel decisions consumed** | `DI-B4B65B293024` (fold-into-SAM, no parallel model), `DI-857DD2A0CDDA` (this build sequenced ahead of D3/D5 — it is their shared predecessor) |
| **Depends on** | D0 (`BI-5B2F5447`, DONE — the `incumbent` / `incumbent_intake` enums) |
| **Unblocks** | D3 (`BI-548060D5`), D5 (`BI-E4162824`), D6 (`BI-69B957E4`) — all need incumbent `DigitalProduct` rows to exist |

## 1. Why this, why now

Substrate verification (2026-07-24) established that both D3 (coverage assessment) and D5 (onboarding prefill) depend on D2, and D2 depends only on D0 (done). D2 is therefore the immediately-buildable shared unblocker for the whole incumbent-coverage lane. Building D3's matching pipeline before D2 would run it over an empty set — no incumbent records to assess.

## 2. Substrate verification (live, 2026-07-24)

- **D0 enums live:** `packages/db/src/portfolio-sources/types.ts` — `coverageStatus` carries `"incumbent"`, `sourceKind` carries `"incumbent_intake"`; both closed and guarded by `portfolio-projection-parity.test.ts`.
- **No parallel model** (kernel `DI-B4B65B293024`): an incumbent app IS a `DigitalProduct` in `for_employees` with those two enum values (spec §5.1). Do NOT add an `IncumbentApplication` table.
- **DigitalProduct writer:** `apps/web/lib/actions/products.ts`. Creation must go through the validating writer, never a raw `prisma.digitalProduct.create` — memory records 7 upsert sites that bypassed the validating writer and broke the type-derived detector at compile time.
- **Spreadsheet parsing:** `apps/web/lib/shared/file-parsers.ts` (`parseXlsx`/`parseCsv`) — reused, not reinvented (spec §5.6).
- **Supplier match/create:** `apps/web/lib/actions/ap.ts` — the existing AP rail. Cost capture on an incumbent is a declared figure + a matched/created `Supplier` (spec §5.3); the full `SoftwareEntitlement`→`SupplierContract` binding is D7, gated on Phase C — this plan must not pretend otherwise (spec R5: label declared, not derived).
- **Identity resolution:** `catalogIdentityId` resolves through the existing Phase A/B pipeline (shared with Phase C). Optional on the intake record until a match exists.

## 3. Data model

**No new model.** The intake writes a `DigitalProduct` (portfolio `for_employees`) carrying `coverageStatus="incumbent"`, `sourceKind="incumbent_intake"`, optional `catalogIdentityId`, a declared cost, and a `Supplier` reference. All columns already exist; this is a write path over existing substrate, not a migration.

## 4. Phases

### P1 — Intake core (server) + tests (this plan's first shippable slice)
A pure, unit-tested intake function + server action:
- `createIncumbentApplication({ name, vendor, annualCost?, seatCount?, catalogHint? })` → resolves/creates the `Supplier` (via the ap.ts helper), attempts `CatalogIdentity` resolution (optional), and writes the `DigitalProduct(incumbent, incumbent_intake)` through the validating writer.
- Idempotent on (org, normalized name/vendor) so re-intake matches rather than duplicates.
- **Acceptance:** unit tests cover create, dedupe-on-reintake, declared-cost-only (no derived binding), and enum correctness; `portfolio-projection-parity.test.ts` still green (the incumbent enum projects correctly). No UI yet — verifiable in the source-only worktree.

### P2 — Spreadsheet import (server)
Wrap P1 with `parseXlsx`/`parseCsv` (existing) → row→`createIncumbentApplication`, collecting per-row match/create/error results. **Acceptance:** a fixture spreadsheet imports N rows to N incumbent products, dupes matched not re-created, malformed rows reported not fatal.

### P3 — Intake UI + onboarding step 12 (design-sensitive — UX-fit review required)
The manual-entry form + spreadsheet-drop, and the 12th `SETUP_STEPS` entry (`apps/web/lib/actions/setup-constants.ts`) after `business-context`, skippable/resumable, prefilled from the archetype replacement-boundary list (this is where P2 of BI-ECO-001's `postureForArchetype` accessor is first consumed — the connective tissue). Routes to a real portal route. **Acceptance:** dpf-ux-fit-review passed; the step earns its surface (prefilled + skippable, per `remove-avoidable-failure-opportunities`); Production Build + live-portal verification.

## 5. Verification
- Unit: the intake core (P1) + import (P2) — run in source-only worktree.
- Parity: `portfolio-projection-parity.test.ts` stays green.
- Governance: a new persistent-write path over `DigitalProduct` is additive (no new model) — no data-impact/stewardship/coverage-registry gate fires (that battery is for new models; verified this session on AbsorptionPosture).
- UX (P3 only): dpf-ux-fit-review + Production Build + live verification.

## 6. Risks
| # | Risk | Mitigation |
|---|---|---|
| R1 | Unfiltered `for_employees` rollups mix incumbents with DPF's 108 coworker services (spec R1). | Never aggregate `for_employees` without a `sourceKind` filter; D6 carries the counter-reconciliation test. Not this plan's surface, but flagged. |
| R2 | Bypassing the validating DigitalProduct writer → compile-time detector break. | Write exclusively through `products.ts`; no raw prisma.create. |
| R3 | Declared cost read as derived. | Label declared-not-derived everywhere; real binding is D7 (Phase C-gated). |
| R4 | Duplicate incumbents on re-intake. | Idempotent match on normalized (org, name/vendor) in P1. |

## Implementation status

- **P1 — intake core: SHIPPED** (PR #3549, merged main sha 324f1ff77c). `apps/web/lib/incumbent/intake.ts` (`createIncumbentApplication`) + `lib/actions/incumbent-intake.ts` action. 8/8 unit tests.
- **P2 — spreadsheet import: THIS PR.** `apps/web/lib/incumbent/spreadsheet.ts` — `mapRowToIncumbentInput` (header heuristics) + `importIncumbentRows` (per-row intake through the P1 core, malformed rows reported not fatal). Server action `importIncumbentSpreadsheet` parses CSV/TSV/XLSX to a matrix (the workbooks path: `parseDelimitedGrid` / `readSheet` / `inferTableFromSheet`) then imports. 6/6 unit tests (P1 core mocked).
- **P3 — UI + onboarding step: pending** (design-sensitive; UX-fit review).

## Backlog coverage
- Decision: decomposed
- Parent: BI-BF12C25C
- Receipt: cmrzm7e8q0btj01o3zb3jpoq6
- Phases (all deliver BI-BF12C25C; not xlarge, so no child-BI split required): P1 intake core, P2 spreadsheet import, P3 UI + onboarding step
- Dependencies: P2 depends on P1; P3 depends on P1 (and consumes BI-ECO-001 P2's postureForArchetype)

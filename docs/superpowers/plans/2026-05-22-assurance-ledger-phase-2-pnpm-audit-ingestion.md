# Assurance Ledger Phase 2 — pnpm-audit Ingestion + Finding Remediation Plan

> **For agentic workers:** Sub-skill `superpowers:executing-plans` or `superpowers:subagent-driven-development`. Steps use `- [ ]` syntax.

**Goal:** Ingest real vulnerability findings into `AssuranceFinding` records by running `pnpm audit --json` against the persisted BOM, surface findings in the Build Studio Assurance Gate and Product Supply Chain panel, and add a remediation/action workflow (status updates + backlog item creation) so findings drive decisions instead of being read-only data.

**Live record:** `BI-F3767770` under `EP-ASSURANCE-LEDGER`. Continues after PR #984 (`feat(assurance): add finding substrate readiness`).

**Why pnpm audit and not OSV-Scanner / Grype / Trivy / Black Duck:** `pnpm` is already the package manager. `pnpm audit --json` is built into pnpm and queries the GitHub Advisory Database — the same source `pnpm install` already consults. No new external CLI is introduced, so this adapter is **platform-native** and not subject to the Tool Evaluation Pipeline gate in AGENTS.md §9. Future commercial scanners (Black Duck, Snyk Enterprise) and additional open-source scanners (Grype, OSV-Scanner CLI, Trivy) still go through the Pipeline and land as separate adapter PRs.

---

## 1. Substrate Already Available

| Module | Role |
|--------|------|
| `apps/web/lib/assurance/adapter-contract.ts` | `AssuranceAdapter` interface (`adapterKey`, `run(input)`, etc.) |
| `apps/web/lib/assurance/finding-key.ts` | `createFindingKey` + `normalizeVendorIdentifier` |
| `apps/web/lib/assurance/finding-persistence.ts` | `persistAssuranceFindings(db, input)` — upsert + reopen tracking |
| `apps/web/lib/assurance/finding-read.ts` | `getActiveFindingSummaryForBuild/Product` |
| `apps/web/lib/assurance/scanner-catalog.ts` | Readiness check based on `ToolEvaluation` + `ApprovedTool` rows |
| `apps/web/lib/assurance/bom-job.ts` | Reference pattern for ToolExecution + Receipt + AssuranceRun writing |
| `apps/web/lib/queue/functions/assurance-bom.ts` | Reference Inngest function pattern |
| Prisma `AssuranceFinding`, `AssuranceRun`, `BomDocument`, `BomComponent`, `BomComponentOccurrence` | All in schema; no migration required |

## 2. Components to Build

### 2.1 pnpm-audit adapter (pure parser)

`apps/web/lib/assurance/pnpm-audit-adapter.ts`

- `parsePnpmAuditJson(jsonText: string): PnpmAuditAdvisoryGroup[]` — normalize the JSON shape from pnpm 9/10.
- `createPnpmAuditAdapter(): AssuranceAdapter` — `adapterKey = "pnpm-audit"`, `adapterVersion = "1"`, `supportedScopes = ["bom-component"]`.
- `mapAdvisoryToFindings(advisory, lookup)` — produce one `NormalizedAssuranceFinding` per (advisory × vulnerable component). `findingKind = "vulnerability"`, `affectedType = "bom-component"`, `affectedId = componentKey` from `BomComponent.componentKey`, `vendorIdentifier = ghsaId || cveId`.
- Severity map: pnpm `critical/high/moderate/low/info` → policy severity `critical/high/medium/low/info`.
- Release impact: critical/high → `block`, moderate → `warn`, low/info → `track`.
- Tests: fixture-driven unit tests for the parser + severity map.

### 2.2 Scanner catalog: platform-native carve-out

`apps/web/lib/assurance/scanner-catalog.ts`

- Add `pnpm-audit` to a new `PLATFORM_NATIVE_SCANNERS` set: bundled tools that ship with the platform and do not require a `ToolEvaluation` row.
- `resolveAssuranceScannerReadiness` returns `ready` when platform-native scanners are available (always true for pnpm-audit since it's bundled in the runtime container).
- Update existing tests; add coverage for the new code path.

### 2.3 Scan job

`apps/web/lib/assurance/scan-job.ts`

- `runPnpmAuditScan({ db, buildId, requestedByUserId, projectRoot, now, runAudit?, readBomComponents? })`.
- Loads the latest `BomDocument` for the build (skip if missing — emit `BuildActivity` "BOM required").
- Builds `componentKey → componentId` lookup from `BomComponentOccurrence` joined with `BomComponent`.
- Calls `runAudit(projectRoot)` (default: `spawn pnpm audit --json --prod`) and captures stdout. `runAudit` is injectable for tests.
- Calls adapter, then `persistAssuranceFindings`.
- Writes `ToolExecution` (`toolName: "run_pnpm_audit"`), `ToolExecutionReceipt`, `AssuranceRun` (`adapterKey: "pnpm-audit"`).
- Emits `BuildActivity` with finding counts and `agentEventBus.emit("evidence:update", { field: "assuranceFindings" })`.
- Tests with stubbed `runAudit` and stubbed db delegates.

### 2.4 Scan trigger + Inngest function

- `apps/web/lib/assurance/scan-trigger.ts` — `queueBuildScan({ buildId, requestedByUserId })`.
- `apps/web/lib/queue/inngest-client.ts` — add `AssuranceScanRunEvent` interface and union member.
- `apps/web/lib/queue/functions/assurance-scan.ts` — Inngest function `assurance/scan-run` mirroring `assurance-bom.ts`.
- Tests for trigger function (mock `inngest.send`).

### 2.5 Finding remediation

`apps/web/lib/assurance/finding-actions.ts`

- `updateFindingStatus(db, { findingKey, status, reason, userId })` — validate status against `ASSURANCE_FINDING_STATUSES`; write `status`, `resolvedAt` when terminal, append `evidence.remediation` audit array.
- `createBacklogItemFromFinding(db, { findingKey, userId })` — load the finding, check there is not already a `BacklogItem` linked by `evidence.backlogItemId`, create the BI through Prisma directly (no MCP client at runtime in the portal), link to `EP-ASSURANCE-LEDGER` (or the finding's `digitalProduct`'s epic if one exists), set finding status to `planned`, store `backlogItemId` in `evidence`.
- Tests with stubbed db.

### 2.6 Server actions + Read helpers

`apps/web/lib/actions/assurance.ts`

- Add `setAssuranceFindingStatus(input)` and `requestBacklogFromAssuranceFinding(input)`.
- Both require `view_platform` + a new write capability `manage_assurance` (use existing `manage_compliance` if present, else gate on `platformRole IN ('admin','superuser')`).

`apps/web/lib/assurance/finding-read.ts`

- `listActiveFindingsForBuild(db, buildId, limit)` and `listActiveFindingsForProduct(db, productId, limit)` — return findings sorted by severity (critical → info), then `lastSeenAt` desc. Includes `findingKey`, title, severity, kind, affected component name/version, status, vendorIdentifier.

### 2.7 UI

`apps/web/components/build/BuildAssuranceGateCard.tsx`

- Render an "Active findings" list (top 5 blocking-first) under the metric grid.
- Each row: severity badge, title, component name@version, vendor id link, status select (accepted/planned/false-positive/resolved/deferred) + "Create backlog" button.
- New `RunScanButton` triggers `queueBuildScan` via a server action; mirrors existing `Generate BOM` button.
- Theme-aware classes only.

`apps/web/components/product/ProductSupplyChainPanel.tsx`

- Add a "Findings" section above the components table with the same row layout. No action buttons here in this PR (read-only at product scope; remediation happens at the build).

## 3. Files Touched

- New: `pnpm-audit-adapter.ts` (+ test), `scan-job.ts` (+ test), `scan-trigger.ts` (+ test), `finding-actions.ts` (+ test), `apps/web/lib/queue/functions/assurance-scan.ts`, `apps/web/components/build/AssuranceFindingsList.tsx` (+ test).
- Modified: `scanner-catalog.ts` (+ test), `finding-read.ts` (+ test), `actions/assurance.ts` (+ test), `inngest-client.ts`, `BuildAssuranceGateCard.tsx` (+ test), `ProductSupplyChainPanel.tsx` (+ test).
- Fixture: `apps/web/lib/assurance/__fixtures__/pnpm-audit-sample.json`.

## 4. Verification

1. `pnpm --filter web exec vitest run lib/assurance components/build/BuildAssuranceGateCard.test.tsx components/product/ProductSupplyChainPanel.test.tsx lib/actions/assurance.test.ts`
2. `pnpm --filter @dpf/db exec vitest run test/assurance-schema-contract.test.ts`
3. `pnpm --filter web typecheck`
4. `cd apps/web && npx next build`
5. UX verification: drive the portal at `http://localhost:3000` after sandbox promotion — trigger scan from BuildAssuranceGateCard, observe finding list, click status update, click Create backlog, confirm BI appears under EP-ASSURANCE-LEDGER. *(Falls under structural-verification-is-not-functional kernel principle.)*

## 5. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `pnpm audit` exits non-zero when findings exist | Capture exit code 1 as "findings present", not error; treat ≥2 as error. |
| Container lacks pnpm at runtime | Verified `pnpm` is available in portal image; if not, scan job emits "pnpm not available" and falls through. |
| `pnpm audit` output schema differs between pnpm 9/10 | Adapter detects shape; both versions emit `advisories` keyed by id with `findings` array. Add a normalizer. |
| Component matching fails when lockfile name does not match `BomComponent.name` | Adapter falls back to PURL match, then logs a `tool-trace` line with the unmatched advisory. |
| `pnpm audit` shells out and could leak data | Output is package names + versions only; same data already sent during `pnpm install` audit step. No secrets leaked. |

## 6. Exit Criteria

- [ ] Adapter parses sample pnpm audit JSON and emits normalized findings.
- [ ] Scan job persists findings linked to BOM components.
- [ ] Scanner readiness flips to `ready` (`pnpm-audit`).
- [ ] BuildAssuranceGateCard lists findings with action controls.
- [ ] ProductSupplyChainPanel lists findings.
- [ ] `updateFindingStatus` and `createBacklogItemFromFinding` work end-to-end.
- [ ] All build-gate verifications above pass.
- [ ] PR opened against `main`, DCO signed.

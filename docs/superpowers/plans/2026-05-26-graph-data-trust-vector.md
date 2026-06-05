# Graph/Data Trust Vector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first reusable trust-vector slice for graph/data responses so Build Studio code intelligence and assurance results can distinguish current facts, last-known facts, inferred results, and low-confidence results.

**Architecture:** Add a shared `TrustAssessment` read-model contract, scorer, wording helpers, and UI badge. Adapt existing authoritative source models (`CodeGraphIndexState`, `CodeGraphFileHash`, `BomDocument`, `AssuranceRun`, `AssuranceFinding`, `ToolExecution`) into trust vectors. Do not add a new persistence table in this slice; trust metadata travels with read models and MCP/tool results, and existing tool/evidence ledgers capture it when calls are executed.

**Tech Stack:** Next.js 16, TypeScript, React, Prisma 7, PostgreSQL, Neo4j, Vitest, Testing Library, DPF MCP JSON-RPC at `/api/mcp/v1`.

**Source spec:** `docs/superpowers/specs/2026-05-26-graph-data-trust-vector-design.md`

**Capacity split:** Reserve at least 20% of the implementation for refactoring existing stale/freshness/provenance wording into shared helpers. Do not spend the whole slice adding local page badges.

---

## Implementation Guardrails

- Work in an isolated branch/worktree off `origin/main`.
- Do not implement until the spec and plan are approved in the thread.
- Keep current source tables authoritative.
- Do not add a `TrustAssessment` table or migration in this slice.
- Use `pnpm --filter web exec vitest run ...`, not `npx`.
- UI must use DPF theme tokens only.
- If a touched UI surface has nearby hardcoded colors, clean them up in the same surface.
- For any coworker/MCP result carrying trust, assert both `data.trust` and stale/low-confidence `message` wording in tests.

---

## Task 0: Approval Gate

- [ ] Confirm the spec is approved for implementation.
- [ ] If the approved first slice changes, update both spec and plan before editing code.
- [ ] Run `git status --short --branch` and confirm the branch is not `main` and not detached.

Expected branch pattern:

```powershell
git status --short --branch
```

Expected result:

- Branch is `doc/trust-vector-data-responses` or a follow-on implementation branch.
- No unrelated dirty files are present except approved docs/code changes.

---

## Task 1: Create Shared Trust-Vector Primitives

### Files

- Add `apps/web/lib/trust-vector/types.ts`
- Add `apps/web/lib/trust-vector/score.ts`
- Add `apps/web/lib/trust-vector/wording.ts`
- Add `apps/web/lib/trust-vector/index.ts`
- Add `apps/web/lib/trust-vector/score.test.ts`
- Add `apps/web/lib/trust-vector/wording.test.ts`
- Modify `apps/web/lib/surface-data-provenance.ts`
- Modify `apps/web/lib/surface-data-provenance.test.ts`

### Steps

- [ ] Define the contract from the spec:

```ts
export type TrustStatementKind =
  | "current-fact"
  | "last-known-fact"
  | "inferred-result"
  | "low-confidence-result";

export type TrustTier = "high" | "medium" | "low" | "unknown";

export type TrustAction =
  | "present"
  | "qualify"
  | "warn-stale"
  | "refresh-required"
  | "escalate"
  | "defer";
```

- [ ] Define `TrustDimensionKey`, `TrustDimension`, `TrustEvidenceRef`, and `TrustAssessment`.
- [ ] Add a pure `scoreTrustVector(input)` helper that:
  - computes a weighted average over applicable dimensions,
  - applies hard caps for contradiction, runtime availability, stale freshness, low evidence grade, low coverage, and high risk,
  - returns `tier`, `statementKind`, `action`, `overallScore`, `summary`, and `primaryRationale`.
- [ ] Add a pure `buildTrustMessage(assessment, options?)` helper for UI/coworker wording.
- [ ] Extend `DataSourceProvenance` with optional `trust?: TrustAssessment`.
- [ ] Keep all primitives client/server safe: no Prisma imports, no server-only imports, no DB calls.

### Tests

- [ ] High freshness + authoritative source + full coverage returns `current-fact`, `high`, `present`.
- [ ] A 45-day security scan returns `last-known-fact`, low/medium depending policy, and `refresh-required`.
- [ ] Runtime unavailable caps the result at `low` and prevents `present`.
- [ ] Contradiction caps the result at `low` and returns `escalate` or `defer`.
- [ ] Missing non-applicable dimensions do not lower the score.
- [ ] `DataSourceProvenance` still works for source-only badges.

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/lib/trust-vector/score.test.ts apps/web/lib/trust-vector/wording.test.ts apps/web/lib/surface-data-provenance.test.ts
```

---

## Task 2: Code Graph Trust Adapter

### Files

- Add `apps/web/lib/trust-vector/adapters/code-graph.ts`
- Add `apps/web/lib/trust-vector/adapters/code-graph.test.ts`
- Modify `apps/web/lib/integrate/code-graph-access.ts`
- Modify `apps/web/lib/integrate/code-graph-access.test.ts`

### Steps

- [ ] Add `buildCodeGraphFreshnessTrust(input)` that accepts the current `CodeGraphFreshness` source fields plus optional policy settings.
- [ ] Add `buildCodeGraphCoverageTrust(input)` for changed-file coverage.
- [ ] Add optional `trust?: TrustAssessment` to `CodeGraphFreshness`.
- [ ] Add optional `trust?: TrustAssessment` to `CodeGraphCoverageSummary`.
- [ ] Convert existing freshness warnings where possible to trust-vector wording, while preserving the current warning strings until all callers migrate.
- [ ] Add age-based freshness:
  - current: `0-24h` or indexed head matches active head when available,
  - watch: `1-7d`,
  - low: `>7d`, missing index, dirty workspace, non-ready index, or last error.
- [ ] Keep structural relationship health as a tool-reliability/coverage signal, not a proof of semantic completeness.

### Tests

- [ ] Existing missing-state test still passes and now includes `trust.action` of `refresh-required` or `defer`.
- [ ] Dirty workspace test includes low/medium trust and a visible rationale.
- [ ] Index older than 7 days produces stale/low freshness.
- [ ] Coverage `1/2 changed files` lowers `coverageCompleteness` and qualifies broad impact claims.
- [ ] Structural relationship gaps affect `toolReliability` or `coverageCompleteness`.

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/lib/trust-vector/adapters/code-graph.test.ts apps/web/lib/integrate/code-graph-access.test.ts
```

---

## Task 3: Code Intelligence UI Pattern

### Files

- Add `apps/web/components/ui/TrustBadge.tsx`
- Add `apps/web/components/ui/TrustBadge.test.tsx`
- Modify `apps/web/components/build/CodeIntelligenceStatusCard.tsx`
- Modify `apps/web/components/build/CodeIntelligenceStatusCard.test.tsx`

### Steps

- [ ] Build `TrustBadge` with compact and disclosure modes.
- [ ] Use semantic DPF tokens only:
  - `var(--dpf-success)`
  - `var(--dpf-warning)`
  - `var(--dpf-error)`
  - `var(--dpf-accent)`
  - `var(--dpf-muted)`
  - `var(--dpf-border)`
  - `var(--dpf-surface-1)`
  - `var(--dpf-surface-2)`
  - `var(--dpf-text)`
- [ ] Do not show raw floats in the compact badge.
- [ ] Render one concise rationale inline.
- [ ] Put dimension detail behind a native `details` disclosure or existing local disclosure pattern.
- [ ] Integrate `TrustBadge` into `CodeIntelligenceStatusCard`.
- [ ] Preserve existing warnings while making trust the primary visible confidence cue.

### Tests

- [ ] `TrustBadge` renders high/medium/low/unknown labels.
- [ ] `TrustBadge` exposes rationale to screen readers.
- [ ] Code intelligence card renders stale trust rationale when graph age is low.
- [ ] Existing missing graph warning test still passes.

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/components/ui/TrustBadge.test.tsx apps/web/components/build/CodeIntelligenceStatusCard.test.tsx
```

---

## Task 4: Code Graph Coworker / MCP Behavior

### Files

- Modify `apps/web/lib/integrate/change-impact.ts`
- Modify `apps/web/lib/integrate/change-impact.test.ts`
- Modify `apps/web/lib/mcp-tools.ts`
- Modify `apps/web/lib/mcp-tools-code-graph.test.ts`

### Steps

- [ ] Update `formatImpactReport()` so code graph summary includes trust wording when `report.codeGraph.trust` exists.
- [ ] Update `get_code_graph_freshness` handler so:
  - `data.trust` is returned,
  - top-level `message` uses trust-aware stale/low-confidence wording.
- [ ] Update `inspect_build_code_impact` so:
  - `data.codeGraph.trust` is returned,
  - stale/low confidence prevents unqualified broad claims.
- [ ] Keep MCP results read-only and side-effect-free.

### Tests

- [ ] `get_code_graph_freshness` returns structured `data.trust`.
- [ ] stale graph result top-level `message` contains the stale rationale.
- [ ] `inspect_build_code_impact` qualifies coverage gaps.
- [ ] Existing unavailable graph failures remain explicit.

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/lib/integrate/change-impact.test.ts apps/web/lib/mcp-tools-code-graph.test.ts
```

---

## Task 5: Assurance Trust Adapter

### Files

- Add `apps/web/lib/trust-vector/adapters/assurance.ts`
- Add `apps/web/lib/trust-vector/adapters/assurance.test.ts`
- Modify `apps/web/lib/assurance/bom-read.ts`
- Modify `apps/web/lib/assurance/bom-read.test.ts`

### Steps

- [ ] Add `buildAssuranceSummaryTrust(summary, options)` that evaluates:
  - BOM freshness from `BomDocument.generatedAt`,
  - scan freshness from latest relevant `AssuranceRun.completedAt` when available,
  - scanner readiness/tool approval,
  - active finding count and severity,
  - component count / model count as coverage clues,
  - risk impact for security/compliance claims.
- [ ] Extend `BomSummary` with optional `trust?: TrustAssessment`.
- [ ] If scan freshness cannot be derived from current `BomSummary`, add the smallest read-model field needed, preferably `latestAssuranceRunCompletedAt?: Date | null`.
- [ ] Do not add schema fields unless the current tables cannot express the read model.
- [ ] Keep scan freshness distinct from BOM freshness in dimension rationales.

### Tests

- [ ] Missing BOM returns `unknown` or `refresh-required` trust.
- [ ] Current BOM + current scan + no findings returns high trust current fact.
- [ ] No active findings with latest scan 45 days old returns last-known fact and stale rationale.
- [ ] Scanner not approved lowers tool reliability and prevents high trust.
- [ ] Blocking findings influence risk/action but do not hide freshness.

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/lib/trust-vector/adapters/assurance.test.ts apps/web/lib/assurance/bom-read.test.ts
```

---

## Task 6: Assurance Gate UI

### Files

- Modify `apps/web/components/build/BuildAssuranceGateCard.tsx`
- Modify `apps/web/components/build/BuildAssuranceGateCard.test.tsx`

### Steps

- [ ] Add `TrustBadge` next to the Assurance Gate status.
- [ ] Replace static empty findings label with trust-aware wording:
  - current: `No active findings.`
  - stale: `No active findings in the latest scan. Scan freshness is low because the latest scan completed 45 days ago.`
  - missing scan/BOM: retain `Generate a BOM, then run a scan.`
- [ ] Keep the card compact and scannable.
- [ ] Keep Run scan as the primary refresh affordance.
- [ ] Avoid nested cards and keep border radius consistent with existing `rounded-md`.

### Tests

- [ ] Assurance Gate renders trust badge.
- [ ] Stale 45-day scan renders last-known wording.
- [ ] Missing BOM still asks the user to generate BOM/run scan.
- [ ] Run scan button behavior remains unchanged.

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/components/build/BuildAssuranceGateCard.test.tsx
```

---

## Task 7: Evidence / Audit Trail Check

### Files

- Modify only if needed:
  - `apps/web/lib/assurance/scan-job.ts`
  - `apps/web/lib/assurance/bom-job.ts`
  - `apps/web/lib/mcp-tools.ts`
  - existing tests around `ToolExecution.result`

### Steps

- [ ] Confirm MCP/tool results with `data.trust` are persisted through existing `ToolExecution.result`.
- [ ] Confirm assurance facts remain persisted in `AssuranceRun`, `BomDocument`, `AssuranceFinding`, and `ToolExecutionReceipt`.
- [ ] Do not persist trust in a new table.
- [ ] If a side-effecting assurance run already writes a summary payload, optionally include trust input facts there, not a duplicate assessment table.

### Tests

- [ ] Existing scan/BOM job tests still pass.
- [ ] If summary payload changes, tests assert the new trust inputs without weakening receipt assertions.

Verification:

```powershell
pnpm --filter web exec vitest run apps/web/lib/assurance/scan-job.test.ts apps/web/lib/assurance/bom-job.test.ts
```

---

## Task 8: Full Slice Verification

### Targeted Tests

Run all changed-unit tests:

```powershell
pnpm --filter web exec vitest run apps/web/lib/trust-vector/score.test.ts apps/web/lib/trust-vector/wording.test.ts apps/web/lib/trust-vector/adapters/code-graph.test.ts apps/web/lib/trust-vector/adapters/assurance.test.ts apps/web/lib/integrate/code-graph-access.test.ts apps/web/lib/integrate/change-impact.test.ts apps/web/lib/mcp-tools-code-graph.test.ts apps/web/components/ui/TrustBadge.test.tsx apps/web/components/build/CodeIntelligenceStatusCard.test.tsx apps/web/components/build/BuildAssuranceGateCard.test.tsx apps/web/lib/assurance/bom-read.test.ts
```

### Typecheck

```powershell
pnpm --filter web typecheck
```

### Production Build

```powershell
Set-Location apps/web
pnpm exec next build
```

### UX Verification

Use the Docker-served app, not stale `next dev`, after code changes:

```powershell
docker compose build --no-cache portal portal-init sandbox
docker compose up -d
```

Then verify:

- Build Studio header shows Code Intelligence trust badge and rationale.
- Assurance Gate shows trust badge and freshness-aware empty findings text.
- Low/stale states are visible without hover-only disclosure.
- Theme tokens render correctly in light/dark branding modes.
- No text overflow or incoherent overlap at desktop and mobile widths.

Capture screenshots/evidence before declaring complete.

---

## Task 9: Final Branch Hygiene

- [ ] Run `git diff --check`.
- [ ] Run `git status --short --branch`.
- [ ] Review changed files and ensure scope is only trust-vector first slice.
- [ ] Commit with DCO signoff:

```powershell
git add docs/superpowers/specs/2026-05-26-graph-data-trust-vector-design.md docs/superpowers/plans/2026-05-26-graph-data-trust-vector.md apps/web/lib/trust-vector apps/web/lib/surface-data-provenance.ts apps/web/lib/surface-data-provenance.test.ts apps/web/lib/integrate/code-graph-access.ts apps/web/lib/integrate/code-graph-access.test.ts apps/web/lib/integrate/change-impact.ts apps/web/lib/integrate/change-impact.test.ts apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools-code-graph.test.ts apps/web/components/ui/TrustBadge.tsx apps/web/components/ui/TrustBadge.test.tsx apps/web/components/build/CodeIntelligenceStatusCard.tsx apps/web/components/build/CodeIntelligenceStatusCard.test.tsx apps/web/lib/assurance/bom-read.ts apps/web/lib/assurance/bom-read.test.ts apps/web/components/build/BuildAssuranceGateCard.tsx apps/web/components/build/BuildAssuranceGateCard.test.tsx
git commit -s -m "Add graph data trust vector first slice"
git push
```

- [ ] Open PR only after targeted tests, typecheck, production build, and UX verification pass, unless the operator explicitly asks for a draft recovery PR.

---

## Definition of Done

- Spec and plan are approved.
- Shared trust-vector primitives exist and are tested.
- Code graph responses include trust metadata and stale/coverage wording.
- Assurance Gate qualifies stale "no active findings" claims.
- UI uses compact badge + concise rationale + expandable detail.
- Coworker/MCP responses include `data.trust` and top-level qualified messages.
- Existing evidence ledgers remain authoritative.
- No new trust table or migration exists.
- Targeted tests, typecheck, production build, and UX verification pass or documented pre-existing failures are captured.

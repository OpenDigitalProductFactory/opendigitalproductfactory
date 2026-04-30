# Artifact Provenance Receipts Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the provenance foundations for Build Studio by adding receipt/revision schema, unifying the real artifact write paths behind one shared helper, and running provenance validation in shadow mode without changing current phase-gate behavior yet.

**Architecture:** This slice implements spec phases A-C only. It adds additive schema (`ToolExecutionReceipt`, `BuildArtifactRevision`, `ArtifactReceiptUsage`), introduces a shared build-artifact persistence seam used by MCP tools, queue jobs, and server actions, and mints provenance receipts from the governed execution path. Mutable `FeatureBuild` fields remain the runtime snapshot for now, but every important write also creates an immutable revision plus shadow-mode provenance warnings that we can observe before enforcement. Roughly 20% of this slice is reserved for refactoring: extracting persistence/validation code out of `mcp-tools.ts` and removing duplicated write logic before behavior changes.

**Tech Stack:** TypeScript, Next.js server actions and queue functions, Prisma + PostgreSQL, Vitest, Build Studio event bus, existing governed MCP execution path.

**Reference docs:**

- Spec: `docs/superpowers/specs/2026-04-27-artifact-provenance-receipts-design.md`
- Aligned spec: `docs/superpowers/specs/2026-04-27-routing-control-data-plane-design.md`
- Related runtime: `apps/web/lib/mcp-governed-execute.ts`, `apps/web/lib/mcp-tools.ts`, `apps/web/lib/actions/build.ts`, `apps/web/lib/queue/functions/build-review-verification.ts`
- Existing focused tests: `apps/web/lib/mcp-tools-save-build-evidence.test.ts`, `apps/web/lib/actions/build-governed.test.ts`, `apps/web/lib/mcp-governed-execute.test.ts`
- Gate logic still using snapshots: `apps/web/lib/explore/feature-build-types.ts`

**Environment:** Commands assume bash on Windows (DPF dev shell). When a step needs PowerShell semantics (e.g. `$env:` vars), it is called out explicitly.

**Preconditions:**

- Postgres dev DB running (`docker compose ps` shows `dpf-postgres` healthy) — `prisma migrate dev` requires it.
- Working tree on a topic branch off `main` (per AGENTS.md PR workflow); never run these tasks on `main`.
- No backfill of pre-existing `FeatureBuild` snapshots is done in Slice 1. Pre-rollout builds keep their mutable snapshots with no mirrored revision; Slice 2 owns the backfill / `legacyEvidence` strategy.

---

## Scope Guard

This plan implements only the foundational slice:

- additive Prisma schema for receipts and artifact revisions
- shared build artifact writer used by the three real persistence paths
- receipt minting in `governedExecuteTool`
- shadow-mode contract evaluation for `verificationOut`, `uxTestResults`, and `acceptanceMet`
- observability hooks for warnings and mismatches
- shadow-mode watchdog detectors for fabrication patterns (missing-receipt and claim/digest mismatch) — non-blocking, but observable via `BuildActivity`

This slice intentionally does **not**:

- flip `checkPhaseGate()` to read revisions instead of `FeatureBuild` snapshots
- hard-reject missing receipt citations yet
- harden `save_phase_handoff` / `advanceBuildPhase` evidence digests yet
- remove legacy snapshot writes
- add cryptographic signing or cross-org trust semantics

Those become Slice 2 after shadow-mode evidence proves the contracts are correct.

---

## File Structure

- Modify `packages/db/prisma/schema.prisma`
  - Add `ToolExecutionReceipt`, `BuildArtifactRevision`, and `ArtifactReceiptUsage`.
- Create `packages/db/prisma/migrations/<timestamp>_artifact_provenance_receipts_slice_1/migration.sql`
  - Add the new tables and indexes only; no destructive changes.
- Create `apps/web/lib/build/build-artifact-provenance.ts`
  - Shared persistence seam for revision creation, snapshot mirroring, and shadow warnings.
- Create `apps/web/lib/build/build-artifact-provenance.test.ts`
  - Unit tests for revision numbering, snapshot mirroring, receipt linkage, and shadow-mode warning behavior.
- Create `apps/web/lib/build/build-provenance-contracts.ts`
  - Field contract registry and contract evaluators for `verificationOut`, `uxTestResults`, and `acceptanceMet`.
- Create `apps/web/lib/build/build-provenance-contracts.test.ts`
  - Unit tests for contract evaluation and warning generation.
- Modify `apps/web/lib/mcp-governed-execute.ts`
  - Extend audit writing so provenance-eligible tool runs can mint a linked receipt row.
- Modify `apps/web/lib/mcp-governed-execute.test.ts`
  - Add tests for receipt minting and “receipt mint failure does not hide the tool result.”
- Modify `apps/web/lib/mcp-tools.ts`
  - Replace direct `FeatureBuild.update()` evidence writes in `saveBuildEvidence` with the shared helper.
- Modify `apps/web/lib/mcp-tools-save-build-evidence.test.ts`
  - Existing focused coverage for `saveBuildEvidence`; extend with revision + shadow-warning expectations.
- Modify `apps/web/lib/actions/build.ts`
  - Route `recordBuildAcceptance()` through the shared helper instead of writing `acceptanceMet` directly.
- Modify `apps/web/lib/actions/build-governed.test.ts`
  - Existing focused coverage for `recordBuildAcceptance` (and `advanceBuildPhase`, `runBuildReviewVerification`); extend for revision-backed acceptance.
- Modify `apps/web/lib/queue/functions/build-review-verification.ts`
  - Route `uxTestResults` persistence through the shared helper.
- Create `apps/web/lib/queue/functions/build-review-verification.test.ts`
  - Verify queue persistence now creates revisions plus snapshot updates.
- Create `apps/web/lib/build/provenance-watchdogs.ts`
  - Shadow-mode detectors: missing receipts after eligible executions, claim/digest mismatches, orphan receipts.
- Create `apps/web/lib/build/provenance-watchdogs.test.ts`
  - Unit tests for each detector. Validates the v1 fabrication-detection rules.

---

## Refactor Allocation

About 20% of this slice should be spent on refactoring before behavior work:

- move build-artifact persistence logic out of the `saveBuildEvidence` case body in `mcp-tools.ts`
- centralize provenance field contracts in one module instead of scattering ad hoc checks
- make `governedExecuteTool()` the only receipt mint entry point instead of duplicating mint logic in tool handlers

If a task is tempted to add new logic by copying existing write paths, stop and extract first.

---

## Tasks

### Task 1: Add the additive provenance schema

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_artifact_provenance_receipts_slice_1/migration.sql`
- Test: `apps/web/lib/build/build-artifact-provenance.test.ts`

- [ ] **Step 1: Write the failing schema-shape test**

Create `apps/web/lib/build/build-artifact-provenance.test.ts` with a real red test that imports the Prisma client and asserts the three new model delegates exist. Tautologies (e.g. `expect([a,b]).toEqual([a,b])`) are not acceptable as red steps — the test must fail until the schema lands.

```ts
import { describe, expect, it } from "vitest";
import { prisma } from "@dpf/db";

describe("artifact provenance schema surface", () => {
  it("exposes receipt, revision, and usage delegates on the Prisma client", () => {
    expect(prisma.toolExecutionReceipt).toBeDefined();
    expect(prisma.buildArtifactRevision).toBeDefined();
    expect(prisma.artifactReceiptUsage).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm --filter web exec vitest run lib/build/build-artifact-provenance.test.ts
```

Expected: FAIL with TypeScript / runtime error that the delegates do not exist on `prisma`. If it passes, the schema is already present and the migration step has been done out of order — investigate before continuing.

- [ ] **Step 3: Add the Prisma models to `schema.prisma`**

Append the three additive models exactly as specified in the spec §6.1–6.3:

- `ToolExecutionReceipt` — fields: `id`, `toolExecutionId @unique`, `buildId?`, `receiptKind`, `receiptStatus @default("valid")`, `inputFingerprint`, `outputDigest Json`, `executionStatus`, `expiresAt`, `createdAt`. Indexes per spec.
- `BuildArtifactRevision` — fields per spec §6.2 including `valueDigest`, `status @default("accepted")`, `legacyEvidence @default(false)`, unique `(buildId, field, revisionNumber)`.
- `ArtifactReceiptUsage` — fields per spec §6.3, unique `(artifactRevisionId, receiptId)`.

Cross-check after writing: every required field from the spec is present (especially `inputFingerprint`, `outputDigest`, `executionStatus`, `expiresAt` on the receipt, and `valueDigest`, `legacyEvidence` on the revision). Missing required fields will cause cryptic insert failures during Task 3.

Keep the new models near `ToolExecution`, `FeatureBuild`, and `PhaseHandoff` so the provenance/build lifecycle stays readable in the schema.

- [ ] **Step 4: Generate the migration**

Requires the dev Postgres container to be running. Run:

```bash
pnpm --filter @dpf/db exec prisma migrate dev --name artifact_provenance_receipts_slice_1
```

Expected: a new migration folder appears under `packages/db/prisma/migrations/` and Prisma client regenerates successfully.

- [ ] **Step 5: Verify the schema applies cleanly and the client is regenerated**

Run:

```bash
pnpm --filter @dpf/db exec prisma validate
pnpm --filter @dpf/db exec prisma generate
pnpm --filter web exec vitest run lib/build/build-artifact-provenance.test.ts
```

Expected:

- `The schema at packages/db/prisma/schema.prisma is valid`
- Prisma client regenerates without error
- The schema-shape test from Step 1 now PASSES (delegates exist on the client)

The third command is the green confirmation for Task 1's red test. If the workspace symlink to `@dpf/db` did not refresh (a known fragility — see project memory on dockerfile workspace packages), the delegates may be missing even after `prisma generate`. Re-run `pnpm install` in that case.

- [ ] **Step 6: Commit the schema-only foundation**

Run (bash):

```bash
test "$(git branch --show-current)" != "main" || { echo "Abort: on main"; exit 1; }
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -s -m "feat(build): add artifact provenance schema foundations"
```

Note: scope `git add` to specific paths (memory: concurrent sessions can sweep staged files into a commit). The `-s` flag is mandatory for DCO sign-off.

---

### Task 2: Create the contract registry and shared artifact writer

**Files:**

- Create: `apps/web/lib/build/build-provenance-contracts.ts`
- Create: `apps/web/lib/build/build-provenance-contracts.test.ts`
- Create: `apps/web/lib/build/build-artifact-provenance.ts`
- Modify: `apps/web/lib/build/build-artifact-provenance.test.ts`

- [ ] **Step 1: Write failing contract tests**

Create `apps/web/lib/build/build-provenance-contracts.test.ts` with these cases:

```ts
import { describe, expect, it } from "vitest";
import {
  evaluateArtifactContract,
  PROVENANCE_GATED_FIELDS,
} from "./build-provenance-contracts";

describe("PROVENANCE_GATED_FIELDS", () => {
  it("registers the v1 gated fields", () => {
    expect(PROVENANCE_GATED_FIELDS).toEqual([
      "verificationOut",
      "uxTestResults",
      "acceptanceMet",
    ]);
  });
});

describe("evaluateArtifactContract", () => {
  it("warns when verificationOut has no receipts", () => {
    const result = evaluateArtifactContract({
      field: "verificationOut",
      value: { typecheckPassed: true, testsPassed: 1, testsFailed: 0 },
      receiptSummaries: [],
      acceptedArtifacts: {},
      enforcementMode: "shadow",
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(
      "verificationOut requires at least one verification receipt",
    );
  });

  it("warns when acceptanceMet is saved without accepted verification artifacts", () => {
    const result = evaluateArtifactContract({
      field: "acceptanceMet",
      value: [{ criterion: "works", met: true }],
      receiptSummaries: [],
      acceptedArtifacts: {},
      enforcementMode: "shadow",
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("accepted verificationOut"))).toBe(true);
  });
});
```

- [ ] **Step 2: Write failing shared-writer tests**

Extend `apps/web/lib/build/build-artifact-provenance.test.ts` with tests for:

- first revision becomes `revisionNumber = 1`
- second save of the same field becomes `revisionNumber = 2`
- snapshot mirror updates `FeatureBuild.<field>`
- receipt usage edges are written when receipt IDs are provided
- shadow warnings are returned but do not block the write

- [ ] **Step 3: Run both focused tests and verify they fail**

Run:

```bash
pnpm --filter web exec vitest run lib/build/build-provenance-contracts.test.ts lib/build/build-artifact-provenance.test.ts
```

Expected: FAIL because the modules do not exist yet.

- [ ] **Step 4: Implement `build-provenance-contracts.ts`**

Implement:

- `PROVENANCE_GATED_FIELDS`
- `evaluateArtifactContract()`
- one small evaluator per field
- `enforcementMode: "shadow" | "enforce"`

For Slice 1, every evaluator returns `ok: true` in shadow mode and only emits warnings; do not block yet.

- [ ] **Step 5: Implement `build-artifact-provenance.ts`**

Implement a shared helper with a shape like:

```ts
export async function saveBuildArtifactRevision(args: {
  buildId: string;
  field: string;
  value: unknown;
  receiptIds?: string[];
  actor: { userId: string; agentId?: string; threadId?: string };
  source: "mcp-tool" | "server-action" | "queue";
  enforcementMode?: "shadow" | "enforce";
}): Promise<{
  revisionId: string;
  revisionNumber: number;
  warnings: string[];
}>;
```

Behavior:

- compute the next revision number per `(buildId, field)`
- create `BuildArtifactRevision`
- create `ArtifactReceiptUsage` edges for any linked receipts
- mirror the latest value onto `FeatureBuild.<field>`
- evaluate the field contract in shadow mode and return warnings

- [ ] **Step 6: Re-run the focused tests**

Run:

```bash
pnpm --filter web exec vitest run lib/build/build-provenance-contracts.test.ts lib/build/build-artifact-provenance.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the extracted foundation**

Run:

```bash
git add apps/web/lib/build/build-provenance-contracts.ts apps/web/lib/build/build-provenance-contracts.test.ts apps/web/lib/build/build-artifact-provenance.ts apps/web/lib/build/build-artifact-provenance.test.ts
git commit -s -m "refactor(build): extract provenance contract and revision writer"
```

---

### Task 3: Mint receipts in the governed execution path

**Files:**

- Modify: `apps/web/lib/mcp-governed-execute.ts`
- Modify: `apps/web/lib/mcp-governed-execute.test.ts`

- [ ] **Step 1: Write the failing receipt-minting tests**

Add tests to `apps/web/lib/mcp-governed-execute.test.ts` for:

- provenance-eligible tool writes a `ToolExecutionReceipt` linked to the created audit row
- non-eligible tool skips receipt creation
- receipt write failure does not turn a successful tool call into a failed one

Use existing override seams and add one more override for receipt creation if needed.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter web exec vitest run lib/mcp-governed-execute.test.ts
```

Expected: FAIL because no receipt path exists yet.

- [ ] **Step 3: Refactor audit writing to expose the created execution row identity**

Adjust `writeAudit()` so the governed executor can get the created `ToolExecution` primary key or a small summary object back. Do not duplicate audit writes in the tool handler layer.

- [ ] **Step 4: Add receipt minting in `governedExecuteTool()`**

Implement, anchored to spec §7.1 (eligible v1 tools and digest shapes) and §10.5 (transport vs execution status):

- **Eligibility table** — the v1 set is exactly: `run_sandbox_tests`, `run_sandbox_command`, `edit_sandbox_file`, `write_sandbox_file`, `evaluate_page`, `run_ux_test`. Encode as a typed registry that maps tool name → `{ receiptKind, deriveDigest(result), deriveExecutionStatus(result) }`.
- **`executionStatus` is NOT `ToolExecution.success`.** `run_sandbox_command` returns `success: true` even on non-zero exit; the receipt's `executionStatus` must be derived from the command's `exitCode` (or equivalent semantic field). For `run_sandbox_tests`, `executionStatus = "passed"` only when `failed === 0`. Each eligible tool needs its own deriver.
- **`inputFingerprint`** — stable hash of the canonical tool params (omit volatile fields like timestamps). Use the same canonicalization across transports so identical calls produce identical fingerprints.
- **`outputDigest`** — exactly the structured shape from spec §7.1's table (e.g. `{ command, exitCode, stdoutHash, stderrHash, durationMs }` for `sandbox-command`). Do not store full stdout/stderr.
- **`expiresAt`** — required field. Default per spec §10.3: 24h for sandbox-command/test/UX kinds; 7d for file-edit/file-write kinds. Centralize the TTL table next to the eligibility registry.
- **Best-effort minting** — receipt creation runs after `writeAudit()` returns the audit row identity. Mint failure logs a structured warning (`[provenance] receipt mint failed tool=... toolExecutionId=... err=...`) but never converts a successful tool result into a failure.
- **Result envelope** — surface `receiptId` (or `null`) on the governed-execute result so downstream callers (Task 4 et al.) can pass receipt IDs back into `saveBuildArtifactRevision` without re-querying.

Slice 1 uses shadow mode, so receipt creation is additive only.

- [ ] **Step 5: Re-run the focused test**

Run:

```bash
pnpm --filter web exec vitest run lib/mcp-governed-execute.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the governed execution seam**

Run:

```bash
git add apps/web/lib/mcp-governed-execute.ts apps/web/lib/mcp-governed-execute.test.ts
git commit -s -m "feat(build): mint provenance receipts from governed execution"
```

---

### Task 4: Route `saveBuildEvidence()` through the shared writer

**Files:**

- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools-save-build-evidence.test.ts` (existing focused tests for this handler — do **not** put `saveBuildEvidence` coverage in `build-governed.test.ts`, which scopes server-action paths)

- [ ] **Step 1: Write the failing behavior tests**

Extend `apps/web/lib/mcp-tools-save-build-evidence.test.ts` with coverage that:

- `saveBuildEvidence(field="verificationOut")` still updates the snapshot
- the shared helper is invoked
- shadow warnings are surfaced in the tool result or build activity

Use the existing mocks around `featureBuild.update` and add mocks for revision writes.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter web exec vitest run lib/mcp-tools-save-build-evidence.test.ts
```

Expected: FAIL because `saveBuildEvidence` still writes directly.

- [ ] **Step 3: Replace the direct evidence write in `mcp-tools.ts`**

In the `saveBuildEvidence` case:

- keep current field validation
- keep current build-plan normalization
- keep current phase guidance messages
- replace the direct `FeatureBuild.update()` snapshot write with `saveBuildArtifactRevision(...)`

For Slice 1, preserve current runtime compatibility:

- snapshot still updates
- `typecheckPassed` auto-fill may stay temporarily, but log a shadow warning when it was required

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
pnpm --filter web exec vitest run lib/mcp-tools-save-build-evidence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the MCP evidence path**

Run:

```bash
git add apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools-save-build-evidence.test.ts
git commit -s -m "refactor(build): route saveBuildEvidence through revision writer"
```

---

### Task 5: Route `recordBuildAcceptance()` through the shared writer

**Files:**

- Modify: `apps/web/lib/actions/build.ts`
- Modify: `apps/web/lib/actions/build-governed.test.ts`

- [ ] **Step 1: Write the failing acceptance-path test**

Extend the existing `recordBuildAcceptance` test in `build-governed.test.ts` so that it asserts:

- all existing preconditions remain (review phase, typecheck, completed/skipped UX verification)
- the shared helper `saveBuildArtifactRevision({ field: "acceptanceMet", ... })` is invoked exactly once
- the snapshot still updates so legacy readers continue to work
- shadow warnings (e.g. "no accepted verificationOut revision") are surfaced on the return value, not raised as errors

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter web exec vitest run lib/actions/build-governed.test.ts
```

Expected: FAIL because `recordBuildAcceptance` still writes `acceptanceMet` directly via `prisma.featureBuild.update`.

- [ ] **Step 3: Route `recordBuildAcceptance()` through `saveBuildArtifactRevision()`**

Keep all existing preconditions from `build.ts`; only change the persistence step so `acceptanceMet` becomes revision-backed as well as snapshot-backed. Remember the spec note in §8.1 `acceptanceMet`: in shadow mode this is `derived-from-artifacts`, so the contract evaluator emits a warning when the latest accepted `verificationOut` revision is missing — but Slice 1 still allows the save.

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
pnpm --filter web exec vitest run lib/actions/build-governed.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the acceptance-path migration**

Run:

```bash
git add apps/web/lib/actions/build.ts apps/web/lib/actions/build-governed.test.ts
git commit -s -m "refactor(build): route recordBuildAcceptance through revision writer"
```

---

### Task 6: Route review verification persistence through the shared writer

**Files:**

- Modify: `apps/web/lib/queue/functions/build-review-verification.ts`
- Create: `apps/web/lib/queue/functions/build-review-verification.test.ts`

- [ ] **Step 1: Write the failing queue-path test**

Create `apps/web/lib/queue/functions/build-review-verification.test.ts` with tests that:

- mock a successful UX run and assert `uxTestResults` persistence creates a `BuildArtifactRevision` row AND mirrors `FeatureBuild.uxTestResults`
- assert `uxVerificationStatus` still updates via direct snapshot write (not revision-backed in Slice 1)
- assert receipt IDs minted by `run_ux_test` / `evaluate_page` (Task 3) flow through to the revision's `ArtifactReceiptUsage` edges

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter web exec vitest run lib/queue/functions/build-review-verification.test.ts
```

Expected: FAIL because the queue path still writes `uxTestResults` directly.

- [ ] **Step 3: Route review verification persistence through the shared helper**

In `build-review-verification.ts`, replace the direct `featureBuild.update({ uxTestResults, uxVerificationStatus })` write with:

- shared revision save for `uxTestResults` (with any receipt IDs available from the UX run)
- direct snapshot update for `uxVerificationStatus` only

Do not try to make `uxVerificationStatus` a provenance artifact in Slice 1.

- [ ] **Step 4: Re-run the focused test**

Run:

```bash
pnpm --filter web exec vitest run lib/queue/functions/build-review-verification.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the queue-path migration**

Run:

```bash
git add apps/web/lib/queue/functions/build-review-verification.ts apps/web/lib/queue/functions/build-review-verification.test.ts
git commit -s -m "refactor(build): route uxTestResults persistence through revision writer"
```

---

### Task 7: Add shadow-mode observability and end-to-end verification

**Files:**

- Modify: `apps/web/lib/build/build-artifact-provenance.ts`
- Modify: `apps/web/lib/build/build-artifact-provenance.test.ts`
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/explore/feature-build-types.test.ts`

- [ ] **Step 1: Write the failing observability tests**

Add tests that assert shadow warnings are visible through ALL of these surfaces (single source of truth: the shared helper's return value, then propagated outward):

- structured `warnings: string[]` on the return of `saveBuildArtifactRevision`
- tool result metadata from `saveBuildEvidence` (warnings reach the agent as advisory, not failure)
- `BuildActivity` row written when a provenance-gated field saves with at least one warning

Add the **shadow-non-blocking invariant test** — this is the load-bearing Slice 1 contract:

> Given a contract-failing save (e.g. `verificationOut` with zero receipt IDs), in `enforcementMode: "shadow"` the helper must:
> - return `ok: true`
> - still create the `BuildArtifactRevision` row
> - still mirror the snapshot
> - return one or more warnings

If this test passes only because warnings are emitted while persistence is silently skipped, Slice 1 has shipped a regression that Slice 2 will compound.

Also add a regression test in `feature-build-types.test.ts` documenting that Slice 1 still gates on mutable snapshots (i.e. `checkPhaseGate` reads `FeatureBuild.<field>`, not revisions). Slice 2 will flip that line; the regression test gives Slice 2 an explicit anchor to move.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm --filter web exec vitest run lib/build/build-artifact-provenance.test.ts lib/explore/feature-build-types.test.ts
```

Expected: FAIL until warnings are surfaced consistently.

- [ ] **Step 3: Implement the observability plumbing**

Add:

- a consistent `warnings: string[]` return shape from `saveBuildArtifactRevision()`
- propagation of those warnings into `saveBuildEvidence()` tool responses
- a `BuildActivity` row when a provenance-gated field is saved with warnings in shadow mode

- [ ] **Step 4: Run the full focused verification set**

Run:

```bash
pnpm --filter web exec vitest run \
  lib/mcp-governed-execute.test.ts \
  lib/mcp-tools-save-build-evidence.test.ts \
  lib/actions/build-governed.test.ts \
  lib/build/build-provenance-contracts.test.ts \
  lib/build/build-artifact-provenance.test.ts \
  lib/build/provenance-watchdogs.test.ts \
  lib/queue/functions/build-review-verification.test.ts \
  lib/explore/feature-build-types.test.ts
pnpm --filter web typecheck
pnpm --filter web exec next build
```

Per the "run full test suite before push" memory, also run the full vitest suite once before opening the PR:

```bash
pnpm --filter web exec vitest run
```

Expected:

- all focused Vitest files PASS
- typecheck PASS
- production build PASS

- [ ] **Step 5: Perform a manual Build Studio smoke test**

Verify one real path:

1. start or use the running DPF install
2. open `/build`
3. run a build flow that saves `verificationOut` or reaches review verification
4. confirm the snapshot still updates
5. inspect the DB to confirm revision rows exist

Suggested DB checks:

```bash
docker exec dpf-postgres-1 psql -U dpf -d dpf -c "select \"buildId\", field, \"revisionNumber\", status from \"BuildArtifactRevision\" order by \"createdAt\" desc limit 20;"
docker exec dpf-postgres-1 psql -U dpf -d dpf -c "select id, \"toolExecutionId\", \"receiptKind\", \"executionStatus\" from \"ToolExecutionReceipt\" order by \"createdAt\" desc limit 20;"
```

- [ ] **Step 6: Commit the shadow-mode finish**

Run:

```bash
git add apps/web/lib/build/build-artifact-provenance.ts apps/web/lib/build/build-artifact-provenance.test.ts apps/web/lib/mcp-tools.ts apps/web/lib/explore/feature-build-types.test.ts
git commit -s -m "feat(build): add shadow-mode provenance observability"
```

- [ ] **Step 7: Pre-PR overlap sweep**

Per the "check overlap before opening PR" memory, before pushing:

```bash
git fetch origin
git log --oneline origin/main..HEAD
gh pr list --state open --search "provenance OR receipt OR FeatureBuild OR saveBuildEvidence"
```

Read the recent main commits and any open PRs touching `mcp-tools.ts`, `mcp-governed-execute.ts`, `build.ts`, or `schema.prisma`. If a concurrent session is fixing the same surface, coordinate before pushing.

---

### Task 8: Shadow-mode watchdog detectors (turn data into signal)

**Files:**

- Create: `apps/web/lib/build/provenance-watchdogs.ts`
- Create: `apps/web/lib/build/provenance-watchdogs.test.ts`
- Modify: `apps/web/lib/build/build-artifact-provenance.ts` (call sites only)
- Modify: `apps/web/lib/mcp-governed-execute.ts` (call sites only)

**Why this task exists:** Without watchdogs, Slice 1 just accrues rows that nobody reads. The whole point of shadow mode is to *use* the data to validate the contracts before Slice 2 enforcement. Two detectors are load-bearing — they directly close the failure modes from the 2026-04-27 incident, the proposal-trap stalls (commit `0de87879`), and the contribute-to-hive silent-failure pattern (PR #137). Per spec §11.2 these are "watchdog detectors"; this task implements the two highest-value ones in shadow mode.

- [ ] **Step 1: Write the failing watchdog tests**

Create `apps/web/lib/build/provenance-watchdogs.test.ts` covering:

**Detector A — Missing receipt after eligible tool execution.** The 2026-04-27 fabrication path: an eligible `ToolExecution` row exists for `run_sandbox_tests` / `run_sandbox_command` / etc., but no linked `ToolExecutionReceipt` was minted. Test:

- given a `ToolExecution` row for an eligible tool with no matching receipt within the audit window, `detectMissingReceipts({ buildId, sinceMinutes: 60 })` returns one entry per orphaned execution
- given the same row WITH a linked receipt, returns empty
- detector severity is `"error"` per spec §11.2 table

**Detector B — Claim/digest mismatch.** The hallucination case: a `BuildArtifactRevision` for `verificationOut` claims `{ testsPassed: 47, testsFailed: 0 }`, but the receipts cited via `ArtifactReceiptUsage` have an aggregate `outputDigest` showing different counts (or no test-run receipts at all). Test:

- given a revision whose value claims a passing typecheck but cited receipts have `executionStatus: "failed"`, detector returns one mismatch with structured detail
- given a revision whose `verificationOut.testsPassed` does not match the sum of `outputDigest.passed` across cited `sandbox-test-run` receipts, detector returns one mismatch
- given a revision with no cited receipts at all (the 2026-04-27 case), detector returns one mismatch tagged `kind: "no-receipts-cited"`
- detector severity is `"critical"` for `verificationOut` and `acceptanceMet`, `"error"` elsewhere

**Detector C (lighter, optional but cheap) — receipt with missing `ToolExecution`.** Data integrity: a receipt row whose `toolExecutionId` doesn't resolve. Spec §11.1. One test, returns empties when consistent.

- [ ] **Step 2: Run the focused tests and confirm RED**

```bash
pnpm --filter web exec vitest run lib/build/provenance-watchdogs.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `provenance-watchdogs.ts`**

Implement as pure query functions (no side effects) so they can be called from a periodic job, an admin endpoint, or directly during a smoke test:

```ts
export type WatchdogFinding = {
  detector: "missing-receipt" | "claim-digest-mismatch" | "orphan-receipt";
  severity: "critical" | "error" | "warning";
  buildId?: string;
  toolExecutionId?: string;
  revisionId?: string;
  receiptIds?: string[];
  detail: Record<string, unknown>;
  observedAt: Date;
};

export async function detectMissingReceipts(args: {
  buildId?: string;
  sinceMinutes?: number;
}): Promise<WatchdogFinding[]>;

export async function detectClaimDigestMismatches(args: {
  buildId?: string;
  sinceMinutes?: number;
}): Promise<WatchdogFinding[]>;

export async function detectOrphanReceipts(): Promise<WatchdogFinding[]>;

export async function runAllWatchdogs(args: {
  buildId?: string;
}): Promise<WatchdogFinding[]>;
```

Implementation notes:

- **Eligibility set must match Task 3.** Import the same registry; do not duplicate the v1 tool list. If the registries diverge, detector A produces false positives forever.
- **Mismatch comparison is field-specific.** For `verificationOut`, compare `value.testsPassed` and `value.testsFailed` against the sum of cited `sandbox-test-run` receipt digests. For `acceptanceMet`, the spec's `derived-from-artifacts` mode means the check is "does an accepted `verificationOut` revision exist in the same build" — receipts on `acceptanceMet` itself are not the right comparison. Mirror the field contracts from Task 2 exactly; do not invent a parallel rulebook.
- **Severity follows spec §11.2.** `verificationOut` and `acceptanceMet` mismatches are `critical`; other field mismatches are `error`; orphaned receipts are `warning`.
- **Time window matters.** `sinceMinutes` defaults to 60 so the detector is cheap to run periodically. A `null` window scans full history (admin/forensics use only).

- [ ] **Step 4: Wire watchdog invocation into shadow-mode observability**

In `build-artifact-provenance.ts`, after a provenance-gated save completes successfully:

- run `detectClaimDigestMismatches({ buildId })` for that build only
- if any findings of severity `critical` or `error` come back, write a `BuildActivity` row tagged `kind: "provenance-watchdog"` with the structured findings
- propagate finding summaries into the helper's `warnings` return so they reach the agent surface

In `mcp-governed-execute.ts`, after a provenance-eligible tool call mints (or fails to mint) a receipt:

- if mint succeeded, no detector call needed
- if mint failed (the existing warning-log path), additionally write a `BuildActivity` row so the failure is observable in the build timeline, not only in server logs

Slice 1 stays additive: watchdog findings are recorded, never blocking. Enforcement is Slice 2.

- [ ] **Step 5: Re-run the focused tests**

```bash
pnpm --filter web exec vitest run lib/build/provenance-watchdogs.test.ts lib/build/build-artifact-provenance.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add an admin/operator surface for findings (smoke check only)**

For Slice 1, do not build a UI. Confirm watchdog output is queryable two ways:

- direct DB query against `BuildActivity` filtered to `kind = "provenance-watchdog"`
- ad-hoc: `pnpm --filter web exec tsx -e 'import("./lib/build/provenance-watchdogs").then(m => m.runAllWatchdogs({}).then(console.log))'`

A real operator surface (forensics view, admin panel) is the post-Slice-1 follow-on.

- [ ] **Step 7: Manual smoke — induce a mismatch, observe the detector**

Per the "evidence before diagnosis" memory, prove the detector fires before declaring done:

1. on a real Build Studio run that's reached `verificationOut`, manually save a `verificationOut` payload via `saveBuildEvidence` with `testsPassed: 999` (a value no receipt could justify)
2. confirm a `BuildActivity` row of `kind: "provenance-watchdog"` was written, severity `critical`, detail showing the mismatch
3. confirm the snapshot still updated and the run did NOT fail (shadow mode invariant)
4. revert the synthetic save

If the detector did not fire, the wiring in Step 4 is wrong — fix before continuing. Do not skip this step.

- [ ] **Step 8: Commit the watchdog substrate**

```bash
git add apps/web/lib/build/provenance-watchdogs.ts apps/web/lib/build/provenance-watchdogs.test.ts apps/web/lib/build/build-artifact-provenance.ts apps/web/lib/mcp-governed-execute.ts
git commit -s -m "feat(build): add shadow-mode provenance watchdog detectors"
```

---

## Slice 1 Acceptance

Slice 1 is complete when ALL of the following are demonstrably true (evidence per the "verification before completion" memory — run the command, paste/observe the output, do not assert from intent):

**Schema & data:**

- `ToolExecutionReceipt`, `BuildArtifactRevision`, and `ArtifactReceiptUsage` exist in Prisma and the dev DB (verify via `prisma validate` AND a SELECT against each table)
- the migration is additive only; no destructive operations on existing tables (inspect the generated `migration.sql`)

**Receipt minting:**

- provenance-eligible governed tool executions mint receipt rows for the v1 set in spec §7.1, with `executionStatus` derived from semantic outcome (not `ToolExecution.success`) and `expiresAt` populated per the TTL table
- a tool that runs `run_sandbox_command` exiting non-zero produces `executionStatus = "failed"` (or "blocked") even though `ToolExecution.success = true` — confirm via DB inspection during the smoke test
- receipt mint failure logs a warning but never converts a successful tool result into a failure (covered by Task 3 test)

**Writer unification:**

- `saveBuildEvidence`, `recordBuildAcceptance`, and the review-verification queue all route through `saveBuildArtifactRevision` (grep confirms no remaining `prisma.featureBuild.update({ ... verificationOut | acceptanceMet | uxTestResults ... })` outside the shared helper)
- `FeatureBuild` snapshots still update exactly as before for legacy readers

**Shadow-mode contract:**

- provenance contracts run in shadow mode and emit warnings instead of rejecting
- a contract-failing save (zero receipts on `verificationOut`) STILL persists the revision and snapshot — the load-bearing Slice 1 invariant
- shadow warnings are observable through the helper return value, the `saveBuildEvidence` tool result, AND a `BuildActivity` row

**Watchdogs (Task 8):**

- `detectMissingReceipts`, `detectClaimDigestMismatches`, and `detectOrphanReceipts` exist and pass focused tests
- watchdog findings write `BuildActivity` rows with `kind = "provenance-watchdog"` so they are queryable without bespoke tooling
- the induced-mismatch smoke test (Task 8 Step 7) produced a `critical` severity finding without blocking the save — proves shadow-mode wiring is correct end-to-end

**Verification:**

- focused Vitest set passes (Task 7 Step 4 command, plus `lib/build/provenance-watchdogs.test.ts`)
- full Vitest suite passes (`pnpm --filter web exec vitest run`)
- `pnpm --filter web typecheck` passes
- `pnpm --filter web exec next build` passes
- manual Build Studio smoke test confirms a real `verificationOut` save creates a `BuildArtifactRevision` row with `revisionNumber=1` and matching `FeatureBuild.verificationOut` snapshot

**Process:**

- every commit signed off (`-s` / DCO)
- pre-PR overlap sweep done (Task 7 Step 7)

---

## Shadow-Mode Soak Window

Before opening the Slice 2 plan, let shadow-mode data accrue from real Build Studio runs. The exit criteria for the soak (not gates on Slice 1 itself, but prerequisites for Slice 2):

- at least one full Build Studio lifecycle (ideate → ship) runs against the new substrate without regressing existing flows
- watchdog `BuildActivity` rows are inspected at least once: do `claim-digest-mismatch` findings reflect real coworker fabrication, or are they false positives from contract bugs? If false positives dominate, fix the contracts BEFORE Slice 2 enforcement, otherwise Slice 2 will reject legitimate saves.
- the receipt eligibility set matches lived experience: are there tools that *should* mint receipts but were skipped in v1, or vice versa? Update the registry before flipping to enforcement.

Concrete soak query, run a few times during the window:

```sql
SELECT
  ba."buildId",
  ba.kind,
  ba.summary,
  ba.metadata->>'detector' AS detector,
  ba.metadata->>'severity' AS severity,
  ba."createdAt"
FROM "BuildActivity" ba
WHERE ba.kind = 'provenance-watchdog'
ORDER BY ba."createdAt" DESC
LIMIT 50;
```

If this returns nothing after a real Build Studio run reached verification, the wiring is wrong — investigate before Slice 2.

## Slice 2 Preview

Once Slice 1 lands and the soak confirms the contracts match reality, Slice 2:

- removes the `typecheckPassed` auto-fill in `saveBuildEvidence`
- flips `verificationOut` and `uxTestResults` contracts to `enforcementMode: "enforce"` — saves without valid receipt citations are rejected
- promotes the `acceptanceMet` `derived-from-artifacts` rule to enforcement: no acceptance save without an accepted `verificationOut` revision in the same build
- moves `checkPhaseGate()` to read accepted revisions instead of mutable `FeatureBuild` snapshots (the regression test added in Task 7 Step 1 is the explicit anchor to flip)
- hardens both handoff writers (`save_phase_handoff` MCP tool and `advanceBuildPhase()` server action) to derive `evidenceDigest` from revisions and receipts rather than from mutable JSON
- defines the `legacyEvidence = true` backfill path for builds that started before Slice 1 — they should remain advanceable but visibly tagged

Slice 2 is a behavior change, not a substrate change. It will only land cleanly if Slice 1's soak data confirms the contracts are right.

## Post-Slice-2 Follow-Ons (Forensics & Leverage)

The receipts substrate exists not just to gate phase advancement but to give operators ground truth about what happened during a Build Studio run. After Slice 2 ships, the next plans should turn the data into product:

1. **Forensics view at `/build/<id>/forensics`.** A single page that joins `BuildArtifactRevision` ↔ `ArtifactReceiptUsage` ↔ `ToolExecutionReceipt` ↔ `ToolExecution` chronologically for one build. Replaces "scroll through coworker chat threads at 2am to figure out what went wrong" with one query. This is the moment the substrate stops being theoretical.

2. **Hallucination pattern reports.** Aggregate `claim-digest-mismatch` findings per coworker / per model / per archetype. Surfaces which prompts and which models fabricate which fields under which conditions. Direct input to coworker improvement loops (per the "improvement loops for every coworker" memory).

3. **Routing signal from receipts.** Feed receipt-derived success rates (per model, per task type, per archetype) into the routing substrate alongside the existing capability-tier routing. Ties to "no provider pinning" — routing decisions become measurable, not aspirational.

4. **Hive contribution quality scoring.** When a contribution flows from a local install to the public hive, attach a receipt-derived quality signal: revision churn, fabrication rate, mismatch count. Reputation grounded in measurable platform behavior, not identity. Aligns with "obfuscated, not anonymous."

5. **Customer-facing audit export.** Per the TAK governance substrate framing — the receipt+revision chain is exportable as a verifiable trail. Becomes part of the recursive-self-improvement story: every receipt the platform mints is also a sellable artifact of trust for regulated-industry customers.

These do not require schema changes; they all consume the rows Slice 1 starts producing today. The forensics view is the right thing to build first because it pays for itself the next time an autonomous Build Studio run goes weird — and it makes the value of the substrate self-evident to any future contributor without needing to read the spec.

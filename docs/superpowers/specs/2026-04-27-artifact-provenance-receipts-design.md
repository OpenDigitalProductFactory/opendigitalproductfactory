# Artifact Provenance via Execution Receipts - Design Spec

| Field | Value |
|-------|-------|
| **Epic** | Platform Infrastructure / Build Studio Integrity |
| **Status** | Draft |
| **Created** | 2026-04-27 |
| **Updated** | 2026-04-29 |
| **Author** | Codex for Mark Bodman |
| **Scope** | `apps/web/lib/mcp-governed-execute.ts`, `apps/web/lib/mcp-tools.ts`, `apps/web/lib/queue/functions/build-review-verification.ts`, `apps/web/lib/integrate/build-orchestrator.ts`, `packages/db/prisma/schema.prisma` |
| **Aligns with** | [2026-04-27-routing-control-data-plane-design.md](./2026-04-27-routing-control-data-plane-design.md), [2026-04-27-routing-substrate-attempt-history.md](./2026-04-27-routing-substrate-attempt-history.md) |
| **Distinct from** | Routing decides where work runs. This spec decides whether the platform may trust claimed work strongly enough to persist it as build evidence or use it to advance a phase. |
| **Primary Goal** | Make phase-gating evidence trustworthy by requiring evidence saves and handoffs to attach durable execution receipts derived from the tool calls that actually produced the claimed result. |

---

## 1. Problem Statement

On 2026-04-27 a Build Studio run advanced through verification and into review even though the sandbox had not been changed and no verification commands had run. The agent saved structured `verificationOut` and `acceptanceMet` payloads, the platform accepted those payloads as if they were facts, and the state machine advanced.

That failure was not "the model made a mistake." It exposed a platform-level gap:

- The system records that a tool save happened.
- The system does not require proof that the saved payload was grounded in any prior execution.
- The system stores mutable evidence directly on `FeatureBuild`, so later edits overwrite the exact artifact state that previously justified a gate decision.
- `save_phase_handoff` accepts free-text summaries that downstream agents can read as truth even when the summary is not backed by tool execution.
- `run_sandbox_command` currently returns `success: true` even when the command exits non-zero, which is useful for iterative fixing but unsafe as a provenance signal unless execution status is modeled separately.
- `saveBuildEvidence` currently auto-fills `typecheckPassed=true` when the AI omits it, which is convenient for throughput but architecturally incompatible with trustworthy verification evidence.

The recurring harm is larger than one fake verification record:

- A coworker can say it filed a bug without calling `create_backlog_item`.
- A handoff can claim tests passed even when none ran.
- Review or verification queues can consume mutable build fields with no immutable chain showing which tool executions justified the state at that time.

The common shape is this:

**the platform lets agents persist conclusions without binding those conclusions to the concrete executions that produced them.**

This spec closes that gap by introducing execution receipts, immutable artifact revisions, and phase gates that evaluate accepted revisions rather than mutable free-form fields.

## 2. Design Principles

1. **`ToolExecution` remains the canonical execution audit.** Do not create a second competing audit ledger.
2. **Receipts are derived proof, not a parallel truth system.** A receipt must point back to one canonical tool execution.
3. **Mutable build snapshot fields are caches, not evidence history.** Gate-worthy evidence needs immutable revisions.
4. **Phase gates must evaluate accepted artifact revisions, not raw user- or agent-supplied JSON.**
5. **Structured saves can be rejected; prose remains advisory.** We are hardening state transitions, not trying to eliminate all hallucinated text.
6. **Proof requirements should be field-specific and incremental.** v1 should harden the dangerous gates first, not freeze every artifact path at once.
7. **The governed execution path is the integration seam.** Receipt minting must work for agentic loop, REST, JSON-RPC, and external MCP callers through the same entry point.

## 3. Current-State Reality This Spec Must Match

The design must fit the repo as it exists today:

- `apps/web/lib/mcp-governed-execute.ts` is already the convergence point for capability checks, grant checks, and `ToolExecution` writing across transports. Receipt minting should attach here or immediately below it, not only inside one caller path.
- `ToolExecution` already stores `threadId`, `agentId`, `userId`, `toolName`, `parameters`, `result`, `success`, `executionMode`, `routeContext`, `durationMs`, and audit metadata. A receipt should reuse that audit row, not duplicate those fields as a new independent record.
- `FeatureBuild` stores mutable JSON snapshots such as `designDoc`, `buildPlan`, `verificationOut`, `acceptanceMet`, `uxTestResults`, and `planReview`.
- `PhaseHandoff` already stores `evidenceFields`, `evidenceDigest`, `gateResult`, and `toolsUsed`, but today those are only as trustworthy as the inputs that wrote them.
- `saveBuildEvidence` currently allows only `designDoc`, `designReview`, `buildPlan`, `planReview`, `taskResults`, `verificationOut`, `acceptanceMet`, and `scoutFindings`. There is no current `sandboxVerification` field on `FeatureBuild`, so provenance contracts must not invent one.
- `saveBuildEvidence` does **not** currently save `uxTestResults`; the review-verification queue function writes `uxTestResults` and `uxVerificationStatus` directly to `FeatureBuild`. Provenance hardening therefore cannot live only in the MCP tool handler.
- `recordBuildAcceptance()` in `apps/web/lib/actions/build.ts` already exists as a stricter acceptance writer than `saveBuildEvidence`: it requires review phase, clean typecheck, completed/skipped UX verification, and then writes `acceptanceMet` directly. v1 should converge on that path rather than leave two competing acceptance semantics.
- There are currently two handoff writers: `save_phase_handoff` writes a free-text `PhaseHandoff` and performs the phase transition itself, while `advanceBuildPhase()` separately writes a best-effort `PhaseHandoff` with derived `evidenceDigest` from mutable `FeatureBuild` fields. Hardening only one path would leave the other as a bypass.
- `run_sandbox_command` deliberately returns a tool-success payload even when the command exits non-zero, so provenance must distinguish "tool transport succeeded" from "command produced a passing result."

## 4. Non-Goals

- Replacing `ToolExecution`
- Cryptographic signing for cross-organization trust boundaries
- Preventing all hallucinated prose in agent replies
- Solving general human fraud by privileged operators
- Hardening every artifact type in the first rollout
- Replacing the current build-phase state machine

## 5. Architectural Model

The architecture has four layers:

1. **Canonical execution audit**: `ToolExecution`
2. **Derived execution receipts**: additive provenance rows attached 1:1 or 1:n to tool executions
3. **Immutable artifact revisions**: every gate-worthy evidence save creates a revision row
4. **Gate evaluation**: phase advancement and queue verification consume accepted revisions plus their attached receipts

```text
Tool call
  -> governedExecuteTool(...)
  -> ToolExecution row written
  -> if tool is provenance-eligible, mint execution receipt linked to ToolExecution
  -> tool result returns receipt metadata

saveBuildEvidence(field, value, receiptIds)
  -> validate field contract against receipts
  -> create immutable BuildArtifactRevision
  -> create ArtifactReceiptUsage edges
  -> update FeatureBuild.<field> snapshot

recordBuildArtifact(...)
  -> shared helper used by saveBuildEvidence, review-verification jobs,
     and recordBuildAcceptance
  -> same revision + receipt contract regardless of caller path

save_phase_handoff(...)
  -> summarize latest accepted artifact revisions
  -> persist operator/agent notes separately from derived evidence digest

checkPhaseGate(...)
  -> read latest accepted revisions for required fields
  -> verify provenance contract status
  -> allow or reject transition
```

### 5.1 Why the Prior Draft Was Not Enough

The earlier direction correctly identified receipts, but it still left three architectural holes:

1. **It created a parallel receipt record duplicating execution identity already stored on `ToolExecution`.**
2. **It bound receipts directly to mutable `FeatureBuild` fields, which loses historical truth after later overwrites.**
3. **It treated synthesized fields like `acceptanceMet` the same as raw execution outputs, when in practice they are judgments that should depend on previously accepted verification artifacts.**

This revision closes those gaps.

## 6. Data Model

### 6.1 `ToolExecutionReceipt`

This remains a separate table, but it is intentionally narrow and anchored to `ToolExecution`.

```prisma
model ToolExecutionReceipt {
  id               String   @id @default(cuid())
  toolExecutionId  String   @unique
  buildId          String?
  receiptKind      String
  receiptStatus    String   @default("valid") // valid | expired | revoked
  inputFingerprint String
  outputDigest     Json
  executionStatus  String   // observed outcome semantics, not transport success
  expiresAt        DateTime
  createdAt        DateTime @default(now())

  @@index([buildId, createdAt(sort: Desc)])
  @@index([receiptKind, createdAt(sort: Desc)])
  @@index([receiptStatus, expiresAt])
}
```

Key points:

- `toolExecutionId` is unique and required. This enforces one canonical audit root.
- `executionStatus` is required because `ToolExecution.success` is not enough for commands that intentionally return useful error output.
- `outputDigest` is JSON, not a lossy string. The platform needs structured matching for tests, typecheck, file mutation, and UX results.
- `buildId` is nullable only for future non-build artifact work. For Build Studio v1, every gate-worthy receipt must have a `buildId`.

### 6.2 `BuildArtifactRevision`

Gate-worthy evidence must be immutable.

```prisma
model BuildArtifactRevision {
  id             String   @id @default(cuid())
  buildId        String
  field          String
  revisionNumber Int
  value          Json
  valueDigest    String
  savedByUserId  String
  savedByAgentId String?
  threadId       String?
  status         String   @default("accepted") // accepted | rejected | superseded | legacy
  legacyEvidence Boolean  @default(false)
  createdAt      DateTime @default(now())

  @@unique([buildId, field, revisionNumber])
  @@index([buildId, field, createdAt(sort: Desc)])
}
```

`FeatureBuild.designDoc`, `FeatureBuild.buildPlan`, `FeatureBuild.verificationOut`, and peers remain in place as current snapshots for runtime convenience. They become denormalized mirrors of the latest accepted revision, not the only place the truth lives.

### 6.3 `ArtifactReceiptUsage`

Receipts should be referenceable by immutable artifact revisions.

```prisma
model ArtifactReceiptUsage {
  id                String   @id @default(cuid())
  artifactRevisionId String
  receiptId         String
  role              String?  // optional semantic label, e.g. typecheck | tests | build | ux
  createdAt         DateTime @default(now())

  @@unique([artifactRevisionId, receiptId])
  @@index([receiptId])
}
```

This is better than "single-use receipt fields on the receipt row" because:

- it preserves a many-to-one history of how a receipt was used,
- it does not destroy forensic clarity,
- it allows the platform to decide in policy whether a receipt may be reused across specific artifact classes.

### 6.4 Consumption Policy

The prior draft required every receipt to be globally single-use. That is too rigid for this system.

v1 policy:

- A receipt may be referenced by multiple revisions of the **same field within the same build** while the revision chain is being corrected.
- A receipt may not be reused across **different builds**.
- A receipt may not satisfy two **independent gate classes** when that would weaken trust. Example: a raw test receipt can support `verificationOut`, but `acceptanceMet` should depend on accepted verification artifacts, not directly on the same raw test receipt.

Enforcement therefore lives in the field contract validator, not in a blanket `consumedAt` column.

## 7. Receipt Issuance

### 7.1 Eligible v1 Tools

Initial receipt minting should cover tools whose outputs are directly used to claim execution or verification:

| Tool | Receipt kind | Execution status examples | Digest shape |
|---|---|---|---|
| `run_sandbox_tests` | `sandbox-test-run` | `passed`, `failed` | `{ exitCode, passed, failed, skipped, command }` |
| `run_sandbox_command` | `sandbox-command` | `passed`, `failed`, `blocked` | `{ command, exitCode, stdoutHash, stderrHash, durationMs }` |
| `edit_sandbox_file` | `sandbox-file-edit` | `applied` | `{ path, beforeSha, afterSha, byteDelta }` |
| `write_sandbox_file` | `sandbox-file-write` | `applied` | `{ path, afterSha, byteCount }` |
| `evaluate_page` | `ux-evaluation` | `completed` | `{ url, evaluationStatus, issuesCount }` |
| `run_ux_test` | `ux-run` | `passed`, `failed` | `{ scenario, passedSteps, failedSteps, artifactPaths }` |

### 7.2 Not in v1

These should not be part of the first hard gate:

- `read_sandbox_file`
- `search_project_files`
- `list_project_directory`
- `reviewDesignDoc`
- `reviewBuildPlan`
- async research dispatch tools

Those calls are useful context, but they are weak provenance anchors compared with write, test, build, and UX execution. Design and plan quality should continue to be hardened by review gates plus repo-grounded required content, not by pretending every read operation is strong evidence.

### 7.3 Where Receipts Are Minted

Receipt minting must occur in the governed execution layer or in a helper immediately called by it:

- the transport should not matter,
- all execution modes should produce comparable provenance,
- `ToolExecution` and receipt rows should be written in one coherent flow.

The implementation should expose a helper like:

```typescript
type ProvenanceReceiptDraft = {
  buildId?: string;
  receiptKind: string;
  executionStatus: "passed" | "failed" | "applied" | "completed" | "blocked";
  inputFingerprint: string;
  outputDigest: Record<string, unknown>;
  expiresAt: Date;
};
```

Tool handlers return this draft alongside normal user-facing result data when applicable. The governed executor persists the audit row first, then the linked receipt row.

## 8. Artifact Contracts

Every gated field has an explicit provenance contract.

```typescript
type ArtifactContract = {
  field: string;
  mode: "raw-receipt" | "derived-from-artifacts";
  requiredReceipts?: ReceiptRule[];
  requiredArtifacts?: ArtifactRule[];
  validateValue?: (
    value: unknown,
    context: ValidationContext,
  ) => ValidationResult;
};
```

### 8.1 v1 Contracts

#### `verificationOut`

Mode: `raw-receipt`

Requirements:

- at least one `sandbox-command` receipt whose command matches the typecheck/build command being claimed,
- at least one of:
  - `sandbox-test-run`, or
  - `sandbox-command` with a recognized verification command pattern,
- `validateValue` must compare claimed pass/fail state to receipt `executionStatus`.

Important current-state change:

- the platform must remove the current auto-fill behavior that silently sets `typecheckPassed=true` when omitted.

#### `uxTestResults`

Mode: `raw-receipt`

Requirements:

- at least one `ux-run` or `ux-evaluation` receipt,
- optional screenshot or artifact path digests if available.

Implementation note:

- because `uxTestResults` is currently written by `build-review-verification.ts` directly, v1 needs a shared artifact-save helper used by both tool handlers and queue/runtime code. Adding a contract only to `saveBuildEvidence` would not harden the real review-verification path.

#### `acceptanceMet`

Mode: `derived-from-artifacts`

Requirements:

- latest accepted `verificationOut` revision must exist,
- latest accepted `uxTestResults` revision must exist when the build's acceptance criteria include UX behavior,
- validator checks that acceptance claims reference those accepted artifacts rather than bypassing them.

This is a key architectural correction. `acceptanceMet` is not raw execution output; it is a synthesis.

Implementation note:

- the existing `recordBuildAcceptance()` server action is already closer to the desired architecture than raw `saveBuildEvidence(field="acceptanceMet")` saves. v1 should move that action onto the shared revision writer and either reject direct free-form `acceptanceMet` saves or downgrade them to non-gating commentary.

#### `designDoc`

v1 should remain ungated by receipts.

Continue using explicit content rules:

- existing-code audit is required,
- design review remains the quality gate.

#### `buildPlan`

v1 should remain ungated by receipts.

Continue using plan-shape validation and plan review.

#### `planReview` and `designReview`

These remain review artifacts rather than receipt-gated execution artifacts in v1.

### 8.2 Field Registry Rules

- Fields not present in the contract registry are free-saved but not phase-gating by provenance.
- Any field used by `checkPhaseGate` or review-queue automation must either:
  - have a contract, or
  - be explicitly marked `legacy-allowed` during rollout.

## 9. Save and Gate Flows

### 9.1 `saveBuildEvidence`

New behavior:

1. Resolve active build.
2. Validate field shape as today.
3. Look up field contract.
4. Validate supplied receipt IDs or dependent accepted artifacts.
5. Create `BuildArtifactRevision`.
6. Create `ArtifactReceiptUsage` edges if receipt-based.
7. Update denormalized `FeatureBuild.<field>` snapshot.
8. Return revision metadata plus any provenance warnings.

If validation fails, the save is rejected and no snapshot update occurs.

### 9.1.1 Shared artifact writer

To match the actual repo call graph, v1 should introduce a shared persistence seam, for example:

```typescript
saveBuildArtifactRevision({
  buildId,
  field,
  value,
  receiptIds,
  actor,
  source,
})
```

Required callers in v1:

- `saveBuildEvidence`
- `recordBuildAcceptance`
- review-verification persistence for `uxTestResults`

Without this seam, receipt enforcement would apply only to MCP tool saves while the real queue and server-action writers would continue bypassing provenance.

### 9.2 `save_phase_handoff`

`save_phase_handoff` should no longer be treated as a place where agents may invent operational truth.

Revised semantics:

- the free-text summary remains allowed as a human-readable note,
- `evidenceDigest`, `gateResult`, and `toolsUsed` should be derived from accepted artifact revisions and linked receipts,
- the summary should be stored as commentary, not as authoritative evidence.

This keeps handoffs useful without making them a hidden bypass around provenance.

The same rule must also apply to the `PhaseHandoff` rows created inside `advanceBuildPhase()`. Otherwise the system would keep one hardened handoff path and one legacy mutable-snapshot path.

### 9.3 `checkPhaseGate`

Gate evaluation should read latest accepted revisions, not only `FeatureBuild` JSON columns.

Example:

- ideate -> plan still depends primarily on approved design artifacts and intake state,
- build -> review depends on accepted `verificationOut` plus any required `uxTestResults` and accepted `acceptanceMet`,
- a build cannot advance if the latest required artifact revision is missing, rejected, or provenance-invalid.

## 10. Failure Modes and Recovery

### 10.1 Agent forgot to pass receipt IDs

Return structured rejection:

- which field failed,
- which receipt kinds were required,
- which compatible receipts already exist for the active build, if any.

### 10.2 Tool ran but receipt minting failed

This is a platform error, not an agent behavior issue.

- tool result should still surface,
- watchdog raises an error,
- the build may not use that execution for a gate until the platform issue is fixed or a new execution is run.

### 10.3 Long-running builds

Receipts expire, but TTL should be per receipt kind:

- build/test/UX receipts: short TTL, e.g. 24h
- file-edit receipts: longer TTL when still within same active build window

### 10.4 Repeated iterations

Multiple verification attempts are normal. The platform should:

- preserve every receipt,
- preserve every artifact revision,
- treat the latest accepted revision as authoritative for gating,
- let operators inspect previous failed or superseded attempts.

### 10.5 Command transport success vs verification success

Because `run_sandbox_command` may return a useful payload when the command exits non-zero:

- `ToolExecution.success=true` means the tool transport worked,
- `ToolExecutionReceipt.executionStatus` carries the semantic outcome used for provenance.

This distinction is mandatory.

## 11. Observability and Operator Surfaces

### 11.1 Required Metrics

- receipts minted by kind
- receipts with no linked `ToolExecution`
- artifact saves rejected by contract
- phase gate rejections due to missing provenance
- legacy artifact usage on post-rollout builds
- mismatches between claimed artifact status and receipt execution status

### 11.2 Watchdog Detectors

| Detector | Signal | Severity |
|---|---|---|
| Missing receipt after eligible tool execution | provenance-eligible tool call wrote `ToolExecution` but no receipt | error |
| Gate evaluated from legacy snapshot only | phase gate allowed advancement without accepted revision on post-rollout build | critical |
| Claimed pass backed by failed receipt | artifact says pass, receipt status says failed | error |
| Cross-build receipt use | artifact references receipt from another build | error |
| Snapshot/revision divergence | `FeatureBuild.<field>` does not match latest accepted revision | error |
| Handoff asserts unverifiable completion | handoff summary claims tests/build/verification while derived digest shows none | warning |

### 11.3 Operator UI

Add a provenance view per build:

- latest accepted revisions by field
- superseded and rejected revisions
- linked receipts
- jump-through to canonical `ToolExecution`
- exact gate decision basis for each phase transition

## 12. Rollout Plan

### Phase A - Schema foundations

- add `ToolExecutionReceipt`
- add `BuildArtifactRevision`
- add `ArtifactReceiptUsage`
- no enforcement yet

### Phase B - Receipt minting on core execution tools

- mint receipts for sandbox command/test/edit/write and UX tools
- attach to governed execution path
- add metrics and watchdog coverage

### Phase C - Shadow-mode artifact validation

- `saveBuildEvidence` evaluates contracts and logs would-reject outcomes
- snapshot writes still proceed
- analyze real builds for false positives and missing data

### Phase D - Enforce `verificationOut` and `uxTestResults`

- remove `typecheckPassed` auto-fill
- require accepted revision creation for these fields
- update phase gates to read revisions first

### Phase E - Derive `acceptanceMet` from accepted artifacts

- prevent direct unsupported acceptance claims
- tighten review queue assumptions

### Phase F - Handoff hardening

- derive evidence digest and tools used from revisions/receipts
- keep summary as commentary

## 13. Test Coverage

- unit tests for contract validators
- integration tests for governed execution -> audit row -> receipt row
- integration tests for `saveBuildEvidence` creating revisions and usage edges
- negative tests for fake `verificationOut`
- regression test for the observed fabricated-advance scenario
- snapshot/revision divergence tests
- phase gate tests that prove mutable snapshot fields alone are no longer sufficient

## 14. Open Questions

1. Should build/test command recognition be contract-driven by explicit command metadata instead of regex matching command strings?
2. Should `run_sandbox_tests` become the preferred mandatory verification tool so fewer gates depend on shell-command interpretation?
3. Should design and plan research eventually gain lighter-weight provenance, or is review plus repo-grounded content enough for that class of artifact?

## 15. Summary

The core problem is not merely "we need receipts." The real problem is that the platform currently lets mutable artifact snapshots stand in for trustworthy history.

The corrected architecture is:

- keep `ToolExecution` as the canonical audit,
- derive linked execution receipts from provenance-eligible tool calls,
- persist immutable build artifact revisions for gate-worthy saves,
- make phase gates and handoffs consume accepted revisions instead of trusting raw mutable JSON fields.

That removes the hidden success path where an agent can claim verification without having done it, while still preserving the iterative, error-tolerant tooling behavior Build Studio needs during active development.

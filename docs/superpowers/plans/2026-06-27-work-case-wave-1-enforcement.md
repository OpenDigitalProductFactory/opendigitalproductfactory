# Work Case Wave 1 Enforcement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Work Case enforcement spine: governed Action descriptors, policy-envelope evaluation, ReceiptEnvelope normalization, and receipt-coverage guard for consequential Work Case transitions.

**Architecture:** Extend the Wave 0 `apps/web/lib/work-management/*` library with pure, testable domain modules before touching the cross-cutting MCP execution path. Reuse existing substrate: `CoworkerActionEnvelope`, `ToolExecution`, `ToolExecutionReceipt`, `DecisionInteraction`, `WorkCapsuleActivity`, `WorkItemMessage`, `RuntimeVerification`, `ExternalEvidenceRecord`, `BacklogItemActivity`, and `GoldenTriangleReceipt`; do not add a new Work Case table or receipt table in this slice. Integrate through the existing `governedExecuteTool` lifecycle/audit seam only after the pure guard proves the invariants.

**Tech Stack:** Next.js 16 monorepo, TypeScript, Vitest, Prisma schema models, DPF MCP tool execution, existing Work Case Wave 0 modules.

---

## Context And Constraints

- Epic: `EP-2984B02B`
- Backlog item: `BI-D633F7AF`
- Spec: `docs/superpowers/specs/2026-06-27-work-management-architecture-design.md`
- Depends on PR #2484 / Wave 0 foundation landing on `main`.
- Current planning branch: `doc/work-case-wave1-enforcement`, stacked on `origin/doc/work-management-architecture` until #2484 leaves the merge queue.
- No operator UI in this BI.
- No sponsor/authority-mode migration in this BI unless a failing invariant proves projection is impossible.
- No new receipt persistence table. Use `ToolExecutionReceipt` and projected envelopes first.
- No raw backing-record lockout. The guard distinguishes governed Action receipts from observed external/raw events.

## File Structure

- Create `apps/web/lib/work-management/action-registry.ts`
  - Closed Work Case handoff/action grammar.
  - Maps actions to sanctioned existing mutators where they exist.
  - Marks consequential transitions and whether they require policy evaluation, DecisionInteraction, CoworkerActionEnvelope staging, and receipts.
- Create `apps/web/lib/work-management/action-registry.test.ts`
  - Coverage for every handoff verb and every source-registry supported transition.
- Create `apps/web/lib/work-management/policy-envelope.ts`
  - Typed policy envelope and pure evaluator.
  - Evaluates source support, terminal sealing, autonomy/staging requirements, sensitivity ceiling, stop conditions, and decision-routing requirement.
- Create `apps/web/lib/work-management/policy-envelope.test.ts`
  - Pure tests for allow/deny reasons.
- Create `apps/web/lib/work-management/receipt-envelope.ts`
  - Normalizes existing receipt/evidence rows into one `ReceiptEnvelope` shape.
  - Includes `fromGoldenTriangleReceipt` and `fromToolExecutionReceipt` so the envelope subsumes both.
- Create `apps/web/lib/work-management/receipt-envelope.test.ts`
  - Normalizer tests for each substrate record class.
- Create `apps/web/lib/work-management/receipt-coverage.ts`
  - Guard that verifies a consequential action has a passing policy decision and a matching governed receipt before it is considered complete.
- Create `apps/web/lib/work-management/receipt-coverage.test.ts`
  - Guard tests for missing receipts, observed-vs-governed receipts, policy failures, and terminal sealing.
- Create `apps/web/lib/work-management/case-telemetry.ts`
  - OTel-compatible span/event projection from `ReceiptEnvelope`; pure shape only in this BI.
- Create `apps/web/lib/work-management/case-telemetry.test.ts`
  - Verifies stable trace/span fields and case/action attributes.
- Create `apps/web/lib/work-management/work-case-governance-hook.ts`
  - Factory for a `ToolLifecycleHook` that evaluates Work Case context in `governedExecuteTool`.
  - The hook is exported but not globally registered until call sites pass `context.workCase`.
- Create `apps/web/lib/work-management/work-case-governance-hook.test.ts`
  - Hook-level tests with fake lifecycle events.
- Modify `apps/web/lib/work-management/source-registry.ts`
  - Expand `WorkCaseSupportedTransition` to the full handoff grammar from the spec: `claim`, `pause`, `needs-input`, `needs-auth`, `respond`, `resume`, `propose`, `delegate`, `handoff`, `escalate`, `verify`, `complete`, `cancel`.
- Modify `apps/web/lib/work-management/case-types.ts`
  - Add shared `WorkCaseRef`, `WorkCaseActorRef`, `WorkCaseActionVerb`, and `WorkCaseEnforcementMode` types if needed by the new modules.
- Modify `apps/web/lib/work-management/architecture-grounding.ts`
  - Add `ACT-WC-claim`, `ACT-WC-pause`, `ACT-WC-delegate`, `ACT-WC-verify`, `ACT-WC-complete`, `PART-WC-policy-envelope`, `PART-WC-receipt-envelope`.
  - Move `REQ-WC-1`, `REQ-WC-2`, `VC-WC-1`, and `VC-WC-2` to `partially-implemented` or `implemented` according to the actual guard coverage.
  - Add `sysml_allocates` edges to new Wave 1 files.
- Modify `apps/web/lib/work-management/architecture-grounding.test.ts`
  - Assert all new Wave 1 files have allocations and each implemented requirement has a verification case.
- Modify `apps/web/lib/work-management/index.ts`
  - Re-export new modules.
- Modify `apps/web/lib/mcp-governed-execute.ts`
  - Add optional `context.workCase`.
  - Make receipt derivation understand `context.workCase` so successful consequential Work Case tool executions can create a `ToolExecutionReceipt` with `receiptKind = "work-case-governed-action"`.
  - Keep existing behavior unchanged when `context.workCase` is absent.
- Modify `apps/web/lib/mcp-governed-execute.test.ts`
  - Add tests proving existing tools are unchanged without Work Case context and proving Work Case context can emit receipts for consequential actions.
- Update `docs/superpowers/specs/2026-06-27-work-management-architecture-design.md` only if implementation discovers a substrate mismatch.

---

## Task 1: Action Registry And Handoff Grammar

**Files:**
- Create: `apps/web/lib/work-management/action-registry.test.ts`
- Create: `apps/web/lib/work-management/action-registry.ts`
- Modify: `apps/web/lib/work-management/source-registry.ts`
- Modify: `apps/web/lib/work-management/case-types.ts`
- Modify: `apps/web/lib/work-management/index.ts`

- [ ] **Step 1: Write the failing action-registry tests**

Add tests that require the full spec grammar and existing mutator mapping:

```ts
import { describe, expect, it } from "vitest";
import { WORK_CASE_ACTION_REGISTRY, getWorkCaseAction } from "./action-registry";
import { WORK_CASE_SOURCE_REGISTRY } from "./source-registry";

describe("Work Case action registry", () => {
  it("defines the full handoff grammar from the spec", () => {
    expect(WORK_CASE_ACTION_REGISTRY.map((a) => a.action)).toEqual([
      "claim",
      "pause",
      "needs-input",
      "needs-auth",
      "respond",
      "resume",
      "propose",
      "delegate",
      "handoff",
      "escalate",
      "verify",
      "complete",
      "cancel",
    ]);
  });

  it("marks consequential actions as policy and receipt gated", () => {
    for (const action of ["claim", "delegate", "handoff", "verify", "complete", "cancel"]) {
      expect(getWorkCaseAction(action)).toMatchObject({
        consequential: true,
        requiresPolicyEvaluation: true,
        requiresReceipt: true,
      });
    }
  });

  it("keeps every source-registry transition backed by a registered action", () => {
    for (const source of WORK_CASE_SOURCE_REGISTRY) {
      for (const transition of source.supportedTransitions) {
        expect(getWorkCaseAction(transition), `${source.sourceKey}:${transition}`).toBeTruthy();
      }
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/action-registry.test.ts
```

Expected: FAIL because `action-registry.ts` does not exist and source transitions do not yet include the full grammar.

- [ ] **Step 3: Implement the action registry**

Create a small registry with entries shaped like:

```ts
export interface WorkCaseActionDescriptor {
  action: WorkCaseActionVerb;
  displayLabel: string;
  a2aStatusHint?: WorkCaseA2aStatus;
  consequential: boolean;
  requiresPolicyEvaluation: boolean;
  requiresDecisionInteraction: boolean;
  requiresCoworkerEnvelope: "never" | "when-supervised" | "always";
  requiresReceipt: boolean;
  sanctionedMutators: readonly string[];
}
```

Use sanctioned mutators already present in the repo where known:

- `claim`: `claim_capsule_scope`, `update_backlog_item_status`
- `pause`: `update_work_capsule_status`, `update_backlog_item_status`
- `needs-input`: `screen_propose_action`, `WorkItemMessage` projection only
- `needs-auth`: `screen_propose_action`, authority/grant tools in a later slice
- `respond`: `WorkItemMessage` projection only
- `resume`: `update_work_capsule_status`, `update_backlog_item_status`
- `propose`: `screen_propose_action`
- `delegate`: `screen_propose_action` now, principal handoff mutator in Wave 2
- `handoff`: `screen_propose_action` now, principal handoff mutator in Wave 2
- `escalate`: `record_execution_evidence`, `DecisionInteraction`
- `verify`: `run_sandbox_tests`, `run_ux_test`, `record_capsule_evidence`
- `complete`: `update_work_capsule_status`, `update_backlog_item_status`
- `cancel`: `update_work_capsule_status`, `update_backlog_item_status`

- [ ] **Step 4: Run registry tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/action-registry.test.ts lib/work-management/source-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add apps/web/lib/work-management/action-registry.ts apps/web/lib/work-management/action-registry.test.ts apps/web/lib/work-management/source-registry.ts apps/web/lib/work-management/case-types.ts apps/web/lib/work-management/index.ts
git commit -s -m "feat: add work case action registry"
```

---

## Task 2: Policy Envelope Evaluator

**Files:**
- Create: `apps/web/lib/work-management/policy-envelope.test.ts`
- Create: `apps/web/lib/work-management/policy-envelope.ts`
- Modify: `apps/web/lib/work-management/index.ts`

- [ ] **Step 1: Write the failing policy tests**

Cover these cases:

- Allows a non-terminal, supported, low-risk action with receipt policy present.
- Denies unsupported source/action combinations.
- Denies consequential action on a terminal case.
- Denies supervised consequential action without an approved `CoworkerActionEnvelope`.
- Denies action when stop condition is already tripped.
- Denies consequential decision action when `decisionInteractionId` is missing.
- Allows observed external events but marks them `enforcementMode = "observed-event"`.

Example:

```ts
expect(evaluateWorkCasePolicy({
  caseRef: { caseId: "backlog-item:BI-1", sourceType: "backlog-item", sourceId: "BI-1" },
  action: "complete",
  currentState: { state: "active", terminal: false },
  envelope: { autonomyMode: "supervised", receiptPolicy: { required: true } },
})).toMatchObject({
  ok: false,
  reason: "missing_coworker_envelope",
});
```

- [ ] **Step 2: Run the policy tests and verify failure**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/policy-envelope.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure evaluator**

Return a discriminated union:

```ts
export type WorkCasePolicyDecision =
  | { ok: true; enforcementMode: "governed-action" | "observed-event"; requiredReceiptKind: WorkCaseReceiptKind }
  | { ok: false; reason: WorkCasePolicyDenialReason; message: string };
```

Keep the evaluator pure. It should take the current projected state from `status-projection.ts`, not query the DB.

- [ ] **Step 4: Run policy tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/policy-envelope.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add apps/web/lib/work-management/policy-envelope.ts apps/web/lib/work-management/policy-envelope.test.ts apps/web/lib/work-management/index.ts
git commit -s -m "feat: evaluate work case policy envelopes"
```

---

## Task 3: ReceiptEnvelope Normalizers

**Files:**
- Create: `apps/web/lib/work-management/receipt-envelope.test.ts`
- Create: `apps/web/lib/work-management/receipt-envelope.ts`
- Modify: `apps/web/lib/work-management/index.ts`

- [ ] **Step 1: Write failing normalizer tests**

Tests must cover:

- `fromGoldenTriangleReceipt` includes requested/actual policy and preserves the Golden Triangle summary.
- `fromToolExecutionReceipt` keeps `toolExecutionId`, `receiptKind`, `receiptStatus`, `executionStatus`, `inputFingerprint`, and `outputDigest`.
- `fromWorkCapsuleActivity`, `fromWorkItemMessage`, `fromRuntimeVerification`, `fromExternalEvidenceRecord`, `fromDecisionInteraction`, and `fromBacklogItemActivity` create source-referenced observed-event receipts.
- Governed action receipts and observed event receipts are distinguishable.

- [ ] **Step 2: Run the tests and verify failure**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/receipt-envelope.test.ts
```

Expected: FAIL because `receipt-envelope.ts` does not exist.

- [ ] **Step 3: Implement `ReceiptEnvelope`**

Use a structural type so tests can pass fixture rows without Prisma imports:

```ts
export interface ReceiptEnvelope {
  receiptId: string;
  caseRef?: WorkCaseRef;
  receiptKind: string;
  enforcementMode: "governed-action" | "observed-event";
  sourceRef: WorkCaseSourceRef;
  actionType?: WorkCaseActionVerb | string;
  status: "valid" | "invalid" | "observed" | "failed";
  summary: string;
  occurredAt: string;
  actorRef?: WorkCaseActorRef;
  inputDigest?: string;
  outputDigest?: unknown;
  policyRefs: readonly string[];
  trace?: { traceId?: string; spanId?: string; parentSpanId?: string };
  rawRef: { table: string; id: string };
}
```

Do not persist anything in this task.

- [ ] **Step 4: Run receipt tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/receipt-envelope.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add apps/web/lib/work-management/receipt-envelope.ts apps/web/lib/work-management/receipt-envelope.test.ts apps/web/lib/work-management/index.ts
git commit -s -m "feat: normalize work case receipt envelopes"
```

---

## Task 4: Receipt-Coverage Guard

**Files:**
- Create: `apps/web/lib/work-management/receipt-coverage.test.ts`
- Create: `apps/web/lib/work-management/receipt-coverage.ts`
- Modify: `apps/web/lib/work-management/index.ts`

- [ ] **Step 1: Write failing guard tests**

Required assertions:

- A consequential governed action with no receipt returns `missing_receipt`.
- A consequential governed action with only an observed-event receipt returns `receipt_not_governed`.
- A policy denial returns `policy_denied`.
- A terminal projected state returns `terminal_case_sealed`.
- A non-consequential observed source event can pass with an observed-event receipt.
- A consequential action with a passing policy decision and a governed-action receipt passes.

- [ ] **Step 2: Run the guard tests and verify failure**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/receipt-coverage.test.ts
```

Expected: FAIL because `receipt-coverage.ts` does not exist.

- [ ] **Step 3: Implement the guard**

Use a pure function:

```ts
export function assertWorkCaseReceiptCoverage(input: {
  action: WorkCaseActionDescriptor;
  policyDecision: WorkCasePolicyDecision;
  projectedState: Pick<WorkCaseStateProjection, "state" | "terminal">;
  receipt?: ReceiptEnvelope | null;
}): WorkCaseReceiptCoverageResult;
```

Do not call database code. The DB integration comes later through `governedExecuteTool`.

- [ ] **Step 4: Run guard tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/receipt-coverage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```powershell
git add apps/web/lib/work-management/receipt-coverage.ts apps/web/lib/work-management/receipt-coverage.test.ts apps/web/lib/work-management/index.ts
git commit -s -m "feat: guard work case receipt coverage"
```

---

## Task 5: OTel-Compatible Case Event Projection

**Files:**
- Create: `apps/web/lib/work-management/case-telemetry.test.ts`
- Create: `apps/web/lib/work-management/case-telemetry.ts`
- Modify: `apps/web/lib/work-management/index.ts`

- [ ] **Step 1: Write failing telemetry tests**

Assert that a `ReceiptEnvelope` projects to a stable event shape:

- `name = "work_case.action"`
- `traceId`, `spanId`, `parentSpanId` copied when present.
- Attributes include `work_case.id`, `work_case.action`, `work_case.enforcement_mode`, `work_case.receipt_kind`, `work_case.source.kind`, `work_case.source.id`, and `work_case.receipt.status`.

- [ ] **Step 2: Run the telemetry tests and verify failure**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/case-telemetry.test.ts
```

Expected: FAIL because `case-telemetry.ts` does not exist.

- [ ] **Step 3: Implement pure event projection**

Do not add an exporter in this BI. The output is a stable shape that later instrumentation can emit.

- [ ] **Step 4: Run telemetry tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/case-telemetry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

Run:

```powershell
git add apps/web/lib/work-management/case-telemetry.ts apps/web/lib/work-management/case-telemetry.test.ts apps/web/lib/work-management/index.ts
git commit -s -m "feat: project work case telemetry events"
```

---

## Task 6: Governed Execution Integration Seam

**Files:**
- Create: `apps/web/lib/work-management/work-case-governance-hook.test.ts`
- Create: `apps/web/lib/work-management/work-case-governance-hook.ts`
- Modify: `apps/web/lib/mcp-governed-execute.ts`
- Modify: `apps/web/lib/mcp-governed-execute.test.ts`
- Modify: `apps/web/lib/work-management/index.ts`

- [ ] **Step 1: Write failing hook tests**

Test the hook in isolation:

- With no `event.context.workCase`, the hook allows existing tool execution.
- With Work Case context and a policy denial, pre-tool hook returns deny.
- With Work Case context and an allowed action, pre-tool hook allows.

- [ ] **Step 2: Write failing governed-execute receipt tests**

Add to `mcp-governed-execute.test.ts`:

- Existing `query_backlog` behavior remains unchanged without Work Case context.
- A successful consequential Work Case execution with `context.workCase` creates a `ToolExecutionReceipt` row with `receiptKind = "work-case-governed-action"`.
- A failed consequential Work Case execution creates an invalid receipt or returns a coverage failure, whichever the implementation chooses; pin the chosen behavior in the test before implementing.

- [ ] **Step 3: Run the tests and verify failure**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/work-case-governance-hook.test.ts lib/mcp-governed-execute.test.ts
```

Expected: FAIL because the hook does not exist and `GovernedExecuteContext` has no Work Case context.

- [ ] **Step 4: Implement the hook and context plumbing**

Add optional context only:

```ts
export type GovernedExecuteContext = {
  // existing fields...
  workCase?: WorkCaseExecutionContext;
};
```

Do not require Work Case context for existing callers.

In `mcp-governed-execute.ts`, extend receipt derivation:

- Keep existing `run_sandbox_tests`, `run_sandbox_command`, and `run_ux_test` receipt behavior.
- If `context.workCase` is present and the action is consequential, derive `receiptKind = "work-case-governed-action"`.
- Use existing `writeReceipt` and `ToolExecutionReceipt`; `buildId` remains optional.

- [ ] **Step 5: Run integration tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/work-case-governance-hook.test.ts lib/mcp-governed-execute.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Run:

```powershell
git add apps/web/lib/work-management/work-case-governance-hook.ts apps/web/lib/work-management/work-case-governance-hook.test.ts apps/web/lib/mcp-governed-execute.ts apps/web/lib/mcp-governed-execute.test.ts apps/web/lib/work-management/index.ts
git commit -s -m "feat: wire work case governance into tool execution"
```

---

## Task 7: Architecture Grounding And Plan Evidence

**Files:**
- Modify: `apps/web/lib/work-management/architecture-grounding.ts`
- Modify: `apps/web/lib/work-management/architecture-grounding.test.ts`
- Modify: `docs/superpowers/specs/2026-06-27-work-management-architecture-design.md` only if needed

- [ ] **Step 1: Write failing architecture-grounding tests**

Add assertions that:

- `policy-envelope.ts`, `receipt-envelope.ts`, `receipt-coverage.ts`, `action-registry.ts`, `case-telemetry.ts`, and `work-case-governance-hook.ts` are allocated.
- `REQ-WC-1` and `REQ-WC-2` have implemented or partially implemented verification cases.
- The new Action elements exist for the handoff grammar actions implemented in the registry.

- [ ] **Step 2: Run the architecture tests and verify failure**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/architecture-grounding.test.ts
```

Expected: FAIL until the manifest is updated.

- [ ] **Step 3: Update architecture grounding**

Update the manifest to reflect actual implemented coverage. Do not overclaim:

- Use `implemented` only for pure guard behavior covered by tests.
- Use `partially-implemented` for governed write path until all sanctioned mutators are routed through the action wrapper.
- Keep Wave 2 identity/sponsor requirements as `planned`.

- [ ] **Step 4: Run architecture tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/architecture-grounding.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

Run:

```powershell
git add apps/web/lib/work-management/architecture-grounding.ts apps/web/lib/work-management/architecture-grounding.test.ts docs/superpowers/specs/2026-06-27-work-management-architecture-design.md
git commit -s -m "doc: ground work case enforcement architecture"
```

---

## Task 8: Full Verification And Evidence

**Files:**
- No source edits expected unless verification finds a defect.

- [ ] **Step 1: Run the full focused test suite**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/*.test.ts lib/mcp-governed-execute.test.ts lib/api/work-item-account-resolution.test.ts lib/api/work-items.test.ts lib/work-capsules.test.ts lib/work-capsules-enum-parity.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run diff whitespace check**

Run:

```powershell
git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 4: Run production build**

Run:

```powershell
pnpm --filter web build
```

Expected: PASS. Existing Turbopack warnings around Edge Runtime Node API use and NFT tracing are acceptable only if unchanged from Wave 0 and the command exits 0.

- [ ] **Step 5: Record MCP evidence**

Record evidence on `BI-D633F7AF`:

- focused test suite result
- typecheck result
- production build result
- any implementation notes about `ToolExecutionReceipt` or observed-event limitations

- [ ] **Step 6: Mark BI status**

Only mark `BI-D633F7AF` done when all verification passes and the branch has been pushed or PR opened. If PR #2484 has not merged, keep this branch pushed but do not open a main-target PR until the branch is rebased onto `main`.

---

## Rollback

- Revert the new `apps/web/lib/work-management/*` Wave 1 modules.
- Restore `mcp-governed-execute.ts` to the pre-Wave-1 context and receipt derivation behavior.
- Keep pure tests if they document existing invariants and still pass.
- No migration rollback is needed because this plan does not add database schema.

## Definition Of Done

- `BI-D633F7AF` has passing tests for action registry, policy envelope, ReceiptEnvelope, receipt coverage, telemetry projection, and governed-execute integration.
- Existing Wave 0 tests continue to pass.
- Existing account-resolution, WorkItem, WorkCapsule, and `mcp-governed-execute` behavior remains stable without `context.workCase`.
- Consequential Work Case actions cannot be considered complete without a passing policy decision and governed-action receipt in the guard.
- Governed-action receipts and observed-event receipts are distinguishable.
- `ReceiptEnvelope` demonstrably subsumes `GoldenTriangleReceipt` and `ToolExecutionReceipt`.
- EA/SysML grounding is updated without inventing new modeling tables.
- Branch is rebased onto `main` after #2484 lands, then pushed and opened as a regular ready-for-review PR only after gates are green.

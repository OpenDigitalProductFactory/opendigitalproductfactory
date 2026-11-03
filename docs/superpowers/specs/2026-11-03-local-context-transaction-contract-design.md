---
status: draft
---

# Local served-context transaction contract

**Backlog:** BI-041CD15B  
**Workroom:** WC-2BD45483  
**Branch:** `fix/local-context-transaction-contract`  
**Delivery shape:** `delivery-medium@1.0.0`  
**Purpose:** Make an operator-selected local context window one durable, observable, reversible transaction instead of three partly independent writes.

## Problem statement

DPF currently represents one local served-context decision in three places:

1. `PlatformConfig.local.servedContextTokens` is durable operator intent and the boot-reconcile target.
2. Docker Model Runner (DMR) owns the context actually served by the selected model.
3. `ModelProfile.maxContextTokens` is the routing projection used to decide whether work fits.

The interactive action and boot reconciler disagree about the same request. `applyLocalModelContext()` rejects an explicit value above the resource estimate, writes DMR, and then updates only `ModelProfile`. `resolveServedContextTarget()` deliberately honors an explicit `PlatformConfig` pin above that estimate, while `reconcileLocalModelContext()` can later reapply that pin and treats profile persistence as best effort. The action therefore does not persist the setting the reconciler owns, and a restart can restore a different value from the one the operator just selected.

This is a correctness and recovery defect, not permission to raise the live system now. The current install serves 40,960 tokens. Recent governed reviews required 51,823 and 71,658 tokens; those failures demonstrate a capacity gap but do not prove that the installed 27B model can safely serve 81,920 tokens. Its advertised 262,144-token model limit is architectural metadata, not a qualified operating point.

## Objectives

- **OBJ-ONE-DECISION:** One domain operation owns validation, runtime application, durable intent, routing projection, verification, and rollback.
- **OBJ-HONEST-BOUNDARY:** Estimated capacity, model maximum, requested context, live readback, and qualified context are distinct facts. No estimate or model-card maximum is presented as measured service.
- **OBJ-FAIL-CLOSED:** A partial write never leaves DPF claiming more context than DMR is verified to serve.
- **OBJ-RECOVERY:** A failed transaction reports its before/after/rollback facts and converges on the last verified state.
- **OBJ-OPERABILITY:** The operator can understand why a request is blocked, provisional, committed, or rolled back without interpreting raw token math.
- **OBJ-NO-AUTHORITY-DRIFT:** This work changes neither sensitivity policy, coworker floors, provider grants, routing admission, nor review deadlines.

## Non-goals

- Raising the production installation above 40,960 tokens as part of source implementation.
- Selecting or installing a smaller model.
- Treating DMR acceptance alone as quality qualification.
- Changing provider grants, sensitivity boundaries, task token envelopes, or review semantics.
- Adding a new persistence model when the existing configuration and profile records can represent the transaction.

## Evidence and benchmarking

### Repository evidence

- `applyLocalModelContext()` currently validates against an estimated ceiling, writes DMR, and then updates `ModelProfile.maxContextTokens`; it does not update `PlatformConfig.local.servedContextTokens`.
- `resolveServedContextTarget()` treats an explicit `PlatformConfig` pin above the estimate as intentional and returns it with a warning.
- `reconcileLocalModelContext()` reads DMR as runtime truth but can change DMR before a best-effort profile update, so failure can leave the routing projection stale.
- The live 40,960-token probe deferred after 30 seconds. That is evidence of an uncompleted probe, not evidence that a larger context is viable.

### External comparators

- [Docker Model Runner configuration](https://docs.docker.com/ai/model-runner/configuration/) separates the configured context from the model maximum and warns that larger context consumes more RAM/VRAM. It also provides a persistent per-model configuration command and a reset operation.
- [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) exposes context sizing as a server/load setting and reports effective allocation; its fit behavior changes with memory available at load time. DPF therefore cannot infer a stable operating point from model metadata alone.
- [LM Studio load controls](https://lmstudio.ai/docs/cli/local-models/load) pair context length with GPU offload and provide an estimate-only path. Its REST load response can echo the effective load configuration. This supports the DPF requirement to show requested, estimated, and effective values separately.

The useful pattern across these systems is staged intent followed by an observable runtime result. None makes a model's architectural maximum sufficient proof that a specific device can serve that context with acceptable latency and quality.

## Canonical state model

| Fact | Authority | Meaning |
| --- | --- | --- |
| Requested context | Transaction input | What the operator is asking DPF to attempt |
| Estimated safe ceiling | Resource policy | Conservative planning signal; never a runtime fact |
| Model maximum | Model metadata | Architectural upper bound; never a resource or quality result |
| Durable context intent | `PlatformConfig.local.servedContextTokens` | Value boot reconciliation must converge toward after a committed transaction |
| Live served context | DMR configuration readback | What the selected runtime currently reports serving |
| Routing context | `ModelProfile.maxContextTokens` | Projection of verified live service used by routing |
| Qualified context | Governed qualification evidence | Largest context proven on the exact model/runtime/hardware configuration |

The invariant is:

> Routing context must never exceed verified live served context, and durable intent must not advance until the runtime write is verified.

`PlatformConfig` remains the durable intent source, DMR remains runtime truth, and `ModelProfile` remains a derived routing projection. The transaction service owns the ordering between them.

## Transaction design

### Command

Introduce a server-only domain operation consumed by both the operator action and boot reconciliation. Its command includes model identity, requested tokens, invocation (`operator` or `reconcile`), and whether an above-estimate attempt carries the required operator confirmation. The operation returns a structured receipt rather than a boolean plus prose.

The command performs:

1. Resolve the selected model, current durable intent, live DMR configuration, affected model profiles, resource estimate, and model maximum.
2. Validate the request against the global sanity range and model maximum. A value above the resource estimate is never silently clamped.
3. For an operator invocation above the estimate, require explicit confirmation and mark the result provisional until qualification. Reconciliation may honor only a previously committed pin; it cannot invent one.
4. Capture the complete before-state needed for recovery.
5. Write the DMR context while preserving unrelated retained runner configuration.
6. Read DMR back. The write succeeds only when the selected model reports the intended effective value.
7. In one database transaction, persist the verified value as durable intent and update matching local `ModelProfile` rows to no more than that verified value.
8. Read the persisted projection and return a committed receipt.

The database transaction cannot be atomic with DMR. The saga therefore treats runtime verification as the prepare boundary and the database transaction as commit. If database commit fails after DMR changes, compensating recovery restores DMR to the captured before-state and verifies the rollback. If rollback cannot be verified, the receipt is `recovery-required`; routing is reduced to the last verified lower bound and the system must not claim success.

### Reconciliation

Boot reconciliation calls the same transaction service. It may repair a stale profile downward or upward only to verified live context. When the committed durable intent differs from runtime, it attempts that intent through the same apply/readback/commit path. It does not contain a second policy implementation.

If the current live value is larger than durable intent, reconciliation does not lower it merely to make the numbers equal. It records drift and projects the verified live value only when policy explicitly permits that value. Lowering is an explicit operator decision because it can invalidate in-flight work.

### Failure states

| State | Meaning | Routing behavior |
| --- | --- | --- |
| `blocked` | Validation or required confirmation failed before mutation | Unchanged |
| `deferred` | Runtime cannot safely apply while active; no durable change committed | Unchanged |
| `committed` | DMR readback and database commit agree | Project verified value |
| `rolled-back` | Commit failed and verified runtime rollback succeeded | Restore captured projection |
| `recovery-required` | Runtime or database compensation could not be verified | Use the lower verified bound; surface urgent operator action |

Exceptions and timeouts map to these states with bounded, sanitized reasons. An unknown readback never becomes success.

## Operator experience

The existing Platform > AI control remains the destination. The interaction must reduce the decision to four visible facts:

- **Serving now:** verified DMR readback.
- **Requested:** pending operator input.
- **Estimated for this hardware:** a planning signal, clearly labelled as an estimate.
- **Qualified here:** the largest value backed by a completed qualification, or “Not yet qualified.”

Below the estimate, the primary action is **Apply context**. Above the estimate but within the model maximum, the action becomes **Attempt provisional context** and requires a concise confirmation that it may offload, slow down, time out, or fail. The UI never describes the value as safe merely because DMR accepted the write.

After submission, show one outcome sentence first, followed by progressive details containing transaction ID, before/live/committed values, affected model, and rollback status. `recovery-required` receives an urgent banner and a single recovery action; raw stack traces and internal configuration names stay in technical details.

The form must not allow a second mutation while one is active. It must preserve entered values on a blocked attempt and announce status changes to assistive technology. Numeric values use locale formatting plus compact equivalents where space is constrained; color is never the only state cue.

## Qualification contract

81,920 tokens is the smallest 8,192-token increment above the observed 71,658-token requirement. It is a candidate qualification target, not a default. Any live qualification is separate, explicitly authorized work and must:

1. Capture exact model digest, DMR/llama.cpp version, hardware, offload settings, current context, and rollback target (40,960).
2. Estimate memory before mutation and ensure an operator-approved recovery window.
3. Apply through the transaction API and verify live readback.
4. Complete two bounded representative calls within their existing deadlines, recording time-to-first-token, generation rate, RAM/VRAM pressure, OOM/thrash, and final-response completeness.
5. Complete an authorized semantic-review quality check. Transport success is not review acceptance.
6. Roll back to 40,960 on resource instability, deadline failure, incomplete output, or quality regression, and verify all three state holders converge.

A smaller model remains a separately evaluated fallback. Its theoretical resource estimate is not a substitute for model-quality and tool-fidelity evidence.

## Acceptance criteria

| ID | Requirement |
| --- | --- |
| AC-ONE-POLICY | Operator mutation and boot reconciliation call one transaction service; no contradictory above-estimate rules remain. |
| AC-ORDER | Tests prove durable intent and routing projection do not advance before successful DMR readback. |
| AC-COMMIT | A successful operation leaves PlatformConfig, DMR readback, and all matching local ModelProfile rows at the verified value. |
| AC-ROLLBACK | Each failure boundary has a deterministic test proving restoration or `recovery-required` with a conservative routing projection. |
| AC-RECONCILE | Restart/reconcile preserves a committed operator choice and repairs drift without inventing or silently clamping intent. |
| AC-DIAGNOSTICS | The receipt and operator view distinguish requested, estimated, model maximum, live, committed, qualified, and rollback values. |
| AC-AUTHORITY | Existing `manage_providers` authorization remains required and no sensitivity, grant, floor, routing-admission, or deadline policy changes. |
| AC-QUALIFICATION | No source test or DMR write is represented as live capacity or semantic-review qualification. |
| AC-UX | Desktop and narrow layouts, keyboard flow, focus, announcements, contrast, error recovery, and progressive disclosure receive an independent UX-fit review. |

## Refactoring allocation

Approximately 20% of implementation effort is reserved for architecture cleanup in the touched surface:

- extract one pure policy evaluator for bounds, estimate/maximum distinctions, confirmation, and diagnostics;
- extract one transaction coordinator used by action and reconciler;
- replace duplicated best-effort profile writes with one projection helper and explicit outcome;
- centralize structured receipt and rollback types;
- delete contradictory comments and policy branches after parity tests are green.

This allocation is bounded to the served-context path. It must not become a general inference-management rewrite.

## Verification and rollback

Implementation starts with failing unit tests for every transaction boundary, then focused action/reconcile tests, typecheck, affected graph tests, and repository guards. This source-only worktree cannot claim local runtime or production qualification. Exact-head CI, independent semantic review, UX-fit review for any changed surface, protected merge, deployment, and post-deploy verification remain required.

The source rollback is a DCO revert through the normal merge path. Runtime rollback uses the same transaction operation with the last verified context, never a direct database edit. Preserve all receipts and failed-attempt evidence.


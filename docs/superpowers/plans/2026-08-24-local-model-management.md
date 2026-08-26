---
status: active
---

# Local model management implementation plan

**Backlog item:** BI-1FFDF4B1  
**Design:** `docs/superpowers/specs/2026-08-24-local-model-management-design.md`  
**Workroom:** WC-6AF865F3  
**Branch:** `fix/local-model-ux`

## Outcome

The existing local-provider route becomes an honest, fully in-product control surface: cloud-only questions disappear, installed storage comes from native runtime metadata, and authorized operators install or remove models without a terminal. Long installs run durably and automatically reconcile routing state.

## Backlog coverage

- Decision: atomic
- Parent: `BI-1FFDF4B1`
- D1 native DMR inventory/mutation adapter -> `BI-1FFDF4B1`
- D2 durable model-install operation -> `BI-1FFDF4B1`
- D3 local-tailored provider UX -> `BI-1FFDF4B1`
- D4 measured verification and generated projections -> `BI-1FFDF4B1`
- D5 governed 27B reviewer runtime and diagnostics -> `BI-1FFDF4B1`
- Dependencies: none
- Receipt: `cmt6julqc01vl01mxqlrsaz15`
- Rationale: Native management, durable execution, the tailored operator surface, and routing reconciliation are one end-to-end correction; no phase is independently useful or safe to ship.

This plan is **atomic** under BI-1FFDF4B1. The four implementation phases are not independently shippable:

- Native mutations without the tailored UI would leave the user-facing defect intact.
- UI controls without the durable adapter would expose unsafe or nonfunctional actions.
- Accurate inventory without install/remove would still violate the in-product management requirement.
- Routing reconciliation without the mutation workflow has no useful user outcome.

All phases therefore ship and verify as one cohesive behavior slice.

| Key | Deliverable | Requirements | Contracts | Flow | Verification | Depends on |
|---|---|---|---|---|---|---|
| D1 | Native DMR inventory/mutation adapter | R2, R3, R6, R9, R10 | C1 runtime authority; C2 validated management root | F1 read; F3 remove | V1 adapter/action tests | — |
| D2 | Durable model-install operation | R4, R5, R8, R10, R11 | C3 manual-job receipt; C4 queue execution | F2 install | V2 queue/action tests | D1 |
| D3 | Local-tailored provider UX | R1, R3, R4, R6, R7, R9, R11 | C5 locality composition; C6 honest view model | F1–F3 | V3 component/route tests | D1, D2 |
| D4 | Measured verification and generated projections | R8, R12, R13 | C7 UX-fit and route projection | F4 verification | V4 guards/live sweep | D1, D2, D3 |
| D5 | Governed 27B reviewer runtime and diagnostics | R14–R16 | C8 policy separation; C9 timeout resolver | Existing chat dispatch and status read flows | V5 reviewer runtime tests | D1, D3 |

Contract, flow, and verification identifiers refer to the matching sections in the design document.

### Coverage receipt status

The deliverable table above is the four-way traceability record for this atomic plan. `record_plan_backlog_coverage` could not issue a green receipt because BI-1FFDF4B1 has no `initiative_scope_baseline`, and that baseline is not reachable from an external MCP session. The receipt above is the recorded failed attempt, not coverage approval. The governance-tooling gap is tracked by `BI-91AF30A5`. Implementation proceeds under the filed delivery BI, claimed Workroom scope, immutable plan commit, and this explicit blocked-receipt evidence.

## Phase 1 — Red tests and native adapter

1. Add failing tests for native `/models` mapping using the two observed live payloads. Assert non-zero byte values, human display values, digest/parameter/quantization preservation, and `null` for missing/unparseable size. **[D1, R2, R3, V1]**
2. Add failing validation and HTTP-contract cases: reject URLs/traversal/whitespace/oversized input; assert `POST /models/create` body; assert encoded namespaced delete path; classify `404` as idempotent success and unsupported endpoints separately. **[D1, R6, R9, R10, V1]**
3. Implement a server-only `local-model-management` adapter using `getOllamaApiRoot`, injected `fetch` for tests, bounded upstream errors, IEC-size parsing, alias comparison, and streaming progress parsing. **[D1, C1, C2, F1, F3]**
4. Refactor `ollama-management` actions around the adapter while preserving the existing permission gate. Keep reads side-effect free and make remove return mutation plus reconciliation outcome. **[D1, R6, R8, R10]**

## Phase 2 — Durable install workflow

1. Add failing action and queue tests for authorization, deterministic operation admission, duplicate active install, dispatch failure, lifecycle transitions, progress updates, success, runtime failure, and reconciliation failure. **[D2, R4, R5, R8, R10, V2]**
2. Add the typed `inference/local-model.install` event and register a concurrency-one Inngest function. Pass the quiescence entry gate and execute the DMR pull in a durable step. **[D2, C4, F2]**
3. Persist a deterministic manual `ScheduledJob` receipt for each validated model reference. Store queued/running/completed/failed state and bounded progress metadata; prevent duplicate active work. **[D2, C3, F2]**
4. Emit a typed local-model invalidation event at lifecycle boundaries and add an authenticated narrow status route returning runtime inventory plus install operations. Bound terminal receipts to the 100 most recent rows and return RFC 9457 Problem Details on failure. **[D2, R5, R11, R13]**
5. Reconcile existing discovery/profile projections after a successful pull. Report mutation success separately if routing reconciliation needs attention. **[D2, R8]**

## Phase 3 — UX tailoring and component refactor

1. Add failing coverage that local/ollama provider details omit `ProviderAccountPostureForm` while cloud provider details retain it, using the canonical locality primitive. **[D3, R1, V3]**
2. Add failing component cases for honest per-model/aggregate disk values, unavailable/partial totals, Install controls, confirmed Remove, embedding and generation consequences, active progress, permission-disabled state, legacy-management state, and absence of terminal/script/clipboard copy. **[D3, R3, R4, R6, R7, R9, R11, V3]**
3. Split the 795-line management component into a small orchestrator plus focused inventory, catalog, confirmation, status, and view-model modules under `components/platform/local-models`. Reuse DPF tokens and shared busy/status primitives; do not add hardcoded colors. **[D3, C5, C6]**
4. Observe the status route through `useBackgroundOperationObserver`. System events invalidate the projection; bounded visibility-aware polling runs only while an install is active and push is unavailable. Refresh the screen automatically on terminal state. **[D3, R5, R8, R11]**
5. Keep custom references behind an Advanced disclosure with direct Install and clear validation help. Remove all generated CLI commands, copy state, and terminal recovery copy. **[D3, R4, R9]**

## Phase 4 — Verification, projections, and handoff

1. Run focused tests after each green step, then exhaustive colocated/provider/routing/event/queue tests because the code graph is unavailable. **[D4, V1–V3]**
2. Regenerate route manifest, route audience, route shells, page purpose, and doc index companions required by the claimed status route; update the eligible-route count only if the generator changes it. **[D4, C7]**
3. Run prose-lint and style-drift guards, typecheck, the affected web test suite, and `pnpm run pregate:preflight`. **[D4, V4]**
4. Acquire the governed shared nonproduction environment, verify the actual route in dark/light at desktop/narrow sizes, and exercise one small reversible install/remove path if the runtime supports it. Capture DOM/state assertions as well as screenshots. **[D4, R12, V4]**
5. Write `docs/ux-fit/2026-08-24-local-model-management.ux-fit.json` with `sweep-measurement` evidence for the exact UI diff and route budget axes. **[D4, R12, C7]**
6. Run exact-tree local merged-code CI, independent semantic review, DCO commit/PR gates, record Workroom/external evidence, and hand off a regular ready PR. **[D4, V4]**

## Phase 5 — Governed reviewer runtime correction

1. Add failing tests for the governed 27B identity, unset/default and explicit 600,000 ms timeout behavior, the 600,000 ms upper bound, and a response that remains live beyond the former 120-second abort. **[D5, R14, R15, V5]**
2. Add one pure reviewer-runtime policy consumed by chat dispatch and diagnostics. Keep PR #4624's installer tiers unchanged: initial host selection and high-trust review are separate decisions. **[D5, C8, C9]**
3. Remove the catalog's generic 8B recommendation and label Qwen3.8 27B as the high-trust reviewer without changing its explicit-install workflow. **[D5, R14]**
4. Extend the authenticated local-model status projection with the effective reviewer timeout and DMR-backed served-context facts. Do not expose raw environment values or cross into BI-F0715C9C's readiness envelope. **[D5, R16]**
5. Run the focused runtime, catalog, route, component, and full chat-adapter suites before the repository guards and exact-tree gate. **[D5, V5]**

## Refactor allocation

Roughly one fifth of the implementation effort is reserved for shrinking `OllamaManagement.tsx`, centralizing model-reference/size logic, and deleting clipboard/CLI state. This is bounded refactoring in the touched surface; it does not expand into unrelated provider architecture.

## Stop conditions

- If the live DMR native contract differs from the documented/tested contract, stop and revise the adapter/spec rather than adding shell execution.
- If `ScheduledJob` cannot carry deterministic manual-operation state without violating its existing contract, stop and return to design review; do not add a schema model during implementation without updating BI scope.
- If routing reconciliation would retire a still-installed alias incorrectly, stop and fix alias canonicalization before enabling Remove.
- If a shared nonproduction environment cannot be leased, record the blocker and do not claim live UX verification.

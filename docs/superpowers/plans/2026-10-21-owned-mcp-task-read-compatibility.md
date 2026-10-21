# Bounded owned MCP task reader — implementation plan

**Backlog:** BI-CAP-21C511CA. **Workroom:** WC-0750EFD3. **Profile:** feature, unchanged.
**Design:** [MCP Tasks convergence §8](../specs/2026-08-06-mcp-standard-tasks-lifecycle-convergence-design.md#8-bounded-owned-task-reader-compatibility--bi-cap-21c511ca).
**Decision:** DI-8C5F6DC67C1D selects the same-origin named reader.
**State:** design/planning only; no implementation permission or passing review is asserted.

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus this plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Delivery and coverage

One independently shippable deliverable implements the bounded named compatibility reader. Identity admission, stable projection, result budgeting and its named tool must ship together: publishing the tool before isolation is unsafe, and admission/budget helpers without the tool cannot satisfy the connector observation outcome. This is an atomic proposal mapped to the existing BI; no new BI is proposed.

| Deliverable | Live BI | Objectives | Acceptance | Contract | Flow | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| owned-task-read-compatibility | BI-CAP-21C511CA | OBJ-OWNED-READ, OBJ-READ-ISOLATION, OBJ-RESULT-TRUTH, OBJ-READ-ONLY, OBJ-LIVE-OBSERVATION | AC-OWNED-01 through AC-OWNED-10 | CT-OWNED-TASK-READ | FLOW-OWNED-TASK-OBSERVE | VERIFY-OWNED-TASK-READ |

## Backlog coverage

Initial atomic coverage receipt `cmvi8njre3k2b01lfr886ms0q` binds this plan at commit `046774b6906b7b05ba74c665356361fc5364abff`, blob `fbdceeba23ce7bd949d6e227f0345e6f7b70d641`, to parent BI-CAP-21C511CA and its independently approved scope. Every phase is internal sequencing for that one BI; there are no independent child mappings or dependencies. In the receipt, `requirementRefs` are the five `OBJ-*` IDs above, `verificationRefs` are AC-OWNED-01 through AC-OWNED-10, and the contract/flow refs are CT-OWNED-TASK-READ and FLOW-OWNED-TASK-OBSERVE. The whole BI is the single shippable delivery; none of its phases is independently shippable.

This pointer records the initial receipt, not validity for later bytes. Refresh provider-verified coverage for the current published plan and Workroom head after this edit; the latest live receipt is authoritative. Claim/read readiness again after each material artifact change; retain refused decisions and follow the exact current recovery packet. Independent plan approval remains pending.

## Phase 0 — design, evidence and readiness

1. Preserve feature classification and claim the actual source session/worktree; no invented executor identity, scope override or reclassification. WC-0750EFD3 is bound to `codex/owned-task-readback`, actual session `01a151a4-49f5-7f82-8aa5-c76a705a0c58`, base `b60d00114fd5be80118140077137a23a8e3491ec`.
2. Record bounded reproduction/research against served `95d3972ac897c3c45c9ffedad0d3b6396bf9e261`, canonical lifecycle/identity source and the primary comparisons in the design. The accepted handoff report is evidence of an observation gap, not an observed task result or proof of settlement. Preserve the separately denied portal conversation reads.
3. Publish DCO-signed design and plan bytes, record current source evidence, and obtain server-issued independent design/spec/architecture and plan routes. Submit only an issued, currently authorized packet. An unavailable request grant or approval boundary stops dispatch; client critique is not the native receipt.
4. Record valid atomic plan coverage after its real prerequisites pass. Consume current readiness and the current production-path impact contract before any production edit. The current docs-only contract has no testImpact/guardObligation; its derived doc-index check does not cover future runtime edits.

Stop this phase at any unmet gate. Record the exact blocker and next responsible action. Do not implement while research, scope baseline, spec approval, architecture review, plan coverage/review or traceability remains unmet.

## Phase 1 — RED contract and security cases

After implementation readiness is actually allowed, claim the exact edit paths and resolve their returned test impact. Proposed production seams are the existing work-thread pack, a narrow task-read compatibility leaf, the existing lifecycle owner's snapshot/projection seam, and the existing tool-to-grant mapping. No route, schema, seed, task execution or portal content change is planned. Add the affected authorization runbook in the same delivery.

Before production changes, capture meaningful RED for:

| Verification case | Acceptance | Required observable behavior |
| --- | --- | --- |
| VERIFY-INPUT | AC-OWNED-01 | Exact bounded ID and closed status/result modes; blank/nonstring/oversize IDs, unknown keys/methods and forged identity arguments refuse before projection. |
| VERIFY-IDENTITY | AC-OWNED-02, AC-OWNED-03 | Current valid same-user/same-canonical-assistant/same-namespace reads; refresh within the same family succeeds. Other user, assistant or family; revoked current connection; missing token/origin/actor and unsupported credential sources reveal no task content. |
| VERIFY-ORIGIN | AC-OWNED-05 | External-MCP deterministic identity and saved request agree. Native semantic review's exact artifact/request/task/OAuth actor and current paired human/assistant content access to its bound Workroom agree. Include a valid native case; missing/revoked native room access, malformed proof or a Build Studio/session origin carrying copied OAuth references reveals no status/result/receipt/recovery details. Target executor cannot impersonate origin. |
| VERIFY-SNAPSHOT | AC-OWNED-04 | Mutate ownership, family, origin actor, request, artifact checkpoint, current token authority or initiative/native room admission during collection; the final fence discards the result without leaked content or a read-write retry. |
| VERIFY-SPECIALIZED | AC-OWNED-06 | Initiative actor/scope/room loss refuses in status and result; durable operation/task binding mismatch refuses; specialized unknown/refusal never becomes raw progress. |
| VERIFY-STATES | AC-OWNED-07 | Submitted/working, approval/input wait, completed, failed, cancelled/rejected and genuine receipt outcomes retain the canonical mapping, terminality and error semantics. Uncertainty remains explicit. |
| VERIFY-BUDGET | AC-OWNED-07 | Huge/control-character/lone-surrogate summary/error/history fixtures remain bounded after actual serialization. Status, isError, uncertainty, wait/retry facts survive. Truncation flags/hash/original sizes are truthful; impossible mandatory envelopes explicitly refuse. |
| VERIFY-NONMUTATION | AC-OWNED-08, AC-OWNED-09 | No dispatch, polling loop, cancellation, replay, healing or grant call; repeated input-required reads never cancel. No added task enumeration, ordinary portal conversation/history or broad message/ToolExecution joins; exact origin-artifact and existing authorized specialized reads remain. Current read access suffices after submission-only thread_write is removed. Feature flag off refuses before the helper. |
| VERIFY-COMPAT | AC-OWNED-09 | Existing protocol lifecycle and specialized-reader tests retain established behavior; registration/read-only annotations and existing read-grant mapping agree. |

Use focused tests at the actual seams, not mirrored implementation tests. Record the observed RED count/output and exact source head in the Workroom. No claim about unrun cases is permitted.

## Phase 2 — implementation and GREEN

1. Implement `get_mcp_task` as an immediate named read in the existing work-thread pack, using existing `agent_control_read` and current read-capable connector context without provisioning grants. Keep a closed exact-ID/status/result contract and no task enumeration.
2. Centralize trusted-context admission using existing OAuth namespace and canonical assistant identity. For native semantic reviews also require current paired content admission to the exact packet-bound canonical Workroom. Project a consistent exact row/artifact snapshot and require a final complete identity/artifact/current-authority fence on every branch, or an equivalent atomic lock/version guarantee; discard on drift. Do not reuse an execution-authority guard for receipt reading.
3. Reuse canonical state/result/error owners and preserve their specialized guards, including initiative admission for status. Do not fork TaskRun semantics or return raw progress after a denied specialized read.
4. Apply a typed nonblocking compatibility envelope with a closed per-subtype output allowlist, mandatory outcome facts and explicit text budgets/hash/truncation metadata. Exclude arbitrary progress objects, saved request/prompts, artifact packets and raw authority metadata even when embedded in otherwise authorized results. Preserve the existing masking/untrusted-content path. Document the distinction from the protocol's exact blocking result.
5. Run the affected suites and both applicable package typechecks when compile-ready; run every returned guard obligation. The initial authoring worktree is source-only (`node_modules` and generated client missing), so no local test/typecheck pass is currently claimed. Provision only through managed dependency bootstrap or use the governed shared gate as the normal procedure requires.

## Phase 3 — publication and actual acceptance

Run the normal exact-tree preflight/shared local-CI gate and required committed semantic review. Keep a genuine inconclusive review inconclusive. Push DCO commits through normal gates, open a regular PR only when ready, resolve real findings, use the protected merge queue and mechanically verify PR health. Deploy only through the governed self-upgrade path.

For VERIFY-OWNED-TASK-READ / AC-OWNED-10, confirm exact served bytes and use the same original connector to read the already-accepted reconciliation TaskRun and an already-required native semantic-review TaskRun with provable origin/current room admission (for example this delivery's required review, if it satisfies those facts). Do not create a demonstration handoff/review, repeat the AI Ops request, change grants, or invoke a provider to manufacture acceptance. Record actual status/result or the exact bounded refusal. A valid native case must be demonstrated; returning unavailable for every native task is incomplete delivery. Separately confirm a foreign-context negative fixture through the governed verification environment, not another person's live task. If a historical task lacks proof required by admission, keep it unavailable and report that limit; do not backfill authority.

The parent coordinator's original desktop connector performs the real accepted-handoff read. The source worker and headless gate credentials cannot substitute for that connection, even when they represent the same human. The named reader's successful delivery does not settle the original portal execution, complete its useful-task acceptance, or authorize an application retry. Those require their own authoritative reconciliation evidence.

## Risks, stop conditions and rollback

Stop for incomplete origin identity, authorization/room refusal, source drift, unresolved independent review, missing coverage, or an incompatible result that cannot preserve mandatory outcome facts. Do not route around any condition via another actor, raw transport, alternate credentials or conversation access. Preserve completed evidence and immutable task lineage.

The single delivery can be reverted or the named compatibility read disabled without changing TaskRun records, standard Tasks methods, grants or execution. Keep all delivered and unrun verification claims separately attributable.

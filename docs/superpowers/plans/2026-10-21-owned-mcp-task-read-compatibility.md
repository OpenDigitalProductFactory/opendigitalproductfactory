---
status: active
---

# Bounded owned MCP task reader — implementation plan

**Backlog:** BI-CAP-21C511CA. **Workroom:** WC-0750EFD3. **Shape:** Large; funding purpose shared-platform, classification refactor.
**Design:** [MCP Tasks convergence §8](../specs/2026-08-06-mcp-standard-tasks-lifecycle-convergence-design.md#8-bounded-owned-task-reader-compatibility--bi-cap-21c511ca).
**Decision:** DI-8C5F6DC67C1D selects the same-origin named reader.
**State:** author plan amendment only. Current specification approval is recorded below; full-scope architecture acceptance, current plan coverage/review and implementation admission remain unresolved.

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus this plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Delivery and coverage

One atomic deliverable implements the bounded named compatibility reader and approved checkpoint-proof observation. Identity admission, stable projection, result budgeting and its named tool must ship together: publishing the tool before isolation is unsafe, and admission/budget helpers without the tool cannot satisfy the connector observation outcome. This is an atomic proposal mapped to the existing BI; no new BI is proposed.

| Deliverable | Live BI | Objectives | Acceptance | Contract | Flow | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| owned-task-read-compatibility | BI-CAP-21C511CA | OBJ-OWNED-READ, OBJ-READ-ISOLATION, OBJ-RESULT-TRUTH, OBJ-READ-ONLY, OBJ-LIVE-OBSERVATION, OBJ-PROOF | AC-OWNED-01 through AC-OWNED-10; AC-P1 through AC-P6 | CT-OWNED-TASK-READ | FLOW-OWNED-TASK-OBSERVE | VERIFY-OWNED-TASK-READ |

## Backlog coverage

Initial atomic coverage receipt `cmvi8njre3k2b01lfr886ms0q` binds this plan at commit `046774b6906b7b05ba74c665356361fc5364abff`, blob `fbdceeba23ce7bd949d6e227f0345e6f7b70d641`, to parent BI-CAP-21C511CA and its independently approved scope. Every phase is internal sequencing for that one BI; there are no independent child mappings or dependencies. In the receipt, `requirementRefs` are the five `OBJ-*` IDs above, `verificationRefs` are AC-OWNED-01 through AC-OWNED-10, and the contract/flow refs are CT-OWNED-TASK-READ and FLOW-OWNED-TASK-OBSERVE. The whole BI is the single shippable delivery; none of its phases is independently shippable.

This pointer records the initial receipt, not validity for later bytes. Refresh provider-verified coverage for the current published plan and Workroom head after this edit; the latest live receipt is authoritative. Claim/read readiness again after each material artifact change; retain refused decisions and follow the exact current recovery packet. Independent plan approval remains pending.

## Phase 0 — design, evidence and readiness

1. Preserve the recorded delivery profile and funding classification and claim the actual source session/worktree; no invented executor identity, scope override or reclassification. WC-0750EFD3 is bound to `codex/owned-task-readback`, actual session `01a15000-aaba-7fa0-89d9-56411dbd6a22`, base `6d1ce4762307ded266a732076edbe1a99f9518a7`.
2. Refresh bounded reproduction/research against verified current served bytes; `95d3972ac897c3c45c9ffedad0d3b6396bf9e261` is historical evidence only. Recheck canonical lifecycle/identity source and the primary comparisons in the design. The accepted handoff report is evidence of an observation gap, not an observed task result or proof of settlement. Preserve the separately denied portal conversation reads.
3. Publish DCO-signed design and plan bytes, record current source evidence, and obtain server-issued independent design/spec/architecture and plan routes. Submit only an issued, currently authorized packet. An unavailable request grant or approval boundary stops dispatch; client critique is not the native receipt.
4. Record valid atomic plan coverage after its real prerequisites pass. Consume current readiness and the current production-path impact contract before any production edit. Consume the refreshed impact obligations below; earlier docs-only advice does not cover runtime edits.

Stop this phase at any unmet gate. Record the exact blocker and next responsible action. Do not implement while research, scope baseline, spec approval, architecture review, plan coverage/review or traceability remains unmet.

## Phase 1 — RED contract and security cases

After implementation readiness is actually allowed, claim the exact edit paths and resolve their returned test impact. Proposed production seams are the existing work-thread pack, a narrow task-read compatibility leaf, the existing lifecycle owner's snapshot/projection seam, and the existing tool-to-grant mapping. No route, schema, seed, task execution or portal content change is planned. The authorization runbook is currently owned by C51/WC-1D5431B1 after ordered handoff; coordinate any required correction and do not edit it without normal reacquisition.

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

Run the normal exact-tree preflight/shared local-CI gate and required committed semantic review. Keep a genuine inconclusive review inconclusive. Use `pnpm land` for gated publication, PR creation and protected queue integration under the current rulebook; do not chain those operations manually. Resolve real findings and mechanically verify PR health. Deploy only through the governed self-upgrade path.

For VERIFY-OWNED-TASK-READ / AC-OWNED-10, confirm exact served bytes and use the same original connector to read the already-accepted reconciliation TaskRun and an already-required native semantic-review TaskRun with provable origin/current room admission (for example this delivery's required review, if it satisfies those facts). Do not create a demonstration handoff/review, repeat the AI Ops request, change grants, or invoke a provider to manufacture acceptance. Record actual status/result or the exact bounded refusal. A valid native case must be demonstrated; returning unavailable for every native task is incomplete delivery. Separately confirm a foreign-context negative fixture through the governed verification environment, not another person's live task. If a historical task lacks proof required by admission, keep it unavailable and report that limit; do not backfill authority.

The parent coordinator's original desktop connector performs the real accepted-handoff read. The source worker and headless gate credentials cannot substitute for that connection, even when they represent the same human. The named reader's successful delivery does not settle the original portal execution, complete its useful-task acceptance, or authorize an application retry. Those require their own authoritative reconciliation evidence.

## Risks, stop conditions and rollback

Stop for incomplete origin identity, authorization/room refusal, source drift, unresolved independent review, missing coverage, or an incompatible result that cannot preserve mandatory outcome facts. Do not route around any condition via another actor, raw transport, alternate credentials or conversation access. Preserve completed evidence and immutable task lineage.

The single delivery can be reverted or the named compatibility read disabled without changing TaskRun records, standard Tasks methods, grants or execution. Keep all delivered and unrun verification claims separately attributable.


## Approved checkpoint-proof scope — author amendment, 2026-11-13

The canonical design remains MCP Tasks convergence §9. At source
`ff103dc0b15c05254238ce2900f70e7e61246571`, blob
`d050b73dfab4900bc9d8e865b56205b756379d1f`, specification receipt
`initiative-review-v1-832620afe50895e5bf360c56a2396cc0c63fc00a76b9b23fcd3139621b31cd67`
established `baseline-5b45b002-b008-4e43-a0f7-0ed30d3bae2b`, including OBJ-PROOF
and AC-P1–AC-P6. The historical baseline and original coverage above remain
historical, not current coverage for this amendment.

Architecture receipt
`initiative-review-v1-2b1f888f8bf30cf9152b202ffa8490c747ec65fed10030940670f658dc32c191`
reports PASS but explicitly excludes §9 as unapproved. Whole-scope architecture
acceptance is therefore unverified. The issuer returned no correction route.
Keep the hold until the existing review coordinator resolves this mismatch
through a supported procedure. Do not rewrite immutable receipts, remove the
historical source annotation merely to trigger review, or submit a substitute
assessment. This plan is not implementation admission.

**OBJ-PROOF:** An admitted owner can distinguish positive canonical checkpoint
proof from incomplete observation without acquiring execution authority.

Extend the same atomic deliverable and BI with these verification references.
Its contract remains CT-OWNED-TASK-READ and flow FLOW-OWNED-TASK-OBSERVE; the added
observation is existing `get_workroom` recovery detail, not broader named-reader
origin support. Neither predicates alone nor a projection without current
admission and complete-set verification satisfies the outcome. There are no new
independently shippable children. Current immutable plan coverage must map all
six objectives, all ten AC-OWNED criteria and all six AC-P criteria before code.
The initial receipt cannot be reused as approval of these changed plan bytes.

| Reference | Required acceptance and verification phase |
| --- | --- |
| AC-P1 | A six-node final-verdict fixture passes the actual final-set predicate and the bounded projection reports that result. Phase 1 RED and Phase 2 GREEN. |
| AC-P2 | A complete six-node mixture of preserved PASS and typed predispatch capacity deferrals passes the canonical capacity predicate with every expected branch covered. Phase 1 RED and Phase 2 GREEN. |
| AC-P3 | Missing, failed, running, unknown, duplicate, foreign, wrong-digest, wrong-agent, wrong-generation and wrong-attempt cases never yield positive complete-set proof. Phase 1 adversarial fixtures and Phase 2 GREEN. |
| AC-P4 | Truncation, unavailable immutable request and denied or unavailable current authority suppress positive proof; foreign callers cause zero protected detail reads. Phase 1 instrumented query assertions and Phase 2 GREEN. |
| AC-P5 | Serialized output obeys a closed allowlist; projection alone never makes health, budget, retry or historical outcomes affirmative. Phase 1 serialization/nonmutation assertions and Phase 2 GREEN. |
| AC-P6 | An authorized served read agrees with canonical verification of its exact admitted source records, or explicitly reports unavailable; fixtures never stand in for historical settlement. Phase 3 served acceptance. |

### Phase 0 additions — grounded source and exact coverage

Read at the frozen source above: `apps/web/lib/change-review/semantic-review-recovery-readback.ts`
selects bounded output snapshots without request contracts; its remediation
coverage is a different fact from checkpoint completeness.
`semantic-review-capacity-recovery.ts` in that directory exports
`hasFinalReviewCheckpointSet` and `hasProvenCapacityCheckpointSet`, sharing
complete-set validation. It verifies expected agent/task/digest/attempt coverage,
excludes superseded nodes and checks typed predispatch deferral generations.
`semantic-change-review.ts` owns `restoreSemanticReviewCheckpoint`;
`semantic-review-remediation.ts` owns `readSemanticReviewRemediation`.
Reuse these owners, not a client-side reimplementation. Revalidate contracts at
the actual admitted implementation head before coding.

Obtain normal path claims for any added recovery-readback implementation/test
paths before editing them. The existing plan claim alone grants no code scope.
Refresh research, publish immutable plan bytes through normal gates, then record
atomic coverage against the actual current baseline and provider-verified plan
commit/blob. Obtain the normal independent plan route only after valid coverage.
No new review dispatch is implied by this author amendment.

### Phase 1 additions — complete proof and disclosure RED

Extend `apps/web/lib/change-review/semantic-review-recovery-readback.test.ts`
and `semantic-review-capacity-recovery.test.ts` only after admission and claims.
Use actual canonical predicates in positive six-node fixtures; six is a test
size, not a production roster. Expected specialists, digest, generation and
attempt come from verified original request/state, never caller reconstruction.
Assert every AC-P3 negative independently, including mixed-generation and
superseded-node behavior prescribed by the current canonical predicate.
Empty unresolved lists, completed status, parsed verdicts and partial PASS sets
must not establish complete proof. Add node-limit, serialized-byte-limit,
immutable-request-unavailable and current-authority-denied/unavailable tests.
Instrument foreign caller tests to prove zero protected detail queries. Change
authority or source during collection and prove the final fence suppresses proof.
Record actual failing results; do not label absent or unrun tests RED.

### Phase 2 additions — bounded canonical projection and GREEN

In `apps/web/lib/change-review/semantic-review-recovery-readback.ts`, collect
request contracts only server-side after existing owner, immutable-request and
current Workroom admission. Bind all detail reads to the admitted task/owner.
Invoke the canonical complete-set predicates with verified original inputs;
return only fixed coverage/final-proof/capacity-proof facts and explicit
unknown/unavailable reasons. Node or byte truncation fails closed. Apply the
final identity/source/current-authority fence before returning positive proof.
Never serialize contracts, prompts, credentials, raw provider output or arbitrary
diagnostics. Keep health remediation on `readSemanticReviewRemediation`, separate
from checkpoint proof. Keep `retryAuthorized: false`; no execution, replay,
health, budget or external-child settlement follows from this projection.

Run affected readback, capacity, semantic-change-review and remediation tests,
plus graph-linked tests and applicable package typechecks. If current canonical
predicates cannot meet an approved case, stop and reconcile that contract through
the existing design/owner; do not silently weaken the criterion or fork logic.

### Current impact obligations and publication evidence

The refreshed plan claim requires related-test resolution before RED for
`apps/web/lib/mcp/owned-task-read-origin.ts`, `owned-task-read-projection.ts`,
`owned-task-read.ts`, `packs/work-thread-pack.ts`, `tasks-lifecycle.ts` and
`apps/web/lib/tak/agent-grants.ts`. Refresh this advice for newly claimed paths;
missing/stale advice expands to exhaustive verification. Exercise the Style
Drift Guard (`node scripts/check-style-drift.mjs`), exact-tree preflight/shared
gate and required review. Respect generated capability completeness and doc-index
checks; obtain normal claims before any generated writes. Keep new leaf modules
under the applicable cap and do not grow the baselined grants module.

Resolve pending documentation impact for
`docs/architecture/2026-06-09-long-running-agentic-process-architecture.md`,
`docs/architecture/agent-standards-dpf-conformance.md` and
`docs/architecture/contributor-procedure-runbook.md` through actual updates or
supported not-affected dispositions. Include design-grounding evidence. These
are obligations for the eventual source delivery, not checks passed by this plan.

### Phase 3 additions — served evidence and rollback

After normal protected publication and canonical upgrade, establish exact served
identity and perform AC-P6 through an admitted owner's existing read. Compare
with canonical verification of those exact admitted records; if unavailable,
record that limit without manufacturing a new review, provider call or proxy.
Keep §8 acceptance outstanding until independently satisfied. Preserve original
70069 and 8E request/effect/budget UNKNOWN histories separately; new fixtures,
receipts, merges and deployments do not settle them.

Rollback removes only the added projection, preserving checkpoints, receipts,
health records and histories. No code implementation, current coverage receipt,
new independent plan approval or AC-P test/served pass is claimed here.

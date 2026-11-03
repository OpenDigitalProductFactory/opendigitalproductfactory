---
status: draft
---

# Architecture debt budgets and expired boundary disposition

Status: authored proposal, not an approved waiver or implementation receipt.
Backlog: BI-B437EA69. Design Workroom: WC-4FB227EF.
Blocked delivery: BI-293395E4 / WC-6E3D9D3F.
Source snapshot: `36b46866870694dab1763e691862da38dc577e76` after fresh origin/main fetch.
All 43 recorded review dates are 2026-11-01; registry expiry is 2026-11-16.

## Problem and retained scope

The existing peer demand asks for owned architecture debt budgets, expiry,
shrink schedules and trend reporting across multiple specialized guards.
This design preserves that entire demand. The immediate application-boundary
cohort is its first disposition exercise, not a replacement for the other
acceptance criteria. A review document does not deliver the broad feature.

The readiness correction is independently source-reviewed and locally tested,
but its shared verification is unrun because the application boundary guard
rejects expired entries. Do not change the unrelated correction to evade this
guard. Do not classify this broad demand as a small repair solely to obtain a
shorter review lane.

## Objectives

**OBJ-DEBT-001:** Give every existing architecture-debt budget a verifiable owning scope, current count, target, expiry and shrink schedule.

**OBJ-DEBT-002:** Preserve specialized guard enforcement while converging existing debt through scoped source remediation.

**OBJ-DEBT-003:** Publish reproducible debt trends without adding a competing policy engine.

**OBJ-DEBT-004:** Resolve each of the 43 expired application-boundary entries from source evidence and obtain accountable independent disposition before implementation.

## Acceptance

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-DEBT-001 | OBJ-DEBT-001 | Governed debt baselines carry accountable owner, current count, target count/date, and expiry/review semantics. |
| AC-DEBT-002 | OBJ-DEBT-002 | CI rejects new unowned exceptions, expired exceptions, and regressions above the ratchet. |
| AC-DEBT-003 | OBJ-DEBT-003 | A generated report shows trend by debt class and highest-impact remaining cohorts. |
| AC-DEBT-004 | OBJ-DEBT-002, OBJ-DEBT-003 | Existing specialized guards remain authoritative; no second rule engine is introduced. |
| AC-DEBT-005 | OBJ-DEBT-001, OBJ-DEBT-002 | Initial targets cover module size, raw route errors, local `isRecord`, local status-color maps, connector lifecycle debt, raw tables, loading indicators, and retired process references. |
| AC-DEBT-006 | OBJ-DEBT-004 | All 43 exact boundary keys carry source presence, recorded and context owner, proposed disposition, review outcome and verification; no entry is silently renewed or dropped. |
| AC-DEBT-007 | OBJ-DEBT-004 | The five build exceptions whose recorded owner conflicts with the context owner receive an explicit owning-scope decision before assignment or renewal. |

## Design grounding and alternatives

Existing substrate: `scripts/application-boundaries.json`,
`scripts/check-application-boundaries.mjs`, `scripts/lib/baseline-budget.mjs`,
the existing specialized guards and Workroom readiness/evidence contracts.
Use these as authoritative readers/writers. Extend the budget/report adapters
where the existing contract lacks target or shrink metadata; do not add a new
policy service or database lifecycle. Review actual budget formats before
implementation and preserve their individual enforcement.

[dependency-cruiser CLI documentation](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md)
describes baselines for known dependency violations. Adopt exact-edge identity
and ratcheting; reject treating a recorded exception as permanent permission.
[Conftest](https://www.openpolicyagent.org/ecosystem/entry/conftest) tests
structured configuration with OPA. Adopt executable validation of owned budget
metadata; reject importing another rule engine where DPF already has dedicated
guards and a shared budget validator.
[Backstage catalog documentation](https://backstage.io/docs/) supplies a catalog
and system model. Adopt explicit ownership and capability context for review;
do not claim a catalog owner string is a live principal appointment or require
a separate catalog to fix the current source.

The project-specific choice is to retain exact source keys and fail-closed
expiry in the existing validators, with reporting derived from their measured
outputs. Neither external comparison provides authority to extend a DPF date.

## Boundary disposition rules

1. Re-measure each exact import at the immutable source reviewed. Presence in
   this matrix was checked with the guard's exported module-specifier reader;
   it is not a passing full guard run.
2. Remove an exception only when the complete application-boundary analyzer
   confirms its edge has disappeared. EX-30 appears absent and is a removal
   candidate, not a claimed deletion.
3. For present reverse dependencies, implement the proposed lower service,
   neutral contract or dependency injection in the owning context. Keep
   compatibility exports for consumers where necessary; compatibility exports
   themselves must not retain the prohibited edge in the inner context.
4. Keep grant, token, actor, tenant, billing, screening, credential, queue and
   sandbox checks intact. Moving implementation below an adapter must not move
   browser authentication into a background caller or bypass user authority.
5. Default disposition is source refactor or unresolved, never automatic
   renewal. Any separately requested bounded extension needs an exact key,
   justified residual risk, an accountable owner decision and concrete deadline
   and shrinking target. This proposal requests no extension.
6. Registry owner is platform-architecture. Recorded build entries EX-08–12
   say integration-platform but contexts.build says build-platform. These are
   conflicting source labels, not evidence that either principal accepted the
   work. Ask the owning architecture review to reconcile them.
7. Enterprise Architect is the declared compare specialist of the existing
   architecture-alignment-review shape. Architecture-owner ratifies findings.
   That standing shape's ontology/capability workflow has not been proven
   applicable to these source exceptions. Use the normal source-design review
   packet issued by readiness; do not substitute a standing room or fabricate
   an immutable packet after the earlier independent_review_request_denied.
8. Preserve historical uncertain review TR-GATE-5C843E95A8E0E676CA4717ED;
   this work is not a successor or execution-settlement claim.

## Exact source matrix

Every row is still awaiting independent disposition. Numbers refer to the
immutable snapshot above; the key contains importer, specifier and target
context. All recorded review dates are expired; none is changed by this file.
Recommendations describe source locations to investigate, not completed moves.

| ID | Exact exception key | Source line | Recorded owner | Context owner | Proposed disposition | Proposed remedy and retained invariant |
| --- | --- | --- | --- | --- | --- | --- |
| EX-01 | `apps/web/lib/actions/coworker-tool-budget.ts\|@/lib/mcp/tool-tier\|mcp` | 24 | web-application | web-application | refactor; keep blocked | Move tool-tier constants to an existing protocol-neutral tool contract; preserve MCP compatibility export and tool-budget assertions. |
| EX-02 | `apps/web/lib/actions/mcp-tokens.ts\|@/lib/mcp/contributor-readiness\|mcp` | 18 | web-application | web-application | refactor; keep blocked | Extract contributor readiness service beneath the MCP adapter; keep authentication in the actions adapter. |
| EX-03 | `apps/web/lib/inference/bootstrap-first-run.ts\|../actions/setup-progress\|actions` | 4 | ai-platform | ai-platform | refactor; keep blocked | Move first-run setup-progress persistence below actions; keep action authorization at entry. |
| EX-04 | `apps/web/lib/inference/phase-model-resolution.ts\|@/lib/build/build-studio-config\|build` | 57 | ai-platform | ai-platform | refactor; keep blocked | Inject build dispatch configuration into inference phase selection rather than importing build. |
| EX-05 | `apps/web/lib/inference/phase-model-resolution.ts\|@/lib/build/opencode-dispatch\|build` | 62 | ai-platform | ai-platform | refactor; keep blocked | Extract endpoint/model preflight predicates into inference-owned helpers with compatibility exports. |
| EX-06 | `apps/web/lib/inference/semantic-memory.ts\|@/lib/tak/agent-sensitivity\|tak` | 20 | ai-platform | ai-platform | refactor; keep blocked | Locate sensitivity contract below both inference and agent orchestration; preserve classification semantics. |
| EX-07 | `apps/web/lib/inference/utility-inference.ts\|@/lib/tak/context-arbitrator\|tak` | 8 | ai-platform | ai-platform | refactor; keep blocked | Extract the token-counting primitive below TAK; preserve tokenizer behavior and tests. |
| EX-08 | `apps/web/lib/build/build-orchestrator.ts\|@/lib/actions/deliberation\|actions` | 468 | integration-platform | build-platform | refactor; keep blocked | Call the deliberation service beneath actions; keep identity and grant checks explicit. |
| EX-09 | `apps/web/lib/build/opencode-dispatch.ts\|@/lib/queue/resource-lane\|queue` | 45 | integration-platform | build-platform | refactor; keep blocked | Extract shared inference-resource locking beneath queue; preserve singleton lock/lease semantics. |
| EX-10 | `apps/web/lib/build/plan-to-build-transition.ts\|@/lib/mcp/build-tool-helpers\|mcp` | 41 | integration-platform | build-platform | refactor; keep blocked | Move activity persistence to a build-owned service; MCP remains an adapter. |
| EX-11 | `apps/web/lib/build/sandbox/sandbox-pool.ts\|@/lib/queue/queue-telemetry\|queue` | 8 | integration-platform | build-platform | refactor; keep blocked | Use shared telemetry beneath queue and build; preserve event fields and transition ordering. |
| EX-12 | `apps/web/lib/build/ship-on-review-approval.ts\|@/lib/queue/scheduled-owner\|queue` | 499 | integration-platform | build-platform | refactor; keep blocked | Extract scheduled-owner resolution beneath queue; preserve actor and missing-owner refusal. |
| EX-13 | `apps/web/lib/queue/functions/agent-task-dispatch.ts\|@/lib/actions/agent-task-scheduler\|actions` | 91 | runtime-execution | runtime-execution | refactor; keep blocked | Call task scheduling service below actions, keeping authenticated user adapter outside. |
| EX-14 | `apps/web/lib/queue/functions/hive-scout-ingest.ts\|@/lib/actions/hive-scout/ingest-500-agents\|actions` | 5 | runtime-execution | runtime-execution | refactor; keep blocked | Point legacy ingestion shim at domain ingestion service below actions; preserve scheduler semantics. |
| EX-15 | `apps/web/lib/queue/functions/recurring-invoice-dispatch.ts\|@/lib/actions/recurring\|actions` | 24 | runtime-execution | runtime-execution | refactor; keep blocked | Call recurring invoice service below actions; preserve scheduled identity, idempotency and financial checks. |
| EX-16 | `apps/web/lib/routing/activity-package.ts\|@/lib/tak/work-pattern-types\|tak` | 1 | ai-platform | ai-platform | refactor; keep blocked | Place work-pattern metadata types in shared neutral contracts with compatibility exports. |
| EX-17 | `apps/web/lib/routing/anthropic-cache.ts\|../tak/prompt-boundary\|tak` | 30 | ai-platform | ai-platform | refactor; keep blocked | Move prompt-boundary constant to shared prompt contract; preserve cache split and TTL tests. |
| EX-18 | `apps/web/lib/routing/chat-adapter.ts\|@/lib/queue/resource-lane\|queue` | 51 | ai-platform | ai-platform | refactor; keep blocked | Move legacy lock re-export to the shared resource-lock contract without changing admission ownership. |
| EX-19 | `apps/web/lib/routing/cli-adapter.ts\|@/lib/inference/ai-provider-internals\|inference` | 25 | ai-platform | ai-platform | refactor; keep blocked | Move credential access below routing and inference; preserve all secret, OAuth and authority boundaries. |
| EX-20 | `apps/web/lib/routing/cli-adapter.ts\|@/lib/build/sandbox/agent-cli-runtime\|build` | 28 | ai-platform | ai-platform | refactor; keep blocked | Separate sandbox CLI file transport from build orchestration and inject the transport. |
| EX-21 | `apps/web/lib/routing/cli-adapter.ts\|@/lib/mcp/session-token\|mcp` | 30 | ai-platform | ai-platform | refactor; keep blocked | Inject scoped session-token factory into outer CLI execution adapter; never relax token scope. |
| EX-22 | `apps/web/lib/routing/cli-adapter.ts\|@/lib/tak/agent-grants\|tak` | 31 | ai-platform | ai-platform | refactor; keep blocked | Expose grant mapping through a neutral authorization contract; retain effective grant intersection. |
| EX-23 | `apps/web/lib/routing/codex-cli-adapter.ts\|@/lib/inference/ai-provider-internals\|inference` | 28 | ai-platform | ai-platform | refactor; keep blocked | Use the same lower credential service as EX-19, preserving isolated CLI execution behavior. |
| EX-24 | `apps/web/lib/routing/eval-runner.ts\|@/lib/inference/ai-provider-internals\|inference` | 7 | ai-platform | ai-platform | refactor; keep blocked | Use the same lower credential service as EX-19, preserving eval provider eligibility checks. |
| EX-25 | `apps/web/lib/routing/fallback.ts\|@/lib/inference/data-screening/screen-inference-payload\|inference` | 53 | ai-platform | ai-platform | refactor; keep blocked | Invert screening dependency through existing lower policy service; preserve mandatory refusal. |
| EX-26 | `apps/web/lib/routing/fallback.ts\|@/lib/inference/provider-reconciliation\|inference` | 44 | ai-platform | ai-platform | refactor; keep blocked | Move provider-reconciliation predicates to lower provider contract; preserve reconciliation outcomes. |
| EX-27 | `apps/web/lib/routing/inference-dispatch-guard.ts\|@/lib/inference/data-screening/types\|inference` | 1 | ai-platform | ai-platform | refactor; keep blocked | Move screening receipt types to lower data-policy contracts; retain exact receipt fields. |
| EX-28 | `apps/web/lib/routing/task-dispatcher.ts\|@/lib/inference/data-screening/screen-inference-payload\|inference` | 25 | ai-platform | ai-platform | refactor; keep blocked | Use lower policy screening service as EX-25; preserve enforcement before dispatch. |
| EX-29 | `apps/web/lib/routing/task-router-types.ts\|@/lib/inference/data-screening/types\|inference` | 136 | ai-platform | ai-platform | refactor; keep blocked | Use lower screening receipt type as EX-27; retain optionality and serialization. |
| EX-30 | `apps/web/lib/routing/tool-fidelity-harness.ts\|@/lib/tak/intent-taxonomy\|tak` | absent | ai-platform | ai-platform | remove if analyzer confirms | Remove stale exact exception only after full analyzer confirms edge absence. |
| EX-31 | `apps/web/lib/routing/types.ts\|@/lib/inference/data-screening/types\|inference` | 237 | ai-platform | ai-platform | refactor; keep blocked | Use lower screening receipt type as EX-27; retain route result compatibility. |
| EX-32 | `apps/web/lib/tak/agent-routing-server.ts\|@/lib/actions/agent-skills\|actions` | 12 | agent-runtime | agent-runtime | refactor; keep blocked | Call skill-read service below actions; retain agent authorization and visibility filtering. |
| EX-33 | `apps/web/lib/tak/autonomous-work-run.ts\|@/lib/actions/coworker-tool-budget\|actions` | 311 | agent-runtime | agent-runtime | refactor; keep blocked | Move pure tool-budget selection below actions; preserve required tool pins and ceilings. |
| EX-34 | `apps/web/lib/tak/coworker-collaboration.ts\|@/lib/actions/agent-coworker\|actions` | 23 | agent-runtime | agent-runtime | refactor; keep blocked | Call coworker spawn service below actions; preserve delegation/handoff authority. |
| EX-35 | `apps/web/lib/tak/pattern-observer/periodic-review.ts\|@/lib/queue/scheduled-owner\|queue` | 6 | agent-runtime | agent-runtime | refactor; keep blocked | Use lower scheduled-owner service as EX-12; preserve tenant-scoped review identity. |
| EX-36 | `apps/web/lib/tak/scheduled-task-runs.ts\|@/lib/build/inference-failure\|build` | 15 | agent-runtime | agent-runtime | refactor; keep blocked | Move inference-failure classification below build; preserve retry/exhaustion categories. |
| EX-37 | `apps/web/lib/tak/tool-script.ts\|@/lib/build/sandbox/sandbox\|build` | 38 | agent-runtime | agent-runtime | refactor; keep blocked | Inject sandbox command transport below build; preserve canonical sandbox execution fence. |
| EX-38 | `apps/web/lib/tak/tool-script.ts\|@/lib/mcp/session-token\|mcp` | 37 | agent-runtime | agent-runtime | refactor; keep blocked | Use injected scoped session-token factory as EX-21; preserve read-only script scope. |
| EX-39 | `apps/web/lib/tak/work-pattern-experiment-promotion.ts\|@/lib/build/work-pattern-experiment-runtime\|build` | 6 | agent-runtime | agent-runtime | refactor; keep blocked | Move pure experiment parsing below build; preserve experiment schema refusals. |
| EX-40 | `apps/web/lib/tak/work-pattern-experiment-scheduler.ts\|@/lib/build/work-pattern-experiment-runtime\|build` | 7 | agent-runtime | agent-runtime | refactor; keep blocked | Use the same lower experiment parser as EX-39; retain scheduler behavior. |
| EX-41 | `apps/web/lib/tak/work-pattern-experiment-scheduler.ts\|@/lib/queue/functions/work-pattern-experiment\|queue` | 8 | agent-runtime | agent-runtime | refactor; keep blocked | Move enqueue capability to shared scheduling service; preserve deduplication and owner fence. |
| EX-42 | `apps/web/lib/tak/work-pattern-experiment-store.ts\|@/lib/queue/scheduled-owner\|queue` | 3 | agent-runtime | agent-runtime | refactor; keep blocked | Use lower scheduled-owner service as EX-12; preserve experiment actor scope. |
| EX-43 | `apps/web/lib/tak/work-pattern-profile-review.ts\|@/lib/queue/scheduled-owner\|queue` | 251 | agent-runtime | agent-runtime | refactor; keep blocked | Use lower scheduled-owner service as EX-12; preserve profile-review owner refusal. |

## Sequencing and delivery boundaries

Phase 1 authors and independently reviews this design and matrix under
BI-B437EA69. Bind its immutable commit/blob to WC-4FB227EF and obtain current
server-issued research/design/spec/architecture review prerequisites as owed.
Authored research is not self-approval. Funding purpose reported unresolved at
claim; do not infer a budget allocation or authorize extra provider spend.

Phase 2 maps independently shippable source cohorts to existing covering work.
The peer demand's parent and sibling references are not resolvable in the local
backlog; reconcile them through the existing federation demand before claiming
coverage or accepted ownership. File a child only if overlap checks prove no covering item,
and record real decomposition coverage before implementation. This design is
not a fabricated coverage receipt or an admission of unshaped implementation.

Phase 3 implements and verifies the approved source cohorts, removes only
resolved exceptions, and records remaining unresolved decisions. Initial
boundary target is zero reverse edges; interim targets and dates require the
accountable owner's reviewed schedule. No target date is guessed here.

Phase 4 extends the shared budget metadata/report adapters across the other
debt classes from AC-DEBT-005. Each adapter reads its own guard's measured count;
report current, target, deadline, owner and change since the prior comparable
snapshot. An unreadable class reports unknown, never zero. Reconcile specialized
formats before migration and avoid broad baseline regeneration.

Phase 5 resumes exact-head readiness repair verification, protected publication
and canonical runtime acceptance after the actual blocking guard is green.
The architecture design alone cannot make BI-293395E4 or BI-B437EA69 complete.

## Verification and rollback

For this documentation artifact: check every one of the 43 keys against the
registry, verify source lines/presence with the exported extractor, check
objective/acceptance notation, run documentation link/index checks and diff
whitespace validation. No source tests or runtime pass is inferred.

Before source implementation: read the Workroom change-impact contract for each
cohort and record meaningful failing invariants. Test new/reintroduced reverse
imports, missing owner/date, expired date, owner-conflict handling, absent
snapshot handling and exact removal. Run related domain tests and both web
typechecks for moved modules. Exercise changed background/agent flows through
canonical/shared governed runtime, preserving auth/identity and dispatch effects.

After approved remediation: run full application-boundary analysis and other
specialized guards, shared governed verification at the exact merged-code tree,
protected PR checks and canonical upgrade/live verification as required.
A global guard failure is a real blocker; never set an environment override.

Rollback source refactors through a protected PR restoring behavior and exact
evidence. Do not restore an already expired exception as if it were valid;
retain the explicit blocked state until accountable disposition. Rollback of
this proposal is documentation-only and changes no runtime policy.

## Evidence and unresolved decisions

Existing source failure linkage: cmvzmt4x2083b01tmoobki47p and
cmvzmt84h083h01tmkpi624ee. Authored bounded proposal:
cmw016nk7122901o2bs9vux0h. Normal design admission created WC-4FB227EF with
verdict allowed. No implementation admission, owner ratification, formal
review receipt, fresh shared gate, PR, merge or runtime deployment is claimed
for this artifact. Required decisions: approve/correct the per-row remedies,
resolve EX-08–12 ownership conflict, establish cohort schedule and accountable
implementation ownership, and determine the full broad demand's delivery shape.

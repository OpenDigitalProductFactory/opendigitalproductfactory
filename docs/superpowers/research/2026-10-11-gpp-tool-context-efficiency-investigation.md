# GPP, tool context and execution efficiency investigation

Status: investigation draft; not an approved architecture decision or implementation plan.
Date: 2026-10-11. Source baseline: `30dd6aaaa85` on `origin/main`.
Existing owning work: BI-69415B68 (GPP enforcement), BI-D37B2C13 (Build Studio shape compilation), BI-43C3E914 (stage tool declarations).

## Outcome

The first optimization target is repeated execution after a predictable refusal. The second is the tools actually attached to each inference request. Retain fine-grained server authorization and use existing stage context to limit what a coworker needs to consider. Human approvals should describe the work and its consequences, with technical receipts available on demand.

These are investigation recommendations awaiting live WWMD consultation. Source documents establish implementation intent; they do not substitute for kernel lookup or approval. The initial investigation made no platform implementation, permission change, runtime modification or GPP enforcement promotion. Following the operator's instruction to proceed, a bounded source repair of the existing refusal breaker was prepared under the recovery procedure; see [repair plan](../plans/2026-10-11-settled-refusal-loop-recovery.md). It is not a GPP rollout.

## Evidence and limits

The native Codex app-server inventory reports one OAuth DPF development server and 259 authorized tools. This chat still has zero callable DPF tools in its attached registry. Consequently, live kernel lookup, decision scoring, workroom claim and plan coverage were unavailable. The investigation used the source contract's explicitly permitted read-only database fallback, not a substitute MCP execution path.

Catalog measurements serialize retrieved tool objects as compact UTF-8 JSON. They measure catalog bytes, not model tokens, cached tokens, cost or latency. The core projection uses the current source core-name list against the authorized host inventory; it is not a fresh core-tier response.

| Catalog projection | Authorized tools | JSON bytes |
| --- | ---: | ---: |
| Full developer inventory | 259 | 294,710 |
| Current core-name intersection | 34 | 58,273 |

The projected byte reduction is 80.23%. Individual objects range from 315 to 10,306 bytes, with median 875 and p95 2,728. `principle_decide` is largest; its input schema accounts for 9,550 bytes. A uniform per-tool estimate cannot capture this variation. Reducing the server index alone cannot establish model-context savings on a host that defers schema attachment.

Read-only live PostgreSQL aggregates cover the rolling seven days ending at `2026-10-11 17:55:04 UTC`:

| Observation | Count |
| --- | ---: |
| Tool executions | 33,269 |
| Successful executions | 20,765 |
| Unsuccessful executions, including correct refusals | 12,504 |
| `record_initiative_evidence` unsuccessful executions | 11,414 |
| Same tool with `authority_denied` | 11,376 |

Those authority refusals account for approximately 91% of unsuccessful calls. They span 67 route contexts and 87 distinct parameter values. The dominant recorded authority reason is `agent-grant-denied` (11,316), associated with `AGT-WS-BUILD`; another 52 records say `room-authority-denied`. The remaining eight are not classified by those two reasons. Do not describe a correct authorization refusal as a broken gate.

Several high-volume routes show 384 denied calls over the window with one distinct parameter value per route. This establishes repetition across the observation window, not the identity of the scheduling trigger or proof of a particular retry algorithm. The relevant records have no taskRunId; tracing execution lineage is part of the next reproduction.

All 199 observed GPP observations in that window are shadow: 176 ungoverned, 22 lineage_unsealed and one unmediated. All 22 permits are shadow `human-checkpoint-admit`, each single-use. This says nothing about absence of existing TAK authorization enforcement.

Diagnostics and catalog measurement scripts are retained locally in the Codex temporary directory under `dpf-connector-diagnostics`. Raw credentials and private installation names are excluded from this report.

## What already exists

The owning design is [Gated Permissions Process](../../architecture/gated-permissions-process.md), with context budgeting in [Context Engineering Standards](../../architecture/context-engineering-standards.md). GPP models admission; TAK enforces authority. An approved envelope narrows the intersection of actor authority, user capabilities and transport scope. It cannot manufacture a standing grant the actor lacks.

| Existing source | Observed behavior | Optimization seam |
| --- | --- | --- |
| `apps/web/lib/mcp/tool-tier.ts` | Core/full changes discovery, not authorization; known lazy hosts need a full initial index | Measure host attachment separately from server listing |
| `apps/web/app/api/mcp/v1/route.ts`, `handleToolsList` | Listing intersects capabilities, token grants and coworker authority, then tier/loaded names | Reuse stage authority projection where client context supports it |
| `apps/web/lib/actions/coworker-tool-budget.ts` | Shared ranking, required tools and count caps; uniform token estimate | Measure serialized schema size and actual provider payload |
| `apps/web/lib/tak/autonomous-work-run.ts`, `resolveAutonomousWorkTools` | Reserves discovery slot; silently slices required names to four; exception returns all authorized tools | Explicit required-set admission and a bounded failure path |
| `apps/web/lib/tak/agentic-loop.ts` | Grant-starvation breaker counts `forbidden_grant`; no `authority_denied` branch was found | Reproduce typed refusal handling before changing it |
| `apps/web/lib/govern/authority/governed-rejection-disposition.ts` | Classifies `authority_denied` as refused | Reuse this classification in execution/scheduling |
| `apps/web/lib/work-management/room-turn-authority.ts` | Existing typed room context and authority intersection | Extend existing projection rather than invent another permission engine |
| `apps/web/lib/gpp/binding-enforcement.ts` | Source enforcement map is empty; binding promotion is explicitly governed | Promote only named bindings with required evidence |
| `apps/web/lib/gpp/permit-mint.ts`, `shadowPermitClaims` | One exact tool, one use; stage/actor/subject fields null in this shadow path | Do not equate this with implemented stage-wide admission |

The budget exception returns a full surface that remains authorization-filtered. It is an efficiency hazard, not evidence of an authorization bypass. Its frequency and effect have not been measured. Likewise, four required tools is an existing contract; changing the cap is not automatically the right fix. An oversized required set should produce an explicit admission result rather than silently lose dependencies.

The grant breaker mismatch is a concrete candidate explanation for repetition, not an established root cause. Source already includes repetition protection and scheduling treatment for pending approval. Verify their actual deployment identity, typed refusal path and behavior across fresh runs before adding another loop guard.

## Existing backlog overlap

BI-099A0BA3 already describes scheduled acceptance that cannot supply the server-issued review packet needed by the objective-mapping writer. Its intended repair routes through the existing reviewer or issues the correctly bound packet; it does not weaken evidence checks. This is a relevant lead for the repeated evidence refusals, but correlation is not proof.

BI-947205E1 describes a Codex CLI reviewer whose attachment logs claim tools are present but whose executor fails to carry the required reader/writer. BI-PIR-b1b9265a covers demand-driven stage executor discovery. BI-PIR-d2257424 records an authority-denial loop on another tool. BI-7898EE05 covers review routing and progressive disclosure gaps. Reuse these owners and existing GPP work before filing or claiming overlapping implementation.

## Proposed sequence for kernel consideration

1. **Make refusals stop wasting work.** Trace the dominant refused evidence calls to their initiator. Reproduce both same-run and subsequent-run behavior. Reuse canonical refusal disposition to park blocked work until a relevant authority, stage, evidence or routing revision changes. Preserve a single actionable explanation and route to an already authorized reviewer when the recorded process permits it. Never auto-add the missing grant.
2. **Measure and bound attachment.** Instrument the existing provider boundary with tool count, schema bytes, attachment decision, required/deferred tools and measured token usage when supplied by the provider. Capture completion, p50/p95 latency and cost for representative tasks. Explicitly reject an unsatisfied required set. Test budget exceptions so they cannot restore an unbounded surface without a recorded policy decision.
3. **Complete the existing stage model.** Resolve one authoritative stage envelope through GPP/TAK/room context and derive execution reach, discovery preference and human status from it. Revalidate on each call; any reuse must bind actor, stage, subject, policy version, validity and revocation. Consequential actions retain their required exact evidence/parameter binding. Follow existing binding-specific promotion evidence; do not turn on global enforcement.
4. **Make approvals understandable.** Present the outcome, affected scope, consequence and when approval ends. Show progress and one reason when work needs attention. Generate these facts from the authority projection. Expose tool names, grant intersections and receipt lineage only in expandable details. Keep audit evidence complete and available to technical operators.

The operator clarified that the target is overarching across threads: 80% or more refactoring/consolidation, with other threads potentially supplying net-new work. This supersedes the initial 20% interpretation. Use refactoring effort to consolidate existing tool-budget and refusal-disposition projections, with parity tests. Do not create a universal mega-tool, second policy engine or parallel stage vocabulary. Actual effort has not yet been allocated to implementation.

## Cross-thread investment metric proposal

Treat 80% as a portfolio target for this modernization initiative, not a per-thread quota or percentage of lines changed. The population must be explicitly scoped to the initiative's canonical work items; separately report the whole platform if the operator chooses a platform-wide target. Count each work item once even when multiple threads, workrooms or PRs contribute to it. Workroom delivery shape controls the process owed; it is not a substitute for work classification.

Source inspection confirms existing `BacklogItem.workType` (including `refactor`), `jobSize`, effort-estimate provenance and `investmentBucket`, plus Workroom links to backlog/epic/work items. Reuse them. The run/grow/transform bucket is a separate dimension and must not be relabeled as refactor/net-new. Workroom backlog/epic links can contain semantic keys or database IDs, so aggregate through the canonical resolver rather than assuming one raw foreign-key shape.

Proposed initial measure: refactor-classified accepted work's comparable estimated effort divided by all classified accepted work's comparable estimated effort. Label it **delivered refactoring share, weighted by estimated effort**. It is not actual labor spent. Report planned and active work separately, together with classification/estimate coverage and unknowns. Do not manufacture numeric effort from size labels, mix incompatible estimation scales, or treat unknown work as net-new. Mixed work should use existing child work items where justified; do not create tiny artificial tickets solely to improve the ratio. The classification policy must define consolidation, replacement, bug repair and new capability consistently before the ratio is used.

Pair the investment ratio with outcomes: successful stage completion, unchanged-denial repetitions, human interventions per completed work item, elapsed time to accepted work, and actual model-attached tool context. A high refactoring ratio with no improvement in these outcomes is not success. The human overview should show target, measured share, coverage and outcome trend; technical attribution belongs in drill-down.

This is a proposed roll-up over existing work records. No metric writer, schema change, dashboard, live portfolio policy or historical backfill has been implemented. Reconcile scope and measurement semantics through the owning kernel and backlog process before implementation.

## Proposed human flow

Example copy, requiring verification against the actual stage and authority facts:

> **Prepare this change for review**
>
> The coworker will update the selected working copy and check the result. Publishing requires its own approval.
>
> **Approve preparation**

After admission: **Working**, followed by **Ready for review** or **Needs your decision**, with a specific explanation. A refusal for missing coworker authority should route to platform recovery or a qualified peer; it should not make a nontechnical user choose grant names. The approval button must never promise authority that the server cannot admit.

This is interaction guidance, not a rendered or tested UI. Before a UI implementation, inspect existing gate and workroom surfaces, preserve their canonical states, and verify both light and dark themes and accessible keyboard operation.

## External evidence

These are preliminary comparators, not the complete research required to finalize a feature spec:

- [OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search) documents eager versus deferred loading. Adopt demand-based schema attachment and measure discovery failures; do not assume API settings map directly to Codex Desktop.
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) defines listing and list-change notifications. Use the standard where the client supports it; notification support does not prove this chat can refresh its registry.
- [OPA partial evaluation](https://www.openpolicyagent.org/docs/filtering/partial-evaluation) illustrates deriving a filter from policy and known context. Borrow the projection idea within existing GPP/TAK; no OPA dependency is proposed.

Before finalizing delivery-lifecycle architecture, complete the repository-required BMAD comparison and the remaining open-source/commercial research in the [design research runbook](../../architecture/design-research-runbook.md).

## Verification and next admission

Completed: source contract and relevant substrate inspection; native Codex catalog/auth inventory; deterministic catalog byte measurement; read-only live execution/GPP/backlog aggregates. No write to the live database occurred.

At the initial investigation boundary, live kernel consultation, autonomous decision receipt, workroom claim, plan coverage, caller-root-cause reproduction, provider attachment measurement, implementation, UI verification, unit/typecheck/build gates and runtime deployment were not completed. The worktree was source-only. Subsequent managed dependency bootstrap established compile readiness and enabled the first source-local refusal reproduction and repair; see the repair plan for its separate scope. The broad architecture and live operational outcomes remain unproven. This document is investigation evidence, not a delivery completion claim.

The next governed step requires DPF tools attached to the executing session: consult the owning platform kernel, reconcile this evidence with the existing backlog owners, then obtain plan coverage for the bounded first repair. A fresh native host inventory is healthy, so the remaining connector fault is specifically this session's tool attachment. No raw MCP calls or direct database writes may replace that authority path.

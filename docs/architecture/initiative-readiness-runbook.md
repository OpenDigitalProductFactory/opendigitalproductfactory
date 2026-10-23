# Initiative-Readiness Runbook — who does what, when, through the gates

**Purpose.** A single human- and agent-readable map of the governed path a piece of work travels from a raw backlog item to a completed, accepted initiative: the **roles × gates × sequence × actor**, and the **routing mechanism** that hands each gate to the coworker who can satisfy it. Written because that end-to-end map previously existed **only in code** — agents (this one included) were reverse-engineering it from gate-refusal errors, which is exactly how a governed process gets misused.

> **Source of truth is the code, not this file.** This runbook orients; it does not re-implement. The policy is `initiative-readiness.v3`, evaluated by a pure function. When this doc and the code disagree, the code wins — and this doc is stale and must be fixed.
> - Gate machine: [`apps/web/lib/backlog/initiative-readiness/evaluate.ts`](../../apps/web/lib/backlog/initiative-readiness/evaluate.ts) (`evaluateInitiativeReadiness`), [`types.ts`](../../apps/web/lib/backlog/initiative-readiness/types.ts) (codes, targets, profiles), [`readiness-guidance.ts`](../../apps/web/lib/backlog/initiative-readiness/readiness-guidance.ts) (per-profile evidence definitions + writer tools).
> - Independence enforcement: [`receipt-schema.ts`](../../apps/web/lib/backlog/initiative-readiness/receipt-schema.ts), reviewer identity in [`reviewer-identity.ts`](../../apps/web/lib/backlog/initiative-readiness/reviewer-identity.ts).
> - Lane → gate → grant → role + the reviewer packet builder: [`apps/web/lib/tak/initiative-readiness-tool-grants.ts`](../../apps/web/lib/tak/initiative-readiness-tool-grants.ts).
> - Where the recovery packet is issued: [`apps/web/lib/work-capsules/governed-work-claim.ts`](../../apps/web/lib/work-capsules/governed-work-claim.ts).
> - Packet consumption: [`apps/web/lib/mcp/packs/coworker-pack.ts`](../../apps/web/lib/mcp/packs/coworker-pack.ts), [`external-coworker-task-adapter.ts`](../../apps/web/lib/mcp/external-coworker-task-adapter.ts).

## 0. Two "shapes" — do not conflate them

### Approval status is separate from original action evidence

The exact caller-scoped `get_my_approval_status` reader includes a separate
`actionEvidence` projection for stored provider-account test outcomes. It proves
the original envelope, tool, actor and input before returning a bounded typed
result; missing, conflicting and unsupported evidence remain explicit. Pending
discovery retains its status-only contract. This read never dispatches or replays
an action, and generic test success supplies neither a Responses verification
receipt nor a selected-quota transaction receipt. It cannot settle an uncertain
initiative review or substitute for the gate's independent writer.

### Medium body criteria and independent acceptance

Effective medium work, including product-linked work, can satisfy its objective
baseline from an Acceptance heading with criterion bullets, or explicit
`AC-<id>:` bullets. It does not owe a separate spec approval for that baseline.
After delivery passes and acceptance remains unmet, the existing authorized,
serialized completion mutation retains a DocumentVersion and baseline activity.
Approved and inherited baselines retain precedence. The retained version binds
criteria and anchors, item/organization, author provenance and delivered source
identity; it creates no approval or acceptance receipt.

Recovery requires one current source Workroom, fresh post-baseline passing
evidence, and an independent reviewer with the existing reader/writer grants
and room admission. `get_backlog_item` and completion refusals return the exact
server-issued packet. Its existing `read_source_at_version` reader hydrates the
bound retained criteria only for that authorized TaskRun. Room admission is
checked before reading and again before receipt writing. Automatic reviewer
dispatch carries the recorded requesting person into these checks.

A merged author's room can remain archived throughout body acceptance. The
shared author resolver admits only the current unambiguous attempt with an exact
server-owned, verified merged PR observation matching repository, number, branch
and head. A newer incomplete or superseded attempt blocks historical fallback.
This retains source authorship; it grants no execution lease or room admission.
The reviewer TaskRun, OAuth authority, content access and author separation must
remain current. Missing merge proof calls for source/observation reconciliation,
not repeated reopening of a room the reaper correctly considers delivered.
Spec and post-implementation review retain their existing live-room requirement.

Changed criteria, source identity, organization or eligible evidence reject old
requests. Refresh recovery for a current successor; unchanged retries reuse the
TaskRun and proposal. Historical authority stays auditable. Research and
dependency-disposition remain author lanes; only the acceptance mapping lane
becomes independent. Missing prerequisites are reported as recovery actions,
without unlinking the product, lowering shape or weakening completion gates.

Implementation: [body baseline retention](../../apps/web/lib/backlog/initiative-readiness/body-baseline-persistence.ts),
[terminal recovery](../../apps/web/lib/backlog/initiative-readiness/terminal-recovery.ts),
and [objective mapping writer](../../apps/web/lib/backlog/initiative-readiness/objective-mapping-repository.ts).
Operator procedure: [acceptance sweep](../operations/acceptance-sweep.md).

The word *shape* is overloaded across the platform. Two distinct machines:

1. **The initiative-readiness gate machine** (this runbook). Decides whether a backlog item / epic / build may transition `design → plan → implementation → completion`, by checking that the required **evidence receipts** exist and passed review. Roles are *governance accountabilities* (design-author, design-checklist-reviewer, …).
2. **The Workroom collaboration shape** ([`apps/web/lib/work-management/room-shapes.ts`](../../apps/web/lib/work-management/room-shapes.ts), documented for humans in [`docs/user-guide/ai-workforce/how-governed-work-runs.md`](../user-guide/ai-workforce/how-governed-work-runs.md)). Decides *which collaboration roles staff a room* (coordinator → specialist/reviewer → approver). A different axis.

They meet at one edge: a readiness **review gate** is *routed into* a Workroom, to the reviewer coworker, via the recovery packet (§3).

## 1. The lifecycle sequence

An xlarge initiative does not enter implementation itself. After decomposition,
close it through the existing completion writer using its current governed plan
coverage, at least two distinct mapped children and actual parent outcome
reconciliation. Every explicitly mapped child must be done, including a mapped
sequencing child. A parent PR merge or deployment does not replace child delivery,
independent plan review or hypothesis outcomes. Coverage and delivery refusals
name the evidence to repair; reuse those records rather than creating duplicate
children or changing the initiative's shape.

Break-fix post-implementation review uses the authored Workroom head and a
provider-verified artifact. A workflow or code repair with one implementation
file can be reviewed without a changed design document; accompanying tests
and explanatory docs do not change that identity. Multiple implementation
files without a canonical design remain an explicit scope ambiguity. Use the
returned reviewer packet unchanged; deployment evidence and an independent
receipt are still required. This does not relax design-approval gates.

The readiness **targets** are ordered and cumulative — each includes every prior target's requirements ([`types.ts`](../../apps/web/lib/backlog/initiative-readiness/types.ts), the cumulative call chain in `evaluate.ts`):

```
design  →  plan  →  implementation  →  completion
```

The backlog-item **status** vocabulary (`triaging / open / in-progress / done / deferred / retired`) is a *separate* axis. Status is where the item sits; the readiness targets gate the transitions between phases of real work. An item must be **triaged** (out of `triaging`) before any readiness target is reachable.

**Depth is set by the profile** (`doc-only ⊂ fix ⊂ feature ⊂ cross-domain ⊂ archetype`). A `doc-only` change skips the reviewer gates a `feature` must pass; strongest applicable profile wins.

## 2. The gates — role × actor × evidence (feature profile)

Each row: the gate, the **accountable role**, **who actually acts** (Author = the coworker doing the work; Independent = a reviewer coworker that is *not* the author; Human/System = authority), and the **tool** that records the receipt. "Independent" gates carry `independent: true` on their writer lane and are **refused** if the reviewer principal equals the author principal (`receipt-schema.ts` — *no self-approval override exists*).

| Target | Gate | Accountable role | Actor | Recorded by |
|---|---|---|---|---|
| design | CLASSIFICATION | product-owner | Author | `record_initiative_evidence(gate:"classification")` |
| design | AUTHORIZATION | platform-governance | System/Human authority | authority intersection (token ∩ grant ∩ capability) |
| plan | RESEARCH | design-author | Author | `record_initiative_evidence(gate:"research")` |
| plan | CANONICAL_DESIGN | design-checklist-reviewer | **Independent** | `record_initiative_design_review(gate:"design-spec")` |
| plan | **SPEC_APPROVAL** | design-checklist-reviewer | **Independent** | `record_initiative_design_review(gate:"spec-approval")` — **mints the scope baseline** |
| plan | REVIEW (architecture) | architecture-reviewer | **Independent** | `record_initiative_architecture_review` |
| plan | OBJECTIVE_BASELINE | design-checklist-reviewer | **Independent** | minted *by* the spec-approval receipt |
| plan | ARTIFACT_AUTHOR | artifact-resolver | Author (git identity) | DCO-signed commit (author principal == workroom principal), **pushed**, then `adopt_worktree` re-sync |
| implementation | PLAN | implementation-planner | Author | `record_plan_backlog_coverage` |
| implementation | DEPENDENCY_DISPOSITION | portfolio-management | Author | `record_initiative_evidence(gate:"dependency-disposition")` |
| implementation | CAPSULE_IDENTITY | delivery-coordinator | Author | `adopt_worktree(headBranch, headSha)` |
| implementation | PLAN_REVIEW | plan-reviewer | **Independent** | `record_initiative_design_review(gate:"plan-review")` |
| implementation | PLAN_COVERAGE + TRACEABILITY | portfolio-management | Author | `record_plan_backlog_coverage` (binds to the baseline) |
| completion | DELIVERY_EVIDENCE | delivery-coordinator | Author | `record_execution_evidence`, cited in `completionEvidence.evidenceActivityIds` |
| completion | ACCEPTANCE_EVIDENCE | acceptance-reviewer | **Independent** | acceptance evidence vs the objective baseline |
| completion | OBJECTIVE_RECONCILIATION | acceptance-reviewer | **Independent** | `record_product_outcome_observation` |

Cross-domain / archetype profiles add specialist review gates (data / ux / security / compliance / domain / archetype), each an independent lane.

**Evidence must be a gate receipt.** A plain timeline "evidence" activity is deliberately *not* accepted (the load-bearing distinction reported as `gate-receipt` vs `recorded-unread` vs `none`). Recording `record_execution_evidence` alone does **not** satisfy a review gate.

## 3. How a gate is handed to the right coworker — the recovery packet

You do **not** choose the reviewer or hand-build the review call. The server issues a **recovery packet** naming, per unmet gate, the exact coworker and a ready-to-send handoff. The flow:

**Native source identity.** Supplied `baseSha` and `headSha` must be full
40-character commit IDs; malformed values are refused before claim or adoption
writes. Source-less design and planning remain valid. Implementation requires
both usable persisted values even when the optional claim inputs are omitted.
Exact claim readback returns `baseSha`, `headSha` and `sourceIdentityComplete`.
That flag describes recorded SHA syntax, not observed Git state, approval or
publication authority. The existing local Git capture observes the actual
repository, branch, worktree, merge base and head on the caller's host.

**Current and historical review readback.** `get_workroom` and room liveness use
the same bounded recovery projection. A complete history containing only older
source is not a failed read, and its outcomes remain explicitly historical.
Readback includes at most five historical executions and marks truncation;
their requester-bound `tasks/result` actions retain the existing access check.
No historical pass, task completion or source identity flag approves the current
source. Missing current review, incomplete observation and conflicting identity
remain distinct unknown states. Their recovery names the existing room holder
principal when recorded and the delivery-coordinator role, then directs callers
to `get_backlog_item(itemId, recoveryGate: "post-implementation-review")` for the
current issuer's action. An unlinked room must first be linked by its coordinator.
Repeating the identical room read does not repair that condition; historical
unknown provider work must not be replayed or assigned a new request nonce.

An unusable legacy value is named in `identityRepair.missingFields` and excluded
from the repair packet; valid recorded values are retained. Capture the actual
missing values locally, then use the issued `adopt_worktree` packet or retry the
claim with the full values. No reviewer artifact lookup or dispatch uses an
incomplete source identity. Never invent a base or substitute the running
install's commit for unpublished work. Other readiness and authority gates
still apply.

1. **Bind a Workroom to the item, with a real base *and* head.** `adopt_worktree(title, objective, repositoryFullName, headBranch, headSha, baseBranch, baseSha, worktreePath, backlogItemId)`. Without **both** an immutable `baseSha` and `headSha`, no reviewer binding can be issued (`no-canonical-artifact`) — the review has nothing immutable to pin. The artifact commit must be **resolvable on the provider** (a squash-merged, deleted branch will not resolve — re-publish it).
2. **Attempt the governed claim.** `claim_backlog_item_for_work(itemId, worktreePath, branchName, provider, sessionRef)`. When the item is not ready it *refuses* and returns `data.recovery`:
   - `reviewerRoutes[]` — per gate: `accountableRole`, `gate`, `targetAgentId`, `independent`, and a ready `requestCoworker` packet with `requiredToolNames` + `initiativeReviewBinding` (the writer tool + the immutable `artifactRef` — repo, commitSha, path, providerBlobId).
   - `escalations[]` — `no-eligible-reviewer` (activate a production reviewer holding the grant) / `no-canonical-artifact` (fix the base/head per step 1) / `dispatch-context-required` / `research-evidence-required` (a **small or medium** shape's research is the author's reproduction plus failing-to-passing proof, recorded with `record_initiative_evidence(gate:"research")`; no spec is owed and none is demanded — BI-3B323B6A. For a **small fix** the reproduction itself satisfies research at claim: `record_execution_evidence` with kind `source_verified` (the defect on a named ref, with its URL) and kind `test_pass` (the failing-to-passing test, not superseded by a later `test_fail`), which an external session can reach without `initiative_evidence_write` — BI-6EB2DBBB. The claim loads those `evidence` rows alongside its receipts, so recording them and claiming again is admitted — BI-5C992261. Build Studio's entry gate (`build-entry-gate.ts`) reads the same activity kinds, so a small fix advanced out of ideate without a design review is admitted to plan on the same reproduction — BI-7027C26E. Medium shapes and net-new work still need the recorded research receipt. That receipt cites a commit on a live workroom, and a refused implementation claim binds none, so the order is: claim with `workIntent: "design"` (it does not owe research and binds the room), record the receipt, then claim with `workIntent: "implementation"` again. Both the claim's research escalation and the no-workroom artifact refusal name this step — BI-77C600B2. A development connection includes `initiative_evidence_write` and no other initiative grant (BI-B9B196FD). A write connection already in use whose stored grants are an earlier prefix of that template gains the grants added later on its next use, without a new secret (BI-E9F1C116). A read connection, an admin connection, an OAuth connection, and a custom set with a hole keep the grants they already have).
   - `unroutable[]` — gates whose role owns no writer lane (e.g. `ARTIFACT_AUTHOR` — you push a signed commit; nobody records it for you).

   The refusal also carries `data.governingPrinciples`: for each unmet or blocking code whose rule a principle page states, the page's slug (`{ "CAPSULE_IDENTITY_MISMATCH": "claim-a-workroom-before-you-work" }`). The message ends with the same list as a `Governing rules:` line. Look a slug up with `wiki_query` before inferring the rule from code. The completion refusal (`update_backlog_item_status` to `done`) carries the same field, and `get_backlog_item` / `list_backlog_items` return `readiness.governingPrinciples` keyed by target. A code with no page cites nothing; the table and its unwritten-rule inventory live in [`apps/web/lib/kernel/governing-principles.ts`](../../apps/web/lib/kernel/governing-principles.ts) (BI-DEDAC950).
3. **Dispatch each packet** with `request_coworker` (or `summon_coworker`), passing the `targetAgent`, `objective`, `requestKey`, **and** the packet's `requiredToolNames` + `initiativeReviewBinding` verbatim. The two travel together or not at all; the adapter refuses a binding without its required tools, and refuses any tool outside the bound writer + `read_source_at_version`. The dispatched coworker reads the pinned artifact and records the gate receipt **only if the gate passes** — it cannot invent or reshape the identity.
4. **Re-attempt the claim / transition.** Passing receipts satisfy their gates; `spec-approval` mints the baseline, which unblocks `record_plan_backlog_coverage`; the item advances.

**Claim identity, when a room was owned by a prior session.** The claim matches the Workroom's recorded executor identity and lease-holder. A room left by a dead session (idle-stale, no live signal) can refuse a fresh claim with `capsule_identity_mismatch` even after `adopt_worktree`, and `force` does **not** override an identity mismatch (only live-ownership conflict). Take the room over with `reassign_workroom_executor(capsuleId, toExecutorKind, toExecutorRef, reason)` — it transfers the lease to the caller and sets the executor — then re-claim. Renew a still-owned but expiring lease with `heartbeat_workroom`; do not thrash heartbeat on an already-expired lease.

## 4. The reviewer roster (who holds which grant)

**Exhausted independent review.** If an exact design-spec, spec-approval,
architecture-review or plan-review task reports
`terminal-writer-retry-exhausted`, refresh the governed claim instead of
replaying that task. For the same user and current OAuth task family, the
server excludes only that recorded exhausted packet and issues the next
currently eligible independent reviewer with both writer and reader grants.
The artifact, baseline and Workroom binding stay fixed; the replacement key
includes the new target independently of roster order. An exact owned legacy
task retains its recorded key and retry budget, including while active.
Submit the newly issued packet unchanged. Issuance
and authorization use the same exact task-history check. Writer refusals,
capacity or approval waits, active tasks and uncertain provider outcomes do
not authorize replacement. If all eligible reviewers are exhausted, the
server returns a bounded escalation; attempts, grants and receipts are never
reset or synthesized. This recovery applies to the external OAuth review lanes.

Live assignment in [`packages/db/data/agent_registry.json`](../../packages/db/data/agent_registry.json); the recovery packet resolves the current holder, so prefer the packet over this table.

| Grant | Coworker | Gates it records |
|---|---|---|
| `initiative_design_review` | **AGT-WS-REVIEW** (Change Reviewer) | design-spec, spec-approval, plan-review |
| `initiative_architecture_review` | **AGT-WS-EA** (ea-architect) | architecture-review |
| `initiative_data_review` | AGT-902 (data-governance) | data-review |
| `initiative_ux_review` | AGT-903 (ux-accessibility) | ux-review |
| `initiative_security_review` | AGT-190 (security-auditor) | security-review |
| `initiative_compliance_review` | AGT-905 (licensing-specialist) | compliance-review |
| `initiative_archetype_review` | AGT-WS-INVENTORY (inventory-specialist) | archetype-review |
| `initiative_evidence_write` | **AGT-WS-BUILD** (Build Lead), AGT-WS-PORTFOLIO | research, dependency-disposition, plan-coverage, delivery (author-side) |

**Independence is by principal.** A reviewer coworker's receipt is attributed to that coworker's principal; on a single-human-principal install the reviewer coworker is the *only* independent reviewer available, which is *why* the author (human or external agent) cannot self-approve and must route (`reviewer-identity.ts`). If no production coworker holds the grant, the packet escalates `no-eligible-reviewer` — activate one; do not proxy the receipt.

**One eligibility rule picks every lane owner.** `loadEligibleGrantHolders` (same file) returns the active, production, unarchived holders of a lane's grants, ordered by agent id. The reviewer routes use it, and so does the daily acceptance sweep for a **small or break-fix** item's delivery-coordinator evidence (`ACCEPTANCE_EVIDENCE_REQUIRED`, `DELIVERY_EVIDENCE_REQUIRED`). That lane has no reviewer packet: the sweep names the first in-platform holder of a grant that authorizes `record_execution_evidence` who did not deliver the item (the whole delivery-actor set is excluded: every agent that created, held or worked any of the item's rooms, its claimant, and the item's own agent — `delivery-actors.ts`, BI-099A0BA3), and its acceptance-verification room asks that coworker to record the runtime check (`apps/web/lib/backlog/acceptance-sweep/execution-evidence-owner.ts`, BI-7C7E8CAC). The terminal refusal still gives the author the small-shape hint.

## 5. Drive-to-completion checklist

For a `feature` initiative:

1. **Triage** the item (`triage_backlog_item`) — leaves `triaging`.
2. **Author the artifacts**: canonical design spec (with the Research & Benchmarking section) + phased plan under `docs/superpowers/`, DCO-signed and **pushed** to a resolvable branch.
3. **Bind the Workroom** to the item with real `baseSha` + `headSha` pointing at the pushed artifact (`adopt_worktree`).
4. **Get the recovery packet** (`claim_backlog_item_for_work`) → dispatch: research (AGT-WS-BUILD), design-spec + spec-approval (AGT-WS-REVIEW), architecture-review (AGT-WS-EA).
5. **Baseline minted** by spec-approval → **record plan-coverage** (`record_plan_backlog_coverage`, binds to the baseline) → dispatch plan-review (AGT-WS-REVIEW).
6. **Implement**; land the change via the normal PR/merge-queue path (build gate is provenance-blind — governance approves the *evidence*).
7. **Completion**: `record_execution_evidence` (delivery) → dispatch acceptance-review + `record_product_outcome_observation` (AGT-WS acceptance-reviewer) → close.

At every step, the **recovery packet is the authority on the next action** — read its `reviewerRoutes` / `escalations` / `unroutable`, act on them, and re-attempt. Do not guess the reviewer, and do not treat a reviewer requirement as a dead-end: it is a routing step.

## 6. Known limitation — reviewer dispatch can complete without writing a receipt

Routing a review correctly is necessary but not currently *sufficient*. A dispatched external reviewer coworker can finish a bound task **without executing its governed writer** — the coworker reads the pinned artifact, returns evidence-confirming prose, and completes with `executedToolCount: 0`, so no `record_initiative_*` receipt is ever written and the gate stays unmet. When this happens the initiative correctly refuses to advance (it has no receipt), but it also cannot be advanced by re-dispatching — the work strands at the reviewer step even though the operator routed it exactly right.

This is a tracked platform defect, **BI-ECFE0AC2** ("External initiative reviewers complete with zero tool executions, blocking governed terminal transitions"), under epic EP-E1F1DB58, with two observed contributing causes: the reviewer's terminal-writer context not hydrating its bound tools, and a stale Codex model catalog forcing a fallback that omits the writer. Until it is fixed, a `feature` initiative on a single-principal install can be fully authored, correctly bound, and correctly routed, yet still not reach `completion` — and that is the defect's fault, not a step the operator or author missed. Do not proxy the receipt from the author principal to "unblock" it: that would defeat the independence rule the gate exists to enforce (§2). Read the live BI for current status before assuming the strand is unfixed.

**A CLI reviewer that did write its receipt is no longer reported as missing it (BI-2E479619).** On a subscription install the reviewer usually runs on the Claude Code CLI adapter, which mounts the platform MCP server and runs `read_source_at_version` and the `record_initiative_*` writer itself. Those calls are recorded as `ToolExecution` rows with `executionMode: internal-mcp-session` and the TaskRun id, but the adapter does not return them to the loop, so runs that had minted a verified receipt were parked `input-required` with `noncompliance: prose-without-required-writer` and `executedToolCount: 0`. Now the loop and the executor fold this attempt's native rows into the run's tool records (`apps/web/lib/tak/native-mcp-executions.ts`), and the executor consults the TaskRun's persisted receipt (`loadTaskInitiativeReviewOutcome`) before it classifies a missing writer. A verified receipt completes the run with its `reviewOutcome`. A writer that ran and refused the packet is reported as a writer refusal with the writer's error text, not as prose noncompliance. Runs already parked that way are settled to their recorded receipt by the background dispatch reconciler (`healParkedReviewFromReceipt`), never re-dispatched. Native reader rows persist no result (`metrics_only`), so a native-reads-only turn still gets the ordinary "read the bound evidence" nudge: those rows count as tool calls but neither prove the traversal nor spend the read budget.

## 7. Closing a small or medium item: the baseline is the body (BI-0F8E39D5)

For ordinary small or medium work without prior approved scope, the objective
baseline is the acceptance criteria in its body. Do not create a spec solely
for that gate. A medium item retaining an independently approved repository
baseline keeps that approval's amendment writer: when the current design is
stale, use the server-issued independent spec-approval packet bound to the
existing baseline and current immutable artifact. Author body criteria cannot
overwrite it. Inherited scope remains owned by its parent; this route never
lets a child amend that parent. BI-31159978 repairs this ownership distinction.

For body-owned scope, the recovery packet distinguishes two refusals (DI-FDAB20135537):

- **`acceptance-criteria-missing`: the body has no criteria the parser can read.** Put them under a heading that contains "Acceptance" (for example `## Acceptance criteria`), one criterion per bullet, or use bullets that start with `AC-<id>:`. A bold line is not a heading. Update the body with `update_backlog_item` and retry. BI-FA769D87 was refused this way and closed minutes after its criteria moved under a heading.
- **`body-baseline-unpersisted`: the criteria are readable but no version is retained.** Follow the authorized body-baseline retention procedure above: a valid completion transition can retain the criteria and source identity, then fresh passing evidence and the exact independent acceptance packet are required. It never replaces an approved or inherited baseline or creates a passing receipt. Do not claim completion merely to obtain a baseline; the completion manifest must describe actual delivered work.

## Approval outcome readback

When a governed call returns an approval request, retain its `envelopeId` and
`inboxHref`. After the human decides, use `get_my_approval_status(envelopeId)` to
read the durable result before considering a retry. The tool requires the same
authenticated human and acting coworker; another user's or coworker's request
returns the same unavailable response as an unknown ID. It reveals no arguments
or raw tool results and confers no workroom admission or reviewer authority.

An approved request without execution evidence remains unknown. Confirm the
target operation's actual state before retrying; HTTP success from the approval
route alone is not delivery or acceptance evidence. The Inbox projects the same
safe outcome and recovery guidance, including execution refusals and expiry.

## Anti-patterns (observed)

- **Driving the workroom from gate-refusal errors instead of the packet.** Get the packet; it names every actor and hands you the call.
- **Self-approving, or declaring "the author can't do this, so it can't be done."** The author routes to the reviewer coworker; that is the design, not a blocker.
- **Guessing the reviewer coworker.** The packet resolves the current grant-holder; a guessed target (e.g. an architecture agent for a design-spec gate) will not hold the grant.
- **Binding a Workroom with a head but no base, or to a deleted/unresolvable commit.** No immutable artifact → no reviewer binding (`no-canonical-artifact`). Push the artifact; anchor base **and** head.
- **Proxying a stranded reviewer receipt from the author principal.** If a review strands (§6), that is a defect to report, not a licence to self-approve.


### Original review recovery across connection changes

For a paused independent review whose interactive OAuth connection changed,
read `get_backlog_item` with its exact `itemId` and `recoveryGate`. Submit the
returned `request_coworker` packet unchanged, including its `reviewRecovery`
target. Current paired Workroom access, human/coworker permissions and immutable
source must still authorize that review. Recovery retains the original TaskRun,
reader evidence and retry budget; it does not create a new assessment or transfer
another person's work. A stale or ambiguous target requires a fresh bounded read
and actual execution reconciliation. Never remove the locator to obtain a new
connection's task or treat uncertain provider effects as settled.

The [MCP authorization procedure](mcp-tool-authorization-runbook.md#recovering-an-original-initiative-review-after-a-connection-change)
describes the current-authority checks, generation reservation and approval
continuation. Completion still requires the original task's genuine governed
writer receipt and the readiness finding it actually records.

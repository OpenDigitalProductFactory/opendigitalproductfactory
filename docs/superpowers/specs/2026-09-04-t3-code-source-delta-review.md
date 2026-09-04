---
title: T3 Code source delta review for local-first agentic delivery
date: 2026-09-04
status: draft
scope: architecture research amendment
baseline:
  spec: 2026-09-03-local-first-agentic-delivery-throughput-design.md
  merge_commit: ac134727bf3ad312da6452e7433906e2aec39897
research:
  t3_commit: 4e547318b60031eb546d8cf2b84ad9fa0785a87a
  transcript: Fable 5.1.txt
backlog_item: BI-6E750AD8
workroom: WC-C515439E
decision: DI-580C8D86B161
---

# T3 Code source delta review

## 1. Purpose and boundary

This is a delta to the merged
[`2026-09-03-local-first-agentic-delivery-throughput-design.md`](2026-09-03-local-first-agentic-delivery-throughput-design.md),
not a second design. It answers the concrete T3 follow-up questions and changes only
acceptance detail that materially improves verified throughput, recovery, or operator
attention. The existing decisions remain fixed: Build Studio is the cockpit;
Pipeline, Thread, and Attention are lenses over one Workroom projection; the two
local installations are primary execution capacity; Git worktrees isolate writers;
cloud CI protects delivery; and the 20% refactoring lane remains evidence-led.

The review inspected T3 Code at immutable commit
[`4e547318b6`](https://github.com/pingdotgg/t3code/tree/4e547318b60031eb546d8cf2b84ad9fa0785a87a),
dated 2026-09-03. Findings from code and documentation are pinned to that revision.
Open issues are reproducible reports, not proof that every installation is affected.
No T3 runtime was installed or executed; its repository had no dependencies present.
“Actual behavior” therefore means code-path inspection, shipped tests, and issue
reproduction evidence rather than a local end-to-end trial.

## 2. Evidence taxonomy

- **Verified fact:** immutable DPF source, merged PR/commit, live DPF MCP record, or
  T3's own version-pinned documentation/contract.
- **Code-level observation:** behavior traced through the pinned T3 implementation;
  high confidence about that revision, without claiming production prevalence.
- **Issue evidence:** maintainer/user reproduction with a direct issue link; useful
  failure evidence, not a measured incidence rate.
- **Vendor claim:** product or sponsor statement that needs a DPF-controlled trial.
- **Transcript anecdote:** first-person report from `Fable 5.1.txt`; hypothesis only.
- **Inference:** the DPF implication drawn from two or more sources; labelled as such.

The transcript's T3 references at lines 302–368 describe branch-based PR linking,
takeover, remote execution, multi-PR cleanup, monitoring, merge, and auto-archive.
Lines 375–403 describe a selected model cohort and review-tail outcomes. These remain
anecdotes. The pinned source verifies mechanisms, not the speaker's throughput or
model-causality claims.

Sponsor references do not change the baseline: Blacksmith/Codesmith claims at lines
16–31 remain vendor claims about CI speed, runner cost, automated fixes, and Slack
control; General Translation at lines 236–248 remains a disclosed localization
sponsor. Neither justifies procurement or new substrate in this delivery design.

## 3. Direct answers to the follow-up questions

### 3.1 What is canonical in T3?

**Code-level observation, high confidence:** the T3 orchestration thread is the
durable coordination identity. A project supplies the environment-local repository
and workspace root. Branch and worktree path are mutable thread metadata. The
provider session is a replaceable runtime binding with provider, status, active turn,
and error. The contracts expose all four separately in
[`orchestration.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/packages/contracts/src/orchestration.ts#L329-L408)
and the thread carries branch, worktree, linked PR, activity, checkpoints, and session
in the same projection
([lines 477–536](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/packages/contracts/src/orchestration.ts#L477-L536)).

**DPF implication:** this supports, rather than challenges, §6. Workroom is canonical;
WorkCase/WorkItem and TaskRun describe work and execution; branch, SHA, worktree,
installation, and provider session are observed bindings. DPF must not make a Codex,
Claude, or T3 thread the cross-surface identity.

### 3.2 Are branch/worktree/thread transitions atomic?

**Code-level observation, high confidence:** not across SQL and Git. T3 totally orders
orchestration commands and commits event, projection, and idempotency receipt in one
SQL transaction
([overview](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/docs/internals/overview.md#L61-L88)).
Worktree bootstrap creates the thread, performs Git/filesystem work, then updates
thread metadata; cleanup on failure deletes orchestration state
([`ws.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/server/src/ws.ts#L939-L1182)).
The metadata command has `expectedBranch`, but no complete prior-binding compare for
worktree path/session
([contract](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/packages/contracts/src/orchestration.ts#L895-L905),
[`decider.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/server/src/orchestration/decider.ts#L786-L833)).
[Issue 3753](https://github.com/pingdotgg/t3code/issues/3753) correctly states that
`git worktree add` alone cannot move the session, terminal, checkpoint, diff, status,
and cleanup bindings. [Issue 9085](https://github.com/pingdotgg/t3code/issues/9085)
shows one archive/delete path that can orphan the physical worktree.

**DPF implication:** §6 now specifies a version-checked saga: record intent, fence the
old writer, act externally, verify, finalize, or compensate. This uses the existing
Workroom identity, activity/evidence trail, workspace state, lease, TaskRun, and Git
facts; it does not require a new queue or Workroom ledger.

### 3.3 How are PR, checks, review, and merge linked?

**Code-level observation, high confidence:** a thread can carry an explicit PR
identity `(projectId, repository, number)`. T3 also discovers a PR from current
repository/branch context. Settlement is server-owned, validates the exact linked PR,
and refuses to derive completion in the client
([overview](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/docs/internals/overview.md#L92-L105),
[`ThreadSettlementReactor.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/server/src/orchestration/ThreadSettlementReactor.ts#L50-L132)).
The pinned commit adds a targeted post-turn refresh so a PR opened by an agent outside
the controller is discovered without continuous global polling.

Branch lookup is not authoritative. [Issue 4970](https://github.com/pingdotgg/t3code/issues/4970)
reports a reused branch inheriting an old merged PR, while
[issue 8209](https://github.com/pingdotgg/t3code/issues/8209) reports a feature branch
being associated with its non-default base branch's PR.

**DPF implication:** §8 now makes branch a discovery hint and requires repository,
PR number, head ref, and head SHA agreement before settlement. The useful new pattern
is edge-triggered, targeted reconciliation after a turn or head change—not another
polling service. DPF remains stricter: merge is not verified delivery.

### 3.4 How does reconnection and takeover recover active work?

**Code-level observation, high confidence:** a disconnected client does not own the
session; the server continues. On server restart, T3 identifies projected running
sessions with no live provider. It continues only a deliberately marked session with
a usable resume cursor; otherwise it records an orphaned-session error and clears the
active turn
([`serverRuntimeStartup.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/server/src/serverRuntimeStartup.ts#L305-L623)).
Provider-instance switching preserves native context only when continuation identities
are compatible and a cursor survives; some model/provider changes force a restart
([`ProviderCommandReactor.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts#L598-L814)).
[Issue 4766](https://github.com/pingdotgg/t3code/issues/4766) shows why a compatible
instance switch can still silently lose native context after a stopped session.

**DPF implication:** §10 now separates client reconnect, server restart, provider
restart/switch, and installation takeover. A handoff must state separately whether
the durable Workroom timeline, Git state, provider-native context, process, and cursor
survived. Unknown context is a visible downgrade, never a transparent resume claim.

### 3.5 How does the task hub decide what needs attention?

**Code-level observation, high confidence:** T3 emits a compact thread shell for lists
and loads detail separately. Status precedence favors approval, input, working, plan,
monitoring, then completion. Activity does not reorder sidebar rows, avoiding a list
that moves under the pointer. Only three nearby rows are prewarmed
([`Sidebar.logic.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/web/src/components/Sidebar.logic.ts#L27-L70),
[status priority](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/web/src/components/Sidebar.logic.ts#L197-L216),
[stable ordering](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/web/src/components/Sidebar.logic.ts#L587-L605)).

**Inference, high confidence:** T3's restraint is more valuable than its badges:
stable placement, compact shells, explicit unseen completion, and bounded detail
subscriptions reduce attention and host work. DPF §7 already has the stronger semantic
attention filter; it now adds stable active ordering and a subscription budget.

### 3.6 What if the worktree disappears beneath a session?

**Code-level observation, high confidence:** before a new turn, T3 notices a missing
persisted worktree, prunes Git metadata, and attempts to recreate it
([`ProviderCommandReactor.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/server/src/orchestration/Layers/ProviderCommandReactor.ts#L482-L526)).
That is best-effort and turn-bound. [Issue 4723](https://github.com/pingdotgg/t3code/issues/4723)
reports deletion during a live session leaving an active-turn marker that prevents
both UI archive and reaping. The reaper skips any session with `activeTurnId`
([`ProviderSessionReaper.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/server/src/provider/Layers/ProviderSessionReaper.ts#L56-L85)).
[Issue 4713](https://github.com/pingdotgg/t3code/issues/4713) independently reports a
terminal turn with session state stuck running and a stop command that is accepted but
cannot act.

**DPF implication:** §12 now requires independent reconciliation of resource, process,
TaskRun, provider session, and active-turn liveness. No single stale active flag may
block repair or reaping indefinitely. Cleanup is idempotent and missing resources are
an already-applied step, not an unrecoverable error.

### 3.7 What survives checkpoint revert?

**Issue evidence, medium confidence:** [issue 6127](https://github.com/pingdotgg/t3code/issues/6127)
reports that reverting restores files and visible timeline but the Claude provider
still sees reverted turns. Git state, displayed history, and provider-native context
are distinct stores.

**DPF implication:** DPF must not offer a semantic “rewind” unless all three layers are
verified. A safe fallback starts a new provider session from the retained evidence and
decision digest while preserving the superseded history for audit.

### 3.8 How are large lists and event streams kept performant?

**Code-level observation, high confidence:** shell subscriptions accept
`afterSequence`; a bounded persisted replay falls back to a snapshot when the gap is
too large
([contract](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/packages/contracts/src/orchestration.ts#L662-L735),
[`ws.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/server/src/ws.ts#L1459-L1622)).
Thread detail uses cursor pagination. Live activity uses a short bounded window that
coalesces only repeated updates for the same tool call and preserves lifecycle
boundaries
([`ThreadLiveEventCoalescer.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/apps/server/src/orchestration/ThreadLiveEventCoalescer.ts#L51-L177)).

These controls are necessary, not sufficient. [Issue 5681](https://github.com/pingdotgg/t3code/issues/5681)
reports provider-native subagent progress delaying unrelated threads;
[issue 5722](https://github.com/pingdotgg/t3code/issues/5722) reports passive sidebar
rows keeping VCS work active; and [issue 4178](https://github.com/pingdotgg/t3code/issues/4178)
reports read-model and client/VCS state growing with lifetime thread count.

**DPF implication:** §§7 and 12 now require visibility-scoped detail, cancellation,
bounded replay with snapshot fallback, stable-key coalescing only for replaceable
progress, and per-workroom/provider backpressure so a noisy worker cannot delay an
unrelated delivery or operator command.

### 3.9 How does usage and cost accounting work?

**Verified T3 documentation and code, high confidence:** T3's Usage page reads local
provider histories and combines Codex, Claude, and Grok usage across connected
environments. It displays API-equivalent token cost, processed tokens, cache savings,
provider/model breakdowns, and subscription windows; it explicitly says raw token
cost is not subscription billing
([usage guide](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/docs/user/usage.md)).
Its contract separates uncached input, cached input, cache creation, output, and
reasoning tokens, with reasoning treated as a subset of output
([`usage.ts`](https://github.com/pingdotgg/t3code/blob/4e547318b60031eb546d8cf2b84ad9fa0785a87a/packages/contracts/src/usage.ts#L68-L105)).

[Issue 5793](https://github.com/pingdotgg/t3code/issues/5793) reports provider-native
child totals including inherited parent history, causing double counting when raw
cumulative totals are summed. [Issue 7075](https://github.com/pingdotgg/t3code/issues/7075)
reports a large provider history exhausting server heap on resume.

**DPF implication:** §9 now distinguishes context occupancy from incremental usage,
API-equivalent price from subscription allocation and invoiced spend, and inclusive
provider totals from attributable parent/child deltas. Cost per verified result is
unusable unless completeness and attribution method travel with the observation.

## 4. Findings matrix

| T3 pattern or failure | Evidence class | DPF classification | Design delta | Confidence |
| --- | --- | --- | --- | --- |
| Thread is durable identity; project, worktree, branch, and session are separate bindings | Pinned contract/code | Already covered | Confirms Workroom as canonical in §6 | High |
| Ordered command queue, idempotent receipts, transactionally consistent event/projection writes | Pinned architecture doc/code | Already covered | Keep DPF transitions server-owned; do not add a second queue | High |
| Git/filesystem transition is a saga and partial failure can orphan resources | Pinned code plus issues 3753/9085 | Covered but needing amendment | Full-binding compare, intent/fence/verify/finalize/compensate in §§6/12 | High |
| Missing worktree is recreated only at a turn boundary; stale active markers can wedge cleanup | Pinned code plus issues 4723/4713 | Covered but needing amendment | Independent liveness reconciliation and bounded recovery in §12 | High |
| Server owns settlement and continues without a client | Pinned architecture/code | Already covered | Confirms §§8/12 | High |
| Post-turn targeted PR discovery catches agent-created PRs | Pinned current commit | Covered but needing amendment | Edge-triggered discovery in §8 | High |
| Branch-only PR association can select an old/base PR | Issues 4970/8209 | Covered but needing amendment | Branch is hint; immutable PR/head agreement is authority | Medium-high |
| Provider-native continuation depends on compatible identity and cursor | Pinned code plus issue 4766 | Covered but needing amendment | Explicit resume matrix and context downgrade in §10/§11 | High |
| Compact shell/detail split, stable ordering, three-row prewarm | Pinned UI code | Already covered | Adds stable ordering/subscription budget to §7 | High |
| Cursor replay, snapshot fallback, detail pagination, narrow coalescing | Pinned contract/code | Already covered but needing amendment | Concrete non-coalescible boundaries and cancellation in §12 | High |
| Provider-native child activity can flood shared ingestion | Issue 5681 | Covered but needing amendment | Per-workroom fairness/backpressure under `BI-C41AB195`/`BI-7C1F43E3` | Medium-high |
| Usage separates token classes and labels API-equivalent cost | Pinned docs/code | Covered but needing amendment | Attribution and billing semantics in §9 | High |
| Child cumulative totals can double count inherited parent history | Issue 5793 | Genuinely missing and worth adding | Add to existing scorecard BI; no new BI | Medium-high |
| Resume can load unneeded giant history and exhaust heap | Issue 7075 | Covered but needing amendment | Metadata-only/bounded resume and payload ceilings under async hub/session rollup | Medium-high |
| File/timeline revert may not rewind provider context | Issue 6127 | Genuinely missing and worth adding | New-session fallback and visible context boundary under profile/session BIs | Medium |
| Global T3-style thread/session ledger across installations | Architectural comparison | Unsuitable for DPF | Violates one Workroom/MCP authority and installation ownership | High |
| Shared writable worktree for parallel writers | T3 issue evidence and DPF doctrine | Unsuitable for DPF | Conflicting branch/process state; retain one writer per worktree | High |
| Auto-archive or close on merge alone | T3 source/transcript | Unsuitable for DPF | DPF requires served/deployed SHA and acceptance evidence | High |
| Copy sponsor products as the solution | Transcript advertising | Unsuitable without trial | Local-first baseline and controlled procurement review remain | High |

## 5. Exact delta against the canonical design

| Canonical section | Finding | Amendment applied |
| --- | --- | --- |
| §3 Evidence and confidence | Original review cited T3 generally | Pin this review to commit `4e547318b6`; preserve source/anecdote/vendor distinctions |
| §6 Canonical delivery rail | Identity was clear, replacement mechanics were not | Workroom remains identity; complete execution binding changes through a verified compensating saga |
| §7 Build Studio UI contract | Attention semantics were strong but subscription/row-stability behavior was implicit | Stable active ordering; compact shell; detail/VCS subscriptions scoped, coalesced, bounded, cancelled |
| §8 PR and review-tail convergence | Creation result plus branch did not cover PRs opened inside an agent terminal or branch false positives | Add post-turn targeted discovery; branch is hint; require exact repository/PR/head agreement |
| §9 Delivery outcome scorecard | “tokens/cost” did not define token classes or billing/attribution semantics | Separate input/cache/output/reasoning, cumulative vs incremental, API-equivalent vs actual spend, parent vs child |
| §10 Two-install fabric | Handoff was specified but reconnection classes/context survival were implicit | Separate client/server/provider/install transitions; declare surviving state and explicit downgrade |
| §12 Failure, security, and scale | Bounded reads/backpressure were broad | Add independent liveness, idempotent cleanup, replay fallback, non-coalescible events, and attribution rules |
| §13 Backlog delta | Existing BIs had broad scopes | Add exact acceptance amendments below; no new BI |
| §15 Design acceptance | Did not require this source delta to reach implementation contracts | Require the six amendment families to be carried into the existing BIs |

## 6. Ranked recommendations and backlog reconciliation

Benefit is expected improvement in verified throughput or operator attention, not raw
agent activity. Cost and risk are relative implementation judgments. Dependencies
name existing BIs only.

| Rank | Amendment | Benefit | Cost | Risk | Existing owner/dependency |
| ---: | --- | --- | --- | --- | --- |
| 1 | Complete-binding saga and independent liveness reconciliation | Very high | Medium | Medium | `BI-7C1F43E3`, `BI-8D56F777`, claim/projection prerequisites |
| 2 | Immutable PR identity plus post-turn targeted discovery | High | Medium | Low-medium | `BI-06AE6833`; PR inventory/check projections |
| 3 | Fair, bounded event/replay/subscription pipeline | High | Medium-high | Medium | `BI-7C1F43E3`, `BI-05D7A0DC`, `BI-C41AB195` |
| 4 | Explicit continuation/takeover matrix and context downgrade | High | Medium | Medium | `BI-C41AB195`, `BI-A472354E`, durable resume contract |
| 5 | Incremental parent/child usage and actual-spend semantics | Medium-high | Medium | Low-medium | `BI-69803ACC`, `BI-A472354E` |
| 6 | Stable attention ordering and visibility-scoped hydration | Medium | Low-medium | Low | `BI-9DC43E17`, `BI-05D7A0DC` |
| 7 | Provider-context-safe revert behavior | Medium | Medium-high | Medium-high | `BI-C41AB195`, `BI-A472354E` |

### Existing BI amendments

- **`BI-9DC43E17` — delivery rail:** expose stable Workroom shell rows; show binding
  conflicts and stale sources; do not reorder active rows for noisy activity; hydrate
  detail only for selected/visible rows.
- **`BI-06AE6833` — review-tail loop:** discover a missing PR after relevant turn/head
  events; accept branch only as a lookup hint; persist exact PR identity and reject
  stale/base/historical head matches before merge/closeout.
- **`BI-1CB9D97B` — campaigns:** schedule dependency-ready Workrooms, not provider
  sessions; include per-workroom event fairness so a fan-out campaign cannot starve an
  unrelated operator command; preserve the 20% evidence-backed refactoring lane.
- **`BI-69803ACC` — scorecard:** store incremental token classes, attribution basis,
  completeness, price source/time, and billed-vs-equivalent semantics. Deduplicate
  inherited parent history and report child-inclusive and child-exclusive totals.
- **`BI-A472354E` — execution profiles:** define provider continuation compatibility,
  cursor support, context-history policy, metadata-only resume capability, payload
  ceiling, compaction/revert behavior, and explicit fallback to a bounded handoff.
- **`BI-8D56F777` — paired scheduler:** treat Workroom binding change as a fenced,
  version-checked saga; reconcile worktree/process/lease separately; record orphan
  resources and idempotent cleanup.
- **`BI-05D7A0DC` — async hub:** use monotonic cursor replay with a bounded gap and
  snapshot fallback; separate shell from detail; cancel inactive subscriptions; never
  coalesce approvals, failures, ownership, lifecycle, or terminal evidence.
- **`BI-C41AB195` — session rollup:** distinguish lead/worker child progress from the
  provider session; retain parent/child identity and attribution; publish which state
  survives reconnect/restart/switch/takeover; prevent a stale active child/turn from
  wedging the Workroom.
- **`BI-7C1F43E3` — concurrency pilot:** add adversarial fixtures for partial worktree
  create/delete, disappearing worktree during a turn, terminal turn with stale session,
  event flood fairness, oversized resume payload, and cursor-gap snapshot recovery.

No new BI is justified. Every useful missing deliverable fits one of these live
implementation slices, and a separate T3 queue, task ledger, or filesystem authority
would create the reconciliation problem this design is intended to remove.

## 7. Architecture and UX review

### Architecture fit

The source review strengthens the existing architecture. T3's good mechanisms map to
DPF's present substrate: Workroom identity/lease/activity, WorkCase/WorkItem demand,
TaskRun execution and parentage, `BuildExecutionProvider`, PR/check/review facts,
evidence, closeout, and installation-aware placement. The only genuinely missing
requirements—incremental child-cost attribution and provider-context-safe revert—fit
existing scorecard/profile/session BIs. No new durable entity is required by this
design delta.

Kernel decision `DI-580C8D86B161` compared: research-only; amendments on the existing
substrate; and a T3-like global ledger/queue. It selected the existing-substrate
amendment with high confidence and no commandment conflict. The largest positive
pulls were research/standards, single source of truth, and treating worktrees as
source-control rather than runtime isolation.

### UX fit

**UX fit review — Build Studio multi-delivery cockpit**

- **Decision:** fits-with-guardrails.
- **Owning area:** Platform.
- **Route family:** the existing Build Studio `/build` family; no new global or
  section navigation.
- **Primary persona:** the contributor/platform operator monitoring delivery outcomes
  without remembering provider, session, or repository internals.
- **Navigation layer touched:** local lenses and contextual recovery actions only.
- **Reuse/convergence:** compose existing report-kit status, table, notice, loading,
  and progressive-disclosure primitives; do not create a T3-styled component family.
- **Source truth:** the canonical Workroom projection over WorkCase/WorkItem, TaskRun,
  Git/PR/check/review, evidence, closeout, and installation observations.
- **Empty/failure behavior:** keep confirmed facts visible as stale/partial; provider
  absence never becomes an empty success state; contradictions name one safe action.
- **AI boundary:** status and drill-down controls do not send prompts. Any recovery,
  takeover, merge, or other consequential action uses the existing authority and
  confirmation contract.
- **Evidence before implementation merge:** route/read-model tests, attention and
  stable-order fixtures, source-partial/failure fixtures, route-budget measurement,
  keyboard/screen-reader coverage, and desktop/narrow browser verification.
- **Captured in:** this section and canonical design §7.

The amendment does not add a new surface. It sharpens the existing Pipeline, Thread,
and Attention lenses:

- rows stay spatially stable while edge status and unseen completion change;
- one stable Workroom summary survives refresh and provider partial failure;
- `Needs attention` is reserved for an owned executable next action;
- binding/context conflicts use plain state-specific language, name the surviving
  evidence, and offer one safe recovery action;
- worker/session/token detail remains progressive disclosure;
- reconnect never blanks confirmed content or reports an empty success state; and
- accessibility and route-budget requirements from §7 remain mandatory.

### Security and local-install implications

- A worktree is not process, credential, network, or runtime isolation. Each provider
  process keeps the installation's existing least-privilege grants and data policy.
- Takeover fences the old writer before the new installation adopts the branch. A
  synchronized BI never transfers mutation authority.
- Remote clients authenticate to an installation; they do not become a new source of
  work truth. Server-owned convergence/recovery continues without a connected client.
- Resource pressure includes provider processes, Git/VCS subprocesses, event queues,
  resume payload size, and retained histories—not just nominal agent count.
- Cleanup never follows an unverified path from stale projection data. It compares the
  current repository/worktree binding and records partial failure for recovery.

## 8. Verification and unresolved questions

This amendment is documentation-only. Required verification is Markdown/doc lint,
semantic architecture review, UX-fit review, DCO, PR checks, and the source links in
this document. It does not prove any implementation BI complete.

Questions intentionally left to the owning implementation plans:

1. Which existing Workroom status/activity representation will carry binding intent,
   compensation, and orphan inventory without adding a new table?
2. What provider-specific cursor and continuation capabilities can be verified rather
   than inferred for each `BuildExecutionProvider` adapter?
3. What replay-gap, coalescing-window, subscription, retained-history, and resume
   payload ceilings fit the two measured local installations?
4. Which provider records expose actual billed spend, and where must DPF report only
   API-equivalent estimates or subscription allocation?
5. Which failure injection harness can terminate a process or remove a worktree safely
   while proving that a stale active marker cannot wedge recovery?

These are implementation measurements and adapter decisions, not reasons to defer the
canonical contracts added here.

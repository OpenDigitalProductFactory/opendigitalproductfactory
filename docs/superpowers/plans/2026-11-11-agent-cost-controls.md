---
status: draft
---

# Agent cost controls implementation plan

Parent: BI-7B1D74B3. Workroom: WC-37CCCC19.
Design: ../specs/2026-11-10-agent-cost-controls-design.md at
f5cf14baf863f53cee02899352fa3902c042d274, blob
34cc7f93c52073af755b9b1aad3cc9047eaef9e6.

This is preparation, not implementation admission or a coverage receipt.
Architecture review passed; independent scope approval and immutable plan coverage
remain required. Preserve the review source while those requests are unresolved.

## Verified closeout audit — November 14, 2026

Disposition: **blocked; not complete and not eligible for archive**. This audit
preserves the existing work; it is not a replacement approval, scope baseline,
coverage receipt or claim that implementation shipped.

| Original objective | Verified disposition | Existing owner/result |
|---|---|---|
| Evaluate TokenEconomizer and ground the design | Research and architecture receipts passed; independent specification approval remains unresolved. | BI-7B1D74B3, WC-37CCCC19; immutable design at f5cf14baf863f53cee02899352fa3902c042d274. |
| Learning across independent sessions | Not implemented; intake remains triaging. Privacy and provenance findings are preserved. | BI-E3343528; evidence cmwgsdk9d06o30eoxugg8k5gp. |
| Reversible tool disclosure | Not implemented; intake remains triaging. Existing token loading is not per-chat adaptive pruning. | BI-A8387D6B; evidence cmwgsdkap06o60eoxea5hir4s. |
| Failure-loop protection and tooling repair | Not implemented; reproduced stale-refusal defect and its required regression are recorded. | BI-3CE8C348; evidence cmwgs9oc806bq0eoxvyvxmvfe. |
| External chats, coworkers and workrooms | No verified new executor support or standalone-chat enforcement delivered. | BI-54A5A2E8; evidence cmwgsejnj07530eoxfual5trm. |
| Demonstrate lower total spend without worse outcomes | Comparison and live verification remain unrun. No savings claim. | All four delivery slices; existing cost and outcome owners. |
| Repair the restart-related enrollment interruption | Narrow test layers passed historically; the complete repair remains unimplemented and its design reviews failed. | BI-224F56F1 / WC-228D7A07; preserved source 01d6440e11da37096a9b9fddd538187f16ccd2d5 and candidate 184bdae2f8b4e54444d8bc766635dc511fb9f37e. |

Fresh GitHub branch searches found no pull request for the cost-control,
restart-recovery or owned-task-readback branches. Current live records likewise
contain no delivered cost-control children. Local source and pushed documentation
are preservation artifacts, not deployed behavior.

### DPF2 reconciliation

Read-only inspection of DPF2 at 96cfcdb2dfeeaf47fbab6d1894f0fcd6a95d69ef,
including its active implementation, tool-composition and routing contracts,
found neither an accepted implementation of these mechanisms nor an explicit
supersession of this thread's objectives. Therefore none is retired merely
because a successor exists. Its runtime and authority owners remain separate;
no DPF2 source, lane, data, dependency or runtime was changed. Future consumption
must use its existing owners and receiving tests, rather than copying the legacy
implementation or declaring fixture behavior operational.

### Exact dependency and resumption

The parent still returns `original-review-ambiguous` for specification approval.
Its original requests ending 2158B4CB3C7B and 80F2043E2445 remain respectively
`input-required/terminal-writer-retry-exhausted` and
`input-required/terminal-writer-rejected`, bound to the unchanged f5 design.
Neither has a passing recorded specification receipt. Retain their complete
native identities/digests; do not construct a replacement or replay them.

The existing result-reader repair is BI-CAP-21C511CA / WC-0750EFD3, owned by the
existing owned-task-readback chat. Its current plan review failed in receipt
initiative-review-v1-6c3830da34fed0812ee7d3a2b849e630648876cade54b12f88fab5fb9983a16f:
the architecture receipt excludes section 9, so whole-scope architecture and
corrected plan approval are still owed. The owning reviewer/coordinator must
provide the supported correction; the implementation owner then delivers the
same-identity bounded reader through normal review and protected publication.
Only actual original-result readback and the permitted original review remedy
can resolve the parent's approval hold. Reader availability alone is not approval.

After that: obtain the actual baseline, record immutable decomposed plan coverage
against the existing four items, pass plan review, implement and verify each
admitted slice, deliver through protected PR/canonical deployment, and compare
actual outcomes and net cost. The separate, unselected restart worker proposal
is not a blanket prerequisite for this sequence.

For agentic workers: execute one independently reviewable backlog item at a time,
with its own branch and PR. Use dpf-tdd, dpf-local-merge-ci-before-push and
dpf-pr-with-dco. Refresh source and claim exact paths before each child begins.

## Backlog coverage

Decision intended: decomposed. Reuse these existing delivery intakes; reconcile
their live criteria and overlap before admission. No coverage has been recorded.

| Deliverable | Existing BI | Requirement | Contract | Flow | Verification |
|---|---|---|---|---|---|
| Scoped learning | BI-E3343528 | OBJ-1 | memory provenance and scope | observe-confirm-recall | AC-1 |
| Reversible disclosure | BI-A8387D6B | OBJ-2 | disclosure without grant changes | expose-observe-select-restore | AC-2 |
| Loop recovery and tooling repair | BI-3CE8C348 | OBJ-3, OBJ-4 | bounded recovery and repair evidence | fail-classify-redirect-repair-verify | AC-3, AC-4, AC-5 |
| Executor support and measurement | BI-54A5A2E8 | OBJ-5 | normalized observations with explicit unknowns | observe-adapt-compare | AC-6, AC-7 |

## 1. Learning: independently shippable, observation first

Extend existing tak memory-acquisition, memory-consolidation, memory-scope and
memory-corpus-promotion owners. Use ImprovementSignal evidence for candidates;
retain distinct persisted session identities, provenance, currency and access.
Do not use CoworkerMemoryNote.useCount as corroboration. Define bounded evidence
retention in the existing owner before persistence changes. Verify replay within
one session cannot confirm a fact; distinct sessions can; contradictions, expiry,
revoked access and privacy restrictions prevent recall. Exercise actual scoped
memory writes and subsequent recall on the served target before activation.

## 2. Disclosure: independently shippable after exposure evidence exists

Extend tak/tool-intent and mcp/tool-tier and tool-session-store. The current store
appends loaded tools with a token-scoped TTL; preserve explicit loads and expiry.
Record actual exposure with usage in existing task artifacts; missing exposure
means unknown. Compute proposals at session boundaries, freeze within a turn,
retain discovery, required controls and explicit restore. Do not remove tools to
conceal defects. Test exposed-but-unused versus unavailable, required tools,
restoration, grants unchanged, store failure and stable ordering/cache prefixes.
Verify discovery, invocation and restore through served MCP, not only pure tests.

## 3. Loop recovery and tooling repair: independently shippable

Extend tak/runtime-issues and agentic-loop, existing improvement writers and
operate/mcp-call-efficiency classification and aiops-handoff. Existing detection
groups tool+argument signatures; add structured failure evidence across argument
changes without changing existing hard-stop or authorization precedence. Exclude
native audit-only calls. Reset on successful recovery; do not count ordinary
polling as failed progress. Bound redirects and signal emission per run. Test
changed arguments, recovery reset, progressing calls, refusal, transient outage,
discovery miss and unsupported capability separately. Deduplicate repair signals
by stable origin, preserve owner and require functional success before closure.
Verify one failed served workflow recovers and emits one linked repair finding.

### Confirmed repair case: stale refusal after a legitimate room handoff

Include this case in BI-3CE8C348, not a new carrier or a prerequisite to all
feature work. On November 14, the existing feature room WC-37CCCC19 still named
the old synthetic executor and its November 13 expired lease. Normal adoption
and the design claim returned `branch_occupied`. A fresh room read followed by
`reassign_workroom_executor`, with expected executor and lease-holder comparisons,
successfully assigned this chat and renewed its lease. One subsequent claim with
the original arguments was parked as the prior refusal without reevaluation.
Normal refresh of the existing planning path then succeeded; no cache clearing,
force flag, new branch or cosmetic argument change was used.

Source at `9e865eb7db79b375a5e39e7d839396896c9d132b` explains this bounded case:
`work-capsule-branch-identity.ts:isReusableLiveCapsule` permits the matching
executor, while `govern/authority/refusal-breaker.ts:refusalBreakerScope` hashes
the contextual room ID/grants but not the target branch's changed executor.
Its refusal window is 30 minutes. This is evidence of a missing decision-state
invalidation path, not evidence that a correct authorization denial should be
ignored. Retain the exact original review identities and their separate hold.

Plan a regression that exercises the real authoritative room predicate through
the breaker: unchanged refused input remains cached; a supported handoff changes
the relevant branch/session facts and causes one fresh evaluation; unrelated
room changes do not flush the cache; and unavailable facts or a real denial stay
closed. Use only the decision-relevant state, not a fresh timestamp or all room
updates that would defeat loop suppression. Validate all required access before
loading target facts. The normal current item admission and impact contract must
cover this source change before implementation. Those tests are not yet run.

## 4. Executor adapters and comparison: independently shippable after core contracts

Extend workroom-runtime/types, codex-app-server-adapter and claude-stream-adapter
with backward-compatible tool-outcome, usage and completion observations. Keep
missing events unknown; deduplicate replays. Verify each supported executor's
real events and guidance delivery. Update client-capabilities only from observed
support. Standalone chats without verified observation/injection stay explicitly
unsupported; a workroom association alone does not install controls there.
Use existing thread-cost-ledger and context-economy-metrics for enabled/disabled
comparisons including uncached input, cache reads/writes, output and optimization
calls. Compare completion, latency, false redirects and restore frequency along
with cost. No savings claim before measured evidence.

## Source anchors and unresolved data boundaries

At the reviewed feature head, `runMemoryAcquisitionSweep` deduplicates experience
`sourceRef` values, while `MemoryExperienceSource` carries source kind/ID and
agent identity. Those experience IDs are not proof of distinct persisted chats.
Map real source-to-session relationships before counting corroboration; unknown
or repeated sessions cannot confirm a candidate. Existing memory acquisition,
scope, consolidation and corpus-promotion tests are the starting suites.

The recorded `ImprovementSignal` model has no user/organization privacy scope;
its intake can project descriptions into the platform backlog. Do not put private
facts or sensitive learning content there. `UserFact` already owns user/scope/
sensitivity and source-message provenance, while `CoworkerMemoryNote` is
agent-scoped. Resolve bounded corroboration provenance in the appropriate existing
owner, with its data-architecture review if fields must change. A recurrence
counter or a global signal cannot substitute for that scoped evidence contract.

`selectToolsForListing` currently preserves the authorized tier floor and the
explicitly loaded set; `loadToolsForSession` appends tools for a 30-minute token
session. Token identity alone does not distinguish chats that share credentials.
The disclosure slice must identify verified exposure/session boundaries before
proposing pruning, retain explicit loads and restores, and test the unchanged
authorization path. Stateless session-JWT defaults and full lazy-host catalogs
must not be treated as proof of per-chat observation or pruning support.

The runtime adapters currently emit messages, turn completion and permission
requests. Add actual tool outcome/usage observations to `workroom-runtime/types`
and both adapters before claiming executor support. Validate captured real events,
including missing/duplicate events, against the existing cost ledger. The current
runtime-issue tests, `operate/mcp-call-efficiency` analysis/refusal/handoff tests,
tool-tier tests and context-economy metric tests supply the starting boundaries;
each admitted child still needs its exact-source functional verification.

## Gates, deployment and rollback

For this plan's documentation scope, gate context reports no testImpact or
guardObligations and requires doc-index and doc-impact derived checks. Each child's
runtime diff needs a fresh impact contract, affected tests and package typecheck,
exact-source integration evidence, independent review and DCO PR. Do not transfer
documentation exemptions to runtime code. Apply migrations through canonical
procedures if schema changes become necessary. Use the governed served target
for workflow evidence; coordinate canonical deployment with its existing owner.
Roll back by disabling new controls through existing configuration, restoring
advertised tools and retaining learning/repair evidence. Unknown compatibility
keeps controls in observation mode. Close the parent only after child delivery,
baseline reconciliation and all seven acceptance criteria have actual evidence.

---
title: Shared Change Reviewer Control Implementation Plan
date: 2026-07-27
status: active
item: BI-67E23B70
epic: EP-BUILD-65837F
spec: docs/superpowers/specs/2026-07-27-shared-change-reviewer-control-design.md
---

# Shared Change Reviewer Control Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable
> backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for
> red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's
> completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Objective

Close the semantic-review timing gap between Build Studio and external coding
surfaces with one independently authored review contract and one governed
Change Reviewer coworker. Preserve GitHub as a second oracle and reuse the
existing evidence, activation, and finding-verification substrate.

## Backlog coverage

Coverage receipt: `cms2n13cq023t01qqh8pfe5c2` (`decomposed`).

| Deliverable | Backlog item | Depends on |
|---|---|---|
| Governed Change Reviewer definition and lifecycle | BI-DED7D653 | — |
| Shared semantic review contract and fresh receipt | BI-1B83AA84 | BI-DED7D653 |
| External and Build Studio transition wiring | BI-877EEA34 | BI-DED7D653, BI-1B83AA84 |
| Deterministic enforcement and outcome telemetry | BI-BD3F687C | BI-877EEA34 |

Umbrella: BI-67E23B70.

## Phase 1 — Define the Change Reviewer

Backlog item: `BI-DED7D653`.

Deliverables:

1. Add `change-reviewer` to `COWORKER_AGENT_SEEDS`.
2. Add the factory-approved read-only grants to
   `HARDCODED_COWORKER_GRANTS`.
3. Bind the coworker to the Build Studio/delivery route in
   `apps/web/lib/tak/agent-routing.ts` and mirror confidential sensitivity in
   `apps/web/lib/tak/route-context-map.ts`.
4. Add a strong model floor in
   `packages/db/src/agent-model-defaults.ts`.
5. Map the role into the software-development profession family in
   `docs/professions/registry.json`.
6. Add a curated read-only golden journey in
   `apps/web/lib/coworker-lifecycle/golden-journeys.ts`.
7. Seed the new definition as `draft` and refactor reseeding to preserve the
   live lifecycle stage, so deploy cannot bypass certification or undo a later
   explicit promotion.
8. Add the canonical read-only persona at
   `prompts/specialist/change-reviewer.prompt.md`, aligned exactly with the
   registry identity, delegates, grants, and evidence-first review boundary.

TDD:

- First extend coworker-definition conformance expectations and watch the
  missing axes fail.
- Add the minimum complete definition and re-run the focused conformance,
  workforce seed, routing, model-default, and golden-journey tests.

Verification:

- The coworker definition conformance suite names no missing axis.
- Grants contain no write/advance/publish authority.
- The golden journey is read-only and proves an evidence-bearing review.
- A seed/reseed cannot promote the draft or demote an explicitly promoted
  coworker.
- The coworker-persona audit reports no new error-level violation.

Rollback:

- Revert the definition PR. The factory-created live draft remains
  non-summonable and can be abandoned without production authority.

## Phase 2 — Consolidate the shared contract and receipt

Backlog item: `BI-1B83AA84`.

Deliverables:

1. Extract surface-neutral change-review types, prompt construction, result
   parsing, and version constants from Build Studio-specific code.
2. Define pure receipt creation/freshness functions over capsule, base/head
   tree, diff digest, policy version, reviewer version, and specialist set.
3. Reuse `ExternalEvidenceRecord` and `WorkCapsuleActivity` for persistence and
   projection.
4. Generalize verified-finding review to accept code artifacts while
   preserving current plan-review behavior.
5. Keep the finding-substrate guard green; add no Prisma model.

TDD:

- Add failing unit cases for stable freshness, code-change invalidation,
  rebase invalidation, policy/reviewer invalidation, specialist-set
  invalidation, and low-risk auto-pass evidence.
- Add failing compatibility cases that preserve current Build Studio review
  output.
- Implement and refactor under the green suite.

Verification:

- Focused contract and compatibility tests pass.
- `scripts/check-finding-substrate.mjs` passes.
- Typecheck and production build pass through the correct source-local/shared
  sandbox gates.

Rollback:

- Keep Build Studio's existing call site behind an adapter until compatibility
  tests prove the shared contract; reverting the adapter restores the prior
  behavior without data migration.

## Phase 3 — Wire both delivery paths

Backlog item: `BI-877EEA34`.

Deliverables:

1. Add the native review operation/tool used by external delivery surfaces.
2. Wire `decideExternalReviewActivation` into that operation and the capsule
   evidence path.
3. Update `dpf-finishing-a-development-branch` and `dpf-pr-with-dco` so the
   semantic review occurs on a stable local commit before `pregate`/first
   publication.
4. Add an assembled-change Build Studio invocation before
   verification/promotion, preserving existing task-level reviews.
5. Route high-risk/content-specific changes into existing specialist branches
   in coordination with `BI-663A6346`.

TDD:

- Add failing tests that show runtime code requires review, docs can auto-pass,
  stale receipts trigger re-review, loops stop after two repairs, and both
  surfaces emit the same evidence shape.
- Implement external and Build Studio adapters under those tests.

Verification:

- Simulated Codex/Claude/Grok delivery reaches review before publication.
- A Build Studio assembled change reaches the same contract.
- Work Capsule activity renders one coherent review event on both paths.
- No UI route is added; existing timeline UX remains scannable.

Rollback:

- A policy switch returns adapters to shadow-only mode without removing stored
  evidence.

## Phase 4 — Enforce and learn

Backlog item: `BI-BD3F687C`.

Deliverables:

1. Collect shadow-mode review/GitHub/CI outcome pairs.
2. Define measured precision/unique-yield thresholds.
3. Add a fast hook/control that validates receipt freshness or an evidenced
   policy exemption without invoking an LLM.
4. Project outcome metrics into existing process-spine telemetry.
5. Ratchet enforcement only after measured signal quality is acceptable.

TDD:

- Add failing hook cases for missing, stale, valid, and explicitly exempt
  receipts.
- Add outcome-correlation tests across local receipt and GitHub/CI result.

Verification:

- Hook latency is deterministic and does not depend on model/network calls.
- Applicable runtime changes cannot publish without fresh evidence.
- Metrics distinguish accepted findings, false positives, and post-PR misses.

Rollback:

- Return enforcement to shadow mode while retaining receipts and telemetry.

## Completion gate

The umbrella is complete only when:

- all four child BIs are done through separate reviewable PRs;
- the coworker has passed behavioral certification and was promoted through
  `establish_coworker(action="promote")`;
- Build Studio and at least one supported external surface have produced
  equivalent fresh receipts on real changes;
- critical-finding verification is active for code review;
- deterministic enforcement is calibrated from shadow evidence;
- focused tests, production build, UX/timeline verification, finding-substrate
  guard, local merged-code gate, and PR health are green;
- user/contributor architecture and workflow documentation is current.

**Readback successor: BI-CAP-21C511CA, 2026-10-16.** This bounded delivery
extends the design's Workroom readback successor without reopening the original
umbrella or its immutable coverage. Its single deliverable is atomic: a shared
recovery reducer and its detail/liveness adapters must agree to avoid conflicting
readiness claims. Live successor coverage is recorded separately before code:
`cmva95lin1dfg01rxp6ay9y4w` (atomic), bound to plan blob
`a6eb44798dc946a7af46e54881b69b3c879f76cd` at
`f753c7682117ccf4d9bfad3bb3b4c70ceb690f8b`. Research receipt:
`initiative-4a9af857-bfe3-4ae0-bfd5-3c1895df283f`.

Requirements: READBACK-CURRENT (only the current immutable source's review is
current), READBACK-RESULT (durable final result is visible), READBACK-AUTH
(requester-only full receipts remain requester-only), and READBACK-UNKNOWN
(partial, missing or conflicting proof cannot become a pass).

Contracts: `apps/web/lib/work-management/semantic-review-room-projection.ts::loadSemanticReviewRoomProjection`
and `apps/web/lib/mcp/tasks-lifecycle.ts::handleTasksResult`. Compare their
existing bounded room summary and auth-bound full receipt paths; compose the
former and retain the latter instead of implementing a third reader.
Flow: `get_workroom -> existing review projection -> recovery readback`;
liveness must use the same projection and reducer.

1. Reproduce the missing metadata-linked reviewer in
   `apps/web/lib/work-capsules/workroom-recovery-projection.test.ts`, then cover
   current versus historical requests, PASS/FAIL/inconclusive receipts, unreadable
   and partial evidence, stale heartbeat, and identity-repair priority.
2. Refactor the existing recovery reducer to consume the existing read-model
   observations. Reserve at least 20 percent for consolidating state selection,
   unknown handling and canonical result actions rather than adapter copies.
3. Wire the authorized detail and liveness paths, including colocated
   `apps/web/lib/work-capsules/liveness-inventory.test.ts` and handler tests.
   The handler edit waits for its existing owner to land and a normal scope
   claim to succeed; no forced overlap. No grant or visibility expansion.
   Verify an oversized capsule still returns exact ownership/source and recovery
   within the existing route budget, with explicit omitted fields. An oversized
   log remains incomplete without cursor advancement; a source identity that
   cannot fit returns a bounded refusal. Full activity-detail repair stays
   BI-3CE72645.
4. Run the focused suites, both package typechecks, style-drift guard and
   applicable canonical integration. Freeze, obtain independent review, pass
   readiness, push and open a regular DCO PR through protected merge controls.
5. After canonical deployment, read pending and completed review state through
   `get_workroom`; retrieve the owning caller's full receipt with `tasks/result`.
   Record source delivery and deployed verification separately. No fake pending
   pass, provider replay, private task disclosure, or UI-only success claim.

Rollback reverts this additive projection only and retains all durable records.
Automatic safe continuation remains BI-7CCCA696; expired successor admission
remains BI-8ECEC429. Canonical identity repair BI-CAP-437F7745 and role/room
configuration BI-56E9CEC2 remain separate.

**First-served correction, same BI-CAP-21C511CA.** Release c38edb55 contained
PR 6423, but actual readback RV-READBACK-6423-FIRST-SERVED-20261016 failed:
the identity SQL accepted only request schema 1 while the canonical writer
persists schema 2. The mocked requestBound tests did not exercise that SQL.
Keep this failure recorded. Reuse the canonical request version/role binding in
the bounded projection, retaining actor, repository, capsule, gate and digest
correlation and exact-head selection. Add read-only PostgreSQL fixture CTE tests
through the actual loader query for both supported versions and unsupported,
malformed, role-conflicting and cross-identity negatives. Run the actual old
query against the fixture before correction; record candidate query results
separately from the protected CI PostgreSQL suite and served acceptance.
No packet rewrite, stopped-provider retry, new orchestration, or approval grant
is part of this correction. Refresh coverage for the published corrective head,
obtain independent bounded source assessment, preserve audited DEV publication
exceptions as skipped/unrun, then use fresh protected CI and canonical deployment
before rerunning the failed live check.

**Historical-only readback correction, same BI-CAP-21C511CA.** Canonical
recovery.102 served `a914e8314d52449979af7b84599b3908b2a61036`. Actual
`get_workroom` for WC-D299E3B8 still returned an incomplete observation, null
accountable owner and an identical read action when every valid request belonged
to older source. Failure activity `cmvapsu610au101pdbuv96w2m` preserves this
observation; the old uncertain TR-GATE-376F91B64F4544826FF58E7F stays historical.

This is one atomic correction of READBACK-CURRENT, READBACK-RESULT,
READBACK-AUTH and READBACK-UNKNOWN, using the same contracts and flow above.
No independent delivery, new task reader, receipt, queue or authority is needed.
PR 6449's native source validation is a source dependency, already merged as
`203c62de7794a2074f952cb40d513d175786ffc8`. BI-7CCCA696 continues to own automatic
capacity recovery; canonical identity and role/room repairs remain separate.

1. Distinguish complete historical-only observation from actual query failure,
   malformed identity, conflicting identity and truncated task/node history.
   Keep complete absence of a current review unknown, never passing.
2. Reuse the existing execution projection for explicitly historical summaries
   (at most five, with an explicit truncation flag), including recorded source,
   requester, outcome, original budget and requester-bound `tasks/result` action.
   Historical evidence must never become the current execution or readiness.
3. When current identity cannot be resolved, expose the existing accountable
   delivery-coordinator role and the existing `get_backlog_item` bounded
   post-implementation-review recovery route. This asks the canonical issuer for
   current recovery, never creates/retries a review or invents a request nonce.
   For rooms without a linked item, retain an explicit owning-role escalation
   rather than promising the same read will repair it.
4. Reserve at least 20 percent for consolidating execution summary/receipt
   visibility and recovery-action selection in the existing reducer. Both detail
   and liveness already consume it; do not fork adapter behavior.
5. Resolve claimed-path test impact before Red. Add loader-to-reducer regressions
   for complete old-source PASS/FAIL/inconclusive/uncertain state, missing current
   source, bounded history, source mismatch and corruption; update the existing
   read-only PostgreSQL regression in
   `apps/web/lib/work-management/semantic-review-room-projection.postgres.test.ts`.
   Run related detail/liveness and Ops Map tests,
   both TypeScript programs and applicable guards. Database suites without a
   governed database remain explicitly skipped, not passed.
6. Obtain independent source assessment on the frozen commit, publish a regular
   DCO PR through protected CI/queue, then repeat the failed live read after a
   containing canonical upgrade and CAN-TEST. No old uncertain provider replay,
   post-publication model review, exact-approval waiver substitution or fake PASS.

Rollback reverts the additive readback correction and preserves all stored tasks,
receipts and the recorded failures. Existing coverage is historical; record and
check new live coverage against this immutable plan and seven claimed paths
before implementation. The owned runbook must describe the current issuer action.

Pre-implementation coverage: `cmvaq0s9y0dal01pdk2faigd7`, checked valid, bound
to plan blob `177bca1ab7966efde7944527ba0e31d079f0bda7` at
`9b9a83f088ccf4d3bd30e55ab6bd6195e22d5e57`; implementation admission
`IRD-58F6C6246868` allowed the existing small/low delivery. Refresh final
immutable coverage after publication; these receipts remain historical evidence.

Independent source assessment of `8b6663317139b37b65eb2ebee1767e2dbaa4741f`
found a P2: Build Studio rooms may retain a BacklogItem row ID, while the MCP
recovery reader accepts its semantic BI ID. Hold publication and normalize this
existing soft pointer in one bounded identifier-only batch, shared by detail and
liveness. Do not mutate stored linkage or expose item bodies. Missing or failed
resolution must name coordinator escalation without emitting the raw ID as a
tool argument. Three regressions reproduced the invalid detail action, missing
batch resolution and unsafe raw-ID reducer action before repair.

The additional normal claims are `apps/web/lib/work-capsules/mcp-handlers.ts`,
`apps/web/lib/work-capsules/liveness-inventory.ts`,
`apps/web/lib/work-capsules/mcp-workroom-recovery.test.ts` and
`apps/web/lib/work-capsules/liveness-inventory.test.ts`. Expanded eleven-path
coverage `cmvaqdaka0hdk01pdlogyyuc2` was checked valid against the same published
pre-implementation plan before correcting these adapters. Reuse graph-linked
investment readback, terminal recovery, scope-input parity and scope-release
tests as well as the prior verification set; obtain a new exact source assessment.

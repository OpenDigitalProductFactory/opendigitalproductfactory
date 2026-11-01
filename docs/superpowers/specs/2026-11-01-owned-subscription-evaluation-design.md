---
status: draft
backlogItem: BI-A358F4C1
---

# Account-bound subscription model calibration

Workroom WC-800259EE, branch codex/owned-subscription-calibration, base86bd41913f24850ab14d2154f4ad0529a032f233. Design intent is admitted under IRD-4579EA64AF04; implementation, provider inference and deployment are not yet admitted. This ordered fix design incorporates the independent draft review in /tmp/dpf-owned-subscription-evaluation-draft-review.md; the earlier draft digest remains d389afe2e716724711ffad0506a079ef7b30a9b00410f3bcb21654fcaf0bba5b.

**OBJ-QUALITY:** Obtain genuine quality measurements through the existing supported owned subscription transport, or report an honest unsupported/incomplete result.
**OBJ-AUTHORITY:** Keep the exact account, current operator authority, quality floors and resource bounds intact throughout dispatch and persistence.

## Acceptance (verbatim live-item criteria)

- AC-001: Reproduce the current owned-subscription qualification refusal with source-local deterministic tests before implementation; record no vendor call or grade change for unsupported contexts.
- AC-002: An authorized exact-account supported case must use the canonical transport and only complete conclusive observations may update measured dimensions/capability projections.
- AC-003: Foreign/revoked/paused/disconnected accounts and changed ownership/credential/model generations send no inadmissible call or stale measurement write; incomplete output stays unverified and historical scores remain unchanged.
- AC-004: Existing API/service-credential evaluations and all quality floors/admin pins remain intact. Test current ownership and unknown-result boundaries, not merely function shape.
- AC-005: Current plan/impact gates, affected tests, both TypeScript programs, independent assessment, qualified shared integration, protected publication and canonical deployment precede one bounded live measurement and an independently observed useful preferred-model workflow.

## Grounding

Source inspected at codex/responses-contract-preservation@1b6d20dc182e665078264426074861c1287d94dd. runDimensionEval in apps/web/lib/routing/eval-runner.ts explicitly rejects oauth2_authorization_code. eval-golden-test.ts builds a model-calibration.dimension plan without explicit account binding. Existing accountExecutionVersion, active default subscription predicates, ModelProfile and EndpointTestRun remain the owners.

Reuse withInferenceAuthorityCheck at the existing common dispatch boundary rather than adding a second authority callback system. Reuse existing execution-proof.server binding/revision readers and current selected-model proof validation as observations only; a quality run must never mint a capacity proof. Existing account/credential lock ordering supplies persistence precedent.

responses-adapter.ts deliberately omits max_output_tokens on the ChatGPT backend. A maxTokens plan field alone does not prove an enforced output limit there. The standard OpenAI API documentation defines max_output_tokens as bounding total generated tokens, including non-visible reasoning: https://developers.openai.com/api/docs/guides/token-counting . This does not establish support by the subscription backend. Existing finite reassessment qualification excludes ChatGPT and must not be weakened or relabelled.

Adjacent carriers BI-7F2FBDA3 and BI-D28A4F55 remain delivered history. BI-52F4119E and BI-A3FE1110 own trace/incomplete-result concerns. BI-0DEE1DF0 concerns a separate tool-fidelity harness, not these dimension golden tests; no old cohort is rescored or qualified by this repair. No matching open GitHub OAuth-evaluation PR was found in the focused publication overlap search.

## Proposed composition — Owned subscription calibration contract v1

**FLOW-CAL-001:** authorized action captures exact admission → queued event → same durable commission revalidated → bounded transport-support observation → declared measurable golden cohort → guarded persistence → honest history/status.

Only an explicitly commissioned current operator with manage_capabilities may request this path. Initially support the active install-owned default ChatGPT direct Responses account. Foreign, arbitrary delegated, paused, disconnected, CLI and unsupported OAuth contexts retain refusal; automatic OAuth evaluation exclusion stays. Force supplies neither permission nor replay clearance. Capture exact operator/account/credential/endpoint/model and fresh selected-model capacity-proof bindings at the authorized action; queue non-secret revision metadata only. A stale or legacy event cannot silently capture replacement identity. Capacity proof is an observation, never a quality grade or permission.

### Durable commission and uncertainty

Reuse ScheduledJob.runCursor and EndpointTestRun identity/results to persist the exact commission, immutable deadline, corpus identity, reserved call/output allowance and actual per-attempt disposition before dispatch. No new table, grant or alternate retry identity. A short admission lock prevents competing claims; a durable unknown disposition fences the work after the lock ends.

This owned path must not run the legacy ten-minute running-row reaper into a new evaluation. Age, force, redelivery, replacement worker, lost acknowledgement and deadline expiry cannot reopen an uncertain commission. Persist started-attempt identity before its provider call; settle it only from an actual terminal observation. Unknown remote outcome stays unknown and blocks another commission for the same pending work until governed reconciliation establishes disposition. Test zero new calls and zero measurement writes past the old in-flight cutoff. Worker absence or caller timeout is not remote-cancellation proof.

Keep an immutable persisted wall deadline of at most ten minutes and no later than any inherited parent limit. Reuse common authority/cancellation machinery without nesting a renewed allowance. Including the support observation and the existing one known-rate-limit retry, maxTotalCalls <= 2 * originalCorpusLength and maxTotalOutputTokens <= 2 * sum(originalTest.maxTokens ?? 512). Reserve every attempt before dispatch; uncertainty never restores allowance. Unsupported graders make no provider call, leaving room for the small support observation within the original corpus budget. Any lower configured or inherited limit remains effective.

### Required output contract and actual support

Use existing providerConnectionId/version in every calibration plan. Require a positive existing finite output allowance through responsePolicy.requireOutputBound, sending max_output_tokens even on ChatGPT calibration. Ordinary subscription omission stays. PR6810 must preserve this mandatory field; never retry after removing it.

Sending or accepting the field is not enforcement proof. Before grading, one deliberately over-demanding, small-output support observation must yield the actual max_output_tokens termination reason and positive reported output usage within its reserved cap on the same bound account/model/context. A naturally short answer, missing reason/usage, different cause, over-bound usage, malformed stream, refusal or uncertainty is not support. Preserve response ID, terminal reason, usage and trace in existing observations; this probe is not a grade or quota proof.

Reuse existing AdapterResult/InferenceResult finishReason and truncated fields. Preserve actual completed/incomplete/failed SSE terminal metadata rather than reconstructing completion from deltas. Unknown terminal state is unverified. A backend refusal produces one unsupported result and zero golden calls; a capped incomplete support observation never becomes a successful golden answer.

### Genuine cohort and unavailable graders

The owned commission explicitly declares the supported subset: existing dimensions with implemented scorers, excluding the orchestrator-only conversational dimension. Preserve original test identities/prompts/versions/allowances. Add no grading provider, historical rescore or full-model qualification.

Remove unconditional orchestrator score5. An unavailable grader yields null/unverified before inference and never counts as a measurement, even for an otherwise complete response. Distinguish an unsupported scorer from incomplete provider generation. Unsupported dimensions keep historical values. Truncated/uncertain provider generation holds all measurement projection for that commission, including earlier dimensions.

A completed supported subset may project only genuinely conclusive dimension values and the existing conclusive capability projection. Keep global confidence, full-cohort evaluation counter, quality-tier/admin overrides and unsupported dimensions unchanged. The existing profileSource evaluated marker may protect actual projected measurements from seed overwrite; it does not mean all dimensions were measured. Store measured/unverified scope and qualityWritesApplied in existing EndpointTestRun results. Full-model status remains incomplete with an explicit partial-results summary. An unavailable-grader-only, unsupported or uncertain run changes no score, confidence, capability or successful-evaluation metadata.

Existing API/service transport and admission continue; they also must not fabricate a placeholder grader result. Genuine conclusive measurements remain available without new providers or retrospective rescore. All current quality floors and admin pins remain.

### Dispatch, persistence and reporting

Reuse withInferenceAuthorityCheck at the shared dispatch choke point without replacing inherited checks. Recheck the captured context before each actual dispatch/retry and inside the short final measurement transaction using existing account/credential lock order and model revision checks. No network in that transaction.

The action explains unsupported/stale contexts before enqueue and the worker independently checks. The existing completion step must read the exact canonical EndpointTestRun status and endpoint/model binding before saving job outcome; a returned Promise cannot turn incomplete into completed. Existing Test Runs/history owns actual subset, unverified dimensions and neutral failure. A queued acknowledgement never becomes a quality result.

## Ordered implementation and evidence

1. Claim design scope and consume the current impact contract. Refresh current main/overlap and preserve the qualified E782 source until its actual merge.
2. Source research at base86bd reproduced the explicit forced/unbound OAuth refusal with zero provider dispatch/create/grade writes. The first desired-behavior Red run produced3 failures (all actual conversational cases returned5 rather than null),1 passing OAuth boundary control and62 unselected tests; actual exit1, /tmp/dpf-owned-calibration-research-red.json/.log. Production remained unchanged. Add the owned eligible-admission Red and uncertainty-race proofs before their implementation; no live provider call is needed for source reproduction.
3. Commit this ordered fix design in the governed branch, record immutable live backlog coverage quoting all criteria, then obtain current implementation admission before production changes.
4. Extend the existing binding/action/event/worker and GoldenTest composition. Test positive account binding and required cap, unsupported cap without retry/grade, revoked/foreign/paused/stale generations, current-user capability loss, incomplete output, current admin pins, concurrent admission and stale final-write races. Keep API/service controls.
5. Run impact-selected tests and both TypeScript programs. Use actual persistence tests for the conditional write/admission race. Record source-local results accurately.
6. VERIFY-CAL-001: Freeze a clean signed source; independent exact assessment, qualified shared integration, protected publication/merge and canonical deployment.
7. VERIFY-CAL-002: After a material deployed change and fresh legitimate exact-model capacity proof, make one bounded live calibration attempt. If the backend does not support the required bound, record unsupported and stop that attempt; no API purchase, floor change, cap omission, alternate private transport or old-execution replay.
8. A genuinely conclusive measurement and independently observed useful preferred-model workflow are separate acceptance evidence. The original six-hour monitor also needs its own legitimate history-only useful result. Neither is inferred from a connection check, Evals count or source green.

## Risks and rollback

Main risks are stale ownership/generation adoption, false grades from incomplete reasoning output, duplicate background runs and grade writes racing revocation. Keep negative controls and transaction evidence. A source revert removes new admissions while retaining actual prior observations/history and unknown outcomes; do not replay a retired or interrupted execution. No schema, provider, credential, permission store or live policy change is part of this draft.

## Traceability and current impact

One atomic deliverable belongs to BI-A358F4C1: bounded account-aware genuine calibration. AC-001, AC-002, AC-003, AC-004 and AC-005 map to Owned subscription calibration contract v1, FLOW-CAL-001, VERIFY-CAL-001 and VERIFY-CAL-002. The authorization binding, output-support proof, durable uncertainty fence, scorer neutrality and guarded measurement cannot independently ship as an enabled subscription-evaluation feature. No new funding allocation is inferred; current Workroom reports funding-organization-unresolved and this design makes no budget decision.

The initial design/research impact contract is resolved for this design and two test files, with doc-index derived artifact regeneration required and no additional testImpact/guardObligation entries. Claim the full implementation paths and consume their fresh impact contract before implementation; unresolved impact expands verification. The expected implementation includes the existing action/event/worker, golden runner/scorer, Responses terminal/required-cap handling, binding helpers and focused tests. Any UI change adds its current served/UX obligations rather than borrowing the unchanged served checks from PR6810.

## Review reconciliation

The first independent advisory draft review identified the unknown-commission reaper and placeholder grader as important findings, plus unproved cap enforcement and aggregate bounds. The sections above are concrete design corrections. They still require independent review of this immutable version, source regressions and current implementation admission; the prior advisory is not a native receipt or final implementation approval.


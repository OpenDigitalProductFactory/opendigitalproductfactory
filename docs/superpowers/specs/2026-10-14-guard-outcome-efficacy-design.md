---
status: draft
---

# Guard outcome records, GPP §11 efficacy measures and the retirement ratchet

**Date:** 2026-10-14
**Status:** Researched design; independent approval, plan and implementation pending.
**Scope owner:** DPF platform (WWMD). Every development install and every clone that runs the gates.
**Backlog:** BI-FEDD8F45 / WC-B99B7ED2 (delivery-medium), epic EP-B932453F. Related: BI-24A1264B (owner and expiry on a raised ratchet), BI-10501365 (shadow gate has zero observations), BI-E99753F9 (shadow-to-enforce precision tuning), BI-D27ADE59 (docs-only changes ran code-only guards), BI-B2E980B6 (test-inventory completeness).

## 1. Problem and existing architecture

Founder direction (2026-10-14): close every gap from the evaluation against Anthropic's "Redesigning source control" write-up with systematic processes, not prose. Their lesson is that engineers became the people who say no to agent over-engineering, because defensive validation against hypothetical concerns piles up. DPF doctrine says the same from the other side: a gate measuring the wrong thing is worse than prose. DPF has many gates (pregate preflight took more than 20 minutes on a ~150-line change on 2026-10-14), but no gate records whether it ever caught a real defect. So none can be retired on evidence, and none can be defended on evidence either.

GPP §11 requires a `GPP-Evidenced` implementation to publish M-1 to M-7 with numerator and denominator. Annex A says "no published measures".

Source inventory at `origin/main` `804ca0150b3`:

| Existing substrate | Use and constraint |
| --- | --- |
| `scripts/check-guards.mjs` `runGuards` (L141) | The guard loop. Discovers `check-no-*.mjs` by filename and runs each self-test, then the guard. Returns only `violations[]` and `runnerFailures[]` as strings: no per-guard duration, nothing leaves the process. |
| `scripts/lib/ci-policy-guards.mjs` `runPolicyProfile` (L1204), `POLICY_GUARD_PROFILES` (L80) | The only runner that already holds guard id, status (`passed`/`failed`/`cancelled`) and `durationMs` per guard. Writes a local `--results` file and the GitHub step summary only. |
| `scripts/lib/pregate-preflight.mjs` `runPreflight` (L218), CLI `scripts/pregate-preflight.mjs` | Pregate's guard step. Refines statuses (`skipped_environment`, `runner_failed`, `timed_out`); keeps receipts in `.git/dpf-host-guard-receipts`. Skip: `DPF_SKIP_PREGATE_PREFLIGHT_REASON`. |
| `scripts/gate-worktree.mjs` → MCP `record_local_integration_result` → `apps/web/lib/nonprod/local-integration.ts` | The only gate data that reaches the platform: one `ExternalEvidenceRecord` (`operationType: "local_integration_ci"`) per gate run, under a lease. No per-guard array. |
| `.githooks/pre-push-gate` | Refuses a push without a passing gate record. Overrides `DPF_SKIP_PREPUSH_GATE_REASON` and the evidence-gated `gate-infrastructure-unavailable` are written to `.git/dpf-local-ci-gate.json` only. |
| `packages/dpf-skill-pack/hooks/lib/local-ci-override.mjs` | `LOCAL_CI_OVERRIDE_REASON_CODES`. Client-side only. |
| `scripts/lib/baseline-budget.mjs`, `check-no-expired-baseline-budgets.mjs` | House shape for owned debt: `owner` + `expiry`. Applies to baselines, not to guards. No guard declares owner, purpose or catch class. |
| `ExternalEvidenceRecord` (`packages/db/prisma/schema/build-delivery.prisma` L391) | `operationType` discriminator, `target`, `provider`, `resultSummary`, `details Json`, `recordedByPrincipalId`/`recordedByAgentId`, index `[operationType, createdAt]`. Already holds gate rows and `semantic-change-review.outcome` rows. |
| `apps/web/lib/change-review/semantic-review-enforcement.ts` | Precedent: an outcome projected onto `ExternalEvidenceRecord` and aggregated into precision and miss rate. |
| `GppPermitObservation`, `AuthorizationDecisionLog`, `ToolExecution`, `DecisionInteraction` | The §11 raw records. `GppPermitObservation.enforcement` is `shadow` for every row while `GPP_BINDING_ENFORCEMENT` is empty. `DecisionInteraction.humanOutcome.resolvedBy` is `human` or `agent` (`lib/decision/decision-outcome.ts`). |
| `apps/web/lib/operate/backlog-ingest.ts` `ingestBacklogItem` (L344), `lib/queue/functions/mcp-call-efficiency-scan.ts` | Precedent for a daily job that files backlog items: `origin: {kind, id}` dedupes against an open item and bumps `occurrenceCount` instead of duplicating. |

## 2. Research & Benchmarking

Primary sources consulted 2026-10-14. No package, service or subscription is adopted.

| Comparator and inspected contract | Pattern absorbed | Pattern rejected / DPF difference |
| --- | --- | --- |
| Google Tricorder ([Sadowski et al., ICSE 2015](https://research.google/pubs/pub43322/)) and [Lessons from Building Static Analysis Tools at Google, CACM 2018](https://6826.csail.mit.edu/2020/papers/google-analysis-cacm.pdf) | **Effective false positive**: an issue counts as a false positive when developers take no positive action after seeing it, whatever the tool's theoretical precision. Analyzers are tracked per analyzer; those with high "Not useful" rates are worked on or disabled. New checks target under 10% effective false positives. | The "Not useful" signal is a human click. DPF derives the outcome from what happened next (§4.3), so no human labelling step is added. DPF does not auto-disable: the ratchet files a review item (§4.5). |
| Meta Infer ([Scaling Static Analyses at Facebook, CACM 2019](https://cacm.acm.org/magazines/2019/8/238344-scaling-static-analyses-at-facebook/pdf)) | **Fix rate per tool** as the value metric: diff-time reports reached ~70% fixed, batch lists ~0%, at the same false-positive rate. Fix rate decides which tools to keep. | Infer attributes fixes to reported lines. DPF guards do not emit structured locations, so DPF uses the coarser "the next run on the branch passed with the guard unchanged" (§4.3). |
| GitHub code scanning alert dismissal (`dismissed_reason`: `false positive`, `won't fix`, `used in tests`) | A refusal's later state is a **closed vocabulary**, recorded with the alert, not prose. | Dismissal is a human act in the UI. DPF's vocabulary (`caught`, `overridden`, `false-refusal`, `unresolved`) is derived by the platform. |

Standard followed: none governs gate efficacy in CI. DPF follows its own GPP §11 (measures computed from execution records, with numerator, denominator, period and stated omissions) and the house baseline-budget shape (`owner` + `expiry`) for a guard kept against the evidence.

Alternatives evaluated, scored with `principle_decide` (WWMD, `mark-dpf-platform`):

- **Record home** (DI-B898E0B18EA8; that consult ran commandment-only because the embedding provider was unavailable): (A) a new `GuardRunOutcome` table; **(B) extend `ExternalEvidenceRecord` with new `operationType` values, selected (6.79, margin 2.74)**; (C) fold a guard array into the leased `local_integration_ci` row, rejected because pre-push and guard-loop runs hold no lease; (D) local files only, rejected because the platform would hold nothing.
- **Outcome classification** (DI-497E93E55B6B): **(A) deterministic pairing on guard and baseline digests, selected (6.74, margin 3.21)**; (B) git-diff attribution through the GitHub API, rejected: needs structured guard locations, and couples the platform to repository access; (C) human "useful/not useful" labels, rejected: adds the human step the founder wants removed.
- **Declarations and retirement** (DI-1E7BB244646E): (A) a registry plus a new CI guard refusing undeclared guards; **(B) the same registry and thresholds, with derived defaults and no new refusal, selected (7.65, margin 1.07)**; (C) Tricorder-style automatic disabling, rejected: silently removes a control.

## 3. Objectives

**OBJ-GOE-01:** Every pregate, pre-push-gate and guard-loop run produces a guard outcome record on the platform: guard id, guard version, diff identity, verdict, duration and any override, written by the platform from a submitted run, never only on the client.

**OBJ-GOE-02:** The platform classifies every refusal as `caught`, `overridden`, `false-refusal` or `unresolved` from later records alone, deterministically.

**OBJ-GOE-03:** GPP §11 measures M-1 to M-7 and the guard efficacy measures are published for a stated period with numerator, denominator and stated omissions, on an ops view.

**OBJ-GOE-04:** A guard with no catches over its window, or a high false-refusal rate, files exactly one review item automatically. Nothing is disabled or deleted automatically.

## 4. Decision record

### 4.1 The run record

One record per runner invocation, schema `guard-outcome-run.v1`:

```json
{
  "schema": "guard-outcome-run.v1",
  "runId": "<uuid, client-minted, idempotency key>",
  "runner": "pregate | pre-push-gate | guard-loop",
  "startedAt": "ISO-8601",
  "durationMs": 123,
  "diff": { "branch": "feat/x", "baseSha": "<40 hex or null>", "headSha": "<40 hex>" },
  "override": null,
  "guards": [
    {
      "guardId": "loop:check-no-raw-error-message",
      "guardDigest": "sha256 of the guard source file",
      "baselineDigest": "sha256 over the declared baseline inputs, or null",
      "verdict": "passed | refused | runner-failed | skipped",
      "durationMs": 812,
      "declaration": { "owner": "…", "purpose": "…", "catchClass": "…", "declared": true, "keep": null }
    }
  ]
}
```

`override`, when present, is `{ "kind": "skip-env | local-ci-override | gate-infrastructure-unavailable", "code": "…", "reason": "…" }`.

Guard ids are namespaced so the two existing naming schemes cannot collide: `loop:<file stem>` for guard-loop guards, `policy:<id>` for `POLICY_GUARD_PROFILES` entries, `hook:pre-push-gate` for the hook's own verdict.

`guardDigest` hashes the guard's own source file (for a policy guard, its entry in `ci-policy-guards.mjs` serialized canonically). `baselineDigest` hashes the files listed in the guard's declaration as `baselineInputs`; with none declared it is null.

### 4.2 Where it lives and who writes it

The platform writes it. A client submits; it never writes a row.

- **Spool.** Every runner writes its record to `<git common dir>/dpf-guard-outcomes/<runId>.json` before exiting. Writing never changes the runner's exit code; a failure to write is logged, not raised. In CI there is no credential, so the spool is written and nothing more happens.
- **Submit.** Pregate and pre-push-gate flush the spool through one new MCP tool, `record_guard_outcomes` (build-evidence pack, grant `backlog_write`, the grant `record_local_integration_result` already uses). The flush is best-effort with a short timeout, and deletes a spool file only after the platform acknowledges its `runId`. A run that cannot submit today submits on the next flush. The guard loop does not submit; the pregate run that called it flushes its record.
- **Write.** The tool validates the schema, refuses malformed digests and shas, and writes one `ExternalEvidenceRecord`: `operationType: "guard-outcome.run"`, `target: "<branch>@<headSha>"`, `provider` from the authenticated caller, `recordedByPrincipalId`/`recordedByAgentId` from the token (never from the payload), and `details` = the record. A repeated `runId` returns the existing row.

No new table, enum or migration. The new operation types are `guard-outcome.run`, `guard-outcome.classification` and `guard-outcome.retirement-review`.

### 4.3 Classification

A daily platform job (`ops/guard-outcome-classify`) reads `guard-outcome.run` rows from the last 30 days and applies one pure function to each refused guard result R on branch B:

| Condition, checked in order | Outcome |
| --- | --- |
| R's run carried an override | `overridden` |
| The next run of the same guard on B is `passed` with the same `guardDigest` and `baselineDigest` and a different `headSha` | `caught` (the code changed, the guard did not) |
| The next passing run on B has a different `guardDigest` | `false-refusal` (the guard was fixed, not the code) |
| The next passing run on B has the same `guardDigest` and a different `baselineDigest` | `overridden` (code `baseline-raised`) |
| The next passing run on B has the same digests and the same `headSha` | `unresolved` (`flaky-pass`: nothing changed and the verdict flipped) |
| No passing run of the guard on B within 14 days | `unresolved` (`no-later-pass`) |

Intermediate refused runs between R and the next passing run share the outcome of that pass. The result is one `guard-outcome.classification` row per (runId, guardId), keyed for idempotence, citing the refused run and the deciding run. A refusal still inside its 14-day window is not classified yet. `runner-failed` and `skipped` are not refusals and are never classified.

### 4.4 Declarations

`scripts/guard-declarations.json` maps guard id to `{ owner, purpose, catchClass, baselineInputs?, reviewWindowDays?, keep? }`. `keep` is the house budget shape `{ owner, expiry, reason, decisionRef }`. Runners attach the guard's declaration to each result, so the platform needs no repository access.

A guard with no entry gets a derived default: owner `platform-engineering`, purpose `undeclared`, catch class `unknown`, `declared: false`. No new guard refuses an undeclared guard. The efficacy view lists undeclared guards, and the review item asks the owner to declare.

### 4.5 Retirement ratchet

A daily platform job (`ops/guard-retirement-review`) evaluates every guard seen in the last `reviewWindowDays` (default 90):

| Rule | Fires when | Floor |
| --- | --- | --- |
| R-1 No catches | 0 `caught` in the window | at least 30 recorded runs, and the first record is at least `reviewWindowDays` old |
| R-2 False refusals | `false-refusal / (caught + false-refusal)` above 0.25 | at least 4 classified refusals in the window |

A firing guard files one backlog item through `ingestBacklogItem` with `origin: { kind: "guard-retirement-review", id: <guardId> }`. While that item is open, later evaluations bump its occurrence count instead of filing again. The item states the rule, the counts with their denominators, the median and total duration, the declaration, and three choices: retire the guard, narrow it, or keep it by adding `keep` with an owner and an expiry. An unexpired `keep` silences R-1 and R-2 for that guard until its expiry. Nothing is disabled or deleted by the job.

The threshold is looser than Tricorder's under-10% bar on purpose: that bar measures human-visible noise on a suggestion, whereas a DPF refusal blocks work and its later outcome is coarser, so the review starts at 25% and the decision stays with a person.

### 4.6 Efficacy measures

One pure module computes every measure for a period (default: last 14 days) on the install it runs on. Each measure returns `{ numerator, denominator, value, omits }`. A measure with no record source returns `value: null` and says why; it never reports zero.

| Measure | Numerator | Denominator | Stated omissions |
| --- | --- | --- | --- |
| M-1 Gate coverage | Consequential calls (`GppPermitObservation`) admitted under an **enforced** binding with verdict `valid`, per agent | All consequential calls observed, per agent | Reach, not calls: tools never called in the period are not counted. Direct `executeTool` sites count as `unmediated` in the denominator. |
| M-2 Human decisions per effect | `DecisionInteraction` rows resolved with `humanOutcome.resolvedBy = "human"` | Successful `ToolExecution` rows that carry a monitor-path permit observation (consequential effects) | Approvals not recorded in the decision ledger. |
| M-3 Resolution mix | `DecisionInteraction` by class: `human` (resolved by a human), `escalated` (`outcomeType = "escalate"`), `held` (`defer`, `slip`), `doctrine-only` (all others with no human resolution) | All `DecisionInteraction` rows in the period | Gates that do not write the ledger. |
| M-4 Refusals before effect | `AuthorizationDecisionLog` rows with `decision = "deny"`, grouped by `actionKey`, plus permit observations recorded `enforced` with a refusing verdict | All `AuthorizationDecisionLog` rows | Refusals inside tool handlers that are not logged. |
| M-5 Unauthorized or unintended effects | — | — | **Not measurable:** no record marks an executed effect as later unauthorized or unintended. Reported as `null` with this reason. |
| M-6 Shadow divergence | Shadow observations whose verdict is neither `valid` nor `ungoverned` | All shadow observations | Calls the shape gate never observes (BI-10501365). |
| M-7 Decision outcome linkage | `DecisionInteraction` rows with a recorded `humanOutcome` | All `DecisionInteraction` rows | Decisions made outside the ledger. |
| G-1 Catch rate (per guard) | `caught` | Classified refusals | Refusals still inside the 14-day window. |
| G-2 False-refusal rate (per guard) | `false-refusal` | `caught + false-refusal` | Overrides are reported separately (G-3), not counted as false. |
| G-3 Override rate (per guard) | `overridden` | Classified refusals | — |
| G-4 Cost (per guard) | Total and median `durationMs` | Runs | Runs on clones that never submitted. |

The ops view `/ops/gate-efficacy` renders the measures as two read-only tables (GPP measures; guards) with the period, every numerator and denominator, the omissions, and the undeclared and keep-silenced guards. It uses the existing `/ops` layout, `PlatformTabNav` and theme tokens, and adds no write action.

## 5. Compatibility, rollback and verification

- Existing runners keep their exit codes and output. The record is additive; a spool or submit failure never changes a verdict.
- Rollback: remove the tool and the jobs; the rows remain as audit evidence under the `ExternalEvidenceRecord` lifecycle; the spool directory is inert.
- Privacy: records carry branch names, shas, guard ids, durations and override reasons. No file contents, no diff text, no credentials.
- Verification: unit tests for the record builder, digest computation, spool and flush (injected transport), the MCP handler's validation and idempotence, the classifier (every row of §4.3), the retirement evaluator (both rules, floors, `keep`, dedupe) and every measure's numerator, denominator and `null` case. Runtime acceptance on the dev install: run `pnpm run pregate` on this branch, see `guard-outcome.run` rows, run the classify job, and open `/ops/gate-efficacy`. No runtime check has passed for this design yet.

| Acceptance ID | Objective | Observable contract |
| --- | --- | --- |
| AC-GOE-01 | OBJ-GOE-01 | `pregate`, `pre-push-gate` and the guard loop each write a `guard-outcome-run.v1` spool record with namespaced guard ids, digests, diff identity, verdict, duration and override; exit codes are unchanged. |
| AC-GOE-02 | OBJ-GOE-01 | `record_guard_outcomes` writes one `ExternalEvidenceRecord` (`guard-outcome.run`) per run with the recorder taken from the token; a repeated `runId` is idempotent; a malformed record is refused with a reason. |
| AC-GOE-03 | OBJ-GOE-02 | A refusal followed by a passing run on the same branch with unchanged guard and baseline digests and a new head sha is classified `caught`; each other row of §4.3 has its own test. |
| AC-GOE-04 | OBJ-GOE-03 | M-1 to M-7 and G-1 to G-4 are computed for the last 14 days with numerator, denominator and omissions; M-5 reports `null` with its reason; `/ops/gate-efficacy` renders them. |
| AC-GOE-05 | OBJ-GOE-04 | For a fixture guard with zero catches over its window and a false-refusal rate above 0.25, the retirement job files exactly one backlog item; a second evaluation files nothing new; an unexpired `keep` files nothing. |
| AC-GOE-06 | OBJ-GOE-03 | GPP Annex A's "Evidence for §11" row names the published measures and their omissions instead of "no published measures". |

## 6. Delivery ledger

Medium shape, one implementation PR, all deliverables on BI-FEDD8F45. Plan: `docs/superpowers/plans/2026-10-14-guard-outcome-efficacy-plan.md`, written after spec approval.

| Key | Deliverable | Sections / acceptance | Depends on | Live BI |
| --- | --- | --- | --- | --- |
| D1 | Run record builder, digests, declarations, spool and flush; wired into pregate preflight, guard loop and pre-push-gate | §4.1, §4.2, §4.4 / AC-GOE-01 | — | BI-FEDD8F45 |
| D2 | `record_guard_outcomes` MCP tool and platform write | §4.2 / AC-GOE-02 | D1 schema | BI-FEDD8F45 |
| D3 | Classifier and its daily job | §4.3 / AC-GOE-03 | D2 | BI-FEDD8F45 |
| D4 | Retirement evaluator and its daily job | §4.5 / AC-GOE-05 | D3 | BI-FEDD8F45 |
| D5 | Measures module and `/ops/gate-efficacy` | §4.6 / AC-GOE-04 | D3 | BI-FEDD8F45 |
| D6 | GPP Annex A update | AC-GOE-06 | D5 | BI-FEDD8F45 |

## Design grounding

Specs reviewed: `docs/architecture/gated-permissions-process.md` (§10, §11, Annex A), `2026-07-09-anti-regrowth-ratchet-ledger.md` (guard-loop contract), `2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md` (gates proportional to shape). Code substrate: the files in §1's inventory. New structure: one MCP tool, three `ExternalEvidenceRecord` operation types, one declarations file, two scheduled jobs and one read-only ops page. No new table, enum, capability or agent role.

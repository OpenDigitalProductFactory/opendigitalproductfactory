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

An independent architecture review (2026-10-14, approve-with-fixes) found the first draft's guard digest too narrow and its classification blind to rebases, dirty trees and aggregate guards. This section is the revised design.

### 4.1 The run record

One record per runner invocation, schema `guard-outcome-run.v1`:

```json
{
  "schema": "guard-outcome-run.v1",
  "runId": "<uuid, client-minted, idempotency key>",
  "runner": "pregate | pre-push-gate | guard-loop",
  "startedAt": "ISO-8601",
  "durationMs": 123,
  "diff": {
    "cloneKey": "<sha256 of host name and worktree path, first 16 hex>",
    "branch": "feat/x",
    "baseSha": "<40 hex or null>",
    "headSha": "<40 hex>",
    "patchId": "<git patch-id --stable of baseSha..headSha, or null>",
    "dirty": false
  },
  "override": null,
  "declarationsDigest": "<sha256 of scripts/guard-declarations.json, or null>",
  "guards": [
    {
      "guardId": "loop:check-no-raw-error-message",
      "kind": "guard",
      "guardDigest": "<sha256>",
      "baselineDigest": "<sha256 or null>",
      "verdict": "passed | refused | self-test-failed | runner-failed | skipped",
      "durationMs": 812
    }
  ]
}
```

`override`, when present, is `{ "kind": "skip-env | local-ci-override | gate-infrastructure-unavailable", "code": "…", "reason": "…" }`, with the reason cut to 500 characters.

**Guard ids** are namespaced so the two existing naming schemes cannot collide: `loop:<file stem>` for guard-loop guards, `policy:<id>` for `POLICY_GUARD_PROFILES` entries, `hook:pre-push-gate` for the hook's own verdict.

**Kind.** `guard` for a check that judges the code. `aggregate` for a policy entry whose child runner reports its own per-guard results (`policy:repo-guard-loop` runs `scripts/check-guards.mjs`, whose guards are recorded as `loop:*`), so one defect is not counted twice. `hook` for `hook:pre-push-gate`, which refuses when no gate record exists, not when the code is wrong. Only `guard` results are classified and reviewed for retirement; `aggregate` and `hook` results count for cost (G-4) and overrides (G-3).

**Guard version.** `guardDigest` hashes the guard's own file, its sibling self-test (`*.test.mjs`) and the transitive closure of its relative imports under `scripts/`. For a `policy:` guard it is the command line plus the same closure for every script the command names. A fix to a shared helper under `scripts/lib/` therefore counts as a change to the guard. `baselineDigest` hashes the files the guard's declaration lists as `baselineInputs`; with none declared it is null.

**Diff identity.** `patchId` identifies the author's change independently of the base it sits on, so a rebase that does not touch the change keeps it. `dirty` is true when the working tree had uncommitted changes to tracked files when the run started, since then `headSha` does not describe what was checked. `cloneKey` separates two clones that use the same branch name; it carries no path.

**Self-test failure.** A guard-loop guard whose own self-test fails is recorded `self-test-failed`, not `refused`: the guard failed, not the code.

**Declarations travel once.** The run carries `declarationsDigest`; the declarations file itself is submitted alongside and stored once per distinct digest (§4.2).

### 4.2 Where it lives and who writes it

The platform writes it. A client submits; it never writes a row.

- **Spool.** Every runner writes its record to `<git common dir>/dpf-guard-outcomes/<runId>.json` on every exit path, including the hook's early exits and override paths. Writing never changes the runner's exit code; a failure to write is logged, not raised. In CI there is no credential, so the spool is written and nothing more happens.
- **Submit.** Pregate and pre-push-gate flush the spool through one new MCP tool, `record_guard_outcomes` (build-evidence pack, grant `backlog_write`, the grant `record_local_integration_result` already uses), with a timeout of 3 seconds. A file is deleted only after the platform acknowledged or refused its `runId`; on a transport failure it stays for the next flush. The guard loop does not submit; the pregate run that called it flushes its record.
- **Write.** The tool validates each record (shape, shas, digests, closed vocabularies, at most 400 guard results and 64 KB per record, at most 20 records per call) and writes one `ExternalEvidenceRecord` per run: `operationType: "guard-outcome.run"`, `target: "<cloneKey>:<branch>"`, `provider` from the authenticated caller, `actorUserId` from the MCP caller's user (as `local-integration.ts` sets it), `recordedByPrincipalId` and `recordedByAgentId` from the token (never from the payload), and `details` = the record. The row `id` is derived from the `runId` (`gor_` + the first 24 hex of its sha256), so a repeated `runId` collides on the primary key and returns the existing row: idempotence without a JSON lookup. The declarations file arrives as an optional `declarations` argument and is stored as one `guard-outcome.declarations` row whose `id` derives from its digest.
- **Lifecycle.** `ExternalEvidenceRecord` is grandfathered with no lifecycle annotation and is already one of the largest tables on an install (`docs/architecture/data-model-stewardship-runbook.md`). The `guard-outcome.*` rows are telemetry: the classify job deletes `guard-outcome.*` rows older than 365 days, matching `GppPermitObservation`. Other operation types are untouched.
- **Counting in Postgres.** Measures and the retirement review aggregate the run rows in SQL (`jsonb_array_elements` over `details->'guards'`, grouped by guard). The application never loads run rows to count them. The classifier loads only refused results and the later results of the same guard on the same clone and branch.

No new table, enum or migration. The new operation types are `guard-outcome.run`, `guard-outcome.declarations`, `guard-outcome.classification` and `guard-outcome.retirement-review`.

### 4.3 Classification

A daily platform job (`ops/guard-outcome-classify`) classifies each refused `guard` result R (kind `guard`, verdict `refused`) on clone C and branch B against the next run of the same guard on C and B whose verdict is `passed`. The first matching row decides:

| Condition | Outcome |
| --- | --- |
| R's run carried an override | `overridden` (code = the override code) |
| No passing run within 14 days of R | `unresolved` (`no-later-pass`) |
| R's run or the passing run was `dirty` | `unresolved` (`dirty-tree`) |
| The passing run's `baseSha` differs from R's | `unresolved` (`base-moved`: main may have fixed it) |
| `guardDigest` changed and `patchId` did not | `false-refusal` (the guard was fixed, the code was not) |
| `guardDigest` changed and `patchId` changed | `unresolved` (`ambiguous`) |
| `baselineDigest` changed | `overridden` (code `baseline-raised`) |
| `patchId` changed | `caught` (the code changed, the guard and base did not) |
| Nothing changed | `unresolved` (`flaky-pass`) |

A refusal still inside its 14-day window is not classified yet. Refused runs between R and the deciding pass are each classified against that same pass. The result is one `guard-outcome.classification` row per (runId, guardId), whose `id` derives from that pair, citing the refused run and the deciding run.

The table is deliberately conservative: when the evidence cannot separate a fixed defect from a moved base or a changed guard, the refusal is `unresolved`, never `caught` or `false-refusal`. The `unresolved` share is itself reported (G-5) so a classifier that cannot decide is visible.

### 4.4 Declarations

`scripts/guard-declarations.json` maps guard id to `{ owner, purpose, catchClass, baselineInputs?, reviewWindowDays?, keep? }`. `keep` is the house budget shape `{ owner, expiry, reason, decisionRef }`.

A guard with no entry gets a derived default on the platform: owner `platform-engineering`, purpose `undeclared`, catch class `unknown`, `declared: false`. No new guard refuses an undeclared guard. The efficacy view lists undeclared guards, and a review item asks the owner to declare.

### 4.5 Retirement ratchet

A daily platform job (`ops/guard-retirement-review`) evaluates every `guard`-kind guard seen in its window. The window is `reviewWindowDays` (default 90) and restarts when the guard's digest changes or when its last review item closed.

| Rule | Fires when | Floor | Files |
| --- | --- | --- | --- |
| R-1a Never refused | 0 refusals in the window | at least 30 runs; the window is fully covered by records | One **digest** item per week listing every such guard (a guard that never refuses is either deterring or dead; one review decides which) |
| R-1b Refused, never caught | at least 1 classified refusal and 0 `caught` | at least 4 classified refusals | One item for the guard |
| R-2 False refusals | `false-refusal / (caught + false-refusal)` above 0.25 | at least 4 of those two outcomes | One item for the guard |

Items are filed through `ingestBacklogItem` with `origin: { kind: "guard-retirement-review", id: <guardId> }` (digest: `{ kind: "guard-retirement-digest", id: <ISO week> }`). While an item is open, later evaluations bump its occurrence count instead of filing again. At most 3 new per-guard items are filed per run; the rest wait for the next day. Each item states the rule, the counts with their denominators, the median and total duration, the declaration, and three choices: retire the guard, narrow it, or keep it by adding `keep` with an owner and an expiry. An unexpired `keep` silences every rule for that guard until its expiry. Nothing is disabled or deleted by the job. Each filing is also written as a `guard-outcome.retirement-review` row.

The 25% threshold is looser than Tricorder's under-10% bar on purpose: that bar measures human-visible noise on a suggestion, whereas a DPF refusal blocks work and its later outcome is coarser, so the review starts at 25% and the decision stays with a person.

### 4.6 Efficacy measures

One module computes every measure for a period (default: last 14 days) on the install it runs on. Each measure returns `{ numerator, denominator, value, omits }`; ratios reuse the precision helper in `semantic-review-enforcement.ts`. A measure with no record source returns `value: null` and says why; it never reports zero.

The GPP measures are computed from the records DPF has. Where those records answer a narrower question than §11 asks, the measure says so in `omits`.

| Measure | Numerator | Denominator | Stated omissions |
| --- | --- | --- | --- |
| M-1 Gate coverage (call-based proxy) | Consequential calls (`GppPermitObservation`) admitted under an **enforced** binding with verdict `valid`, per agent where the monitor path names one | All consequential calls observed | §11 asks about reachable tools; this counts calls, so tools never called are absent. Direct-path rows carry no agent and are reported as one group. Every binding is shadow today, so the value is 0 until a binding is promoted. |
| M-2 Human decisions per effect | `DecisionInteraction` rows resolved with `humanOutcome.resolvedBy = "human"` | Successful `ToolExecution` rows that carry a monitor-path permit observation | The decision ledger is the kernel ledger, not the approval record: portal approvals, human checkpoints and envelope approvals that do not write it are absent, and that is a large share. |
| M-3 Resolution mix | Kernel decisions by class: `human` (resolved by a human), `escalated` (`outcomeType = "escalate"`), `held` (`defer`, `slip`), `doctrine-only` (all others with no human resolution) | All `DecisionInteraction` rows in the period | §11 asks about gate resolutions; this measures kernel decisions, which are a subset. |
| M-4 Refusals before effect | `AuthorizationDecisionLog` rows with `decision = "deny"`, grouped by `actionKey`, plus permit observations recorded `enforced` with a refusing verdict | All `AuthorizationDecisionLog` rows | §11 asks for reason codes; the log stores none (only `rationale` JSON), so the grouping is by action. Refusals inside tool handlers that are not logged are absent. |
| M-5 Unauthorized or unintended effects | — | — | **Not measurable:** no record marks an executed effect as later unauthorized or unintended. Reported as `null` with this reason. |
| M-6 Shadow divergence | Shadow observations whose verdict would have refused (not `valid`, `ungoverned`, `unsigned`, `unmediated`) **and** whose `ToolExecution` succeeded | Shadow observations with a `ToolExecution` | Calls the shape gate never observes (BI-10501365). Direct-path calls have no execution row. |
| M-7 Decision outcome linkage | Admitted kernel decisions (`outcomeType` not `escalate`, `defer`, `slip`, `decline`, `veto`) with a recorded `humanOutcome` | Admitted kernel decisions | Decisions made outside the ledger. |
| G-1 Catch rate (per guard) | `caught` | Classified refusals | Refusals inside the 14-day window; runs from CI and from clones that never flush. |
| G-2 False-refusal rate (per guard) | `false-refusal` | `caught + false-refusal` | As G-1. Overrides are reported separately (G-3). |
| G-3 Override rate (per guard) | `overridden` | Classified refusals | As G-1. |
| G-4 Cost (per guard) | Total and median `durationMs` | Runs | Runs from CI and from clones that never flush. |
| G-5 Undecided share | `unresolved`, by reason | Classified refusals | — |

The ops view `/ops/gate-efficacy` renders two read-only tables (GPP measures; guards) with the period, every numerator and denominator, the omissions, and the undeclared and keep-silenced guards. It uses the existing `/ops` layout, `PlatformTabNav` and theme tokens, and adds no write action.

### 4.7 Runners not covered

Guards also run in two places that cannot submit: GitHub Actions (no portal credential) and the Build Studio sandbox gauntlet (`lib/build/sandbox/guard-gauntlet.ts`), which already records an `in-platform-preflight` gate row but only a list of failed guards. Both are stated omissions of G-1 to G-5. Adding the sandbox gauntlet as a platform-written fourth runner is follow-up BI-3B2CE771; it does not depend on a client, but Build Studio has not yet completed a build, so it would add almost no data today.

## 5. Compatibility, rollback and verification

- Existing runners keep their exit codes and output. The record is additive; a spool or submit failure never changes a verdict.
- Rollback: remove the tool and the jobs; existing rows stay until the 365-day prune would have removed them; the spool directory is inert.
- Privacy: records carry branch names, shas, a clone key with no path, guard ids, durations and override reasons cut to 500 characters. No file contents, no diff text, no credentials.
- Verification: unit tests for the record builder, the import-closure digest, patch-id and dirty detection, spool and flush (injected transport), the MCP handler's validation, limits and idempotence, the classifier (every row of §4.3), the retirement evaluator (each rule, floor, window restart, cap, `keep`, dedupe) and every measure's numerator, denominator and `null` case. Runtime acceptance on the dev install: run `pnpm run pregate` on this branch, see `guard-outcome.run` rows, run the classify job, and open `/ops/gate-efficacy`. No runtime check has passed for this design yet.

| Acceptance ID | Objective | Observable contract |
| --- | --- | --- |
| AC-GOE-01 | OBJ-GOE-01 | `pregate`, `pre-push-gate` (on every exit path) and the guard loop each write a `guard-outcome-run.v1` spool record with namespaced guard ids, kinds, digests, diff identity, verdict, duration and override; exit codes are unchanged. |
| AC-GOE-02 | OBJ-GOE-01 | `record_guard_outcomes` writes one `ExternalEvidenceRecord` (`guard-outcome.run`) per run with the actor and recorder taken from the caller; a repeated `runId` is idempotent on the primary key; a malformed or oversized record is refused with a reason. |
| AC-GOE-03 | OBJ-GOE-02 | A refusal followed by a passing run on the same clone and branch with unchanged guard digest, baseline digest and base, and a changed patch id, is classified `caught`; each other row of §4.3 has its own test. |
| AC-GOE-04 | OBJ-GOE-03 | M-1 to M-7 and G-1 to G-5 are computed for the last 14 days with numerator, denominator and omissions; M-5 reports `null` with its reason; `/ops/gate-efficacy` renders them. |
| AC-GOE-05 | OBJ-GOE-04 | For a fixture guard refused at least 4 times with zero catches and a false-refusal rate above 0.25, the retirement job files exactly one backlog item; a second evaluation files nothing new; an unexpired `keep` files nothing; never-refused guards land in one weekly digest item. |
| AC-GOE-06 | OBJ-GOE-03 | GPP Annex A's "Evidence for §11" row names the published measures and their omissions instead of "no published measures". |

## 6. Delivery ledger

Medium shape, one implementation PR, all deliverables on BI-FEDD8F45. Plan: `docs/superpowers/plans/2026-10-14-guard-outcome-efficacy-plan.md`, written after spec approval.

| Key | Deliverable | Sections / acceptance | Depends on | Live BI |
| --- | --- | --- | --- | --- |
| D1 | Run record builder, digests, diff identity, declarations, spool and flush; wired into pregate preflight, guard loop and pre-push-gate | §4.1, §4.2, §4.4 / AC-GOE-01 | — | BI-FEDD8F45 |
| D2 | `record_guard_outcomes` MCP tool and platform write | §4.2 / AC-GOE-02 | D1 schema | BI-FEDD8F45 |
| D3 | Classifier, its daily job and the 365-day prune | §4.2, §4.3 / AC-GOE-03 | D2 | BI-FEDD8F45 |
| D4 | Retirement evaluator and its daily job | §4.5 / AC-GOE-05 | D3 | BI-FEDD8F45 |
| D5 | Measures module and `/ops/gate-efficacy` | §4.6 / AC-GOE-04 | D3 | BI-FEDD8F45 |
| D6 | GPP Annex A update | AC-GOE-06 | D5 | BI-FEDD8F45 |

## Design grounding

Independent review: architecture review 2026-10-14, approve-with-fixes; all eleven findings are addressed in §4. Specs reviewed: `docs/architecture/gated-permissions-process.md` (§10, §11, Annex A), `2026-07-09-anti-regrowth-ratchet-ledger.md` (guard-loop contract), `2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md` (gates proportional to shape). Code substrate: the files in §1's inventory. New structure: one MCP tool, four `ExternalEvidenceRecord` operation types, one declarations file, two scheduled jobs and one read-only ops page. No new table, enum, capability or agent role.

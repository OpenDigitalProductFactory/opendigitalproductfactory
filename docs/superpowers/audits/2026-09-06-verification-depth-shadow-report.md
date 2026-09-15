---
status: active
title: Verification-depth shadow report — what the depth binding would have decided
---

# Verification-Depth Shadow Report

- **Date:** 2026-09-06 · **revised 2026-09-15** with the full ledger (§1) and the decision that closed step 2.4 (§3.1)
- **Phase:** 2 of [`2026-08-28-verification-first-workroom-gates.md`](../plans/2026-08-28-verification-first-workroom-gates.md), step 2.3 (the report) and step 2.4 (the written decision per affected cell).
- **Design:** [`2026-08-28-verification-first-workroom-gates-design.md`](../specs/2026-08-28-verification-first-workroom-gates-design.md) §4.1.
- **Backlog:** BI-30165EB4 (Phase 2), BI-4FF872FB (the defect this report found).
- **Decision:** DI-A940A9467E9E — the phase-aware fix, §3.1.
- **Retrospective run:** §4.1, added 2026-09-15 — the post-build sample the live ledger never produced.
- **Source of truth:** the canonical runtime's `BuildActivity` ledger, `tool = 'verification-depth-shadow'`. Live query, not seed data.

---

## 1. The report

Every shadow decision recorded since the seam landed (PR #4880) through 2026-09-11, when the last observed build was abandoned.

**Total shadow decisions: 250. Distinct builds: 2. Distinct cells: 2. Distinct transitions: 1.**

| kind | processSize | declared depth | transition | decisions | builds | would *newly* block |
| --- | --- | --- | --- | --- | --- | --- |
| `fix` | `medium` | `deep` | `ideate->plan` | 247 | 1 | 247 |
| `feature` | `medium` | `deep` | `ideate->plan` | 3 | 1 | 3 |

Every other cell is empty. **No `shallow` decision was ever recorded, and no decision at `plan->build`, `build->review` or `review->ship`** — the transitions where the depth table is actually meant to bite.

One reason string across all 250:

> `deep verification requires a passing typecheck.`

All 250 carry `actualAllowed: true` — the live gate allowed every transition. **Zero verdicts changed**, which is the whole point of the phase.

### 1.1 250 records are not 250 observations

The row count is inflated by a retry loop and must not be read as sample size. `FB-7B4C714B` produced 247 of the 250 by retrying `ideate->plan` roughly every 20–30 minutes — 58, 57, 55, 55 and 19 records on successive days — until it was abandoned on 2026-09-11. `FB-D85BEA44` produced the other 3. **Both builds ended `abandoned`.**

So the honest sample is **two builds, one transition, one depth** — and the earlier framing of this report, written when the ledger held 3 rows, understated the row count while correctly describing the sample. The blast radius Phase 2 exists to measure is still unmeasured.

What the 250 *do* establish, and it is worth more than sample size: the false positive is **deterministic, not incidental**. Every evaluation of this cell blocks, for one structural reason, indefinitely, across two unrelated builds and two work kinds.

## 2. Reading the numbers honestly

The plan's §10 offers two falsification branches. This report matches **neither cleanly**, and saying which it is matters more than filing it under one.

**It is not the "empty report" case.** §10 says an empty report means the depth derivation is not reaching real transitions, and the fix is upstream in `derive.ts`. The derivation *is* reaching real transitions. Depth resolved to `deep` on a live build through the stakes path — `deriveStakesBias` maps `deliverableSensitivity: "high"` to `deep`, and the ideate->plan gate evidence carries that sensitivity (`build-design-review-handler.ts:598`). The plumbing works end to end: posture resolved, requirement evaluated, decision recorded. No upstream fix is indicated.

**It is not the "enormous report" case either** — but not because depth is rarely declared. The ledger is small because **the Build Studio phase pipeline is nearly dormant**, not because the binding is narrow:

| Build phase | Builds |
| --- | --- |
| `abandoned` | 43 |
| `ship` | 2 |
| `failed` | 1 |
| `build` | 1 |
| `complete` | 1 |

48 builds total, 43 abandoned. Over the four days to 2026-09-06, `BuildActivity` recorded 2,041 `ideate_dispatch` and 1,743 `design_fix_loop` rows against 3 phase-gate evaluations. Work churns inside the ideate phase and almost never crosses a phase boundary — and both builds that reached the shadow seam were themselves abandoned without ever crossing one.

**So the sample is too small to calibrate the declaration, and that is itself the finding.** Two builds on one transition is not a blast radius measurement, whatever the row count (§1.1). The honest verdict on step 2.4's question — "is the block correct or is the declaration wrong?" — is answerable for the one observed cell, and unanswerable for the rest of the matrix because the matrix was never exercised.

## 3. The decision on the one affected cell

**The block is wrong, and the declaration is not wrong either. The requirement is being evaluated at a transition where its evidence cannot exist.**

`checkVerificationDepthSatisfied` demands `verificationOut.typecheckPassed` and `testsFailed === 0` at *any* transition. But `verificationOut` is produced during the build phase. At `ideate->plan` — the transition all 250 records describe — no build has run, so `verificationOut` is structurally absent, and a `deep` declaration blocks on evidence that could not have been produced yet.

The two halves that combine into this are each defensible alone:

- the design's depth table (§4.1) reads as if the requirement is evaluated once, at ship time;
- `evaluateVerificationDepthShadow` calls `checkRequirement` directly rather than through a policy cell's requirement list, so it runs on every transition.

Together they manufacture a false positive.

**This is why the report was worth running.** The moment Phase 3 adds this requirement to a policy cell, every high-sensitivity build deadlocks at its *first* transition, before it can ever produce the typecheck the gate is asking for. A report that had been counted rather than read would have shown "a handful of blocks, small blast radius, safe to bind" — and binding it would have broken the deep path completely.

Filed as **BI-4FF872FB**.

### 3.1 The fix chosen — DI-A940A9467E9E, 2026-09-15

Two candidates went to `principle_decide` on the platform-development (WWMD) profile:

- **(a)** scope the requirement to transitions at or after `build->review`;
- **(b)** make the check phase-aware, asserting at each transition only what can exist there.

**(b) won** — composite 11.82 against 10.31, margin 1.52, confidence high, 45 principles applied, no commandment conflict, sensitivity stable at ε=0.1. The separating contributors were *Architecture Over Shortcuts*, *Ground New Work In Existing Platform*, *Single Source of Truth* and *Structural verification is not functional verification*: (a) buys the same immediate relief by narrowing the requirement's reach, which discards the distinction rather than modelling it, and would have to be re-widened the moment an earlier transition gains a depth signal.

**What landed.** `checkVerificationDepthSatisfied` now reads the transition. At `ideate->plan` and `plan->build` it returns not-yet-evaluable; from `build->review` onward the full depth table applies unchanged. An absent or unrecognised transition stays conservative and evaluates the full table — a caller that does not say where it is gets the requirement, never a silent pass.

**The ledger can now tell the two apart.** Shadow decisions carry `evaluable`, so a not-yet-evaluable transition is no longer indistinguishable from a genuine pass — which is what the next report needs in order to mean anything. `evaluable` is report metadata and is stripped before the gate verdict, so the shared `RequirementResult` contract stays exactly `{allowed, reason?}` and the byte-identical back-compat invariant is untouched.

## 4. What this means for Phase 3

**Phase 3 is not ready to start.** Two preconditions, neither of which is a code change to the gate:

1. ~~**BI-4FF872FB must land first.**~~ **Addressed 2026-09-15** (§3.1). The false positive is fixed and the ledger now distinguishes not-yet-evaluable from pass.
2. **The report still needs a real sample, and this is now the only thing standing in Phase 3's way.** Two builds on one transition cannot calibrate anything — and both of those builds were abandoned. Zero `shallow` observations and zero observations at `build->review` or `review->ship` means the transitions where the depth table actually bites have never been exercised even once. Either the build pipeline starts moving work across phase boundaries again, or the shadow window runs long enough to observe them. The 43-abandoned-of-48 build population is a separate health problem that this report surfaces but does not own — though it is now the binding constraint on Phase 2 finishing its job.

## 4.1 The retrospective run — the sample the ledger could not produce

The live ledger has never recorded a decision at `build->review` or `review->ship`, and it never will on its own: the build pipeline is **quiet**, not slow. One `BuildActivity` row in the 48 hours to 2026-09-15, and the auto-resume loop that kept the last build alive has already been capped by its own age-out guard — the runtime recorded "aged out stranded ideate build to abandoned (>7d old, no progress) — capped the auto-resume loop". Waiting produces nothing.

  *(That runtime message cites a backlog id which does not exist in the live backlog — the same unbacked-reference pattern as `BI-4BD81F3B` in §10 of the design. Not chased here; noted because it is the second instance.)*

So the sample was reconstructed instead. Six live builds carry an object-valued `verificationOut`; the real `checkVerificationDepthSatisfied` was run over their stored evidence at both post-build transitions and both declared depths — the actual function, not a model of it.

| build | phase | verdict | why |
| --- | --- | --- | --- |
| `FB-4591D1EB` | abandoned | **BLOCK** — correct | `typecheckPassed: false` |
| `FB-B7BA303E` | abandoned | **BLOCK** — correct | `typecheckPassed: false`, 1185 tests failed |
| `FB-C1CE0E72` | ship | ALLOW | green, and non-vacuous `uxTestResults` (9) satisfy `deep` |
| `FB-041879CD` | complete | **BLOCK** — spurious | `tests: {failed: 0}`, no `testsFailed` key |
| `FB-FC7A7249` | abandoned | **BLOCK** — spurious | `tests: {failed: 0, passed: 7}`, `typecheck: "pass"`, no `testsFailed` key |
| `FB-E50E3024` | ship | ALLOW | green, and non-vacuous `uxTestResults` (7) satisfy `deep` |

Identical at `build->review` and `review->ship`, and at both `shallow` and `deep`.

**Three things this establishes that the live ledger could not.**

1. **The `deep` tier is satisfiable on real evidence.** Both shipped builds clear it, via non-vacuous `uxTestResults` rather than a golden journey. The deep tier was never exercised before, so this was an open question.
2. **A second false-positive class exists, distinct from BI-4FF872FB.** That one was about transitions where the evidence *cannot exist yet*; this is about transitions where the evidence exists **under another name**. `verificationOut` has no canonical shape — four key sets across six builds, with only `typecheckPassed` common to all. `testsFailed` is absent from two of them, so the check blocks builds that recorded zero failures. **33% spurious at the transitions that matter.** Filed as `BI-397F87A9`.
3. **The one hard runtime gate has already passed an unverified build.** `FB-041879CD` shipped to `complete` carrying `typecheckPassed: true` next to `typecheck: "not_run"`, zero tests run, and a recorded sandbox failure. `verification-typecheck-passed` reads only that scalar, so the single load-bearing check on the workroom tier was satisfied by a flag its own evidence contradicts. Filed as `BI-E4E70B9A` — and unlike everything else in this report, **that gate is blocking today**.

Finding 3 is the design's own thesis landing harder than the design put it. §1.1 says the workroom tier has "exactly one hard check: the code compiles." On this evidence it does not reliably have that one.

**What Phase 3 should conclude.** Not "bind `testsFailed`". On the only post-build sample that exists, binding it as written would spuriously block a third of builds while the typecheck flag it leans on is itself unreliable. `BI-397F87A9` and `BI-E4E70B9A` are now preconditions for Phase 3, alongside a real sample.

## 5. Method

- Ledger read directly from the canonical runtime Postgres (`dpf-postgres-1`, database `dpf`), table `BuildActivity`, `tool = 'verification-depth-shadow'`. Read-only.
- Phase distribution from `FeatureBuild`; room posture inputs from `WorkCapsule` (the `Workroom` Prisma model maps to that table).
- Code substrate verified at `433d90325`: `build-process-matrix.ts`, `verification-depth-requirement.ts`, `verification-depth-shadow.ts`, `work-posture/verification-depth-gate.ts`, `work-posture/derive.ts`, `work-posture/resolve.ts`.
- Acceptance re-run at the same SHA: 156 tests across 9 files, all passing, including the byte-identical back-compat invariant.
- §4.1 retrospective: the six builds with an object-valued `verificationOut` were read from `FeatureBuild`, and the real `checkVerificationDepthSatisfied` was executed over their stored `verificationOut`, `uxVerificationStatus` and `uxTestResults` at both post-build transitions and both depths. Scratch harness only — no analysis script was added to the repo.

**2026-09-15 revision.** Ledger re-read at `757d30ea8` (250 rows, 2 builds, retry spacing confirmed per build per day). Fix proven red-then-green: 11 tests failing before the change, 345 passing across 25 files after, the back-compat invariant among them.

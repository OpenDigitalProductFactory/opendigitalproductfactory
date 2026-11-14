---
status: draft
---

# Bounded remedies for a refused ship build (BI-34A05E78)

**Status:** proportional medium-fix design and ordered implementation plan.
**Workroom:** WC-E23AC53B; branch `fix/ship-refusal-remedy`.
**Decision:** WWMD DI-86B6805671D7 (high confidence, autonomy-eligible).
**Absorbs:** the ship half of BI-2D30E44B. Extends BI-76BD65E6 (refresh from main).

## Problem and research

FB-533EC6E2 reached ship and has never opened its PR. The ship reconciler retried
every hour:

- From 2026-11-12 08:26Z to 2026-11-13 04:32Z, published-tree readiness refused
  it on the Docs Impact and Convergence-Impact guards. Nothing sent those
  findings to repair (BI-2D30E44B).
- At 05:36Z, readiness was killed with exit 137.
- From 06:45Z on, the preflight refused it: "Verification has not passed for
  this exact change (3e2a53adbfa8)". Until 05:35Z the same preflight had been
  satisfied by record `cmw3tna180t5101o2m0ozrj5k` for tree `691d859854ea`.

The sandbox clone's reflog shows `checkout: moving from build/FB-533EC6E2 to
ac27ef525` at 05:35:51Z, with no checkout back. HEAD is detached on the
published commit (tree `3e2a53ad`). `build/FB-533EC6E2` is unchanged at
`ad496273` (tree `691d8598`).

`buildPublishedReadinessCommand` (build-studio-pr-readiness.ts) detaches the
clone and restores it later in the same shell. A SIGKILL skips the restore, and
a trap cannot help. `runGuardGauntletIdentity` reads `HEAD^{tree}`, so every
later preflight keys on a tree nobody verified. The build never changed.

Separately, `refreshOrRetryShipBuildPr` retried every refusal hourly, forever.
The one refusal it remedied (BI-76BD65E6) was a stored diverged snapshot.

Ruled out:

- **Relaxing the exact-tree preflight.** WWMD scored it lowest. The rule is
  correct (BI-0700B79C), and here it was refusing a tree that genuinely had no
  verification.
- **A real code change.** The branch ref and the reflog prove the build's tree
  did not move.

## Design

1. **Restore a leaked checkout** (`sandbox/leaked-readiness-checkout.ts`).
   Before reading the tree, `runGuardGauntletIdentity` is given
   `restoreBranch`. When HEAD is detached, no tracked changes are present and
   the build branch exists, it checks that branch out. It never forces,
   resets or cleans. Any other state is left as it is, and the preflight
   refuses as before.
2. **Classify each refused attempt** (`ship-refusal-remedy.ts`) from the trail
   text: stale-verification, verification-failed, behind-main, guard-finding,
   infrastructure, policy-hold, unknown.
3. **Apply one bounded remedy per class.** Each one reuses existing substrate.

   | Class | Remedy |
   |---|---|
   | stale or failed verification | ship→review (BI-76BD65E6 edge); review verifies the tree again and owns its own repair loop |
   | behind-main | `refreshDivergedShipBuild(…, { force: true })` |
   | guard-finding | ship→review, then `routeGauntletFailureToRepair` with the named guards; the gauntlet repair bound is kept |
   | infrastructure | wait; retry after 1h, 2h, 4h and so on, up to 24h |
   | policy-hold | the same backoff; never escalated |
   | unknown | one more try, then escalate |

   Remedies that move the build are capped at 3. Past a cap the build is
   escalated once (`escalateBuildToHuman`, phase `ship`), and the reconciler
   stops retrying it.
4. **State lives on the trail.** One `ship_refusal_remedy` BuildActivity row
   per decision, tagged `[kind -> action]`. There is no schema change.
5. **User guide.** The Build Studio Ship section describes what happens after
   a refusal.

## Acceptance (BI-34A05E78, quoted)

- AC-1 Before the preflight reads the tree, a build clone left detached by a killed readiness run (clean tree, build branch present) is put back on its build branch. A dirty or unknown clone is left alone and the preflight refuses as before.
- AC-2 A refused ship attempt is classified: stale-verification, verification-failed, behind-main, guard-finding, infrastructure, policy-hold, or unknown. Each class has one remedy: return to review so the current tree is verified again (stale or failed verification); refresh onto main (behind-main); return to review and hand the named guards to the coding agent through gauntlet repair (guard-finding); back off 1h, 2h, 4h and so on up to 24h (infrastructure or policy hold).
- AC-3 Remedies that move the build are capped at 3 per build. Unknown refusals are capped at 2 consecutive. Infrastructure is capped at 6 consecutive backoffs. Past a cap the build is escalated once, and nothing retries it after that.
- AC-4 Tests cover: detached checkout restored and preflight satisfied; each class -> remedy; the bound -> escalation; no retry after escalation.

## Traceability

| Requirement | Contract | Flow | Verification |
|---|---|---|---|
| AC-1 | `apps/web/lib/build/sandbox/leaked-readiness-checkout.ts` | `apps/web/lib/work-management/declared-flows/build-studio.transitions.json` | `apps/web/lib/build/sandbox/guard-gauntlet-identity.test.ts`, `apps/web/lib/build/sandbox/leaked-readiness-checkout.test.ts` |
| AC-2, AC-3 | `apps/web/lib/build/ship-refusal-remedy.ts` | `apps/web/lib/work-management/declared-flows/build-studio.transitions.json` | `apps/web/lib/build/ship-refusal-remedy.test.ts`, `apps/web/lib/build/ship-source-refresh.test.ts` |
| AC-4 | `apps/web/lib/build/ship-refusal-remedy.ts` | `apps/web/lib/work-management/declared-flows/build-studio.transitions.json` | `apps/web/lib/build/ship-refusal-remedy.test.ts`, `apps/web/lib/build/ship-source-refresh.test.ts` |

## Verification

Tests: `leaked-readiness-checkout.test.ts`,
`guard-gauntlet-identity.test.ts` (fails before step 1 and passes after, using
the live FB-533EC6E2 tree ids), `ship-refusal-remedy.test.ts`, and
`ship-source-refresh.test.ts` (wiring: remedy, escalation stop, forced
refresh).

## After release, for FB-533EC6E2

The next PR attempt puts the clone back on `build/FB-533EC6E2`. The preflight
then matches `cmw3tna1…`, and the branch is published again. If published-tree
readiness passes, the PR opens. If readiness is killed again, the attempt is
classed infrastructure and backs off, and the following attempt fixes the clone
again. If a guard refuses it, the guard findings go to repair.

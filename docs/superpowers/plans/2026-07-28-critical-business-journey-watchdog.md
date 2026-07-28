# Plan — Critical Business Journey Watchdog (BI-E105303D)

Spec: `docs/superpowers/specs/2026-07-28-critical-business-journey-watchdog-design.md`
Kernel: DI-96D3FD5C089B · Work Capsule: WC-2FA1E567 · Branch: `feat/business-journey-watchdog`

One concern: **notice when a critical business journey breaks, prove it with evidence, and
route it to the operator through the existing attention surface.** Remediation automation
is explicitly a separate item.

## Phase 1 — contract (test-first)

1. `packages/db/src/quality-issue-registry.ts` — add `journey_failure`
   (`resolvedBy: "monitor-clears"`, auto-resolves on next green run of the same journey,
   `expectedSteadyState: 0`, `owner: "operator"`). Registry derives the type union, so
   this must land before any emitter compiles.
2. `apps/web/lib/business-journeys/types.ts` — `VerificationDepth`, `JourneyStep`,
   `JourneyDefinition`, `JourneyStepResult`, `JourneyResult`, `JourneySweepResult`.
3. `apps/web/lib/business-journeys/depth.ts` — the two honesty rules as pure functions:
   `achievedDepth()` (weakest passing step) and `uncheckedDepths()`. Unit-tested first.

## Phase 2 — applicability and probes

4. `install-context.ts` — resolve `InstallJourneyContext` from live rows (published
   storefront, primary + composed archetypes, bookable items, inquiry surface, payments).
5. `probes.ts` — `reachability`, `contract`, and `data-path` probe implementations.
   The `data-path` probe owns its transaction and force-rolls-back via a private sentinel.
6. `registry.ts` — the journey definitions, each with `appliesWhen`, ordered steps,
   owner-language outcome copy, and `revenueBearing`.

## Phase 3 — run, evidence, issue

7. `runner.ts` — cheapest-first execution (skip `data-path` when cheaper steps failed),
   one `AssuranceRun` per sweep-journey, `AssuranceFinding` per failed step with
   absent-clean resolution, mirroring `certification-runner.ts`.
8. `issue.ts` — sibling writer to `observability/health-alert-issue.ts`: deterministic
   `issueKey` per journey, upsert open, resolve on green.

## Phase 4 — notify

9. `apps/web/lib/attention/types.ts` — add `business-journey` to `AttentionSource`.
10. `apps/web/lib/attention/sources/business-journey.ts` — projection.
11. `apps/web/lib/attention/aggregate.ts` — wire the loader.

## Phase 5 — schedule

12. `apps/web/lib/queue/functions/business-journey-watchdog.ts` — cron `0 6 * * 1,3,5`
    + run-now event, both quiescence-gated.
13. Register in `queue/functions/index.ts` and `operate/scheduled-jobs/catalog.ts`
    (the catalog↔registry parity test fails the build on either-direction gaps;
    `SCHEDULING_MAP` derives from the catalog automatically).

## Phase 6 — operator surface

14. `journey-health.ts` — read model.
15. `/ops/journeys` route + components. Outcome-first: plain-language status, achieved
    depth, and an explicit "Not checked" line. Evidence and step detail behind a
    Technical details boundary. Empty, loading, degraded, and error states designed, not
    defaulted. Tokens only — no hardcoded colors.

## Phase 7 — consolidation (~20%)

16. Extract the duplicated open/resolve `PortfolioQualityIssue` shape shared by
    `health-alert-issue.ts` and the new `issue.ts` into one shared primitive rather than
    a third copy of the same upsert.
17. Fold the repeated absent-clean `AssuranceFinding` reconcile (certification runner +
    journey runner) into a shared helper.

## Phase 8 — gates

Targeted vitest → repo typecheck → production build → migration check (expected: none,
no schema change) → live UX verification with desktop + mobile, light + dark, keyboard,
loading/empty/degraded/error captures.

## Verification of the honesty rules

- A journey whose steps all stop at `reachability` must render "Not checked: …" and must
  not be counted as verified anywhere in the read model.
- A full sweep must leave every touched table's row count unchanged.

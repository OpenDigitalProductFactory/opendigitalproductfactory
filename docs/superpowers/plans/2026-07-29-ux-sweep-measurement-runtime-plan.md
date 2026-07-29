# UX sweep measurement-runtime boot — class-level determinism plan

**Backlog item:** BI-232BA634 (EP-UX-SYSTEM)
**Predecessor:** BI-EA221325 (closed twice on per-route fixes; the class recurred)

## Root cause (evidence, not hypothesis)

Merge-group runs 30434754297 (fail) and 30438124151 (pass) measured the
**identical git tree** `79055b61bdce78437a80617d638c866e2dba6828` with identical
parents and nearly identical navigation/settle timings (~710 ms), yet disagreed
on `/workspace` by five words, one heading, and 2.3 reading-grade points. The
page was captured in two different *server* states, not two different codes.

The sweep boots a real production portal. `apps/web/instrumentation.ts`
`register()` fires a queue of fire-and-forget reconcilers and watchdog
intervals that WRITE operational state after the portal starts serving:
platform-version sync, quiescence level reset, self-upgrade/quiescence/backup
stuck-run reconciles, local-model-context re-assertion, OVSM and org-WWWD
backfills, Build Studio exec-state recovery. The crawl starts seconds after
boot; which side of each write a route is measured on is a race. Per-route
fixture fixes (#3656, #3712) and typed wall-clock exclusions (#3719) cannot
close this class because the writers are runtime, not seed.

## Remedy — deterministic by construction

One flag, one chokepoint: `DPF_MEASUREMENT_RUNTIME=1`
(`apps/web/lib/runtime/measurement-runtime.ts`), consumed by `register()`:

1. **Awaited render-relevant syncs** — platform-version sync and the OVSM /
   org-WWWD backfills complete inside `register()` before Next serves the
   first request (`settleBootSync`). Every measured route observes the same
   post-sync state, and it is the state production users actually see.
2. **Skipped operational self-heal** — voice continuity, stuck-run
   reconciles and their periodic intervals, model-context re-assertion, and
   Build Studio recovery are skipped. An ephemeral sweep portal has no stuck
   state to heal; these writers are the measured nondeterminism.
3. **Unchanged production/dev boots** — the flag defaults off; when unset,
   the boot path is byte-for-byte the prior behavior.

`.github/workflows/ux-route-sweep.yml` sets the flag when starting the portal.

## Acceptance

- Two same-commit sweep runs (workflow_dispatch ×2 on the PR head) produce
  byte-identical verdicts for every pre-existing route.
- The class criterion from BI-232BA634: a change with zero route/UI surface
  produces zero sweep regressions on pre-existing routes — validated on this
  PR itself (instrumentation/workflow/docs-only diff) across PR and
  merge-group sweeps.
- Unit contract: `measurement-runtime.test.ts` proves flag default-off,
  awaited-under-measurement, fire-and-forget otherwise, and non-fatal
  rejection handling.

## Backlog coverage

- Decision: atomic
- Parent: BI-232BA634
- Receipt: cms6e02xl03j901l2b0y9ca2z
- Rationale: the flag module, the instrumentation gating, and the workflow env
  wire are one behavior — any one of them alone leaves the sweep exactly as
  nondeterministic as before, so no phase is independently shippable.
- Dependencies: none

## Residual risk / follow-up

- Routes rendering *time itself* stay governed by the #3719 typed
  wall-clock-collection exclusions — different class, already handled.
- If a future boot writer is added outside the gated regions, it reintroduces
  the race for sweeps only; the gate-context pack (BI-2677A465) and review
  attention on `instrumentation.ts` are the guard. A structural
  "no ungated writer" contract test is a candidate follow-up if recurrence is
  observed.

# Fail-fast dispatch classification — BI-8C44DB49

Status: slice 1 landed, slices 2–4 open
Owner: platform / inference
Related: BI-8C44DB49, BI-A009313E (stranded-ideate flood, same unbounded-retry class),
BI-573A8EB3 (the UPSTREAM cause — see below)

## Update — the upstream trigger is BI-573A8EB3, a Turbopack minifier bug

This fail-fast work bounds the *damage* (don't retry what can't succeed). The
thing that can't succeed was finally root-caused: routed phases (plan /
design-review / plan-review) throw `ReferenceError: workloadClass is not defined`
from a Turbopack inlining bug in `provider-suitability/work-context.ts` — the
source is correct, only the minified bundle is broken, so no unit test sees it.
Fixed under BI-573A8EB3. With that fixed AND an eligible provider, the 8 stranded
`plan`-phase builds can actually advance instead of feeding the flood. The
fail-fast slices remain worth landing: they are the general guarantee that any
*future* structural dispatch failure is bounded rather than infinite.

## The incident this exists to prevent

Between 2026-07-18 and 07-21 a live Windows install produced **5,026 stalled
TaskRuns in four days** (baseline ~5/day) from two titles — `Deliberation: review`
(3,908 stalled / 60 completed) and `Deliberation: debate` (1,110 / 22). Roughly 8
builds each re-dispatched ~100 times.

Every component was individually correct:

1. A deliberation dispatches.
2. `routeAndCall` throws — **structurally**: `No endpoint satisfies agent
   capability floor (EP-AGENT-CAP-002). Missing: toolUse. (3 endpoint(s) excluded)`
   and, where local was reachable, `request (29362 tokens) exceeds the available
   context size (24576 tokens)`.
3. The watchdog settles the TaskRun `stalled` and deliberately does **not** fail
   the build — `shouldSurfaceBuildFailure()` correctly refuses to let a leaked
   deliberation corrupt a healthy build.
4. The build therefore still needs a deliberation, so the sweep re-dispatches it
   ~30 minutes later. Forever.

Two consequences, both of which cost the operator days:

- `coworker.reasoning-loop` is a **hard** blocker in the self-upgrade quiescence
  gate, which skips even a *manual* trigger. With a fresh batch every 30 minutes
  there was almost never a clear window, so self-upgrade reported
  `activity-in-flight` while the AI workforce screen correctly showed nobody
  working — these were failed dispatches, not running coworkers.
- `resolve_model_selection` reported `no-providers` ("No AI providers are
  configured") because `phase-model-resolution.ts` relabelled *every* routing
  throw. The install had three endpoints; they were excluded for lacking
  `toolUse`. Both the operator and a debugging session chased a configuration
  problem that did not exist.

**The missing concept:** some failures are structural. No endpoint offers
`toolUse`; the prompt exceeds the served context. No number of retries changes
either. Nothing in the system could express that, so everything was retryable.

## Design

`lib/inference/dispatch-failure-class.ts` — a pure function over `name` +
`message`, importing nothing.

- Pure because it is called from the dispatch path *and* from operator-facing
  diagnostics; a shared module reaching into routing internals is how
  promoter-only code got dragged into the web bundle (BI-76651B7B).
- Over `name`/`message` rather than `instanceof` so a serialized error crossing
  a queue boundary, a non-Error throw, or a future error class all classify.
- **Fails safe toward retryable.** Wrongly calling something structural silently
  abandons recoverable work — worse than one extra attempt. `MAX_DISPATCH_ATTEMPTS`
  bounds the unknown case instead.

Structural codes: `capability-floor-unmet` (carries the missing capability),
`context-overflow`, `no-eligible-endpoint`, `sensitivity-unsatisfiable`.
Everything else is `transient` and retryable up to the ceiling.

## Slices

- [x] **1 — classifier + honest diagnostics.** The pure classifier with 12 tests
      including the exact live log strings; `phase-model-resolution.ts` stops
      relabelling structural failures as `no-providers` and emits remediation
      that matches the real constraint ("activate a model supporting `toolUse`",
      not "connect a provider" when providers exist).
- [ ] **2 — PREFLIGHT the route before creating the TaskRun.** Not post-hoc
      settling — that was the obvious design and it does not work. Evidence:
      `orchestrator.ts:731` already catches and calls
      `settleBootstrapTaskRun(taskRunId, "failed")`, yet all 5,026 rows are
      `stalled`, which is the *watchdog's* state, not the orchestrator's. The
      reason is `settleBootstrapTaskRun` scopes its update to rows still in
      `active|working|queued|running`, so once the watchdog reaps a slow failure
      to `stalled` the orchestrator's own handler is a silent no-op. Any fix that
      settles *after* the attempt loses the same race.

      So: call the side-effect-free `previewRoute` for the deliberation's
      contract BEFORE `prisma.taskRun.create`, classify with
      `classifyDispatchFailure`, and on a structural verdict return a blocked
      outcome carrying `verdict.summary` — creating no TaskRun at all. The row
      that never exists cannot stall, cannot be reaped, cannot be retried, and
      cannot hold the quiescence gate open. This is also the literal reading of
      the operator's ask: "raise an error vs. trying what won't work."
- [ ] **3 — attempt ceiling on the sweep.** The re-dispatch sweep must count
      prior attempts per build and consult `shouldRedispatch`. Same unbounded
      retry class as BI-A009313E; the ceiling is what makes an unrecognised
      permanent failure cost a bounded number of runs.
- [ ] **4 — quiescence gate honesty.** A TaskRun whose dispatch structurally
      cannot succeed must not hold the self-upgrade drain open as
      `coworker.reasoning-loop`. Today the reaper only handles corpses by
      liveness; a structurally-blocked run is neither live work nor a corpse.

## Verification

Slice 1: `vitest run lib/inference/dispatch-failure-class.test.ts
lib/inference/phase-model-resolution.test.ts` — 20 passing. Test cases use the
verbatim error strings captured from `docker logs dpf-portal-1` during the
incident, so the classifier is proven against the real failure text rather than
an invented approximation.

Slices 2–4 need a live-install check: after landing, `SELECT count(*) FROM
"TaskRun" WHERE status='stalled' AND "startedAt" > now() - interval '1 day'`
should return to single digits, and self-upgrade should stop reporting
`activity-in-flight` with an idle workforce.

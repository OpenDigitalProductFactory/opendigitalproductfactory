---
status: active
---

# Durable Self-Upgrade Admission and Dispatch Reconciliation Plan

**Backlog item:** BI-3FD07259
**Workroom:** WC-25858CAB
**Branch:** `fix/durable-self-upgrade-admission-and-dispatch-reco`

## Outcome

One server-issued `SelfUpgradeRun` identity survives response loss, delayed queue
acceptance, dispatch failure, process restart, and duplicate delivery. The
Upgrade Center remains truthful and cannot invite a second click while the first
request is unresolved.

## Atomic implementation

1. Add the `SelfUpgradeDispatchStatus` enum and the minimal target, fingerprint,
   force, lease, attempt, acknowledgement, and failure fields to
   `SelfUpgradeRun`; add a forward-only migration and data-impact manifest.
2. Write failing run-store/admission tests for atomic admission, same-fingerprint
   reuse, active-run exclusion, dispatch leasing, acknowledgement, ambiguous
   failure, definite failure, target drift, newer-run refusal, and worker CAS.
3. Implement `admission.ts` as the single target-binding and dispatch state
   boundary. Refactor action/request callers to admit first, return the run id,
   and schedule the same dispatcher with Next.js `after()`.
4. Give every send the stable `self-upgrade:<runId>` event id. Persist returned
   event ids and make the worker claim the row by compare-and-swap before any
   preflight or physical action.
5. Add boot and periodic reconciliation for eligible pending/indeterminate rows,
   using the same lease and dispatch function. Preserve exact target/force
   binding and existing quiescence checks.
6. Write failing UI tests for the two red fixtures and for every durable dispatch
   state. Remove the 45-second local unlock and render calm, actionable status
   from the canonical row without adding another control.
7. Run focused and affected tests, web typecheck, migration validation,
   data-impact/prose/style guards, preflight, semantic review, and exact-tree
   local CI. Publish one DCO-signed PR and require every protected PR and
   merge-group check.
8. Create one canonical release from the protected merge, require publisher and
   release-mode clean-install success, perform one governed self-upgrade, and
   prove exact served SHA, data preservation, health, durable admission identity,
   dispatch reconciliation, and CAN-TEST before resuming BI-F48.

## Expected source surface

- `packages/db/prisma/schema/build-delivery.prisma`
- `packages/db/prisma/migrations/20260829040000_self_upgrade_admission_reconciliation/migration.sql`
- `docs/data-impact/2026-08-29-self-upgrade-admission-reconciliation.data-impact.json`
- `apps/web/lib/self-upgrade/admission.ts`
- `apps/web/lib/self-upgrade/admission.test.ts`
- `apps/web/lib/self-upgrade/run-store.ts`
- `apps/web/lib/self-upgrade/run-store.test.ts`
- `apps/web/lib/self-upgrade/request.ts`
- `apps/web/lib/self-upgrade/request.test.ts`
- `apps/web/lib/actions/promotions.ts`
- `apps/web/lib/actions/promotions.self-upgrade.test.ts`
- `apps/web/lib/queue/functions/self-upgrade.ts`
- `apps/web/lib/queue/functions/self-upgrade.test.ts`
- `apps/web/instrumentation.ts`
- `apps/web/instrumentation.test.ts`
- `apps/web/components/ops/SelfUpgradeTriggerControl.tsx`
- `apps/web/components/ops/SelfUpgradeTriggerControl.test.tsx`
- `apps/web/components/ops/SelfUpgradeTriggerControl.swap-resilience.test.tsx`

## Design grounding

- Existing design and plan reviewed:
  `docs/superpowers/specs/2026-08-29-self-upgrade-admission-reconciliation-design.md`
  and this atomic implementation plan. The separate BI-6CB35411 consumer
  start-path design remains the owner of install-tag and runtime-identity
  convergence; it is a delivery prerequisite, not source scope for BI-3FD07259.
- Current code substrate inspected: `SelfUpgradeRun` persistence and status
  projection, the self-upgrade server action and request boundary, the Inngest
  worker and boot instrumentation, and the Upgrade Center trigger control.
- Source of truth: the server-owned `SelfUpgradeRun` admission row, including its
  immutable release target, actor/force fingerprint, dispatch state, lease,
  attempt, acknowledgement, and terminal failure evidence.
- Architectural decision: commit admission before asynchronous dispatch; reuse
  one stable event identity; reconcile ambiguous delivery against the same row;
  acquire worker execution by compare-and-swap; and project the durable state to
  the UI so an unknown disposition cannot re-enable the control.
- Rejected boundary crossings: no client-generated admission identity, no
  synthesized dispatch success, no direct queue retry that changes target or
  force, no emergency-override expansion, and no edits to BI-6CB35411-owned
  start/restart or install-identity paths.

## Risks and rollback

The primary risk is treating an ambiguous dispatch as a rejection or allowing a
stale retry to target a different release. The admission fingerprint, immutable
stored target, stable event id, transaction lease, latest-run guard, and worker
CAS make both paths fail closed. Rollback is a protected revert; new nullable
dispatch metadata remains compatible with historical rows and requires no data
destruction.

## Backlog coverage

- Decision: atomic
- Parent: BI-3FD07259
- Receipt: blocked — no initiative scope baseline exists for BI-3FD07259; the
  atomic table below records the server-submitted mapping without claiming a
  receipt
- Rationale: schema, admission, dispatch, reconciliation, worker CAS, and UI
  projection are one safety contract. Shipping only a subset either keeps the
  ambiguous click, creates an unrecoverable pending row, or permits duplicate
  physical execution.
- Dependencies: none for source delivery; BI-6CB35411 remains a separate live
  runtime-identity prerequisite if tag/SHA/config identity does not converge.

| Deliverable key | Backlog item | Independently shippable | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- | --- | --- |
| `durable-self-upgrade-admission` | BI-3FD07259 | no | OBJ-SUA-001, OBJ-SUA-002, OBJ-SUA-003, OBJ-SUA-004, OBJ-SUA-005 | admission-transaction, dispatch-state-machine, consumer-cas, operator-projection, verified-release-target-fallback | admit-return, post-response-dispatch, boot-reconcile, worker-claim, live-upgrade | AC-SUA-001, AC-SUA-002, AC-SUA-003, AC-SUA-004, AC-SUA-005, AC-SUA-006, AC-SUA-007, AC-SUA-008, AC-SUA-009 |

## Volatile target-projection extension

1. Add the exact oscillation RED fixture to `status-target.test.ts`: a live
   registry success for the canonical release followed by a transient fetch
   failure must retain the identical target, while no persisted proof remains
   unavailable.
2. Extend the existing `release_health.latest` JSON state with one optional
   verified registry-target attestation. Do not add a model, migration, cache,
   or alternate authority surface.
3. Record the attestation only when a fresh successful publisher snapshot and
   live registry candidate agree exactly. Bind publisher run, tag/SHA, GHCR
   owner/channel, install identity, running config digest, platform, and all
   verified image digests in a serializable transaction.
4. On registry failure, accept the persisted candidate only while both evidence
   timestamps are within 30 minutes and every binding still matches. Preserve
   it across a matching health poll; clear it on changed/red/in-progress or
   unsuccessful publisher identity. Keep Git-source and all malformed, stale,
   ambiguous, or mismatched evidence fail closed.
5. Preserve the existing server-signed expiring action binding and normal
   action-time target/quiescence/override validation. Do not edit the #4863 UI
   projection or add another operator control.
6. Run the focused state/status/runner RED-GREEN suites, adjacent release-target
   and self-upgrade action tests, web typecheck, prose/style/preflight guards,
   exact-tree CI, protected PR/merge, and one canonical release. No live click
   or BI-F48 replay is allowed before protected live proof.

Additional source surface:

- `apps/web/lib/self-upgrade/status-target.ts`
- `apps/web/lib/self-upgrade/status-target.test.ts`
- `apps/web/lib/release-health/state.ts`
- `apps/web/lib/release-health/state.test.ts`
- `apps/web/lib/release-health/runner.ts`
- `apps/web/lib/release-health/runner.test.ts`

## Atomic recovery extension for SUR-6B312E24

1. Extract the Inngest self-registration endpoint and PUT lifecycle from the
   oversized instrumentation module into one queue-owned helper. Red fixtures
   cover `APP_URL` unset with an IPv4-only listener, explicit URL normalization,
   truthful OK/failure persistence, and reconcile-only-after-success.
2. Add the exact source-free durable-admission red fixture to
   `admission.test.ts`: a tagged release row with a valid persisted fingerprint,
   null target discovery, healthy job engine, and stable run id
   `SUR-6B312E24` must dispatch once without calling `admit`.
3. Reconstruct the persisted release binding only by validating its complete
   admission fingerprint. Keep null-discovery Git admissions, missing tags,
   corrupted fingerprints, resolved drift, unhealthy health, lease conflicts,
   and newer-run conflicts fail-closed.
4. Wire boot and periodic self-registration through the extracted helper and
   invoke the existing reconciler only after a real successful PUT. Do not add
   another timer, queue, run identity, or operator control.
5. Run focused red/green tests, the adjacent admission/instrumentation suites,
   web typecheck, module-size/style/prose guards, preflight, exact-tree CI, and
   protected GitHub checks. Publish one canonical release and deploy it through
   the governed live path without creating another `SelfUpgradeRun`.
6. On exact served-SHA/CAN-TEST, observe only the existing reconciler advancing
   `SUR-6B312E24`; require stable event identity, one dispatch acknowledgement,
   truthful terminal state, and no replacement row before unfreezing BI-F48.

## Terminal old-target correction

The accepted live fixture is terminal and bound to a superseded release. Add a
first-failing admission test proving reconciliation does not mutate or dispatch
that row. Use the existing authenticated operator action as the sole bootstrap
contract: it accepts only a terminal superseded run plus a verified signed tagged
release target, creates a new
admission through the existing transaction, and persists a unique typed
`recoveryOfRunId` self-relation to the prior run. Reject active/ambiguous or
non-latest prior rows, an existing successor, same/untagged/Git targets, forged
or expired bindings, and target drift. This narrowly supersedes the old
"no replacement run" step: the terminal predecessor remains immutable, while
one separately fingerprinted successor becomes the only lawful bootstrap
identity. It is not a browser retry or rebind; protected CI and the existing
quiescence/worker-CAS gates remain mandatory.

Publish the protected repair without deploying the superseded c137 release.
Before the one physical action, capture a fresh server-signed binding for the
repair tag/SHA and prove the latest row is still the unchanged terminal
`SUR-6B312E24`. The old runtime admits one new manual run through its existing
authenticated path. During new-container startup, the additive migration may
link that one in-flight run to the exact predecessor only when the singleton,
ordering, terminal, pre-dispatch, tagged-target, and distinct-target predicates
all hold. Verify the typed link plus served SHA/CAN-TEST and restart coherence;
otherwise stop without a second action.

Treat the typed link as audit metadata only. The successor's signed target
verification and recomputed admission fingerprint remain the sole dispatch
authority. Record that the SQL migration checks structural predecessor evidence
without cryptographically recomputing the historical fingerprint, and that its
tests are static SQL contract assertions rather than an executed migration
fixture. In live acceptance, read back both immutable rows and the link, then
verify the successor's independent admission and dispatch evidence.

## 2026-08-30 exact-target recurrence closure

The ordered repair and UX-fit decision are normative in
`docs/superpowers/specs/2026-08-30-self-upgrade-exact-target-recovery-design.md`.
Execute that sequence atomically:

1. turn the existing exact-SHA-and-tag refusal into a first-failing
   zero-dispatch successor test;
2. classify target relationships as exact, distinct, or conflicting, permitting
   exact and distinct only behind the existing terminal, zero-dispatch, latest,
   and unique-successor guards;
3. keep partial SHA/tag overlap and every attempted, acknowledged, or event-bound
   predecessor fail closed, and prove repeat recovery returns the same successor;
4. re-run the current live-observation and IPv4 self-registration suites rather
   than adding duplicate UI or startup mechanisms; and
5. pass typecheck, preflight, semantic review, exact-tree CI, protected merge,
   canonical release, and governed live served-SHA/CAN-TEST verification.

This remains the single atomic BI-3FD07259 deliverable. The comparison repair,
typed successor, worker CAS, and truthful terminal projection share one clean
revert boundary and are not independently safe to ship.

## 2026-08-31 long-open binding recurrence

The exact governed action for
`v2026.08.31-source-free-verification-preflight.1` / `787700918778f5db56ca6c9c2701baa176650949`
failed before persistence as `target-binding-invalid`. Read-only inspection
proved the rendered HMAC payload was structurally valid and exact, but had been
issued more than five hours earlier with the normal fifteen-minute expiry. The
page still presented that old action binding after the operator returned to the
long-open tab. No `SelfUpgradeRun` or live mutation occurred.

Treat expiry as loss of fallback authority, not as evidence that a freshly
resolved exact server target is unsafe. Refactor binding verification into one
cryptographic payload check plus the existing strict freshness check. Add a
comparison-only helper that never exposes an expired target for admission. The
action may select only the independently resolved current release, and only
when the expired signed payload matches its kind, SHA, and tag exactly. Forged,
malformed, unresolved, Git-source, or drifted cases remain fail-closed.

Verification is atomic: preserve the strict expiry unit assertion, add exact
and mismatch comparison assertions, reproduce the long-open page in the action
suite, run adjacent self-upgrade tests/typecheck/guards, then protected merge,
one canonical release, one separately authorized governed action, exact served
SHA/CAN-TEST, and the source-free verification preflight. Do not retry the
failed action on the unchanged runtime.

Traceability for `exact-target-never-dispatched-recovery`:

- requirements: OBJ-SUA-002, OBJ-SUA-003, OBJ-SUA-004, OBJ-SUA-006;
- contracts: terminal-predecessor-evidence, release-target-relationship,
  typed-unique-recovery-successor, worker-claim-cas, operator-projection;
- flows: watchdog-terminal-observation, authenticated-recovery-admission,
  successor-dispatch, worker-claim, live-status-observation; and
- verification: AC-SUA-010, AC-SUA-011, AC-SUA-012, AC-SUA-013, AC-SUA-014.

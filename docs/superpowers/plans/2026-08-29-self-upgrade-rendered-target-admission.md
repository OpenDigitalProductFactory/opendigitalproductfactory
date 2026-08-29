---
status: active
---

# Server-Owned Rendered Target Admission Plan

**Backlog item:** BI-EE81F61B
**Workroom:** WC-A48DF3B6
**Branch:** `fix/self-upgrade-rendered-target-admission`
**Historical predecessor Workroom:** WC-25858CAB (BI-3FD07259; unchanged)
**Design:** `docs/superpowers/specs/2026-08-29-self-upgrade-rendered-target-admission-design.md`

## Outcome

A source-free release install can admit exactly the immutable release identity
the server rendered even when action-time discovery is temporarily unavailable.
The browser carries only an authenticated opaque token; it cannot choose or
alter the target. Physical dispatch still requires an independent exact target
match, while resolver absence remains durable and reconcilable rather than
being misreported as terminal drift.

This is a BI-EE81F61B fix layered on protected BI-3FD07259 behavior. The
historical BI-3FD design, plan, baseline, and coverage identity are inputs and
remain unchanged.

## Atomic implementation sequence

1. Freeze the live red fixture: the page rendered
   `v2026.08.29-consumer-restart-identity.1` at
   `bf3cfd88c65344291eae096d83fc0e5c9c01c508`, but action-time discovery
   returned null and no durable `SelfUpgradeRun` was admitted.
2. Add red unit tests for a versioned HMAC target binding: exact round trip,
   malformed payload, forgery, secret rotation, expiry, missing signing
   material, invalid SHA, invalid kind, and invalid tag.
3. Implement a server-only binding module with canonical serialization,
   bounded lifetime, constant-time signature comparison, strict field
   validation, and no repository default secret.
4. Add red page/control/action tests proving the server page mints the token,
   only the opaque token crosses the client boundary, forged or expired tokens
   cannot admit, a resolved mismatch is refused, and a valid release binding
   bridges only resolver-null release installs.
5. Integrate the token without changing the control surface. Preserve all
   session, permission, support, force, quiescence, latest-run, and emergency
   override gates before durable admission.
6. Add the dispatcher red fixture: a persisted exact target plus a temporarily
   null resolver must become `indeterminate` with no worker event, not terminal
   target drift. Keep resolved mismatch terminal and dispatch exactly once only
   after an exact independent match.
7. Run the target-binding, page, control, action, admission, run-store, queue,
   and status test graph; run web typecheck and repository policy/preflight
   guards. Obtain the BI-EE research, exact spec baseline, atomic plan coverage,
   semantic review, and exact-tree CI evidence without rewriting BI-3FD
   evidence.
8. Publish one DCO-signed PR and require all protected pull-request and
   merge-group checks. Create one canonical release from the protected merge
   and require both official publisher and release-mode clean-install success.
9. After global quiescence and exact target checks, use one governed Upgrade
   action. Prove one BI-3FD durable admission/result, exact served SHA,
   CAN-TEST, and convergence of install-state, root `.env`, container image,
   and OCI revision.
10. Run the ordinary governed consumer start path and prove that the same
    immutable identity survives restart before unfreezing BI-F48 and the
    preserved WordPress TaskRun.

## Expected source surface

- `apps/web/lib/self-upgrade/target-binding.ts`
- `apps/web/lib/self-upgrade/target-binding.test.ts`
- `apps/web/app/(shell)/ops/self-upgrade/page.tsx`
- `apps/web/app/(shell)/ops/self-upgrade/page.test.tsx`
- `apps/web/components/ops/SelfUpgradeTriggerControl.tsx`
- `apps/web/components/ops/SelfUpgradeTriggerControl.live.test.tsx`
- `apps/web/lib/actions/promotions.ts`
- `apps/web/lib/actions/promotions.self-upgrade.test.ts`
- `apps/web/lib/self-upgrade/admission.ts`
- `apps/web/lib/self-upgrade/admission.test.ts`
- `docs/superpowers/specs/2026-08-29-self-upgrade-rendered-target-admission-design.md`
- `docs/superpowers/plans/2026-08-29-self-upgrade-rendered-target-admission.md`

No schema, migration, new route, new control, source mount, installed-runtime
edit, or manual consumer environment edit is in scope.

## Design grounding

- Existing specs and plans reviewed: the protected BI-3FD durable-admission
  design/plan, the protected BI-6CB consumer restart-identity design/plan, and
  the BI-EE design linked above.
- Current code substrate reviewed: the server-rendered Upgrade Center page, the
  client trigger boundary, `triggerSelfUpgrade`, durable admission and dispatch
  reconciliation, release-install support projection, and existing HMAC token
  patterns.
- Source of truth: the server-resolved immutable release target at render time,
  authenticated by a short-lived server-only signature and persisted by the
  BI-3FD admission transaction.
- Decision: carry only an opaque authenticated render proof through the browser,
  validate it inside the authorized server action, and require an independent
  exact resolver match before physical dispatch. Never trust ordinary browser
  target fields and never fall back to Git for a release-artifact install.

## Verification map

| Acceptance | Primary test/evidence |
| --- | --- |
| AC-RTA-001 | `target-binding.test.ts` exact round trip and field validation |
| AC-RTA-002 | binding forgery/expiry/secret tests and action denial tests |
| AC-RTA-003 | source-free `triggerSelfUpgrade` admission fixture |
| AC-RTA-004 | action-time resolved mismatch fixture |
| AC-RTA-005 | resolver-null dispatcher indeterminate fixture |
| AC-RTA-006 | exact dispatch, duplicate delivery, and drift fixtures in the admission graph |
| AC-RTA-007 | unresolved Git-source action denial fixture |
| AC-RTA-008 | page/control/action adjacency, web typecheck, protected CI |
| AC-RTA-009 | canonical release, one live upgrade, CAN-TEST, identity convergence, ordinary restart |

## Backlog coverage

- Decision: atomic
- Parent: BI-EE81F61B
- Receipt: `cmte5xb7p094801pgvm1qab3a`
- Mapping: `server-owned-rendered-target-admission` -> BI-EE81F61B
- Dependency: protected BI-3FD07259 durable admission; protected BI-6CB35411
  consumer identity convergence is the live acceptance target
- Rationale: render proof, action verification, durable admission, independent
  dispatch verification, and live restart evidence are one authority chain.
  Omitting any link either reintroduces browser-controlled authority, loses the
  source-free target, or permits physical dispatch without independent proof.

| Deliverable key | Backlog item | Independently shippable | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- | --- | --- |
| `server-owned-rendered-target-admission` | BI-EE81F61B | no | OBJ-RTA-001, OBJ-RTA-002, OBJ-RTA-003, OBJ-RTA-004, OBJ-RTA-005 | opaque-target-binding, admission-transaction, dispatch-state-machine, install-support-boundary | render-sign, client-carry, action-verify, admit, reconcile, dispatch, live-upgrade, ordinary-restart | AC-RTA-001, AC-RTA-002, AC-RTA-003, AC-RTA-004, AC-RTA-005, AC-RTA-006, AC-RTA-007, AC-RTA-008, AC-RTA-009 |

## Risks and rollback

The main risks are replaying a stale token, accepting a browser-selected target,
or confusing resolver absence with target drift. Short expiry, strict payload
validation, server-only signing, existing operator authorization, atomic target
persistence, and independent dispatcher resolution make those cases fail
closed. Rollback is a protected revert of the BI-EE commit; no data migration or
destructive rollback is required, and existing indeterminate rows remain
auditable under BI-3FD reconciliation.

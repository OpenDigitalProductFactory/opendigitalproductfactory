---
status: active
---

# Server-Owned Rendered Target Admission

**Backlog item:** BI-EE81F61B
**Workroom:** WC-A48DF3B6
**Branch:** `fix/self-upgrade-rendered-target-admission`
**Historical predecessor Workroom:** WC-25858CAB (BI-3FD07259; unchanged)
**Predecessors:** BI-3FD07259, BI-6CB35411

## Problem and verified fixture

The source-free consumer Upgrade Center rendered
`v2026.08.29-consumer-restart-identity.1` at
`bf3cfd88c65344291eae096d83fc0e5c9c01c508`. Its single governed action did
not carry that server-resolved identity into admission. The action re-ran target
discovery, fell through to
`git -C /host-dpf rev-parse origin/main`, and returned
`Not admitted: target-unavailable`. No `SelfUpgradeRun` was created and no
live mutation occurred.

The defect is present on named source ref
`fix/durable-self-upgrade-admission-and-dispatch-reco@564a471c0816ae8e00d9db58375b5e3e7e77a00e`:

- `apps/web/app/(shell)/ops/self-upgrade/page.tsx` renders target SHA/tag into
  the client control;
- `apps/web/components/ops/SelfUpgradeTriggerControl.tsx` calls the public
  server action from ordinary browser data;
- `apps/web/lib/actions/promotions.ts` independently calls
  `resolveCurrentSelfUpgradeTarget()` before admission; and
- `apps/web/lib/self-upgrade/admission.ts` previously treated a missing
  dispatch-time resolver result as target drift instead of an uncertain,
  recoverable disposition.

The first TDD draft proved two behaviors before production wiring: the
source-free resolver-null action admitted no run, and the resolver-null
dispatcher failed the run as terminal drift. Those tests became green in a
five-file/129-test draft, but architecture review rejected that draft because
it trusted ordinary client-provided target fields. That draft is research
evidence only and must not be published.

### 2026-08-30 worker-stage recurrence

The protected render/action repair admitted and dispatched
`SUR-5B6E1FE2` for `v2026.08.30` at
`48a7492bdc6da61682f9956a9ca185ba4c12762d`. The worker then discarded that
durable binding, repeated mutable GHCR discovery, and terminally skipped the
run as `no-published-target: registry-unavailable`. A later run to the same
target succeeded when the registry responded. The worker therefore remained a
second, inconsistent home for target authority.

## Objectives

- **OBJ-RTA-001:** Preserve the exact immutable release target resolved by the
  server when the Upgrade Center is rendered.
- **OBJ-RTA-002:** Prevent browser-controlled, forged, malformed, expired,
  mismatched, or unbound target data from creating a durable admission.
- **OBJ-RTA-003:** Keep admission durable and idempotent while target
  re-resolution is temporarily unavailable.
- **OBJ-RTA-004:** Require independently verified immutable image evidence
  before physical mutation, while preserving terminal fail-closed behavior for
  actual drift at dispatch or worker start.
- **OBJ-RTA-005:** Preserve source-install Git discovery and all existing auth,
  quiescence, override, newer-run, and release-support boundaries.

| Acceptance | Objectives | Statement | Verification |
| --- | --- | --- | --- |
| AC-RTA-001 | OBJ-RTA-001, OBJ-RTA-002 | A release-artifact page mints an opaque HMAC binding for kind, SHA, tag, issued time, expiry, and schema version using a server-only secret. | Binding unit tests |
| AC-RTA-002 | OBJ-RTA-002 | Forged, malformed, expired, wrong-secret, wrong-kind, invalid-SHA, blank/oversized-tag, and unbound browser values cannot admit a run. | Binding and action tests |
| AC-RTA-003 | OBJ-RTA-001, OBJ-RTA-003 | If action-time discovery is unavailable, a valid unexpired server binding on a release-artifact install creates exactly one durable admission with that exact target. | Source-free action fixture |
| AC-RTA-004 | OBJ-RTA-004 | If action-time discovery resolves a different kind, SHA, or tag, admission is refused before persistence. | Drift fixture |
| AC-RTA-005 | OBJ-RTA-004 | If dispatch-time discovery is unavailable, the same run becomes indeterminate/reconcilable and no worker event is sent. | Admission state-machine fixture |
| AC-RTA-006 | OBJ-RTA-004 | Reconciliation dispatches exactly once only after the resolver returns the persisted exact kind, SHA, and tag; a resolved mismatch fails closed. | Admission state-machine fixture |
| AC-RTA-007 | OBJ-RTA-005 | Git-source installs cannot use a rendered release binding and retain ordinary Git target discovery. | Git-source denial fixture |
| AC-RTA-008 | OBJ-RTA-005 | Existing auth, force, quiescence, newer-run, and live status behavior remains green; no new user-facing control is introduced. | Adjacent tests and UX verification |
| AC-RTA-009 | OBJ-RTA-001, OBJ-RTA-003, OBJ-RTA-004 | One governed live upgrade reaches the canonical BI-EE release, exact served SHA, CAN-TEST, and restart identity convergence across install-state, `.env`, container image, and OCI revision. | Protected/live acceptance |
| AC-RTA-010 | OBJ-RTA-003, OBJ-RTA-004 | A worker consumes the same bounded publisher-verified candidate used by status/admission when a second registry read is transiently unavailable. | Worker recovery fixture |
| AC-RTA-011 | OBJ-RTA-003 | If neither live nor bounded verified evidence is available, a claimed worker returns the same run to `pending`/`indeterminate` reconciliation before quiescence; it is not skipped and no second admission is created. | Worker and run-store fixtures |
| AC-RTA-012 | OBJ-RTA-004 | A worker candidate whose SHA/tag differs from the durable admission, or whose registry proof reports an integrity failure, terminally fails with a distinct integrity outcome before quiescence. | Drift and digest fixtures |
| AC-RTA-013 | OBJ-RTA-003 | Recovery is constant work per admitted run and uses the existing bounded reconciliation query; no fleet fan-out or unbounded collection is introduced. | Architecture review and existing reconciler bound |

## Chosen design

### Opaque server binding

Add a small `target-binding.ts` module. It signs a canonical, versioned payload
with HMAC-SHA256 and a server-only secret sourced from
`DPF_SELF_UPGRADE_TARGET_BINDING_SECRET`, falling back to `AUTH_SECRET` or
`NEXTAUTH_SECRET`. There is no repository default. Token verification uses a
constant-time signature comparison and validates every field after the
signature is trusted.

The payload is a proof of what the server rendered, not an authorization. The
server action still performs ordinary session/permission, support, quiescence,
override, and newer-run checks. The binding expires after 15 minutes; an
operator whose page is older must refresh rather than admit an identity the
server can no longer confirm.

The page mints a token only when its server-resolved target is a complete
`release-artifact` binding. The client control carries only the opaque token.
It does not submit kind, SHA, or tag as admission authority.

### Action and dispatch behavior

The action verifies the token, reads the current installation support posture,
and resolves the current target:

1. A resolved exact target is authoritative and is admitted.
2. A resolved mismatch returns `target-changed` without persistence.
3. A missing resolver result may use a valid server binding only when current
   support is `release-artifact`.
4. A missing/invalid/expired binding with a missing resolver returns
   `target-unavailable` without persistence.
5. A Git-source install ignores release bindings and requires Git discovery.

Admission persists the exact target as BI-3FD already requires. Dispatch never
trusts the token. It resolves the canonical target independently. Resolver
absence records `admission-target-unavailable` as indeterminate and retains
the row for reconciliation; an exact result dispatches once; an actual
mismatch remains terminal drift.

The worker uses that same verified resolver instead of owning a parallel
registry-only path. Live discovery remains primary. Only
`registry-unavailable` may fall back to recent publisher-verified evidence
bound to the exact install context and current config digest; authentication,
manifest, digest, tag, and source-revision failures remain authoritative. The
worker compares the resulting SHA/tag with the durable admission before any
quiescence. If transient evidence is absent, a compare-and-swap returns the
claimed run to `pending`/`indeterminate`, where the existing bounded admission
reconciler redispatches the same identity. This preserves one source of target
truth and one physical-upgrade identity.

The scale ceiling remains the admission reconciler's existing bounded batch of
recoverable runs; this repair adds O(1) work and one bounded evidence lookup per
worker delivery. EP-56AE0F69 owns further self-upgrade lifecycle evolution.

## Rejected options

- **Ordinary client fields:** rejected because a forged or stale browser can
  create an indeterminate durable row and block the legitimate upgrade.
- **Re-resolve only at action time:** rejected because the live source-free
  fixture already proved the resolver can transiently lose a target that the
  same server just rendered.
- **Dispatch directly from the binding:** rejected because render-time proof is
  not physical-deployment authority.
- **Mount source or edit the consumer `.env` manually:** rejected as a bypass
  of the installed-runtime and governed upgrade contracts.

## Ordered fix sequence

1. Add failing token tests for round-trip, forgery, malformed input, expiry,
   secret rotation, kind/SHA/tag validation, and missing server secret.
2. Implement the bounded HMAC binding module and make those tests green.
3. Add failing page/control/action tests proving only the opaque binding crosses
   the client boundary and unbound/forged fields cannot admit.
4. Mint the binding in the server page, forward the token through the client
   control, and verify it inside the action.
5. Preserve the first draft's source-free admission, drift refusal, Git-source
   denial, and resolver-null indeterminate state-machine tests; refactor the
   action so the verified binding is the only fallback authority.
6. Run all graph-linked self-upgrade tests, web typecheck, prose/style guards,
   diff checks, exact-tree local CI, and independent semantic review.
7. Deliver through DCO/protected merge, one canonical release, one governed
   live action, exact served-SHA/CAN-TEST, and restart identity convergence.
8. Add the worker-stage recurrence fixtures, consolidate registry plus bounded
   verified-evidence resolution behind one helper, compare against the durable
   admission, and return transport-unavailable runs to reconciliation before
   mutation. Keep all typed integrity failures terminal.

No step is independently shippable: signing without action integration is
unused, action integration without dispatch reconciliation wedges admissions,
and dispatch reconciliation without authenticated render proof preserves the
original authority defect.

## Atomic backlog coverage

| Deliverable key | Backlog item | Independently shippable | Requirement refs | Contract refs | Flow refs | Verification refs |
| --- | --- | --- | --- | --- | --- | --- |
| `server-owned-rendered-target-admission` | BI-EE81F61B | no | OBJ-RTA-001, OBJ-RTA-002, OBJ-RTA-003, OBJ-RTA-004, OBJ-RTA-005 | opaque-target-binding, admission-transaction, dispatch-state-machine, install-support-boundary | render-sign, client-carry, action-verify, admit, reconcile, dispatch, worker-verify, worker-reconcile, live-upgrade | AC-RTA-001, AC-RTA-002, AC-RTA-003, AC-RTA-004, AC-RTA-005, AC-RTA-006, AC-RTA-007, AC-RTA-008, AC-RTA-009, AC-RTA-010, AC-RTA-011, AC-RTA-012, AC-RTA-013 |

## Scope, rollback, and root-cause prevention

The change adds no table, migration, route, control, or business-data surface.
Rollback is the protected revert of the BI-EE commit and release; an
indeterminate admission remains auditable and can be reconciled by the prior
BI-3FD path.

The regression suite permanently binds the render-to-action authority boundary,
the source-free fixture, token integrity/expiry, and dispatch-time independent
verification. This prevents a future refactor from silently converting
displayed release identity back into Git discovery or client trust.

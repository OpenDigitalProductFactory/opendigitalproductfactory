# Scoped DEV upgrade timing

Backlog: **BI-DE9FB008**. Workroom: **WC-3BEE075D**.

## Design grounding

Extend [the existing agent-safe upgrade design](../specs/2026-06-30-agent-safe-self-upgrade-trigger-design.md#proposed-dev-timing-amendment--2026-10-14).
The timing policy currently treats all agents alike; the server already has
canonical instance stance and cautious environment precedence. This is platform
WWMD work, funded as reliability/refactoring, not organization operating-hours
administration. Original peer-owned BI-2128872C remains read-only.

## One atomic deliverable

DEV-TIMING implements AC-DEV, AC-BOUNDARY, AC-BLACKOUT and AC-PIPELINE together.
The scope condition, request composition, safety regressions and design amendment
cannot ship independently: a condition without its request boundary is unusable,
and a caller-controlled condition would weaken the protection being preserved.

1. Bind immutable plan coverage to this small delivery shape and six claimed paths.
2. Write the failing regression for a verified development/evolve-dpf request
   outside the business window; record its actual failure on the named base.
3. Compose trusted server stance at the existing request/timing boundary. Retain
   agent identity, force=false, blackout, batch readiness and active-run joining.
   Catch missing/invalid/unavailable stance as the existing cautious policy.
4. Verify production, staging, other purpose, missing/invalid stance, blackout,
   ineligible batch and active-run cases. Run both web type programs and affected
   source guards. Obtain independent exact-source review.
5. Publish with DCO and protected CI/queue. Record unrun native/full integration
   honestly if the existing scoped operator-emergency publication route is used.
6. Publish a containing immutable batch and advance only through the governed
   pipeline. Reconcile the original deferred request before any additional call;
   validate the actual served source and live policy behavior.

## Traceability

Requirement refs: AC-DEV, AC-BOUNDARY, AC-BLACKOUT, AC-PIPELINE.
Contract refs: apps/web/lib/self-upgrade/upgrade-timing.ts,
apps/web/lib/self-upgrade/request.ts, apps/web/lib/install/instance-stance.ts.
Flow refs: request_self_upgrade, ops/self-upgrade.run.
Verification refs: apps/web/lib/self-upgrade/upgrade-timing.test.ts,
apps/web/lib/self-upgrade/request.test.ts, verify_live_install_readiness.

## Risk and rollback

Incorrectly trusting caller context would widen production timing. Only server
stance is eligible; absence and errors retain the cautious rule. Blackouts and
batching prevent an eager DEV request from overriding a recorded pause or
starting an unready batch. Revert the timing amendment to restore nightly-only
agents; retain all historical request and artifact evidence. No schema or data
mutation accompanies this source change.

## Backlog coverage

One atomic deliverable maps to BI-DE9FB008. The immutable plan coverage receipt
is pending; implementation does not begin until the normal writer accepts it.

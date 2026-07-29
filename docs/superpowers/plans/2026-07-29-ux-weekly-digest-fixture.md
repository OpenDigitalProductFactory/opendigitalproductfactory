# Deterministic weekly-digest UX fixture

Backlog item: BI-1C048B7A  
Epic: EP-UX-SYSTEM

## Outcome

Keep the exhaustive authenticated UX sweep strict while making `/workspace`
start from one reproducible, clean-owner attention projection. The existing
fixture command already runs before portal startup and again after readiness;
both passes will converge the database rows that can enter the weekly-digest
lane.

## Grounding

- `apps/web/scripts/ux-sweep-fixture-core.mjs` owns the idempotent fixture
  convergence contract.
- `.github/workflows/ux-route-sweep.yml` invokes that contract before startup
  and after the portal is ready.
- `apps/web/lib/attention/aggregate.ts` loads the three sources that can produce
  the conditional digest suffix observed in the failing artifact:
  `CoworkerMemoryNote`, pending `ResearchProposal`, and unresolved unlinked
  deferred `DecisionInteraction`.
- The evidence matrix in BI-1C048B7A proves the same exact source can render
  either 199 or 204 words. No source or plan search found an existing plan for
  this fixture boundary.

## Atomic delivery

This is one independently reviewable fix. The phases are internal sequencing,
not separately shippable behavior:

1. Extend the fixture unit contract with the zero/one digest race and
   idempotent convergence expectations.
2. Converge only weekly-digest source rows in the disposable sweep database and
   report source-specific counts.
3. Run focused tests, the exact merged-code governed gate, and require both
   PR-head and merge-group exhaustive UX sweeps to pass unchanged.

## Backlog coverage

Decision: atomic  
Umbrella and delivery BI: BI-1C048B7A  
Coverage receipt: cms673pj203es01o65oc0zvyo

The fixture mutation, its contract test, and its hosted sweep proof cannot ship
independently: without the mutation the race remains, without the test the
fixture contract is unguarded, and without the hosted sweep proof the
runtime-created row boundary is unverified.

## Risks and rollback

- Risk: a broad cleanup could hide unrelated owner decisions. The mutation is
  limited to the three row shapes that route into `weeklyDigest`; money,
  public-action, customer, technical, and build-linked decision inputs remain
  untouched.
- Risk: Prisma JSON null differs from JavaScript null. The entry point passes
  `Prisma.DbNull` explicitly and the core contract refuses to run without it.
- Rollback: revert the single PR. No production migration, baseline, route
  assertion, tolerance, or application behavior changes.

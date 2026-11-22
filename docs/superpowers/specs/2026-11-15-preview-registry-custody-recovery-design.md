---
status: draft
---

# Preserve preview graph-registry custody and recover verified drift

Backlog: BI-0AD6196F. Epic: EP-5F6369AB. Implementation owner: WC-9FC3B719,
branch `codex/preview-registry-custody-recovery`. This ordered fix design extends
the registry/migration ownership in
[the typed relation vocabulary design](2026-10-27-typed-relation-vocabulary-design.md#5-implementation).
It does not replace that design or the scoped-judgment acceptance baseline.

## Problem and research

At protected main `dba0dc1fd5c0cba4f128401b01c7db908278e3b5`, the clone's
`buildDestinationResetSql` excludes `_prisma_migrations` but includes
`graph_relation_type`. `runWithDestinationCleanup` resets before copying and
again after failure. A source-import experiment and a governed PostgreSQL TEMP
fixture reproduced registry rows 2 -> 0 while completed history stayed 1 -> 1.
The fixture asserted `pg_temp` identity and rolled back; no persistent tables
were touched. Reproduction: original Workroom evidence sequence 302.

The actual disposable preview has eight registry rows without `PART_OF` or
`DEPENDS_ON`, while its completed `20261028060000_graph_relation_type` checksum
matches source that inserts both. The later relation-drift migration failed
with 23503. Matching checksums and completed history contradict simple ordering.
The exact historical writer remains unknown; the synthetic experiment proves a
source failure mode, not retrospective attribution.

Research receipt: `initiative-441078bf-3e78-40c5-8d5c-6654fddeaedd`.
Decision [DI-112D44FAA6C3](https://localhost/coworker-decisions/decisions/DI-112D44FAA6C3)
selects preserving the migration-owned registry rather than replacing it during
clone and restoring it afterward. Signal usable, autonomy eligible, high
confidence, no blockers or commandment conflict. The decision selects this
source design; it grants no database, deployment or runtime authority.

## Objectives and acceptance

**OBJ-1:** Sanitized clone preserves the installed migration-owned graph
dictionary across successful, failed and interrupted copies.

**OBJ-2:** The existing disposable-preview convergence path can recover only
the demonstrated, source-verified registry drift without editing migration
history by hand, deleting data or reporting a failed migration as applied.

**OBJ-3:** Guarded source verification and an admitted synthetic PostgreSQL
fixture establish the recovery contract before any new served verification.

| Requirement | Objective | Observable acceptance |
|---|---|---|
| REG-01 | OBJ-1 | Reset SQL excludes both migration history and graph registry; ordinary application-table cleanup remains intact. |
| REG-02 | OBJ-1 | Source COPY also excludes the graph registry, so missing/older source rows cannot overwrite installed dictionary custody. |
| REG-03 | OBJ-2 | Recovery refuses non-dev destinations, wrong migration names, changed source/checksums, missing completed prior history, incompatible registry shape and unrelated/concurrent failed migrations. |
| REG-04 | OBJ-2 | Only missing rows from the exact completed registry migration's reviewed INSERT are restored; existing rows are not overwritten. |
| REG-05 | OBJ-2 | Only the exact failed relation-drift migration with matching source/history and demonstrated FK failure is eligible for a bounded supported rollback-and-deploy retry; never mark it applied. |
| REG-06 | OBJ-3 | Actual immutable migration SQL is idempotent on synthetic ordinary/adverse fixtures; all refused cases perform no repair/history command. |
| REG-07 | OBJ-3 | Exact-tree tests/types, governed integration and independent review precede protected publication. Served acceptance remains separately recorded. |

## Existing contracts and scope

Keep `graph_relation_type` owned by the existing migration/vocabulary contract,
not a copied organization dataset. Extend the existing clone reset/copy policy
and `dev-preview-migrate-converge.mjs` / `dev-preview-migrate-deploy.mjs` seam.
Use the existing `DPF_ENVIRONMENT=dev` and disposable URL refusal. Runtime
verification requires its normal shared lease and verified destination binding.
No new table, service, workflow engine, authority grant or production adapter.

Committed migrations stay byte-identical. The original registry SQL SHA256 is
`b0b76a1bfceaa4909e00c3e820d9c103b5098d7f122054ff52c2b116f0a703b8`;
the failed relation-drift SQL SHA256 is
`2606adc435559392f8a9804ce6afbfb2e71708cfeeed5e08a782be2766b5edfa`.
Bind recovery to those exact contracts and the live history. Reuse the reviewed
original registry INSERT rather than inventing a second dictionary. Apply
missing rows idempotently, validate the required keys, then use the supported
Prisma retry path only after the failed SQL's repeatability is established.
Any mismatch remains `blocked_sandbox_drift`. Keep the existing hive repair
contract independently qualified; do not broaden its allowlist generically.

## Ordered implementation and verification

1. **Reproduce custody loss and define its regression.** Add meaningful clone
   tests for reset, source-copy exclusion, success/failure and retained history.
   Add guarded-convergence tests for each refusal and command ordering.
   Capture genuine RED before source edits. Covers REG-01 through REG-03.
2. **Preserve custody.** Change reset and COPY selection together; preserve
   existing application cleanup, confidentiality filtering and source identity
   checks. Run the affected clone tests/types. Covers REG-01 and REG-02.
3. **Implement narrowly verified recovery.** Probe exact migration/history/schema
   and source hashes, restore only missing reviewed reference rows, then admit
   one supported rollback/deploy retry for the known repeatable migration.
   Exercise absent, mismatched, partial and repeated cases; keep refusals closed.
   Covers REG-03 through REG-05.
4. **Qualify the whole sequence.** Under one fresh normally admitted lease,
   create only isolated synthetic TEMP fixtures, exercise actual migration SQL
   before/after recovery and on repeat, verify refused cases are effect-free,
   and roll back. Do not repair the shared preview during this experiment.
   Covers REG-04 through REG-06.
5. **Deliver and resume acceptance.** Run affected unit/types, current impact
   obligations, governed integration, exact-source independent review and
   `pnpm land`. Only then use the supported governed preview path for the actual
   verified disposable target, retaining pre/post migration evidence. Resume
   BI-BDF358CB ordinary/adverse/recovery and installed-package checks separately.
   Covers REG-07; no acceptance claim until actually observed.

These are sequential parts of one repair, not independently complete outcomes:
preservation alone leaves the existing preview blocked; recovery alone allows
the next clone to erase the registry again. Keep one implementation BI and one
reviewable source revert. No runtime retry or migration command follows merely
from this document or a source unit test passing.

## Impact, risks and rollback

Expected source: `packages/db/src/sanitized-clone.ts` and its existing tests;
`scripts/lib/dev-preview-migrate-converge.mjs` and tests;
`packages/db/scripts/dev-preview-migrate-deploy.mjs` and the existing preview
contract tests. Inspect native related tests and claimed-path impact before
implementation; unresolved impact expands verification. Document the supported
preview recovery and its refusal conditions in the existing architecture/runbook
home in the same change.

The main risks are accidentally retaining business rows, overwriting a valid
dictionary, accepting partial migration effects and widening automatic repair.
Exact table policy, immutable-source checks, narrowly matched history/schema,
bounded retry and actual PostgreSQL adverse fixtures address those risks.
Source rollback is a protected revert of the coupled policy/helper/tests. It
must hold preview work if the old destructive dictionary-copy behavior would
return; it must not delete repaired dictionary rows or rewrite persisted history.

## Backlog coverage

Implementation parent: BI-0AD6196F. Atomic deliverable `registry-custody-recovery`
maps REG-01..REG-07 and OBJ-1..OBJ-3 to the ordered sequence above. The live
coverage receipt must be recorded against this immutable design before
implementation; a Markdown mapping alone is not a permit. Original receiving
BI-BDF358CB remains a separate acceptance obligation and is not closed by this fix.

## Verified post-delivery continuation

PR7147 delivered the preceding source at protected merge
`ec084600baf4238ac6d743af0b7670870a7d31e5`. Its actual admitted preview
`NPEL-1B4649903A` passed install, generation and migration recovery, then entered
sanitize before the owned keeper was stopped. The initializer deliberately runs
the clone from the canonical image's `/app`, whose inspected source lacked the
new registry policy. Mounted candidate source therefore did not establish clone
custody. The subsequent read-only, binding-verified disposable database check
found zero registry rows, the original exact registry migration completed, one
rolled-back drift attempt and one completed drift attempt, each checksum-bound
to the unchanged source. This records the present sequence; earlier historical
actor attribution remains unknown. The reservation was released normally. No
served acceptance or whole-process cleanup proof was obtained.

Native repair evidence sequence71 and original receiver sequence305 retain this
finding. `DI-4AB3F0F295FA` selects completing this same repair through qualified
source continuation (high confidence, autonomy eligible, no commandment conflict).
The initial featureless consultation abstained and authorized no action.

The original seven requirements and their delivered evidence remain immutable
historical proof. The following requirements complete the same outcome against
the newly observed installation and destination state:

| Requirement | Objective | Observable acceptance |
|---|---|---|
| REG-08 | OBJ-1 | Before stopping or initializing any preview, compare the canonical image's actual clone source bytes with the verified candidate clone source. A missing file, unreadable digest or mismatch refuses startup with no initializer, migration or clone command. Install advancement belongs solely to the designated canonical actuator. |
| REG-09 | OBJ-2 | The existing disposable migration convergence entry also restores missing dictionary rows when both known migrations are completed with exact source checksums, the demonstrated prior failed drift attempt is rolled back, schema matches and no active failed migration exists. This branch performs no Prisma resolve, migration replay or history edit; all unrecognized states refuse. |

Ordered continuation, before any further actual preview:

1. Extend the existing initializer precondition with exact clone-source digest
   identity, using only bounded read-only inspection of the canonical container.
   Add a genuine old-image RED and matching-image GREEN in the existing preview
   runtime test entry; prove the refusal precedes initializer/runtime mutation.
2. Extend the existing checksum/schema/history recovery decision and locked
   transaction, retaining its original failed-attempt branch. For the completed
   branch require exactly one completed drift row with one applied step and the
   exact checksum, plus exactly one rolled-back, unfinished, zero-step row with
   that checksum and the demonstrated 23503 FK diagnostic. Require no active
   failed migration anywhere. Restore only the original source INSERT's missing
   keys, preserving existing values/custom rows and all ledger rows. Return
   terminally without a history command or migration replay. Keep checksums,
   original committed SQL, dev destination checks and transaction bounds.
3. Exercise absent/mismatched source, ledger, schema, unrelated failures,
   concurrent state changes, already-attempted recovery, interrupted inserts and
   repeated completed-state recovery. Under a normally admitted PostgreSQL TEMP
   fixture, qualify actual reviewed SQL, missing-only restore, dictionary custody
   and unchanged history, with namespace assertions and full rollback.
4. Run current impact obligations, affected tests/types, governed integration,
   exact-source independent review and protected `pnpm land`. Preserve prior
   source evidence under its original identities. Canonical actuator installation
   and a fresh admitted preview are separate dependencies; neither a source
   merge nor this plan authorizes an install advance or a blind retry.
5. Verify actual restored registry/history and clone preservation, then resume
   the original receiver's served ordinary/adverse/recovery and installed archive
   acceptance. Release the owned reservation normally and reconcile both items.

This extension introduces no table, service, permission, production mutation,
destructive reset or manual ledger repair. Its rollback is one protected source
revert with preview held when custody cannot be established. The two added
criteria must enter the same item's acceptance baseline and fresh plan coverage
before implementation; the old seven-criterion receipt is not relabelled.

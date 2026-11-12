---
status: active
---
# Settle obsolete reservation approvals

BI-3C0F7A92 · EP-AUTONOMOUS-DECIDE · WC-FC10201F. Narrow, independently
shippable continuation of BI-8D8939E5; its wider DI-to-actuator proposal remains
open. DI-E28DC01BF184 records a planning choice, never execution authority.

## Problem and existing architecture

On main `834d1446696c4d16957cd890a59c0c2070698925`, the concierge's
`retireLapsedEnvelopes` calls `expireLapsedEnvelopes`, which considers only
elapsed decision windows. A still-fresh release request remains proposed even
after its reservation is cancelled or expires. Existing lease supersession and
durable-wait settlement already work; do not duplicate them. Reuse the envelope
state machine and approval-convergence architecture, not a second approval store.

Live terminal examples are recorded in `cmvxar5r01cnj01tmq3kursj3`; they are
executed historical requests, not evidence of a currently pending obsolete card.
The named-source behavior test below is required to establish that defect.
The current named Codex agent has no explicit governance profile and derives an
approval floor. That observation does not grant any cleanup exemption.

## Authority and data boundary

This is lifecycle settlement, not approval or execution. The only write is an
unreserved envelope's legal transition to `cancelled`, with its settlement time.
Keep original arguments, rationale, human markers and fingerprints intact.
No release handler runs; the reconciliation changes no lease, provider,
permission or human decision. The admission-history amendment below records
future lifecycle facts in the existing lease, without granting cleanup authority.

Accept only taskless, authority-bound `release_nonprod_environment_lease`
requests whose exact parked call belongs to the same user and tool and hashes
to the stored approval input fingerprint. Require the envelope binding itself
to match its recorded fingerprint and actor fields. A redacted, malformed,
unbound, task-bound or ambiguous request stays untouched.
Positively identify every bound original `ToolExecution`: `success: false`,
result `error: approval_required`, and the same result envelope ID, tool,
human, assistant and exact input. Reuse `originalToolParameters` and the existing
fingerprint functions. A non-parked, successful, failed or uncertain execution
row prevents settlement. Read at most 26 rows; more than 25 is inconclusive.
Do not require platform-only resume metadata on an external MCP request.

Read the exact reservation under its existing environment advisory lock in a
database transaction: terminal gate rows can be revived by a normal claim, so
an unlocked snapshot is insufficient. Require a cancelled/expired reservation,
no admission, no slot or active key, no process identity/PID, cleanup command,
resource class or memory reservation. Require exact lease/session arguments to
match the row. This is target identity, not proof that the caller owns resources.
Require a recorded terminal timestamp and positive database-owned admission
history: `admissionHistoryVersion: 1` and `firstAdmittedAt: null`. Neither
`admittedAt: null` nor slot-manifest version proves that history; both can be
reset or backfilled. Unknown historical rows remain explicitly inconclusive.
No active, queued, admitted, missing or uncertain target qualifies. Existing
explicit-always policies and PROD cleanup controls are unchanged because this
path authorizes and releases nothing. No legacy provenance is backfilled.

Write with the exact old status and `resolvedAt: null` compare-and-set. A racing
human decision or execution reservation wins. Task-bound envelopes remain out of
scope so this change cannot strand or falsely finish a paused task.

## Ordered deliverables and acceptance

1. Reproduce a fresh release envelope surviving the current scheduled expiry
   cleanup despite an already cancelled, never-admitted reservation.
2. Apply the forward-only admission-history amendment below, then add a bounded,
   server-only lifecycle reconciler and compose it with the
   existing concierge cleanup. Preserve ordinary time expiry separately.
   Scan at most 200 requests per pass in stable ID order, with one look-ahead
   row. Save counts and the next cursor in the existing standing-room sweep
   activity payload; resume from that cursor next pass and wrap at the end.
   Unchanged negative prefixes must not starve an eligible request on page 2.
   No new scheduler, table, queue or authority store is introduced.
3. Verify cancelled and expired targets, proposed and approved states, exact
   input binding, unchanged audit data, no handler execution, idempotence,
   human/execution races, and every negative boundary above. Report scan limits;
   a bounded pass must not claim to have examined the entire inbox.
   Include a more-than-one-page regression and real isolated-PostgreSQL barrier
   tests for revival versus settlement and execution reservation versus
   settlement: one winner, zero handler calls and original audit data retained.
   Compose the actual existing terminal-gate reviver with settlement, proving
   that reset last-state fields cannot hide an earlier admission. Verify legacy
   rows cannot acquire eligibility through manifest or history backfill.
4. Run affected tests, both web TypeScript checks, documentation checks and the
   governed integration gate; obtain independent source assessment and publish
   through the protected PR process. Exercise the existing cancelled outcome on
   the served target after the canonical release, with source/runtime evidence
   kept distinct.

## Forward-only admission history (R1 amendment)

Independent review of `f409fef16e672e92e63b1b516834151865d8e46c` found
that the existing gate reviver clears admission/slot/evidence fields on the same
lease ID. Current wait projections also overwrite their state on requeue.
The exact committed-schema read at main `834d144` found no retained historical
admission fact. The ordinary preview producer declares a cleanup command, so a
hypothetical process-free preview cohort does not establish real coverage.

Planning decision `DI-BAAF37D46EC3` selects a fact in the existing canonical
lease record. This is a design choice, never an execution permission or test
pass. Add only nullable `admissionHistoryVersion` and `firstAdmittedAt` fields
on `NonProductionEnvironmentLease`; no default or backfill for retained rows.

The database owns both facts through one row trigger, following the existing
database-owned Workroom sequence/preservation pattern. Reject supplied history
on insertion. Stamp only the actual fresh producer shape: its creation time equals
the database transaction timestamp, with either queued/no-admission/no-slot
state or actual active admission. The fresh claim must read and validate
`CURRENT_TIMESTAMP::timestamp(3)` inside its existing database transaction and
supply that value as `createdAt`; omitting the ORM field does not establish
that database-clock contract. A missing or invalid real clock result aborts
creation rather than inventing history. Legacy narrow domain ports without a
clock reader keep their existing unknown-history behavior. A fresh queued row receives version 1 with no first
admission; an active row receives version 1 and a database-clock first admission.
A terminal or historical/backdated insertion remains unknown regardless of
submitted values. A structural table copy has no trigger and cannot mint proof.
Existing rows keep their NULL version, including when later updated. Actual
producer tests must establish the creation-default contract; a synthetic clock
or marker is insufficient.

On every update, preserve the version and any recorded first admission, ignoring
supplied replacement values as database-owned fields. A
version-1 row entering `active` records its first admission from the database
clock once, regardless of omitted or explicit NULL fields from older writers.
No requeue, revival, release, ORM update or raw SQL update can erase or invent
that record. `active` is the actual resource-admission status in the existing
claim controller; this fact does not prove command execution or process cleanup.
Historical schema copies and raw historical inserts cannot confer eligibility.

The invariant must cover both queued-to-active and immediate-active producers.
PostgreSQL row triggers expose the original and replacement row and may validate
or modify the saved row; see the [official trigger-function documentation](https://www.postgresql.org/docs/current/plpgsql-trigger.html).
No database extension or new journal table is needed. Unknown legacy rows remain
unknown after migration and source rollback. No grant, autonomy policy or caller
assertion can substitute for the positive history fact.

Real isolated-PostgreSQL tests must attach the exact migration function to their
private cloned table: `LIKE` does not copy triggers. Prove the real fresh queued
and immediate-active producers, migration-applied older writer shapes, retained
admission across actual gate revival, legacy non-conversion, ignored/rejected
history forgery/erasure, historical-copy behavior, and the existing revival/reservation barriers. Synthetic version
fields in unit fixtures alone are not evidence of a real eligible cohort.

## Compatibility and non-goals

The two nullable columns and their invariant are the only schema amendment;
there is no seed change, new model, grant, tool, scheduler or autonomy policy. Reuse
the concierge schedule and existing cancelled/not-run outcome. No automatic
cancellation of queued reservations, process cleanup, owner impersonation,
original-task replay, or general DI execution. A read or transaction failure is
inconclusive and leaves the request unchanged. The migration is forward-only;
source rollback keeps the database-owned invariant, which also handles old
writers without requiring them to supply the new fields. Never drop history to
make a rollback pass. Existing retention and ownership stay with the lease row.

The immutable ordered design at `23b555b2b9d8a5f50e9d64a3fe54bcbdba9e5c63`
has canonical atomic coverage `cmvxc39dl1ohb01tmxht777wk`. Research receipt
`initiative-7bd2fe82-f908-4096-926e-4fa741fbc1c8` and implementation admission
`IRD-5942914DF41A` cover the prior bounded algorithm. Its source checks passed
1,419 affected tests and both web TypeScript programs. Nineteen conditional
tests were skipped locally. Canonical evidence `cmvxcrqto1wgu01tmlnbay7sd`
then passed 232 affected tests in 12 files, including all four real database race
cases, and both web TypeScript programs for f409 against base `e7f5784`.
That is not exhaustive coverage or proof of the R1 amendment: independent P2
`cmvxcmkcc1tbi01tm3zuzpxdq` still blocks that source from shipping. The history
amendment, migration and new producer/revival tests are unimplemented at this
design checkpoint and need ordinary updated scope/coverage/admission, source and
data assessment, qualified integration and served verification.

The strengthened reproduction uses a positively identified original parked
`approval_required` call and exact fingerprint. Against the unchanged main
expiry routine alone it fails with proposed rather than cancelled; adding the
new lifecycle step passes. A controlled baseline experiment restored the green
test's exact bytes afterward. Native receipt and source review remain distinct
from database, execution and deployment proof.

## Coverage of the recorded acceptance contract

CT-OBS is the authority and data boundary above. FLOW-OBS is the ordered
concierge cleanup and locked cancellation flow. V-OBS is the regression,
negative/race checks, qualified integration and served verification in step 4.
These criteria quote the live item's acceptance contract; the implementation
retains the narrower taskless and never-admitted limits stated above.

| Reference | Recorded acceptance criterion |
| --- | --- |
| AC-OBS-1 | Exact terminal reservation makes its unreserved release request visibly cancelled/obsolete, with no authorization or handler execution. |
| AC-OBS-2 | Unrelated requests, active/queued reservations, missing rows, executing envelopes and unknown outcomes retain their controls. |
| AC-OBS-3 | Compare-and-set races cannot overwrite an execution reservation or human decision. |
| AC-OBS-4 | Tests reproduce current-source defect, demonstrate repair, and cover negative and race boundaries. |
| AC-OBS-5 | Qualified integration and served checks are reported separately from source review. |

All five map atomically to BI-3C0F7A92. Wider autonomy and task-run lifecycle
repairs stay with their existing carriers and are not closed by this change.


## Measured producer-clock correction

Qualified afd attempt `cmvxfqq1a2m3d01tmjtqfoi0t` remained failed: the explicit
waiting deadline was corrected, but the standalone fixture ignored its pressure
setting and actual new rows did not reliably acquire positive birth history.
Source inspection proves a missing pool configuration selects compatibility
singleton admission before pressure is consulted. Configure the canonical
private PlatformConfig row for pressure-based producer tests.

A bounded private diagnostic under the still-admitted exact afd runtime
(tree `0c8e91f119a0463e9b5d47c9b4376e4369e947f9`) measured three ORM inserts
omitting createdAt: their saved times differed from the same transaction clock
by 21/2/2 ms, with NULL history. Three counterfactual inserts supplying the
validated database transaction timestamp yielded zero difference and version 1.
The committed migration remains immutable. Its historical omitted-creation-time
comment records the disproven assumption; the current producer supplies the
database timestamp explicitly. The private schema was removed; this is diagnostic
evidence, not a passing gate
or proof that the actual producer is repaired (`cmvxfrmja2m6801tmykjxmp3p`).

Within the admitted implementation, first add a failing actual-claim source test
for database-clock use and invalid-clock refusal. Reuse the existing provenance
module for a small validated birth-fields helper and move the existing lease-ID
factory there without changing its format; compose it only at fresh
creation, never existing-row refresh or revival. Keep the strict SQL comparison,
first-admission preservation and legacy non-backfill rule unchanged. Make the
private database race fixtures create with the same transaction clock, configure
the real producer fixture's pool, and rerun real producer/revival/legacy/race
cases plus ordinary independent review and canonical integration. No new stored
fact, model, tool, grant or authority exception is introduced.

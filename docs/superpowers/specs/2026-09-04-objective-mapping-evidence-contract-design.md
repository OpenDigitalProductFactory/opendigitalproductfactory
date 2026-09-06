---
status: active
title: Objective-mapping evidence contract and correction
---

# Objective-mapping evidence contract and correction

**Backlog item:** `BI-0F8E39D5`
**Parent contract:** `docs/superpowers/specs/2026-09-01-completion-readiness-recovery-design.md`

## Decision summary

An `objective-mapping` recovery packet must carry the finite set of activity
IDs that the server has already proved are eligible evidence for the current
initiative baseline. The narrowed writer schema permits only those IDs, and
the repository independently revalidates each referenced row before appending
the mapping. A malformed latest mapping stays auditable but projects the
existing missing-mapping recovery requirement so a later governed proposal can
supersede it; it never falls back to an older mapping or becomes PASS.

## Observed failure

On the current protected tree `76ef1adc8e0d64e30695684270c6df7f7563c11f`,
the recovery packet tells a coworker to map statements to post-baseline
evidence but provides no eligible activity IDs. The generic writer schema
accepts any non-empty strings and `objective-mapping-repository.ts` validates
only statement IDs. For `BI-2B619BC9`, the coworker therefore persisted mapping
activity `initiative-12011…` with a source-document path in `evidenceRefs`
instead of one of the real post-baseline evidence activities
`cmtnr924q…`, `cmtnr926e…`, `cmtnr9295…`, or `cmtnr927v…`. Canonical
reconciliation correctly rejects that row, but because it inspects only the
latest mapping and classifies the bad reference as malformed, completion now
fails with `READINESS_PROJECTION_FAILED` and exposes no governed correction.

Candidate causes ruled out:

- Baseline absence is not the cause: `baseline-c2b59832…` is current.
- Delivery evidence absence is not the cause: the four post-baseline activity
  rows exist and are passing.
- Reconciliation accepting source paths is not the desired repair: its
  activity-id lookup and same-item/post-baseline/pass checks are the correct
  fail-closed authority boundary.
- Falling back to an older mapping is not safe: it would silently disregard the
  latest reviewer proposal rather than correct it through a governed write.

## Objectives

**OBJ-OMEC-PACKET:** A server-issued objective-mapping packet exposes one
bounded, deduplicated set of eligible post-baseline evidence activity IDs and
binds the writer schema to that set.

**OBJ-OMEC-WRITER:** Persistence accepts only evidence activities that still
belong to the same backlog item, are at or after the current baseline, and
carry a passing initiative evidence kind.

**OBJ-OMEC-CORRECTION:** A malformed latest mapping remains non-passing and
auditable while the existing recovery route can append one newer, valid,
governed mapping that supersedes it.

**OBJ-OMEC-FAIL-CLOSED:** Missing, foreign, pre-baseline, failing, conflicting,
or unbounded evidence never contributes to coverage and never produces a
readiness PASS.

**OBJ-OMEC-KEY:** The server derives the objective-mapping request identity
from the complete immutable review packet, including the Workroom head,
baseline, artifact, reviewer, tools, and normalized eligible evidence set.
Byte-identical packets reuse one TaskRun; a changed server-proved evidence set
uses one deterministic successor key rather than colliding with an obsolete
packet at the same Workroom head.

**OBJ-OMEC-SUPERSESSION:** A successor key is issued only for an evidence-set
change inside the same immutable Workroom, baseline, and artifact identity.
Caller-invented suffixes, identity drift, or a prior current packet with active
approval or authoritative writer/receipt state fail closed while all historical
TaskRuns and envelopes remain auditable.

## Architecture and data flow

The terminal recovery adapter already loads the current validated baseline and
the exact immutable design artifact. Extend that same server-owned read to load
a bounded list of `BacklogItemActivity(kind='evidence')` rows for the same item
whose `recordedAt` is at or after the baseline and whose payload evidence kind
is accepted as passing by objective reconciliation. Sort by activity ID,
deduplicate, and cap the packet at the existing bounded recovery limit. Zero
eligible rows yields a typed no-route escalation rather than an unconstrained
writer.

Add `eligibleEvidenceActivityIds` to the objective-mapping binding. Historical
non-mapping bindings remain parseable, but a newly issued objective-mapping
route requires a non-empty list. `narrowInitiativeReviewTools` constrains every
`evidenceRefs` element to that exact enum and requires a unique, non-empty
array. The prompt names the same finite IDs; it does not ask the model to infer
database identifiers from prose or source content.

The repository is the final authority. In its serializable transaction it
reloads the current baseline and all referenced activities, then verifies:

1. every reference resolves exactly once as `kind='evidence'` on this item;
2. every row is at or after the current baseline;
3. every payload evidence kind is in the canonical passing set; and
4. the submitted set is contained in the binding's eligible set when that
   server-issued binding is present.

Schema narrowing improves model behavior but is not trusted as authorization.
The repository rejects the entire proposal before append if any reference is
invalid.

For correction, the newest malformed `initiative_objective_mapping` row maps
to the existing objective-mapping-required state, with its row ID retained as
diagnostic evidence. The recovery adapter then issues a fresh, exact packet and
a later successful append becomes the newest proposal. Reconciliation never
uses an older mapping as a substitute and never converts malformed evidence to
PASS. Baseline-chain corruption and conflicting baseline identities remain
hard `malformed` projection errors.

### Versioned request identity and historical recovery

The original packet key ended at the Workroom head:
`initiative-readiness:<BI>:objective-mapping:<head>`. That identity is too
coarse once `eligibleEvidenceActivityIds` becomes required, because the remote
task digest correctly hashes the binding. The live BI-SIG TaskRun ending
`5AFED05D3098` and BI-2B TaskRun ending `42F4B2BBCDF2` therefore own coarse
keys with historical packet shapes that omit the evidence authority; an exact
current packet necessarily produces `idempotency_conflict`.

New objective-mapping packets carry an explicit `workroomRef` and use a
versioned request key whose suffix is the SHA-256 of canonical JSON over:

1. the target reviewer and exact required tools;
2. the Workroom id, repository, branch, and head;
3. the writer, BI, gate, and current baseline;
4. the immutable artifact repository, commit, path, and provider blob; and
5. the sorted finite eligible evidence activity ids.

The key is an idempotency identity, not an authorization token. The external
adapter recomputes it from the supplied packet and rejects arbitrary key churn;
the existing repository and approval boundaries remain the write authority.
Historical exact packets remain stored and are never rewritten.

Before returning a successor packet, terminal recovery inspects prior
objective-mapping TaskRuns in the same BI/head lane. A historical packet that
lacks the now-required evidence authority may be superseded only when its
immutable artifact, baseline, and Workroom identity still match and it has no
active proposed/approved envelope or authoritative receipt. A current packet
with the same normalized evidence set returns the same key. A different current
evidence set may advance only after the prior request is terminal and has no
successful authoritative writer or receipt. Any other invariant drift or
unbounded/ambiguous history produces a typed no-route result.

## Acceptance

| Acceptance ID | Objective IDs | Required outcome |
|---|---|---|
| AC-OMEC-001 | OBJ-OMEC-PACKET | The BI-2B live fixture packet contains only the four eligible post-baseline activity IDs and the nested writer schema enums `evidenceRefs` to them. |
| AC-OMEC-002 | OBJ-OMEC-PACKET, OBJ-OMEC-FAIL-CLOSED | No eligible passing evidence produces a typed no-route result; the packet never exposes an empty or open-ended evidence-ref schema. |
| AC-OMEC-003 | OBJ-OMEC-WRITER, OBJ-OMEC-FAIL-CLOSED | The repository rejects source paths, unknown IDs, another BI's rows, pre-baseline rows, and failing evidence without appending a mapping. |
| AC-OMEC-004 | OBJ-OMEC-WRITER | Exact same-BI, at/after-baseline passing activity IDs append one complete mapping under the current baseline. |
| AC-OMEC-005 | OBJ-OMEC-CORRECTION, OBJ-OMEC-FAIL-CLOSED | A malformed newest mapping remains non-passing but yields the objective-mapping recovery requirement; a later valid row supersedes it and can reconcile. |
| AC-OMEC-006 | OBJ-OMEC-CORRECTION, OBJ-OMEC-FAIL-CLOSED | Reconciliation never falls back to an older valid row when the newest row is malformed, and baseline-chain corruption remains a hard projection failure. |
| AC-OMEC-007 | OBJ-OMEC-KEY | Exact BI-SIG and BI-2B historical coarse-key fixtures receive deterministic versioned keys when their new server packets add the required evidence set, without modifying either historical TaskRun. |
| AC-OMEC-008 | OBJ-OMEC-KEY | Reissuing a byte-identical packet, including the same evidence ids in a different input order, produces the same key and therefore the same TaskRun identity. |
| AC-OMEC-009 | OBJ-OMEC-SUPERSESSION, OBJ-OMEC-FAIL-CLOSED | The external adapter rejects a caller-invented suffix, and recovery rejects changed Workroom, baseline, or artifact identity rather than minting another key. |
| AC-OMEC-010 | OBJ-OMEC-SUPERSESSION, OBJ-OMEC-FAIL-CLOSED | A prior active proposed/approved envelope, or a successful writer/receipt on a current packet, blocks evidence-set supersession; declined/failed obsolete packet history remains auditable and may recover. |

## Ordered fix sequence

1. Add RED fixtures for the exact BI-2B packet, arbitrary-string writer input,
   repository activity validation, and malformed-latest correction behavior.
2. Centralize the existing passing-evidence-kind classification and use it in
   both packet eligibility and canonical reconciliation.
3. Load bounded eligible activity IDs with the current baseline, carry them in
   the immutable review binding, and narrow the writer schema and prompt.
4. Revalidate all evidence references inside the writer transaction before
   appending; retain strict current-baseline and statement-coverage checks.
5. Project only mapping-row malformation as recoverable missing mapping while
   preserving its diagnostic ID and all hard baseline failures.
6. Run focused and graph-linked suites, web typecheck, style/diff/pregate
   guards, semantic review, DCO, and protected CI. If the shared heavy local
   lane is occupied, record it as INCONCLUSIVE under the operator's explicit
   boundary; never infer PASS or weaken protected checks.
7. Add RED fixtures for BI-SIG `5AFED05D3098` and BI-2B
   `42F4B2BBCDF2`, then derive and validate the versioned request identity and
   guard evidence-only supersession against historical TaskRun state.
8. Publish through one protected PR and canonical release, verify the served
   SHA, then use the server-issued correction packets to append real BI-SIG and
   BI-2B mappings and prove objective reconciliation without database mutation.

## Failure, compatibility, and rollback

- The binding field is optional only for parsing historical non-mapping task
  history. New objective-mapping dispatch is impossible without it.
- Activity reads are same-item, kind-filtered, time-bounded, deterministically
  ordered, and capped. More eligible evidence than the cap yields no route; it
  is never silently truncated into incomplete authority.
- Existing valid mapping activities and baseline receipts are unchanged.
- Historical coarse keys, TaskRuns, tool executions, and envelopes remain
  immutable. Versioned keys apply only to newly issued objective-mapping
  packets; they do not rename or mutate a prior identity.
- No migration, new table, new tool, role, or approval bypass is introduced.
- Rollback is the source commit. Malformed audit rows remain immutable and
  continue to block PASS until a governed correction exists.

## Verification contract

TDD must show the pre-fix packet lacks IDs, arbitrary strings reach the
repository, and malformed latest mapping dead-ends; then show the exact same
fixtures green. Adjacent tests must cover route generation, task binding,
writer persistence, baseline validation, and completion projection. Protected
CI and live correction are authoritative; unavailable local infrastructure is
reported honestly rather than treated as success.

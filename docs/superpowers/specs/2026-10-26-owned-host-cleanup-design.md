---
status: active
---

# Owned host reservation settlement

Implementation parent: BI-521A92CF. Design Workroom: WC-310B36B4.
Source baseline: c17502c73e9ebdc35cfb3677f0a33b20da5cf192.

## Problem and boundaries

The host-resource runner calls `release_nonprod_environment_lease` after its
supervised command. The existing narrow cleanup classifier deliberately admits
only authenticated versioned local-CI leases and excludes process-owned host
reservations. A real host cleanup therefore produced a pending human envelope,
although the reported command had finished. This is an integration-contract gap;
the existing process/authority fence is intentional and remains authoritative.

The recorded supervisor PID identifies the still-running runner, not a proven
empty workload tree. Existing TaskRun completion can prove lease admission,
not command completion. A caller boolean, locally written receipt, or a signature
whose key the claimant controls cannot become independent terminal host proof.
No generic trusted host-command observer was established in this source.

## Chosen approach and alternatives

Use the existing natural lease-expiry/reaper path and add exact historical lease
readback to the existing lease-list tool. The host runner stops heartbeats when
supervision ends, reads only its exact admitted lease, and reports reservation
state separately from command outcome. It does not request immediate release.
This does not execute a refused action by a different route: normal expiry
already exists, and the added read does not mutate or reap a lease.

Keep immediate host release governed. A future immediate-cleanup proposal needs
a trusted observer and authenticated owner/attempt/host/source/PID-start evidence
revalidated in the locked release transaction. That larger authority contract is
outside this repair. Do not retrofit provenance onto old active leases or alter
pending/failed envelopes. Do not change the classifier, grants, always-human
policy, TTL, renewal bounds, reaper cadence, host admission or process termination.

The existing janitor is hourly. A ten-minute TTL is not a ten-minute guarantee
of persisted terminal state. Absence from the active list, elapsed wall time,
or an unavailable reader never proves expiry or cleanup. This repair must not
introduce blocking polling or promise an automatic later read that is not arranged.

## Objectives and acceptance

- OBJ-HC-1: Routine host supervision creates no new human cleanup envelope.
- OBJ-HC-2: Command results, reservation settlement and process cleanup remain distinct.
- OBJ-HC-3: Preserve existing authority and ownership boundaries and immutable history.

| Criterion | Objective | Observable result |
| --- | --- | --- |
| AC-HC-1 | OBJ-HC-1 | Normal and fenced host-runner completion does not call generic lease release; renewal stops through the existing supervisor lifecycle. |
| AC-HC-2 | OBJ-HC-2 | The existing list tool accepts one exact lease ID and returns its safe persisted row, including terminal status, under the same platform-read capability and grant. No scan or lease mutation occurs. Unknown/invalid IDs remain explicit unavailable results. |
| AC-HC-3 | OBJ-HC-2 | The runner validates retained ID, claim, environment, provider, session, worktree and branch against its admitted binding. The existing terminal clearing of process fields is accepted without inferring process exit. Mismatch or reader failure is unknown. Active/queued is pending. Persisted terminal status describes reservation settlement only. |
| AC-HC-4 | OBJ-HC-2, OBJ-HC-3 | Nonzero command exit, cancellation, identity drift and uncertain execution preserve their existing verdicts. A terminal reservation never proves command success or descendant exit; no cleanup pass is inferred from direct-child close. |
| AC-HC-5 | OBJ-HC-3 | Existing foreign/running/process-owned cleanup negatives, explicit-human policy, pending decisions, local-CI cleanup and transactional release checks are unchanged. |
| AC-HC-6 | All | Source fixtures cover exact/foreign/malformed/terminal/missing/pending readback, unavailable janitor assumptions, no release calls, and preserved command failures. Qualified shared verification and protected publication precede live acceptance. |

## Atomic ordered implementation and refactoring

1. Add failing tool and runner tests for exact terminal readback, mismatch, pending
   and unavailable states, and no automatic release on normal/fenced completion.
2. Extend the existing list definition/handler with an optional exact lease ID;
   reuse `toolSafeLease` and current authorization. Omitted ID retains the existing
   admitted/queued response. Exact lookup returns one safe row, never a new permit.
3. Refactor host-runner cleanup into one bounded reservation-observation helper
   reused by pre-execution identity failure and supervised completion. Keep the
   shared lease supervisor's existing lifecycle and all other callers unchanged.
4. Document reservation-pending versus command outcome and the existing immediate
   release boundary. Run affected tests/typechecks, shared integration, independent
   assessment, normal hooks/CI/merge queue and canonical release validation.
5. Verify a fresh owned host attempt using ordinary admission. Record command
   outcome separately from exact reservation state; wait for normal expiry only
   when required for acceptance, without changing an existing pending request.

One atomic deliverable HC maps to BI-521A92CF. Requirements: OBJ-HC-1..3 and
AC-HC-1..6. Contract HC-READ is the existing safe lease-list response extended by
one exact-key read. Flow HC-OBSERVE is supervision end -> stop renewal -> one exact
read -> explicit settled/pending/unknown reservation report. Verification VC-HC
is the affected tool/runner/supervisor and unchanged authority-negative suites.
The read and caller must ship together; neither is a separately useful bypass.
No schema migration, new service, table, grant, credential, tool or UI is added. Include a realistic expired-row regression through toolSafeLease, with cleared process fields.

## Evidence

Native blocked host cleanup diagnosis: BI-521A92CF activity
cmvplh1mn09ym01mll5vpwsnu. Existing scope-release diagnosis remains separate under
BI-8D8939E5. Independent architecture assessment was read-only at the baseline;
it is a client assessment, not a native passing receipt. Source verification is
recorded below; canonical integration and live acceptance remain outstanding.


## Acceptance baseline (verbatim)

- AC-HC-1: Normal and fenced host-runner completion stops renewal and creates no new human cleanup envelope; it does not call generic immediate release.
- AC-HC-2: Existing lease-list tool accepts one exact lease ID and returns the safe persisted row, including terminal status, under unchanged platform-read authority; invalid IDs never fall back to listing, and the read performs no cleanup mutation.
- AC-HC-3: Runner validates retained lease ID, claim, environment, provider, session, worktree and branch. Mismatched/unavailable results are unknown; active/queued remains pending; persisted terminal means reservation settlement only, with existing cleared process fields accepted without inferring process exit.
- AC-HC-4: Nonzero command, cancellation, source drift and uncertain execution verdicts remain distinct. Reservation expiry never proves command success or descendant termination; no time/absence-based cleanup pass or tight polling.
- AC-HC-5: Foreign/running/process-owned direct release, explicit always-human policy, pending/failed approval history, original local-CI cleanup and locked release checks remain unchanged.
- AC-HC-6: Affected tool/runner/supervisor tests cover exact/malformed/missing/foreign/pending/terminal safe readback and no-release behavior; shared integration, protected publication and actual canonical live acceptance are separately recorded before completion.

Implementation was admitted by IRD-36FB73BD3914 after the Medium acceptance
baseline was recorded. First-failing runner, exact-readback and supervisor
regressions were observed before implementation. Source tests now pass (97 Node
fixtures and 95 affected Vitest checks). These are source checks, not live
acceptance or canonical heavy integration. The normal direct-release classifier
and its process/foreign-owner negatives are unchanged.

Independent review identified a post-completion renewal race. Four failing regressions covered late success, transport error, transient refusal and authoritative refusal; the finalization fence makes them green and prevents stale callbacks from renewing or terminating a completed command.

The query helper lives in the existing nonprod library, outside the tool-pack discovery directory. Its regression test is registered with the normal CI guard profile; no new selectable pack or tool is introduced. Linked contributor, operations and pattern guidance describe the same completion contract.

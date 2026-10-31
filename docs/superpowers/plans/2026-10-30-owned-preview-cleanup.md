---
status: draft
date: 2026-10-31
backlog: BI-31AC1F90
---

# Owned preview cleanup implementation

**Backlog item:** BI-31AC1F90

For agentic workers: execute one independently reviewable backlog item at a
time. Use dpf-tdd, dpf-local-merge-ci-before-push and dpf-pr-with-dco. Native
coverage and implementation admission must exist before source implementation.

Parent BI-31AC1F90; Workroom WC-B0685306; declared medium repair. The
[design](../specs/2026-10-30-owned-preview-cleanup-design.md) owns the contract
and ordered fix. This plan has one deliverable PC mapped to BI-31AC1F90.

## Item-body acceptance, verbatim

- Authenticated preview admission durably attributes original user/assistant/session and exact reservation through existing supported provenance, including immediate and queued paths.
- Only that currently authorized owner can close an unused/completed process-free DEV preview reservation as routine; the execution transaction revalidates exact provenance and state under the normal lock.
- Foreign, running/process-owned, production/unknown, stale/reassigned/malformed provenance and explicit always-human policy retain refusal or approval. Existing pending/failed envelopes remain historical; do not backdate them as executed.
- Meaningful tests cover real immediate/queued preview ownership, denied foreign identity, source/state races and repeated closure; qualified publication and fresh live preview admission/release prove no extra employee envelope.

R-PC-1 through R-PC-4 refer, in order, to those four exact criteria.
C-PC-PROVENANCE is authenticated fresh creation plus immutable existing
Task/wait attribution. C-PC-EXECUTION is the shared proof predicate, current
stance, closed call form and locked release validation. F-PC-CLAIM-RELEASE is
new immediate/queued claim -> durable ownership/wait -> state transition ->
owner release -> revalidation -> idempotent terminal reservation.

## Internal phases

1. Red, R-PC-1..4 / V-PC-REGRESSION. Extend
   environment-lease-provenance.test.ts, durable-wait.test.ts,
   lease-cleanup-consequence.test.ts, environment-lease-release.test.ts and
   nonprod-lease-pack.dispatch.test.ts. Prove missing immediate/queued ownership,
   actor forwarding, metadata preservation and the precheck/release race fail
   before implementation. Keep existing local-CI and controlled negatives.
2. Creation, C-PC-PROVENANCE. In environment-lease-provenance.ts and
   durable-wait.ts, reuse deterministic Task creation and preserve original
   authenticated user/assistant metadata. Wire fresh active and queued paths in
   environment-lease.ts and trusted claim context in nonprod-lease-pack.ts.
   Persist atomically, detect conflicts and never backfill old records.
3. Release, C-PC-EXECUTION / F-PC-CLAIM-RELEASE. Share proof reading between
   lease-cleanup-consequence.ts and environment-lease.ts. Forward server actor
   context; under the normal lock recheck current owner, Task, target, stance
   and no-process/no-command state before release. Preserve static authority
   and explicit always-human policy when proof is unavailable.
4. Verification, V-PC-REGRESSION and V-PC-LIVE. Run affected suites and both
   web typecheck programs, qualification and independent assessment, then normal
   protected publication. After a containing canonical release, exercise fresh
   immediate and queued preview admission/release with no employee envelope.
   Record reservation settlement separately from any command/process outcome.

V-PC-REGRESSION includes service and PostgreSQL transaction behavior in
environment-lease.pg.test.ts, ownership/foreign-user/foreign-assistant cases,
legacy/caller-Task/malformed proof, metadata persistence failure, queue
transition preservation, stale source/state, process attachment, production
and unknown stance, repeat own closure and existing explicit-human controls.

## Impact contract and verification set

The Workroom scope covers the five existing source modules above, their named
tests, MCP dispatch test, and these two documents. No UI route or migration is
planned. The native graph was ready on October 31 and returned linked tests for
the pack, durable-wait, lease and refiner. It had no linked result for the
provenance module, so absence is not an exemption: include its colocated suite
and the complete nonprod unit directory. Also run nonprod-lease-pack.test.ts,
the dispatch suite, and linked work-capsules/bounded-handoff.pg.test.ts in the
governed database lane. Do not claim DB coverage from an unavailable/skip run.

The impact contract requires Design Grounding for the MCP pack; the PR names
this design/plan and the existing lease, durable-wait and consequence modules.
Run the style-drift guard. Check/regenerate the documentation index and
capability-completeness artifacts; obtain their existing scope before writes.
Missing/stale advice expands verification. Qualified exact-tree pregate and
protected pr:ready/pr:health remain mandatory; never create a draft PR.

## Backlog coverage

- Decision: atomic
- Parent: BI-31AC1F90
- Receipt: cmvx1ms5j0fhs01me71lwxiab
- Rationale: Trusted creation, durable ownership, consent and locked execution are internal phases of one safe preview cleanup repair; none is independently shippable.
- Dependencies: none
- Deliverable: PC -> BI-31AC1F90

Atomic deliverable PC -> BI-31AC1F90. Dependencies: none outside its internal
phases. References: R-PC-1, R-PC-2, R-PC-3, R-PC-4;
C-PC-PROVENANCE, C-PC-EXECUTION; F-PC-CLAIM-RELEASE;
V-PC-REGRESSION, V-PC-LIVE. No phase is independently shippable because trusted
creation, preserved ownership, consent and locked execution must agree before
ordinary release is safe. Native coverage receipt **cmvx1ms5j0fhs01me71lwxiab** (refresh after claiming
the already-planned linked pack test; predecessor cmvwzj88500w401meed9obr9u)
was recorded and checked current on October 31, bound to plan commit
a481a6235d7eb728c2299596ea3efc4b9a8d3c90 and blob
f0d3fafc21de8aaa149d021fe3ba8c4e754ab496. Parent and sole mapping:
PC -> BI-31AC1F90; dependencies none. Author research receipt:
initiative-738d4181-f54d-43ad-a30c-b9f67711e200. Implementation admission:
IRD-7C59EC366804, allowed. These are planning/admission receipts, not delivery evidence.

## Completion, risk and rollback

Completion requires the actual containing source/runtime identity, current
qualified test/build evidence, protected merge and fresh canonical preview
checks. An independent client assessment is separately attributed and never
becomes a native receipt. No new provider, spend, role or approval authority is
introduced by the plan. Funding remains unresolved; no allocation is inferred.

Principal risk is a classification/execution race or ownership loss during a
queue transition. Share one predicate, fail closed under the environment lock,
exercise adversarial transitions and retain old records/envelopes unchanged.
Rollback reverts the atomic integration; unknown/legacy proof keeps the
controlled path and ordinary expiry. Do not delete history, rewrite credentials,
change TTL, terminate a host process or weaken policy to make verification pass.

The private queued-admission result in environment-lease-result.ts carries the
server-created atomic wait identity. The MCP handler uses that internal result,
never a caller Task or public parameter, to avoid a redundant outside-lock write.
Authenticated owned queue reclaims refresh that same wait under the lease lock;
legacy caller Tasks remain separate and gain no preview ownership proof.
The type module had no graph-linked tests, so the complete nonprod suite and
MCP pack suites remain required. Latest coverage refresh includes this type path.

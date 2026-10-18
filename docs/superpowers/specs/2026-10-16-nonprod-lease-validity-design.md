---
status: draft
---

# Nonproduction lease validity across approval

Backlog item: BI-B8437D03
Parent: BI-06AE6833
Related: BI-8EA5BC09 (approval/run lifecycle; separate acceptance)
Status: proposed ordered fix; no implementation or runtime acceptance claimed

## Problem and existing substrate

The first local-model integration request held envelope
`cmvbdkt2f0b2d01o3dv5rb21j`. Its two-minute absolute lease deadline
`2026-10-16T19:45:14.730Z` expired while its seven-day approval remained open.
No active or queued lease was admitted. Renewing a nonexistent lease cannot
recover this request, and raising the same proposal preserves its stale inputs.

`nonprod-lease-pack.ts` currently requires `expiresAt`; the service derives
`requestedTtlMs` from that absolute instant. `environment-lease-timing.ts`
clamps a past instant to one millisecond. Approval time therefore consumes
the resource lifetime before a resource is allocated.

Reuse the existing lease, environment advisory lock, admission policy, durable
wait and approval outcome. The service already persists requested duration and
starts admitted local-CI/host leases with at most two minutes. No new table,
ledger, daemon, grant, credential or tool is needed.

## Contract

**LV-ABS:** Legacy requests without an explicit duration keep absolute expiry
semantics. An expired request cannot create, refresh, revive or admit a lease.
Validate at the effect boundary against the current clock, including time spent
awaiting the environment lock. Return a settled refusal and a clear fresh-request
remedy; do not silently move the old deadline. Existing successful approval
receipt replay remains a readback of the recorded winner, not a fresh claim.
Preserve existing lease identity/readback where possible without renewal or
positive allocation; do not label an expired lease admitted.

**LV-REL:** New callers may explicitly provide bounded `requestedTtlMs` alongside
the existing absolute `expiresAt` compatibility value. Its documented presence
selects relative-duration semantics; it is never inserted into old approved
arguments. It requires an explicit, independent `waitDeadlineAt`. The new server
uses the duration at actual admission while that deadline remains valid. An old
server uses the compatibility expiry and can fail closed; it must not acquire
broader authority. Invalid, non-finite, non-positive or out-of-bound durations
are refused before effects.

**LV-FENCE:** Preserve all owner, immutable gate identity, cancellation, terminal
claim, FIFO, pressure-freshness, resource capacity and renewal checks. A valid
duration is not proof of current host capacity. Preserve legacy zero-wait probes
with a future absolute expiry; do not blanket-reject their deliberate immediate
queue deadline. A new relative request whose absolute admission deadline expired
cannot allocate a resource. No forced slot or implicit approval is introduced.

**LV-OUTCOME:** Use the existing `refused` outcome disposition for expired
requests, with no successful-execution claim or unchanged retry loop. Preserve
the old envelope and its arguments. A normal fresh request may retain its
canonical gate/owner identity after the prior proposal is terminal; it does not
reuse an expired approval or reset a live lease. Do not mark an uncertain
execution settled by this repair.

## Acceptance (verbatim BI criteria)

- AC-1: A delayed legacy absolute request that is already expired fails before any lease, queue, task or capacity mutation; the existing proposal reports expired/refused, not executed successfully.
- AC-2: A new explicit relative-duration request may await normal approval, then starts its bounded lease duration at actual admission only while its independent absolute wait deadline is valid.
- AC-3: Local-CI and host-resource two-minute admitted TTL, maximum bounds, capacity/owner/gate identity and cancellation fences are unchanged; no stale lease renewal, forced slot or approval bypass.
- AC-4: Old callers retain their absolute deadline semantics, new caller/server compatibility is explicit, and repeated approved execution remains idempotent.
- AC-5: Meaningful clock-controlled tests cover delayed approval, already-expired proposals, normal immediate admission, bounded queued admission, repeated/cancelled requests and absence of side effects on refusal; affected tests/typechecks and governed publication pass before deployment.
- AC-6: User-facing approval/lease outcomes explain validity and next action without raw transport details. Preserve original stale envelope/evidence; do not replay it.

## Ordered implementation and verification

One atomic deliverable **LV-FIX**, mapped to BI-B8437D03. Timing normalization,
the effect-boundary check and caller compatibility must ship together; none is
an independent feature. Existing approval/run expiry work stays with BI-8EA5BC09.

1. **LV-RED:** Add clock-controlled regressions at the real lease-pack/service
   boundary. Demonstrate refusal before any create/update/wait checkpoint,
   delay past the legacy expiry, explicit relative admission after that delay,
   expiry while waiting for the environment lock, current pressure requirements,
   terminal/cancelled identities and the legacy no-wait probe. Assert genuine
   accepted-receipt replay separately from a new resource allocation.
2. **LV-TIMING:** Consolidate request timing in the existing nonprod timing owner;
   keep parsing, expiry, duration and admitted-lifetime semantics distinct.
   Integrate the check before positive mutation inside the existing transaction.
   Use the existing typed refusal disposition in the MCP response. Characterize
   unaffected FIFO, resume and terminal-evidence paths rather than replacing them.
3. **LV-CALLERS:** Update the existing local-CI and host-resource callers through
   a small shared request builder; preserve the legacy fallback and independent
   wait deadline. Test actual outgoing argument shapes and old-server fallback.
   Keep the infrastructure probe's deliberate no-wait behavior unchanged.
4. **LV-VERIFY:** Run affected lease/MCP/client tests and both web TypeScript
   programs; consume exact-path gate context and all returned obligations. Run
   the governed functional gate, independent exact-source review and protected
   PR/queue. Reuse valid evidence and record unavailable infrastructure as such.
   After a qualified containing release, verify the normal new request and an
   expired-request refusal without executing the original stale envelope.

Reserve roughly 20% of implementation for the shared timing/request builder and
characterization tests, avoiding parallel timing rules in preview and CLI code.

## Scope, risks and rollback

Expected source: existing `nonprod/environment-lease-timing.ts`, lease service
and MCP lease pack, their tests, canonical local-CI/host-resource callers and a
small shared script helper. Refresh exact claims and impact before editing them.
No grant, approval requirement, active lease, runtime install or original review
record is changed. Funding is unresolved; this plan makes no spending decision.

Risks are accidentally extending an absolute deadline, breaking old no-wait
probes or same-identity readback, starting the clock before lock admission,
accepting stale pressure evidence, or treating a refused proposal as executed.
Tests must prove those negatives through the actual consumers. Rollback restores
old caller compatibility; retain refusal/evidence history and never revive the
original stale proposal. No database migration is planned.

## Backlog coverage

Decision: atomic, LV-FIX -> BI-B8437D03. Requirement refs AC-1 through AC-6;
contract refs LV-ABS, LV-REL, LV-FENCE, LV-OUTCOME; flow refs LV-RED, LV-TIMING,
LV-CALLERS, LV-VERIFY; verification refs LV-RED and LV-VERIFY.
Native immutable plan coverage and implementation admission are pending.

## Follow-up: authenticated immediate-admission cleanup (2026-10-18)

The original LV-FIX shipped in PR6477 and its bounded live timing acceptance is
retained. This follow-up reuses BI-B8437D03 / WC-ECDBB7AC; it does not reopen or
reinterpret the original stale approval. A real versioned local-CI admission
NPEL-3E7C0681E6 had no taskRunId. Therefore the existing narrow authenticated
DEV owner cleanup predicate could not establish ownership and requested an
employee approval even though the same caller had just acquired the lease.

**LC-OWN:** Newly immediate-admitted versioned local-CI claims receive the same
server-owned deterministic user/lease Task provenance as queued admissions.
The authenticated MCP user, never a caller-supplied user or Task id, owns that
record. Preserve the admitted expiry; checkpointing must not substitute the
wait deadline for its bounded active lifetime. Existing queued Task event,
consumption and continuation history must survive admission and replay.

**LC-FENCE:** Keep lease-cleanup-consequence.ts unchanged: exact user, session,
claim, environment, worktree, branch, manifest, slot and active-key checks;
declared DEV purpose; and no process-owned resource. Legacy preview, foreign,
production, malformed or unsupported provenance remains gated. No grant,
approval-policy, schema, table or cleanup tool expansion is proposed.

One atomic deliverable **LC-FIX** maps to BI-B8437D03. Requirement refs
LC-OWN and LC-FENCE; contract ref LC-PROVENANCE; flow refs LC-RED,
LC-CHECKPOINT and LC-VERIFY; verification refs LC-RED and LC-VERIFY.

1. **LC-RED:** Add a real lease-pack regression for a fresh immediate versioned
   admission without taskRunId. Expect durable authenticated provenance, an
   admitted projection and unchanged lease expiry. Cover supplied unrelated
   Task ids, repeat admission and failure to persist; keep existing queued and
   foreign-owner cleanup negatives. Run the new test before implementation.
2. **LC-CHECKPOINT / LC-PROVENANCE:** Refactor the existing durable Task payload
   construction so immediate and queued admissions share binding semantics.
   A separate immediate checkpoint must not reset an existing queued wait or
   overwrite another Task. Return the persisted linkage in the tool response.
   Reuse existing admission settlement for queued continuations. Do not change
   any actual resource capacity, FIFO, timing or renewal policy.
3. **LC-VERIFY:** Run all graph-linked durable-wait, lease-pack, release,
   expiry-wait and cleanup-consequence suites, both web TypeScript programs,
   current gate obligations and independent exact-source review. Complete the
   governed full gate, protected PR and qualified canonical release. On the
   served target prove a fresh owned versioned immediate claim can release
   through the existing no-extra-consequence rule, with no employee envelope;
   preserve rejected foreign/process/production cases as source tests.

Risks: granting ownership to a subscriber, overwriting a foreign Task, resetting
a queued capacity event, or extending active TTL. The immediate helper must
bind only the fresh lease's authenticated provenance and preserve existing
Task identity on continuations. Failure to persist provenance is not a cleanup
pass and must be explicit/recoverable. Rollback removes the new immediate
checkpoint path; existing policy then safely requires approval again. Retain
Task and verification history; no migration or historical backfill.

Roughly 20% of this implementation is shared payload/checkpoint refactoring.
Funding remains unresolved; no new allocation or paid inference is authorized
by this plan. Current immutable follow-up coverage is pending publication.

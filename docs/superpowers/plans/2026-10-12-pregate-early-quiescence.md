---
status: active
backlogItem: BI-25CB699C
workroom: WC-921B5193
---

# Stop preflight early during quiescence

## Design grounding

Continue [validation evidence reuse](2026-10-12-validation-evidence-reuse.md)
without editing the frozen PR #6248 or its plan. Existing BI-25CB699C covers
this atomic ordering repair. The coordinator reported an eight-minute host
preflight followed by `portal_quiescing`; source inspection confirms
`scripts/pregate.mjs` runs preflight before `scripts/gate-worktree.mjs` reads
`get_quiescence_status`. This is source evidence, not a new live reproduction.

Reuse the existing native read contract, credential/transport adapters, PASS
reader, preflight receipt cache and exit-75 wait signal. Extract the quiescence
reader/classifier into `scripts/lib/gate-quiescence.mjs` so the early wrapper
and final admission check cannot drift. No new endpoint, queue, grant, runtime,
database or cached admission authority is needed. Normal status never grants a
lease. Unknown, refused or unavailable status is explicitly inconclusive and
continues the existing path; it never becomes a product FAIL or PASS.

## Acceptance criteria from the live item

- AC-1: After a PASS at commit A, a signed merge of origin/main with no change to the branch's own diff can be pushed after the refresh tier passes, without waiting for a full local-CI slot.
- AC-2: A merge that changes the branch's own diff, such as hand-resolved conflicts in the branch's files, runs the affected tests. A merge that alters branch-authored logic still requires the full gate.
- AC-3: The merge queue remains the authoritative main+PR build. Nothing merges without it.
- AC-4: A re-claimed waiting gate keeps its queue position.

AC-2's unconditional local full-gate requirement is superseded by the recorded
October 12 founder clarification in the parent plan. This repair does not claim
all four criteria complete. It removes wasted host preflight while preserving
existing evidence and queue identity, and leaves protected CI authoritative.

## Atomic implementation and verification

CT-EARLY-QUIESCENCE / FLOW-PREFLIGHT / VC-EARLY-QUIESCENCE:

1. Add a failing regression showing a confirmed draining status prevents the
   expensive preflight callback. Verify normal, malformed, denied and transport
   failure responses, explicit endpoint selection, record-exempt invocations,
   and current PASS reuse ordering. Keep the existing late admission read.
2. Share the existing read/classification behavior, with bounded request and
   credential exchange timeouts for the early probe. Emit the existing durable
   wait code and exit 75 without spawning a waiter, claiming capacity, or
   overwriting any existing gate or pending-evidence record.
3. Run affected pregate, gate-lease, credential/client, preflight receipt and
   policy-inventory tests. Register the pregate regression in protected CI;
   update `docs/testing/pre-pr-gate.md`. Run diff-local guards and regenerate
   the doc index. Native impact is resolved with empty inferred test/guard
   lists; this is not an exemption from the named checks.
4. Freeze the signed source and actual evidence for independent coordinator
   review/publication. Full integration and live acceptance remain unrun unless
   actually executed. Use only the already-authorized bounded DEV recovery
   publication procedure if needed, never fabricate native review evidence.

These steps form one independently revertible ordering fix: tests, extraction,
wiring and documentation are internal sequencing, not separate deliveries.
The earlier retry identity repair and later evidence-expiry race are outside
this unit. No UI changes. Refactoring shares one status reader and wait policy.

## Risks and rollback

An early read can become stale, so retain the existing late read and governed
claim. A slow/unavailable read must not hang or claim a false verdict. Do not
log credentials or raw failed responses. Preserve existing PASS and finalize
material. Roll back through a signed PR; no persisted state migration is needed.

## Backlog coverage

Atomic mapping: early-quiescence -> BI-25CB699C, no dependencies.
Requirement refs: AC-1, AC-2, AC-3, AC-4.
Contract ref: CT-EARLY-QUIESCENCE. Flow ref: FLOW-PREFLIGHT.
Verification ref: VC-EARLY-QUIESCENCE.
Native atomic receipt `cmv60fyxw1lvs01nvx80mdd0j` binds plan commit
`4068144984c60f16bbfa56f654d311bc208d20c6`. Refreshed receipt
`cmv60knsu1m1z01nvn2td5b04` includes removal of the existing pregate-test
exclusion from `scripts/ci-policy-test-inventory-allowlist.txt` when registering
the suite in protected CI. These receipts are coverage, not passing tests.

The failing regression reproduced status 0 instead of the required wait 75
before the early reader was wired. After repair, the same regression passes;
mock-only HTTP coverage observes one read and zero preflight/write calls.

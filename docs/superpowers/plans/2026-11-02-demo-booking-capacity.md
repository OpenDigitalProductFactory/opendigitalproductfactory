---
status: active
---

# Demo booking capacity implementation

**Backlog:** BI-0F5FCA55. **Design:** [Demo booking capacity](../specs/2026-11-02-demo-booking-capacity.md).
**Status:** implementation admitted; delivery and runtime verification pending.

One atomic repair: native demo loading cannot become valid through tests or allocation alone. No phase is independently shippable. Broader owner acceptance remains under BI-A699AE2C/DOC-82684072.

## Bound requirements

REQ-CAPACITY: native plan has no capacity-conflicting bookings per assigned provider; retain realistic demand/status/assignment and deterministic refs.
CONTRACT-DEMO: use planDemoLoad and the existing native Demo writer with the unchanged exclusion constraint and fixture authorization guards.
FLOW-RESULTS: resume guarded software-platform Performance fixtures and saved owner readback after native Demo preparation succeeds.
VERIFY-DEMO: meaningful real-PostgreSQL native write, idempotency and atomic failure/no partial records, followed by populated/zero/empty/retained stale values/failure/recovery portal scenarios.

## Sequence

1. Resolve graph impact before RED. Native find_related_tests reports demo-business-load.test.ts as the exact related test. Claim scope is resolved with no schema or route obligations. The doc index is derived and must be regenerated/check clean.
2. RED: extend packages/storefront-templates/src/demo-business-load.test.ts with software and complete-catalog pairwise interval checks, assignment/status/identity/queue preservation, repeated deterministic plans and boundary/duration cases. Run and record actual failures before source edits.
3. GREEN: implement the planner-local deterministic reservation described by AC-1–AC-3 in packages/storefront-templates/src/demo-business-load.ts. Run the package tests and typecheck; then applicable web checks because the native writer imports this package.
4. Commit with DCO; source review and required normal pregate against merged main before push, protected ready PR and merge queue with pnpm pr:health. Missing/stale impact advice expands verification rather than exempting it. No unrun check is passed.
5. In an admitted shared nonproduction environment, execute the existing guarded Demo and Results preparation protocol (DOC-A20A3FBE / DOC-23B60028), prove fixed-clock repeat identities/counts and atomic rejection of a deliberately conflicting transaction, then resume FLOW-RESULTS with the actual native producer and owner portal. Release the exact lease after use. Canonical verification requires the live preflight to contain the merged repair.

## Risks and evidence

Keep completed work in the past and pending/confirmed work upcoming; preserve independent providers' concurrency. A large duration must not push completed work across now. Never unassign a provider, mark canceled/quarantined, change capacity constraints or widen fixture access to pass. A normal source revert rolls back the allocator. Record RED/GREEN, exact gate/source, native database readback and owner screenshots in DPF before closing. The earlier PostgreSQL exclusion failure is historical evidence, not a present pass.

## Backlog coverage

Atomic deliverable maps to BI-0F5FCA55 using REQ-CAPACITY, CONTRACT-DEMO, FLOW-RESULTS and VERIFY-DEMO. Native receipt cmvzqofph0m4v01tmehv9yow9 binds the immutable plan at dade0a9e3192f339edfa759b098089e6ef40e37c (blob b6b32d91d53d7cabe823cfeb498d08685fff50e3). Research receipt initiative-fe3a69f1-0b1d-428a-9768-783cc497bbcd and implementation admission IRD-B745E859CFFF were recorded 2026-11-02. Execution evidence remains pending.

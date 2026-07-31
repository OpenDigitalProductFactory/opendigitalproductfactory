# Exact-tree main-push reuse activation

**Backlog:** BI-9585E580  
**Work Capsule:** WC-BFB3F681
**Plan coverage receipt:** cms8zpzk20gtp01mz2hwg417d (`atomic`)

## Outcome

Reuse a successful merge-group CI receipt when the subsequent `main` push has
the identical Git tree. Pull-request and merge-group verification remain
exhaustive. Missing, expired, malformed, incomplete, or mismatched evidence
falls back to the existing exhaustive push workflow.

## Atomic scope

This is one independently releasable policy change: receipt validation and
workflow allocation must change together. Activating only the workflow would
trust receipts that can contain skipped heavy gates; hardening receipts without
using their verdict would deliver no cycle-time reduction.

## Implementation

1. Define the heavy gate set that a reusable receipt must record as
   `success`; `skipped` is not reusable evidence for those gates.
2. Expose the validated receipt verdict from the push-only exact-tree job.
3. On `push` only, skip duplicate heavy job allocations when and only when the
   verdict is exactly `true`. Any other value runs exhaustive verification.
4. Keep the stable `Unit Tests`, `UX Route Sweep`, and `Merge Readiness`
   aggregate checks. Their summaries explicitly attest exact-tree reuse.
5. Update CI evidence documentation and architecture tests.

## Verification

- Receipt unit tests reject a skipped required heavy gate at creation and
  validation.
- Workflow architecture tests prove PR and merge-group runs stay exhaustive,
  only duplicated heavy push jobs consume the verdict, and unknown verdicts
  fall back to exhaustive execution.
- Repository policy and injection guards pass.
- Exact-SHA governed local CI passes before publication.
- The merge-group run creates a complete receipt; the resulting `main` push
  validates that receipt, skips only duplicated heavy jobs, and keeps all
  stable aggregate checks green.

## Non-goals

- No affected-test selection activation; BI-2F60FDCE remains shadow-only until
  its two-week recall threshold is satisfied.
- No reduction in pull-request or merge-group coverage.
- No queue-capacity, runner-slot, or local-CI lease changes.

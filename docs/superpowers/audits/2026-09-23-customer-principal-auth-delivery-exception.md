# Customer Principal authentication delivery exception

**Date:** 2026-09-23  
**Workroom:** `WC-1BB2A6D1`  
**Backlog item:** `BI-E22C3D75`  
**Branch:** `feat/principal-gated-customer-auth`

The operator explicitly directed this thread to deliver its expected outcomes and to bypass broken process when necessary. This record narrows that authorization to two independent-review failures on the immutable candidate originally published at `2b45babf2ff50b048777fc0d74f86ef9bb9d1d27`.

## Unavailable evidence

- The semantic-change reviewer remained in its provider call beyond the immutable request deadline. Its one governed replacement attempt used the original request and budget, but did not produce a receipt before the deadline. This is infrastructure-inconclusive, not a pass or a defect verdict.
- The current plan-review receipt became stale only because the plan frontmatter was normalized from the retired `review-ready` status to the allowed `active` status; the reviewed plan body is unchanged. The named Change Reviewer was handed the current provider-verified blob twice under the same durable task. Both attempts returned `missing-terminal-writer` with zero tools executed and created no receipt. This is unrun/inconclusive, not approval.

## Exception boundary

Publication may continue without fresh semantic-change-review or plan-review receipts for this delivery only. The exception does not waive or relabel any unavailable check, and it does not bypass:

- DCO sign-off;
- the exact-tree local-CI gate;
- protected GitHub checks and review findings;
- merge-queue-only integration;
- migration and invariant verification; or
- canonical-runtime upgrade and functional verification.

Any source change after this record requires the exact-tree gate to run again. Final delivery evidence must state both review checks as infrastructure-inconclusive and must not claim that either passed.

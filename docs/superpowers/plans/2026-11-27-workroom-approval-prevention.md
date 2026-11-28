---
status: draft
backlog: BI-F2CFC9EA
---

# Prevent approval amendments from dispatching without required input

**Delivery:** BI-F2CFC9EA, split from BI-5345BFC7 by owner disposition `cmwzvqwmq12qh0ekj9y6w6ccc` and decomposed coverage `cmwzvscit12sk0ekjk9gtwrwa`.

**Source:** Reuse the parent's canonical ordered design at commit `f79b340f5d03f7d1cbb49d50d988c64853e0aa94`, blob `c3f49ebfd535d5cabea33578dfd36d8c39e0d7af`. The signed candidate `d88b2d8c3a2c44d4f77012994d4b644ced5cf5ef` is source input only. Its room, scope, gate and acceptance cannot be carried over.

## Acceptance

- Before dispatch of fresh amended design approval, check the current authoritative baseline and exact changed or removed statement IDs. Incomplete or stale inputs return typed corrections with zero added reviewer tasks. Initial and unchanged inputs must not acquire duplicate work.
- Persist the exact typed refusal and show bounded read-only correction information to the authorized reader, including when the worker checkpoint is missing and the current canonical writer audit matches the original identity. Wrong actor or stale source discloses nothing beyond the allowed refusal and causes no writes or replay.
- Prove the prevention-only scope on the exact release candidate through the normal protected gate and review. In-scope test evidence may be reused only where it matches the actual admitted artifact and identity.

## One implementation slice

- **PREVENT-INPUT.** Derive required amendment dispositions from the current approved baseline and the immutable new artifact. Share this check between packet issuance and new-request admission. Preserve initial, unchanged, and already-issued requests.
- **RETAIN-REFUSAL.** Reuse the existing TaskRun and canonical writer audit to surface only the latest matching, bounded correction on protected readback. Keep the original held when its execution is unknown. No authority is granted by a read or by a writer refusal.
- **VERIFY-PREVENTION.** On the exact scoped candidate, test the four changed IDs without drafts and prove zero added reviewer tasks. Check unaffected initial, unchanged and existing requests. Test missing checkpoint, mismatched source, wrong actor and no replay in the readback. Run related suites, web source/test typecheck, exact-tree gate and independent review. After canonical deployment, verify a synthetic refused amendment in DPF without dispatch or writes to historical tasks.

The remaining AC-2 and all successor-writer AC-3/AC-4 obligations stay open on BI-5345BFC7. Do not exercise or modify the live S5 attempt. This delivery does not add an endpoint, grant, scheduler, data store, or a new way to settle unknown results.

---
status: draft
---

# Private retained reassessment policy source — implementation plan

**Backlog:** BI-AE2EF5E4. **Design:** [Private retained source for a one-use reassessment policy](../specs/2026-11-28-private-retained-reassessment-policy-source-design.md), independently approved at commit `2668e6ed18885d277fad6ae2516ff498cdba1bc1`, blob `1029be5dbd72cac80fd0fb8a920178108f637ddd`. The exact live approval and scope baseline are recorded on the backlog item. This plan draft is not implementation admission or an authorization artifact.

## Scope and entry conditions

Extend only the source-proof path for the existing closed one-use v2 policy. The underlying subject review, immutable original occurrence, contribution mode, operator authority, and original no-replay boundary do not change. Do not include or use the protected policy candidate or a live operator, TaskRun, document or retention pin as a fixture. BI-5345BFC7 owns original-review recovery and BI-5EF67818 owns the shipped one-use compatibility; neither is a new deliverable here.

Before code, obtain Portfolio's exact scope and delivery shape disposition, verify the locked plan's coverage and independent approval, get implementation readiness, and claim only confirmed affected paths. Incorporate the Workroom's source-derived test and guard obligations into the verification phase before the first implementation edit. If impact is unresolved, resolve the affected consumers and use the full affected test and guard set. The artifact-retention and reassessment stewards must agree the discriminator and canonical encoding together. Do not treat a guessed encoding or matching null organization fields as authority.

## Flow and proof

### Phase 1 — establish private approved-source proof

**FLOW-S5-PRIVATE-PROOF** · **CONTRACT-S5-PRIVATE-LOCATOR**

1. Add failing synthetic cases to the existing private artifact resolver/retention and review-policy test seams. Verify whether the existing resolver and baseline repository already provide all identity and pin checks before editing them. Reuse `apps/web/lib/backlog/initiative-readiness/artifact-resolver.ts` and `baseline-repository.ts`; avoid a second document or archive store.
2. In `apps/web/lib/mcp-task-review-reassessment.ts`, extend the approved-policy proof with one closed private document locator for the v2 policy only. Resolve the approved current policy version, exact subject and non-null organization, passing independent receipt, retained version and Blob ID from the host. Rehash actual bytes via the existing blob reader and check both receipt and pin metadata. A new version does not inherit the old approval, even if its bytes match. Keep raw artifact digest, canonical policy digest and original request digest distinct. Verify operator evidence and current actor permission separately from byte identity.
3. For `VERIFY-S5-PRIVATE-PROOF`, compare the actual bytes resolved by review and loaded by the policy reader. Cover pin kind and ID mismatches, altered bytes, same bytes under a changed version, stale approval, changed pointer, cross-organization/actor restrictions and author/reviewer independence. An invalid or unsupported source must refuse before allocation. This phase is sequencing-only; a source reader without compatible consumers does not ship.

### Phase 2 — carry proof through intake and preserve allocation

**FLOW-S5-RELATION-ADMISSION** · **CONTRACT-S5-ONE-SUBJECT-ALLOCATION**

1. Add red/green relation and transport cases in the existing `mcp-task-reassessment-policy.test.ts` and `mcp-task-reassessment-transport.test.ts`. Extend `mcp-task-reassessment-policy.ts`, preparation and transport only as needed for the approved closed private variant. Preserve the exact published legacy reconstruction and reject unsupported or mixed-version bytes rather than dropping fields.
2. Route the same proof through the current authority/admission and lineage seams in `mcp-task-reassessment-authority.ts`, `mcp-task-reassessment-admission.ts` and `mcp-task-reassessment-lineage.ts`. Load and verify bytes before acquiring subject/task locks. Inside the transaction re-read live metadata and the canonical subject inventory and compare the exact proof. No network or blob I/O under locks. Keep author identity, published policy-version behavior and existing lock order.
3. For `VERIFY-S5-SUBJECT-ONE`, use the existing isolated PostgreSQL admission and lineage harness. Queue synthetic repo/private variants concurrently under the same subject with differing policy versions and reviewer identity. At most one accepted allocation wins; exact duplicate joins stay idempotent; any other accepted state counts without refund, and unprovable lineage refuses. Genuine original receipt wins, unknown remains unknown, and old request never replays. No external provider or real effect. This phase is sequencing-only; it must not ship without consumer verification.

### Phase 3 — consume the same proof and verify complete delivery

**FLOW-S5-WORKER-CONSUME** · **CONTRACT-S5-LIVE-REVALIDATION**

1. Extend the existing worker/capture seams in `mcp-task-reassessment-worker.ts` and `mcp-task-reassessment-capture.ts`. Reuse the same closed verifier and exact retained-byte binding. Preserve execution seals, capture and existing authority checks; reject stale retention, actor mismatch or unsupported relation before an effect. Never release an accepted allocation because the proof is no longer current.
2. For `VERIFY-S5-COMPATIBILITY`, run the affected resolver/retention, policy, preparation, transport, authority, worker and capture unit tests, the isolated PostgreSQL admission/lineage/capture tests, web typecheck and the ordinary governed gate for the runtime-impacting diff. Use synthetic data and record the exact tested commit, actual outcomes and unrun tests. No S5 dispatch is a test fixture. Verify legacy relations, original-result recovery and no-replay unchanged. Confirm no data migration or public interface widening beyond the reviewed locator relation, or return to the approved design if necessary.
3. Rollout owns the mixed-version boundary. Admit no private request until reader and consumers are on supported canonical bytes. A rollback disables new private-source admission rather than refunding allocations, altering retained evidence or replaying history. Verify unaffected repo-source behavior. Any normal release and installed synthetic check needs its own admitted lane. No activation, production operation, policy approval or assessment is part of this plan draft. This phase is sequencing-only.

## Baseline traceability

| Objective | Criteria | Contract and verification |
| --- | --- | --- |
| OBJ-S5-PRIVATE-SOURCE | AC-S5-PRIVATE-MATCH, AC-S5-PRIVATE-STALE | CONTRACT-S5-PRIVATE-LOCATOR and VERIFY-S5-PRIVATE-PROOF |
| OBJ-S5-AUTHORITY | AC-S5-PRIVATE-AUTHORITY | CONTRACT-S5-PRIVATE-LOCATOR, CONTRACT-S5-LIVE-REVALIDATION and VERIFY-S5-PRIVATE-PROOF |
| OBJ-S5-ONE-USE | AC-S5-PRIVATE-ALLOCATION, AC-S5-PRIVATE-NO-REPLAY | CONTRACT-S5-ONE-SUBJECT-ALLOCATION and VERIFY-S5-SUBJECT-ONE |
| OBJ-S5-COMPATIBILITY | AC-S5-PRIVATE-LEGACY | CONTRACT-S5-LIVE-REVALIDATION and VERIFY-S5-COMPATIBILITY |

## Backlog coverage

Candidate delivery grouping: one non-independently-shippable change, under BI-AE2EF5E4, covering all three phases. A reader, a transport variant, and a worker deployed separately would create unsupported or misleading mixed-version states and would not deliver private proof end to end. This is the proposed atomic rationale for review, not an approved coverage receipt. Once the scope disposition is confirmed and the sanitized plan is available as an immutable artifact, record source- and baseline-bound coverage for the exact plan and hand it to the eligible plan reviewer. No coverage or implementation pass is claimed here.

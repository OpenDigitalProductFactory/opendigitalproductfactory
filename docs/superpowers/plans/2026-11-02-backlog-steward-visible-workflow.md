---
status: active
---

# Backlog Steward visible workflow implementation plan

**Backlog item:** BI-506706B7
**Workroom:** WC-A32A6FEC
**Decision:** compose the existing duplicate, Workroom, scheduled-task and Right Now substrate; do not add a dashboard or a second execution lane.

## Outcome

A scheduled Backlog Steward reviews the full active backlog and newly shared peer demand, applies only safe corrections, routes ambiguous decisions, and shows any human what it checked, changed, deferred and needs next inside the existing coworker and Workroom experience.

## Acceptance criteria

1. A run declares the exact backlog population it observed and proves full pagination; an unchanged rerun is idempotent.
2. Findings are classified as true duplicate, repeated occurrence, related variant, epic-placement correction, cross-reference gap, peer-owned correction or no change.
3. Only deterministic, reversible local corrections can auto-apply. Ambiguous merges, destructive changes and peer-owned mutations become evidence-backed proposals.
4. Existing merge reach and relations are preserved, including safe handling of already-retired duplicates owned by BI-8EC69BE0.
5. Newly shared demand from BI-FF8A57EF enters the same review path; the steward does not create a second federation lane.
6. The existing coworker/Workroom UI shows scope, progress, last run, findings by disposition, applied changes, exceptions, evidence and next scheduled run in plain language.
7. Cross-reference rendering and `MENTIONS` edges remain owned by BI-A63A9476; this work emits structured references that capability can project.
8. The first-pass reconciliation BI and BI-75080736 are linked as learning input and consolidated UX direction.

## Delivery

This is one atomic medium delivery. Full-population detection, a recurring Workroom declaration and a human inspection path are not independently useful versions of the requested outcome: a detector without recurring ownership repeats the current one-off audit; a recurring room without complete coverage produces false assurance; a UI without either has nothing truthful to show.

### Phase 1 — full-population duplicate review

- Refactor `apps/web/lib/demand/dedup.ts` so the all-pairs contract can scan the complete active population without repeatedly rebuilding trigram sets.
- Remove the unreported 500-item ceiling from `find_duplicate_candidates` and `sweep_duplicate_demand`.
- Return population and coverage fields that make a partial read impossible to describe as complete.
- Start with failing tests in `apps/web/lib/mcp/packs/demand-scoring-pack.test.ts` and `apps/web/lib/demand/dedup.test.ts`; prove more than 500 records are covered and unchanged inputs are deterministic.

### Phase 2 — recurring steward activity

- Add `backlog-steward-watch@1.0.0` to the standing WorkShape registry in `apps/web/lib/work-management/standing-operations-shapes.ts`.
- Reuse `portfolio-rationalization-agent`, existing backlog tools and `record_workroom_evidence`.
- Keep mutation tools behind the existing consequential-tool policy; peer-owned changes and ambiguous merges are proposals.
- Extend the standing-shape conformance tests. No table, enum or scheduler is added.

### Phase 3 — human inspection in Right Now

- Project a live TaskRun's existing Workroom relation in `apps/web/lib/platform-runtime/workforce-activity.ts`.
- Turn the current-task label in `apps/web/components/platform/WorkforceNowShell.tsx` into one contextual Workroom link when the relation exists; keep plain text for unroomed work.
- Add focused loader and component tests, including the plain-text fallback and accessible link name.
- Record UX-fit evidence against the committed Right Now route budget. The default board stays at one link; detailed evidence remains in the Workroom.

## References

- **Requirement:** BI-506706B7 acceptance criteria 1–8; BI-44ABB02A baseline pass.
- **Contract:** `apps/web/lib/work-management/work-shapes.ts`; `apps/web/lib/platform-runtime/workforce-activity.ts`.
- **Flow:** `apps/web/lib/queue/functions/workroom-drive.ts`; `/platform/ai/right-now`; `/workspace/cases/work-capsule:<id>`.
- **Verification:** `apps/web/lib/mcp/packs/demand-scoring-pack.test.ts`; `apps/web/lib/work-management/standing-operations-shapes.test.ts`; `apps/web/lib/platform-runtime/workforce-activity.test.ts`; `apps/web/components/platform/WorkforceNowShell.test.tsx`.

## Backlog coverage

- Decision: atomic
- Parent: BI-506706B7
- Receipt: blocked-by: the exact committed plan blob is not verifiable by the evidence service until this locally gated commit is published to the remote repository
- Rationale: The complete-population detector, recurring activity shape, Workroom projection and contextual Right Now link form one delivery boundary. Shipping any phase alone would either produce an unobservable steward, a visible task without the complete review contract, or a detector with no recurring accountable owner.
- Dependencies: BI-44ABB02A, BI-049409BF, BI-8EC69BE0, BI-A63A9476, BI-FF8A57EF, BI-B18B1DE2, BI-C1781121, BI-75080736

## Risks and rollback

- A complete all-pairs scan can become CPU-heavy. Precompute similarity inputs and keep the existing result limit; the returned coverage remains complete even when findings are capped.
- Adding mutation tools to the shape could widen unattended action. Reuse existing tool consequence policies and make the decision stage human-owned.
- Workroom joins could increase Right Now query cost. TaskRun already has the relation and the live-run set is bounded; select only the semantic `capsuleId`.
- Rollback is one PR revert. No migration or data rewrite is introduced.

## Completion gate

- Focused tests pass.
- `pnpm gate:context` obligations are satisfied or named unrun.
- UX-fit evidence is committed and the UX specialist reviews the prototype/current implementation.
- Plan coverage and research receipts are reconciled when MCP connectivity returns.
- The served DEV install shows the steward's live task linking to its Workroom, and the full-population sweep reports the real active count.

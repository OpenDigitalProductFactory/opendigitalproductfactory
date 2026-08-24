---
status: draft
---

# Owner-attention briefing convergence

| Field | Value |
| --- | --- |
| Backlog item | `BI-2C50F548` |
| Workroom | `WC-7B7175A9` |
| Date | 2026-08-24 |
| Profile | Fix |
| Owning area | Workspace |

## Problem

On a fresh install, `/workspace` truthfully reports that zero decisions need the owner and that the digital team is handling 51 technical items. The adjacent coworker opening briefing reads the same raw attention feed but labels one item “Most pressing” and the other 50 “waiting for your review,” then links to an inbox with zero owner decisions. The contradictory hierarchy makes the primary Workspace question—“What needs me now?”—untrustworthy.

The briefing is deterministic, not model-generated. `loadOpeningBriefingPayload` passes raw operator-visible `AttentionItem[]` to `composeOpeningBriefing`, while `OperatorCockpit` and `AttentionInbox` first call `buildOwnerAttentionProjection` and treat only `needsYouNow` as owner work. The defect is the missing shared projection at the coworker seam.

## Objectives

**OBJ-1:** Make the Workspace cockpit, full Needs-you inbox, and coworker opening briefing derive owner-review counts from the same canonical owner-attention projection.

**OBJ-2:** Keep proactive coworker copy concise and honest: genuine owner decisions may interrupt; custodian and weekly-digest work must never be relabelled as waiting for owner review.

**OBJ-3:** Prove the fresh-install regression is closed without weakening genuine approval, escalation, or assertive all-clear behavior.

## Design grounding

This design extends, rather than replaces:

- [`2026-06-23-human-attention-surface-design.md`](2026-06-23-human-attention-surface-design.md): the Needs-you inbox is a projector over source-owned state; only human residue belongs in the owner queue; proactive surfacing may change presentation but not truth.
- [`2026-05-26-portal-ux-simplification-spine.md`](../plans/2026-05-26-portal-ux-simplification-spine.md): `/workspace` must have one trustworthy answer to “what needs me now,” use honest fresh-install empty states, and reserve implementation effort for convergence/refactoring.
- [`owner-projection.ts`](../../../apps/web/lib/attention/owner-projection.ts): canonical classification into `needsYouNow`, `weeklyDigest`, and `custodian`.
- [`OperatorCockpit.tsx`](../../../apps/web/components/workspace-home/OperatorCockpit.tsx) and [`AttentionInbox.tsx`](../../../apps/web/components/attention/AttentionInbox.tsx): existing owner-facing consumers of that projection.
- [`opening-briefing-loader.ts`](../../../apps/web/lib/agent/opening-briefing-loader.ts) and [`opening-briefing.ts`](../../../apps/web/lib/agent/opening-briefing.ts): deterministic ephemeral briefing seam and proactivity rules.

No new route, model, attention source, status map, or UI primitive is introduced.

## Research and benchmarking

The relevant product and security pattern is already canonical in DPF's human-attention design: a human inbox contains only governed residue, while technical/custodian work remains with the digital team. The existing Workspace cockpit and inbox are the implemented benchmark. This fix adopts their projection contract and rejects a second page-local classification or copy-only patch because either would recreate drift.

No external protocol, dependency, schema, or industry-specific workflow is introduced, so external standards research would add no design signal. The applicable internal standards are `architecture-over-shortcuts`, `single-source-of-truth`, `structural-verification-is-not-functional`, and the Workspace UX fit gate.

## Proposed design

### 1. Project once, then compose the briefing

`loadOpeningBriefingPayload` will build `OwnerAttentionProjection` from the operator-visible attention items using the same fallback proactivity level, timestamp, and operator audience used by Workspace. It will pass only `projection.needsYouNow.map(entry => entry.item)` to the existing briefing composer.

This keeps `composeOpeningBriefing` focused on presentation and preserves its surface-local headline selection, quiet/balanced/assertive semantics, link rendering, and detail de-duplication. The loader owns routing because it already owns the read-model fan-out and user/proactivity context.

### 2. Preserve the assertive all-clear

When raw attention exists but `needsYouNow` is empty:

- `balanced` remains silent, because no owner decision exists.
- `assertive` receives an empty owner-decision list and emits the existing deterministic all-clear.
- Team-held work remains visible in the Workspace `DigitalTeamHandlingStrip`; the coworker does not repeat or dump it.

### 3. Bound the presentation by owner decisions

The “N more items are waiting for your review” line is retained only for genuine `needsYouNow` items. Because custodian/digest items never reach the composer, a long technical coworker-name list cannot occupy the opening bubble through this path.

### 4. Regression-first verification

Add loader-level tests that mock 51 raw attention items classified into custodian/digest lanes and assert the composer receives an empty owner list. Keep pure composer tests for genuine owner items. The test must fail on the current raw-array path before implementation.

## UX fit review

- Decision: `fits-with-guardrails`.
- Owning area: Workspace.
- Route family: `/workspace` and `/workspace/inbox`; no new route.
- Primary persona: founder/operator on a fresh install.
- Navigation layer: contextual coworker action only.
- Reuse/convergence: `buildOwnerAttentionProjection`; no new status or count primitive.
- Source truth: attention aggregate plus canonical owner-routing projection.
- Empty/failure behavior: balanced stays silent at zero owner decisions; assertive gives an honest all-clear; existing failed-source disclosure remains owned by Workspace/inbox.
- AI boundary: deterministic, read-only opening bubble; no prompt send or mutation.

## Data, security, compliance, and scale

- Data: no schema, persistence, retention, sensitivity, query, or migration change. The ephemeral briefing remains unpersisted.
- Security: no authorization or action boundary changes. Audience filtering remains operator-scoped before projection.
- Compliance: no new personal, regulated, customer, or business data is introduced.
- Scale ceiling: classification remains O(N) over the already-loaded bounded attention feed. The change removes an unbounded presentation symptom without adding queries or fan-out.

## Alternatives rejected

1. **Copy-only change:** rename “waiting for your review” to “being handled.” Rejected because the briefing would still headline technical work and duplicate Workspace's custodian strip.
2. **Filter by source names in the briefing:** rejected because source identity is not owner-routing truth and would drift as adapters are added.
3. **Create a briefing-specific projection:** rejected as a second status map and a direct single-source-of-truth violation.

## Risks and rollback

- Risk: a genuine owner item is accidentally demoted by owner routing. Mitigation: retain owner-projection unit coverage and add a positive loader test for a genuine `needsYouNow` item.
- Risk: surface-local selection changes because projection ordering differs from raw triage ordering. Mitigation: the projection preserves ordered entries within each lane; the composer retains its current surface-local choice.
- Rollback: revert the loader projection call and associated tests. No data rollback is required.

## Acceptance criteria

| ID | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | With 51 raw custodian/digest items and zero `needsYouNow` entries, the coworker opening briefing does not claim any item is waiting for owner review and does not link to the Needs-you inbox as if it contains work. |
| AC-2 | OBJ-1 | Workspace, `/workspace/inbox`, and the coworker briefing derive owner-review counts from `buildOwnerAttentionProjection`; no parallel classification or source-name filter is added. |
| AC-3 | OBJ-2 | A balanced coworker stays silent when the owner projection is empty, even if the digital team is handling raw attention items. |
| AC-4 | OBJ-2 | An assertive coworker gives the existing honest all-clear when the owner projection is empty. |
| AC-5 | OBJ-2 | Genuine owner decisions retain the most-pressing headline, overflow count, deep links, and surface-local preference. |
| AC-6 | OBJ-2 | The opening bubble does not render an unbounded comma-separated list of technical coworker names through team-held attention. |
| AC-7 | OBJ-3 | A regression test reproduces the 51-raw/0-owner contradiction and is observed failing before the fix and passing after it. |
| AC-8 | OBJ-3 | Focused tests, source-local typecheck, the governed exact-tree integration gate, and fresh-install browser verification all pass before delivery is claimed. |

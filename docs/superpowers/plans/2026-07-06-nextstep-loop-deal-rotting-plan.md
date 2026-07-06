# Plan — Pipeline next-step loop + deal rotting (BI-0A6DF80F)

Date: 2026-07-06. Epic: EP-B51FA3BC. Build-order slice 2 of the parity gap matrix —
the two cheapest Pipedrive-proven delight mechanics (activity-based selling + ambient
staleness), per docs/superpowers/specs/2026-07-06-sales-crm-parity-delight-gap-matrix.md.

## Substrate finding (dpf-verify-substrate-first)

`isStageStale` with per-stage `STAGE_STALE_THRESHOLDS_DAYS` and a `suggestedNextAction`
generator ALREADY exist in `apps/web/lib/crm/pipeline-inspector.ts` — they render in the
stage inspector but never on the kanban tiles, and there is no structured next-step field.

## Design

- Migration `20260706070000`: `Opportunity.nextActivityAt DateTime?` (nullable add).
- `setOpportunityNextStep` action: sets the date, clears dormancy, logs a `task` Activity
  (scheduledAt) so the plan shows on the timeline too.
- `NextStepControl` (client, on the stage inspector): shows planned/overdue/none state +
  date-and-note setter — the Pipedrive done→plan-next loop surface.
- Kanban tiles: `isStageStale` now tints the card border red + "Rotting Nd" badge (ambient,
  no report); amber "no next step" / red "step overdue" markers from `nextActivityAt`.
- `PipelineInspectorView` gains `nextActivityAt` (ISO string) threaded from the data loader.

## Verification

opportunity-next-step tests (set+log+dormancy-clear, invalid date) and existing inspector /
page suites green. Live check post-deploy: Emma3D's open £2,500 opportunity shows the
no-next-step marker; setting a step logs the task and clears it.

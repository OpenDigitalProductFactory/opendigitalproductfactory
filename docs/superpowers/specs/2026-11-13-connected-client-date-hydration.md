---
status: active
---

# Connected client date hydration repair

Date: 2026-11-13
Backlog: BI-CFC239B2
Shape: delivery-small@1.0.0; fix; one atomic repair.

## Problem and evidence

The owner opens update details at `/ops/self-upgrade`. `ConnectedAgentClients`
formats `hostAgent.since` with the runtime-default `formatDate` during initial
render. A UTC server and a Chicago browser can display different days for the
same instant, causing a React hydration error. The actual component rendered
November 6 versus November 5 for `2026-11-06T00:30:00Z` in the two zones.
The retained native preview log identifies `ClientItem` at lines 77–80.

This is separate from BI-77FF7109. Its first Workrooms failure preceded the
date error; the cause of that failure remains unknown. Current-source D304
owner history and diagnostic reload checks passed. They do not prove this
date defect fixed.

## Existing architecture and decision

Reuse `components/ui/LocalTime.tsx`, the instant-display contract documented in
`lib/datetime.ts`, and the existing `upgrade.agentClients.hostAgentSince`
localized sentence. The human-experience closed-loop design requires existing
timestamp primitives. Keep the shared formatter and calendar-date semantics
unchanged.

Options considered:

1. Compose `LocalTime` into the existing translated sentence. Initial UTC text
   matches across server/client; the established component localizes after mount.
2. Pin the entire existing formatter to UTC. This avoids a mismatch but loses
   the viewer-local instant meaning required by the existing architecture.

Choose option 1. The string-only translator cannot interpolate React nodes.
Pass a private object-replacement marker as the date argument, split only that
marker, and insert `LocalTime mode="date"` between the translated fragments.
Keep all text in the current catalog, including sentence order and punctuation;
do not split English words, inject HTML, or introduce a shared translation API.
No new control, route, formatter, database field, provider, or access is needed.

**OBJ-1:** Owners can view connection failure dates without server/client
hydration errors while retaining viewer-local dates after mount.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | Identical props render identical initial component markup in UTC and America/Chicago, including an instant near midnight. |
| AC-2 | OBJ-1 | After mount, the existing instant display localizes to the viewer's date; translation order and punctuation remain intact. |
| AC-3 | OBJ-1 | Failed and needs-operator states show a since date when present; healthy and missing-date states retain their current behavior. |
| AC-4 | OBJ-1 | Existing connection counts, standing, reasons, empty/error states and theme tokens retain their semantics. |
| AC-5 | OBJ-1 | A served owner update page opens, expands diagnostics and reloads without this date hydration error. |

## Ordered atomic plan

The phases below are internal sequencing for the same deliverable; no phase
independently delivers the date repair. They map only to BI-CFC239B2.

1. Establish the failing regression in
   `apps/web/components/ops/ConnectedAgentClients.test.tsx`, using the actual
   component, catalog and deterministic server/viewer timezone environments.
   Include the near-midnight instant and both failure statuses. The code graph
   reports no linked tests; inspect and extend the real colocated suite rather
   than treating that result as a test exemption.
2. Replace only this component's direct date formatting with the existing
   `LocalTime` composition. Verify matching initial markup, localized mounted
   text, translated sentence order and optional-date/status behavior.
3. Run affected component/date/producer tests, both package typechecks, prose
   and style guards, and refresh the generated doc index if required. Record
   UI fit using the existing surface; add no controls or numeric budget increase.
4. Use the canonical exact-tree gate and independent committed review, then
   `pnpm land` with protected checks and queue. The coordinator alone advances
   the canonical install through its normal update procedure.
5. Verify the served owner update/details/reload workflow. Use the native
   governed preview and authorized labelled fixtures if a failure-state record
   is needed. Do not modify production connection history or induce a real
   failed update. Retain old UNKNOWN/failed evidence and actual cleanup results.

### Traceability references

- Requirement: AC-1, AC-2, AC-3, AC-4, AC-5.
- Contract: `apps/web/components/ui/LocalTime.tsx`.
- Contract: `apps/web/lib/datetime.ts`.
- Flow: `/ops/self-upgrade` connection-failure date → initial render → viewer
  localization → expanded diagnostic → ordinary reload.
- Verification: `apps/web/components/ops/ConnectedAgentClients.test.tsx` and
  served-owner AC-5 verification, with source/runtime identity recorded.

## Risks, boundaries and rollback

The main risk is losing translation order when inserting a React node. Exercise
a non-English-shaped sentence in the component test without changing the
catalog. Repeated markers must retain each date position. Keep escaped text
and normal React nodes; no raw HTML. Null dates and successful host agents must
not acquire a since sentence.

No migration or data change. Roll back through a protected source PR if the
composition regresses display. Do not suppress the whole hydration error,
disable development refresh, change global timezone policy, or claim the
unexplained Workrooms failure repaired.

## Backlog coverage

Native atomic coverage: `cmwfj4dik1mly0ep4h1ye61gb`, bound to immutable design
commit `75805844459f6f4884baac436d710e2c19acdb1b`, blob
`1e8782e35459ae2004c4e98d362f7c5ce4786641`. The single deliverable maps to
BI-CFC239B2 with no independent dependency. Implementation admission:
`IRD-F6A2584068C7`. The existing funding request executed and its native room
binding resolves to the owning organization/shared-platform scope; the normal
allocation policy and limits are unchanged.

The actual component regression first failed for both failure statuses and
reported a real React hydration recovery error. The existing `LocalTime`
composition then passed matching initial markup, mounted Chicago dates,
translated repeated-date order, optional dates and healthy-state checks.
Source-local checks do not establish protected delivery or served acceptance.

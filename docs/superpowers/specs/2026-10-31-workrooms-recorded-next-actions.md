---
status: draft
backlog_item: BI-E8542C82
workroom: WC-4933D363
---

# Recorded next actions in existing Workrooms

Source: DOC-82684072; design draft DOC-5EA98914 v5; illustrative prototype DOC-0D77913C v2. Base ea62f5fb890390bde854b618834f5e77fd3865ea. This document is an implementation design, not approval or served verification.

## Problem and outcome

The owner sees attention counts but must open each room to find what is required. Attention is not a count of founder decisions. Preserve existing health and recovery grouping while showing the concrete recorded remedy and its immediate actor; retain the person accountable for the outcome separately.

## Existing architecture and overlap

Reuse workroom-operator-summary.ts, liveness-inventory.ts, workroom-recovery-projection.ts, workroom-drive-state.ts, held-workrooms.ts and the existing Inventory/Held/Activity components. No new store, status classifier, capability, engine or task replay.

Work Atlas BI-B3D87B06 design/2026-10-28 plan owns A0 health (already shared), A1 projection, A2 eventual replacement of the current inventory/held/activity surfaces and A3 room inspector. This repair adds a safe action presentation to existing shared reads. It does not implement an Atlas map/inspector or change its retirement plan. A future A1/A2/A3 must reuse the action presentation rather than fork it. Public source inspection reconciles this boundary; it is not takeover of another room. The private Atlas room read was refused as not admitted and was stopped.

## Contract: safe action presentation

Retain canonical Atlas health/group and existing recovery state. Present the next actor as a recorded role/requester, never infer the founder from business accountability. Use only safe display fields: actor role/name where available, a localized reason/action and a supported existing room destination. Never serialize recovery packets, original tool arguments, task digests, private request/history or credentials.

A source-identity prerequisite means the delivery coworker must complete the source record before checking can proceed. A recorded review blocker remains with its actual requester/coordinator, and an uncertain outcome is not retry authorization. A missing stage writeback means the executor must record the result; it is not a business approval. A durable capacity wait means waiting, not current execution or automatic retry. Missing actor/action remains explicitly unknown. A status such as awaiting-acceptance or ready-for-promotion alone cannot establish an owner decision or successful delivery.

A genuine human decision needs the recorded attention/decision context and supported room link. If only a generic attention flag exists, say decision details are missing; do not invent a choice. No new actionable buttons, arbitrary resume/reassign/delete or permission expansion.

## Grouped recovery and presentation

Keep existing action/reason/deviation grouping and all case links. A group shows a common remedy only when every member has the same nonempty remedy. Heterogeneous remedies stay on their own rows; never borrow rooms[0].recoveryCondition. Technical stage, deviation codes, lease IDs and branch evidence remain disclosed, with plain outcome/action first.

Use report-kit, existing localization and theme tokens. Replace generic default copy rather than add a wall of text. Retain bounded-read labels and current expiry/reaper protections. Measure both default content and serialized safe projection on deterministic fixtures and served owner views; do not fabricate word/height/payload savings.

## Acceptance

- AC-1: Default page separates demonstrably working, waiting and attention from retained history; leases alone never imply progress. Counts label bounded reads honestly.
- AC-2: Each actionable room names its recorded accountable person or honestly says unassigned, and gives a supported next step without inventing automatic recovery.
- AC-3: Lease timers, UUIDs, branches and diagnostic metrics are hidden behind labelled disclosures; keyboard and narrow viewport remain usable.
- AC-4: Repeated held causes are summarized once with affected room count and honest recovery guidance, preserving every case link and original evidence.
- AC-5: One existing inventory/read model serves unscoped and portfolio views. Compact loading and deferred history/diagnostics reduce default payload or rendered content with measured before/after evidence; no per-room DB queries or timer refresh.
- AC-6: Existing expiry grace/reaper safety and active holder protections remain unchanged and are tested; outcomes needing a person have an accountable recovery path.
- AC-7: Affected tests, typechecks, proportional guards, protected PR/merge, canonical deployment and actual desktop/narrow browser happy path prove delivery.

## Verification and limits

Tests cover verified actor versus accountable human, missing action/actor, unresolved historical review, lease-only waiting, terminal rows, genuine recorded decisions, heterogeneous grouping and secret/packet omission. Existing restaurant/Finance/provider engines are outside scope. My Work long-body duplication is a linked sentinel: reuse its current carrier summary rather than create another task engine.

Run affected tests and package typechecks, diff-scoped prose/style/docs/design gates, independent source/UX assessment, protected PR/merge and canonical release. Served owner verifies attention versus coworker ownership, grouped cases, unknown/empty/failure states, keyboard/narrow layout and authorized saved-result readback. No production business fixture or side effect. Revert this presentation change through a signed PR if misleading; no migration rollback.

## Research and proportionality

This is a refactor of proven native read/projection and report-kit contracts, not a new feature architecture. Existing Atlas research and workroom-human-operations design supply overview/disclosure patterns; preserve their single health vocabulary. Alternatives rejected: infer founder decisions from attention counts; expose raw recovery packets; replace the pending Atlas renderer; create a parallel recovery state machine. The selected extension keeps authority at existing action gateways.

# Workroom flow close-out (EP-B70E718D)

- **Backlog item:** `BI-3EC4722F`
- **Epic:** EP-B70E718D
- **Design:** [Workroom flow map and measurement](../specs/2026-10-02-workroom-flow-map-and-measurement-design.md) §5, §6, §7 L0, §8, §9
- **Decision record:** DI-58C43DCC688E chose to ship the slice of BI-B146AB6B that F8c needs and leave the platform-wide control registry in BI-B146AB6B.

The epic's remaining items ship as one pull request from a stack of branches, one per item, each with its own Workroom.

## Deliverables

1. **Ended rooms close their steps (BI-C9F1DE01).** A terminal room is never driven again, so its open stage telemetry stayed open.
   - `planRoomEndClosures` plans a release (if held) and a cancel for each open step.
   - `updateWorkCapsuleStatus` closes the room's steps once its own commit is done.
   - The hourly queue metrics aggregator closes steps left open on rooms that ended inside a caller's transaction or before this existed.
   - A week's flow load leaves out a run parked in an idle hold (`IDLE_HOLD_LANES`), the rule live load already follows.
   - The area tile's flow-load trend and change come back (withdrawn in BI-B0E285FB).
   - QueueMetricSnapshot depth and wip were never inflated, since they are read from live, non-terminal rooms, so past days are not re-aggregated.
2. **A room can sit at an IT4IT stage (BI-B8B3FB70).**
   - `WORK_SHAPE_STAGE_IT4IT` maps delivery-shape stages to IT4IT 3.0.1 participationReferences. It lives beside the shapes, not on `WorkShapeStage`, because the GPP compiler round-trips stage definitions.
   - `PLATFORM_DELIVERY_GRAMMAR` covers Integrate 5.3.x → Deploy 5.4.x, the 3.0.1 split of 2.x Requirement-to-Deploy.
   - The `platform-delivery` subject resolves a `WorkroomStructure` naming the stream, the stage and its participationReference.
   - The server binding reads the room's shape claim and drive stage, then the reference model.
3. **The home hero reads archetype stages (BI-B32D8C16, F7c).**
   - The twin binding gains the `wr:` stage queues whose IT4IT stream matches the archetype's IT4IT binding. The 2.x stream names map onto 3.0.1 streams in one table.
   - The hero stream is resolved from the archetype's own fields in the spec §9 order, with the primary-portfolio rule as the fallback.
4. **Two reviews in a row file one routed item (BI-3EC4722F, F8c).**
   - Each review's bottleneck and cause are recorded when the review happens, because the daily snapshots cannot recover a past cause.
   - When two consecutive reviews name the same `queueKey + cause`, the item is filed through the shared intake. Its origin is that pile, so a repeat updates the open item.
   - The item is attributed to the stage's `accountablePrincipalRef` and carries a routing answer. This is the slice of BI-B146AB6B: a sustained pile at a step is decidable from drive data when a room is held there, so the answer is a gate bound to that shape stage.
   - The old three-sighting signal stops filing, so nothing is filed twice.

BI-04B6A2FF needed no work: #6564 already reclaims slots held by terminal runs. It was closed as verified-existing.

## Backlog coverage

- Decision: decomposed
- Receipt: pending
- Dependencies: BI-B32D8C16 depends on BI-B8B3FB70. BI-3EC4722F depends on the BI-B146AB6B slice it carries.

| Deliverable | Live BI | Requirements | Contracts | Flows | Verification | Independently shippable |
|---|---|---|---|---|---|---|
| Ended rooms close their steps | BI-C9F1DE01 | §5 flow load | `planRoomEndClosures`, `reconcileEndedRoomStageTelemetry`, `IDLE_HOLD_LANES` | terminal status → closed steps → weekly load | AC-CO-1 | Yes |
| Room at an IT4IT stage | BI-B8B3FB70 | §6, Edge 1 | `WORK_SHAPE_STAGE_IT4IT`, `PLATFORM_DELIVERY_GRAMMAR`, `platform-delivery` subject | room → shape stage → IT4IT stage | AC-CO-2 | Yes |
| Hero reads archetype stages | BI-B32D8C16 | §6, §7 L0, §9 | twin binding `wr:` queues, hero stream resolver | archetype → stream → hero | AC-CO-3 | Yes, after BI-B8B3FB70 |
| Consecutive reviews file one item | BI-3EC4722F | §8 step 3 | review sighting record, routed filing | review → sighting → item | AC-CO-4 | Yes |

## Acceptance

- **AC-CO-1:** after one reconciliation pass, no open workroom-stage step belongs to a terminal room. Ending a room closes its steps. A week's flow load counts what live load counts, and the tile shows its trend again.
- **AC-CO-2:** a delivery room resolves a `WorkroomStructure` naming its IT4IT stream and stage and carrying the participationReference. Its lifecycle uses the shared grammar machinery. Opportunity and account resolution is unchanged. A room whose stage has no reference resolves null.
- **AC-CO-3:** the twin binding includes `wr:` queues bound through the stage reference. The hero stream follows the §9 order, falling back to the primary portfolio.
- **AC-CO-4:** two consecutive reviews naming the same pile file exactly one item, deduplicated on `queueKey + cause`. The item is attributed to the stage's accountable principal and carries its routing answer.

## Recorded limitations

- The Software Platform archetype declares no activation profile or product mix. On this install, the §9 resolution falls back to the primary-portfolio rule until the archetype declares them.
- The full control registry, the refusal on filing without a routing answer, and the conformance walk remain in BI-B146AB6B.

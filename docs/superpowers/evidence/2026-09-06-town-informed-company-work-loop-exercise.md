# Town-Informed Company Work Loop Exercise

| Field | Value |
| --- | --- |
| Date | 2026-09-06 |
| Governing spec | docs/superpowers/specs/2026-07-24-town-informed-company-work-loop-design.md |
| Governing plan | docs/superpowers/plans/2026-07-24-town-informed-company-work-loop.md |
| Governing epic | EP-WORK-CONVERGENCE |
| Historic backlog label | historic-F309BB95 (does not resolve in this install) |
| Live backlog item | BI-0EA09322 |
| Exercise mode | source-grounded dry run |
| Runtime limitation | Live runtime was not used; findings are valid for source/schema/read-model/UI planning and are not a claim that live event routing has been exercised. |

## Initial Broad Request

Capture one company outcome as a Work Case: prepare a launch-readiness package for a small municipal services portal that accepts resident service requests, routes them to the right team, exposes status safely, and names the owner decisions required before public launch.

## Current Town.com Research Snapshot

Town's current public product framing is an AI assistant that handles repeated busywork through routines, integrations, and human review points. The company-use lesson for DPF is not a personal assistant clone; it is that repeated work should be packaged as observable routines, run against existing systems, and pause for review before consequential action.

Sources reviewed on 2026-09-06:

- Town homepage: https://www.town.com/
- Town routine library: https://www.town.com/routines
- Post-meeting debrief drafts: https://www.town.com/routines/post-meeting-debrief-drafts
- Stalled deal re-engagement: https://www.town.com/routines/stalled-deal-re-engagement
- Closed-lost win-back: https://www.town.com/routines/closed-lost-win-back
- Pipeline hygiene alerts: https://www.town.com/routines/pipeline-hygiene-alerts
- Town pricing for teams: https://www.town.com/pricing?audience=teams

DPF adopts the routine and review-loop pattern, rejects a standalone assistant/inbox, and lands the company setting inside Work Case, Workroom, CoworkerOffer/CoworkerEngagement, AuthorityBinding, receipts, and the existing Needs You surface.

## Compact Turn-By-Turn Summary

| Step | Work Case movement | Result |
| --- | --- | --- |
| 1 | Broad company request enters as one launch-readiness outcome. | Work Case remains the company object; no personal assistant surface is introduced. |
| 2 | Strategy/COO defines stakeholders, success criteria, launch risk, and the decision owner. | Business-facing brief is enough for coworker packet creation. |
| 3 | Architecture checks current source substrate. | Work Case, Workroom, CoworkerEngagement, TaskRun, WorkUnit, DecisionInteraction, and evidence/receipts already exist. |
| 4 | Compliance names privacy, retention, public-sector accessibility, and approval constraints. | Consequential commitments belong in Needs You through approval/decision waits. |
| 5 | Storefront/Product defines resident request lifecycle and candidate Build Studio brief. | Build work remains gated until readiness evidence is clear. |
| 6 | Finance identifies fees, procurement, refunds, and paid-provider approval needs. | A paid-provider coworker service engagement can require approval before work starts. |
| 7 | Operations/Dispatcher defines routing, assignment, SLA, and exception handling. | These are Work Case context and candidate future routines, not a second dashboard. |
| 8 | QA/Assurance defines launch checklist and acceptance evidence. | Verification receipts attach to the same Work Case. |
| 9 | Source/code verification checks whether coworker service engagements appear in Work Case. | Gap proven: CoworkerEngagement is persisted and typed, but Work Case source registry/read-model/loader did not project it. |

## Work Case Identity

| Field | Value |
| --- | --- |
| Proposed case id | coworker-engagement:CE-MUNI-LAUNCH |
| Source type | coworker-engagement |
| Source id | CE-MUNI-LAUNCH |
| Sponsor | Requesting user or requesting agent recorded on CoworkerEngagement |
| Provider | CoworkerEngagement.providerAgentId |
| Owning decision scope | WWWD for the municipality/customer's launch decision; WWMD only if platform substrate changes |

## Coworker Contribution Packets

| Coworker | Source reference | Expected output packet | Approval trigger | Evidence/receipt required | Result |
| --- | --- | --- | --- | --- | --- |
| Strategy / COO | Work Case business brief | Launch goal, stakeholders, success criteria, risks | Scope changes that affect launch commitment | Operator note or governed action receipt | Recorded |
| Enterprise Architect | Architecture evidence | Primitive reuse and boundary review | WWMD if DPF substrate changes | Architecture evidence note | Recorded |
| Compliance / Legal | Compliance packet | Privacy, retention, accessibility, and approval constraints | WWWD/WSID when obligations alter launch posture | DecisionInteraction or compliance evidence | Recorded |
| Storefront / Product | Portal flow source | Resident request lifecycle and Build Studio brief | WWWD for resident-facing process commitments | Product packet evidence | Recorded |
| Finance | Finance packet | Fees, refunds, payments, procurement concerns | Funding or paid-provider approval | ApprovalContext and finance evidence | Recorded |
| Operations / Dispatcher | Dispatch source mapping | Routing, assignment, SLA, field exception path | Operational policy exception | Dispatch evidence note | Recorded |
| Build Studio | Work Capsule reference | Implementation scope only after gates are clear | WWMD for platform build scope | Work Capsule/evidence link | Recorded |
| QA / Assurance | Verification source | Launch checklist and acceptance tests | Release readiness decision | Verification receipt | Recorded |

## Required Needs You Decision

Needs You item: approve or decline starting a paid/high-risk launch-readiness coworker service engagement.

Why it belongs in Needs You: CoworkerEngagement.status = needs-approval represents a consequential decision about funding, authority, or risk before work can continue. It should project to Work Case state awaiting-decision with A2A status input-required.

Why technical recovery stays out: a failed runtime verification, provider outage, or missing source bridge is system work. It may block the Work Case, but it should not inflate the owner's decision count unless a real business/authority decision is required.

## Evidence And Receipts

| Evidence | Source | Result |
| --- | --- | --- |
| Schema substrate | packages/db/prisma/schema/ai-coworker.prisma model CoworkerEngagement | CoworkerEngagement already persists engagementId, requested outcome, priority, status, approval context, work capsule/tool references, audit refs, and timestamps. |
| Status vocabulary | apps/web/lib/coworker-service-catalog/types.ts | Engagement statuses are requested, needs-approval, accepted, rejected, in-progress, completed, cancelled. |
| Creation path | apps/web/lib/coworker-service-catalog/engagements.ts | Approval-required offers create CoworkerEngagement rows with status needs-approval and approval context. |
| Work Case source registry | apps/web/lib/work-management/source-registry.ts before this branch | No coworker-engagement source entry existed. |
| Work Case source refs | apps/web/lib/work-management/case-types.ts before this branch | No coworker-engagement source-ref kind existed. |
| Status projection | apps/web/lib/work-management/status-projection.ts before this branch | No CoworkerEngagement projection existed; source fallback could only show intake with low confidence. |
| Workspace lens/detail loader | apps/web/lib/work-management/workspace-case-loader.ts before this branch | Loader queried WorkItem/Workroom only, so a direct CoworkerEngagement could not appear as one company Work Case. |
| WorkUnit formula | apps/web/lib/work-management/work-unit.ts before this branch | WorkUnit carriers were WorkCapsule, WorkItem, and TaskRun; CoworkerEngagement had no adapter. |

Receipt status: source-grounded evidence only. No live runtime receipt is claimed here.

## Delivery Gate Observation

During delivery verification on 2026-09-06, the local-CI production-build stage failed before product code ran because a stale managed BuildKit container for slot-0 carried a GPU device request and Docker Desktop invoked `nvidia-container-runtime-hook`, which crashed while opening NVML. A disposable DPF-shaped BuildKit builder booted without a GPU request, so the stale managed builders were removed and the gate was retried against a fresh tree identity. Treat that earlier local-CI record as infrastructure evidence, not a product defect in the CoworkerEngagement Work Case projection.

## Gap Results

| Hypothesis | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| CoworkerEngagement as Work Case source | Proven | Existing CoworkerEngagement rows cannot be addressed by Work Case source registry/read model without a coworker-engagement source key. | Implemented under BI-0EA09322 on this branch. |
| Multi-coworker session rollup | Partly proven | Workroom participant projection exists for WorkItem-backed rooms; this exercise only proves the requested coworker service must enter the room first. | No separate BI filed. |
| Routine promotion edge | Not proven | One dry-run scenario is insufficient recurrence evidence. | None found. |
| Needs You source coherence | Proven for approval status only | needs-approval should become awaiting-decision/input-required; technical recovery remains system-facing. | Implemented in status projection under BI-0EA09322. |
| Memory and Commons boundary | Not proven | The dry run produced no new durable memory/commons rule beyond the existing spec. | None found. |
| Work Case read-model coverage | Proven | buildWorkCaseSummary/buildWorkCaseDetail accepted WorkItem/Capsule/Decision/Evidence but not CoworkerEngagement. | Implemented under BI-0EA09322 on this branch. |

## Explicit None Found Entries

- Follow-on backlog items: BI-0EA09322 filed for the proven projection gap; no additional item filed from the dry run.
- Repeated-work/routine candidates: none found; one exercise does not prove a repeatable offer.
- Memory/commons candidates: none found; existing Work Case and evidence-bound learning doctrine covers the lesson.
- Implementation gaps: CoworkerEngagement as Work Case source and Work Case read-model coverage.

## Planning Decision

- Gate result: source-level implementation may proceed
- Live-runtime dependency: no
- Implementation gap selected: CoworkerEngagement as Work Case source
- Reason: The implementation is source-level projection work over existing persisted CoworkerEngagement records, not live event routing. Current source proves the missing registry, source-ref, status projection, WorkUnit adapter, and workspace loader coverage. A live runtime exercise remains required before claiming end-to-end automatic delivery from service request to Needs You, but it is not required to implement and test this projection gap.

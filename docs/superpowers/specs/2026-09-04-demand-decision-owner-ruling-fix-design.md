---
status: active
---

# Demand Decision Owner Ruling — Fix Design

Backlog: BI-EB5E9BE3  
Epic: EP-0AF96937

## Problem and named-ref reproduction

On `origin/main` at `fdbff30390b22e6166e01c1335d791d4619cb685`, `apps/web/app/(shell)/coworker-decisions/review/page.tsx` restricts `openOrgRows` to `routeContext: "/coworker-business"`. Live production evidence `DME-0149168E05AC` shows funding decision `DI-BD8CB44CBFDC` was validly created from `/ops/demand` against the organization's WWWD profile but was absent from “Waiting on your call.” The owner therefore has no UI action that can unblock funding.

The regression test imports the intended canonical predicate before it exists and must fail in Red. Green requires `/ops/demand` and `/coworker-business` to be treated alike when both belong to the organization profile.

## Causes checked

- Decision creation is not the cause: the live `DecisionInteraction` exists and is unresolved.
- Funding authority is not the cause: the production installation reaches WWWD and records the escalation.
- The resolution control is not the cause: `OrgDecisionCaptureList` already supplies the answer path for selected rows.
- The queue query is the cause: its route equality excludes the existing `/ops/demand` row before presentation.

## Design grounding

The existing organization `DecisionPerspectiveProfile.profileId` is the source of truth for WWWD ownership. The queue will select unresolved, unanswered decisions on that profile, independent of which business surface originated them. It will continue to exclude build-bound, task-bound, profession-gate, kernel-consult, empty-question, and `mcp:principle_decide` interactions. This extends the existing Review & adjust queue and capture control; it adds no model, enum, route, or approval surface.

## Ordered fix sequence

1. Extract one typed organization-inbox predicate and pin its inclusion and fail-closed behavior with a focused test.
2. Resolve the organization profile before querying and use the shared predicate for `openOrgRows`.
3. Run the focused test, related decision-review tests, prose/style guards, and the governed exact-tree gate.
4. Merge through the queue, advance the canonical runtime through self-upgrade, and verify the live funding decision can be ruled from Review & adjust.

## Documentation impact

No user documentation changes are needed: the existing Review & adjust contract already says it contains unresolved business decisions. This repair makes runtime behavior match that contract. The present fix design and UX-fit evidence carry implementation traceability.

# AI Operations Map owner-first cockpit — implementation plan

- **Date:** 2026-08-02
- **Backlog item:** BI-97E5582F — Operations Map progressive disclosure switched off, cannot answer why routing degraded
- **Epic:** EP-AI-OPSMAP
- **Work Capsule:** WC-140E3442
- **Route:** `/platform/ai/operations-map`
- **Kernel decision:** DI-1269D9D88345 — Option B, owner-first cockpit; composite 9.103, margin 1.619, high confidence; signal usable with strong structured coverage and no commandment conflict
- **Backlog coverage:** atomic — live receipt `cmsc30wkx04m501qmmzagpujv`

## Design grounding

- **Existing specs/plans reviewed:** `docs/superpowers/specs/2026-06-28-activity-level-ai-routing-harness-design.md`, the July Operations Map digestibility plan, BI-97E5582F, and BI-3006D674.
- **Current code substrate reviewed:** `AiOperationsMap`, `ActivityRoutingWorkbench`, `RoutingArchitectureOverview`, `PhaseRemediationActions`, the activity-routing projection/DTOs, route-shell registry, and UX-budget checks.
- **Source of truth:** the activity-routing design owns the workbench contract; live routing projection owns operational state; shared provider and coworker actions own remediation; route-shell policy owns the page-level UX contract.
- **Decision:** preserve the route and its governed actions, replace repeated activity presentations with an owner lead plus one selected inspector, and disclose architecture/topology/evidence after the operator action band. Decision DI-1269D9D88345 selected this option over content-only cleanup, a new route, and peer tabs.

## 1. Purpose and operator job

This route is the operational explanation and recovery surface for governed AI routing. It must let an employee operator answer, without reading logs:

1. Is routing healthy enough for work to proceed?
2. Which activity needs attention first, and why?
3. Which model and harness were selected, or why none qualified?
4. What can I do now: enable/connect a provider, open the originating work, approve a governed proposal, or ask a coworker to investigate?
5. What outcome evidence exists, and what remains unknown?
6. Where are the technical topology, conformance, replay, and raw identifiers when deeper diagnosis is warranted?

The AI coworker is an assistance path, not a decorative CTA. It receives a minimized packet for the selected activity: operator label, signal, risk/shape, humanized model route, decision explanation, exclusion reasons, and available remediation. It does not receive raw route IDs or unrelated page state.

## 2. Evidence and diagnosed failure

Live inspection at 1280×720 found:

- 563 visible words, 52 controls, and 29 headings on the default page; 3,374 px of content height.
- Opening the workbench exposed 517 words in a 1,491 px region.
- The six-node activity rail was 1.78× wider than its viewport and required horizontal scrolling.
- 81 visible text elements were below 12 px.
- The same six activities were rendered three times: rail, selected decision drawer, and six detailed cards.
- The “4 need review” queue could contain four rows labeled “Informational — no action available yet.”
- No marked lead band and no marked next action existed.
- Theme contrast passed; the defect is information architecture, repetition, tiny type, and weak action ownership rather than foreground/background contrast.

The implementation contradicts its design source of truth. The activity-routing design says “dense activity rail plus one selected decision drawer” and explicitly rejects nested cards. The July digestibility plan deferred structural correction; the resulting content pass made labels better but preserved the unusable hierarchy.

## 3. Research and benchmarking

- **NIST AI RMF:** the route should connect Map and Measure evidence to Manage actions, prioritizing risks and responses rather than presenting an undifferentiated technical inventory.
- **Microsoft Foundry model router:** operators are given explicit routing posture, eligible model subset, unexpected-selection troubleshooting, underlying-model metrics, and cost monitoring. DPF adopts the visible posture → selection → evidence → remediation chain, while retaining DPF’s stronger activity/risk and governance context.
- **Amazon Bedrock prompt routing:** operators compare a bounded model set, a fallback, selection criteria, performance, and cost. DPF adopts the bounded-candidate and fallback explanation, but rejects a provider-only view because DPF routes per governed activity.
- **W3C cognitive accessibility guidance:** page, region, and control purpose must be clear; controls must be visibly related to the content they affect; the most important actions and information must be easy to find.
- **USWDS card guidance:** cards are modular summaries, not a substitute for sequential data, tabular rows, or simple calls to action. The duplicate per-activity card grid is therefore removed rather than restyled.

## 4. Options and decision

| Option | Composite | Disposition |
| --- | ---: | --- |
| A — content cleanup inside the current hierarchy | 6.267 | Reject: fast but preserves the page-level architecture defect. |
| **B — owner-first cockpit on the existing route** | **9.103** | **Adopt: highest legibility, evidence density, substrate reuse, and real functionality.** |
| C — new dedicated routing-debugger route | 6.901 | Reject: new route/substrate and navigation burden before the existing route is made coherent. |
| D — three peer tabs for Health, Routing, and Evidence | 7.484 | Reject: modes organize system nouns but still make the operator choose where the answer lives. |

The decision preserves the existing route, DTO, actions, provider-remediation primitive, global coworker panel, and topology. It changes hierarchy and projection rather than adding another dashboard or data store.

## 5. Target interaction architecture

### Band 1 — owner lead

The first visible region, marked `data-dpf-lead`, contains:

- One page title and one-sentence purpose.
- A plain-language health statement derived from live activity data.
- The first affected activity, top exclusion/remediation reason, governed data class when available, and any disabled provider that would satisfy the route.
- One real next action marked with `data-dpf-primary-action` and `data-owner-first-next-action`: review the first affected activity, or inspect routes when no attention item exists.
- Freshness stays adjacent but subordinate.

Lead copy stays below 70 words and never implies a provider can be enabled when no governed candidate was projected.

### Band 2 — routing workbench

- Replace the horizontally scrolling node rail with an ordered vertical activity list on desktop and mobile.
- Keep one selected activity inspector; remove the duplicate detailed-card grid entirely.
- Provide `All` and `Needs attention` filters within the same list instead of opening a second duplicate queue.
- Default selection is the first failed/attention activity, otherwise the first activity.
- Use 12 px minimum supporting text and 14 px body/detail text; retain token-aware status color as a redundant cue.
- The selected inspector owns actions in this order:
  1. governed provider remediation using the existing `PhaseRemediationActions` primitive when a candidate exists;
  2. queue the existing approval proposal when allowed;
  3. open the originating build/work case when referenced;
  4. ask the route coworker to investigate with minimized selected-activity context;
  5. open Providers & Routing when the projection only has textual remediation.
- Raw IDs stay inside `TechnicalDetails` disclosure.

### Band 3 — technical context

- Routing architecture/conformance, topology controls/canvas, deliberation diagnostics, and activity evidence remain on the same route but sit behind clearly named `data-dpf-disclosure` regions.
- The first two bands never require the operator to understand Designed/Observed/Compare, provider topology, A2A edges, raw recipe keys, or route-decision IDs.
- Existing technical deep links and replay behavior remain intact.

## 6. Projection and component changes

1. Extend the existing `OperationsMapActivityStep` DTO with optional remediation metadata already produced by `PhaseResolution`: stable flag code/remediation and typed disabled-provider enable candidates. No Prisma change and no new enum.
2. Preserve that metadata in `projectBuildStudioActivityRouting`; package-derived activities remain valid with empty remediation candidates.
3. Extract pure owner-summary and coworker-prompt helpers from the React component so lead wording and handoff context are deterministic and unit-testable.
4. Refactor `ActivityRoutingWorkbench` around `ActivityList` + `ActivityDecisionInspector`; delete the duplicate card path and obsolete queue-only helpers.
5. Refactor the shared `PhaseRemediationActions` presentation to theme tokens, standard tap targets, accessible status messaging, and marked primary action while preserving its existing enable/connect behavior.
6. Reorder `AiOperationsMap`: owner lead → workbench → disclosed architecture/topology/evidence. Change the architecture component’s internal title to a subordinate heading so the route has one `h1`.
7. Migrate the route’s UX-budget manifest entry: add measured lead/disclosure baselines and retire the `lead-band` and `next-action-marker` exemptions.

## 7. Test-first implementation sequence

### Red 1 — projection integrity

Add failing projector tests proving flag code, remediation copy, and disabled-provider candidates survive into `OperationsMapActivityStep` without inventing data.

### Green 1 — projection

Implement the optional DTO fields and projection mapping. Run the focused projector/live-state tests.

### Red 2 — owner-first workbench

Replace source-presence assertions with interaction assertions that initially fail:

- first attention activity selected by default;
- no horizontal activity rail and no `data-activity-routing-step` duplicate cards;
- one activity list item per activity;
- filtering does not duplicate activities;
- selected inspector exposes exactly the actions supported by its evidence;
- coworker event contains minimized selected-activity context and no raw IDs;
- technical identifiers remain in disclosure;
- all-unknown evidence stays one honest sentence.

### Green 2 — workbench and remediation primitive

Implement the vertical master/detail workbench, selected inspector actions, prompt helper, and shared remediation styling refactor.

### Red/green 3 — route hierarchy and UX budget

Add route/component tests for one marked lead, one marked next action, disclosure regions, one `h1`, and owner lead copy derived from degraded and healthy fixtures. Update the generated route-shell measurement/baseline through the repository’s existing UX-budget tooling, not manual metric invention.

## 8. Refactoring budget

Approximately 20% of the implementation is reserved for consolidation rather than net-new UI:

- delete the duplicate per-activity card rendering and review-queue presentation;
- extract pure summary/prompt helpers from the 700+ line workbench;
- reuse and modernize `PhaseRemediationActions` instead of creating page-local provider controls;
- reuse the canonical provider route constant and `AskCoworkerButton` event path;
- remove the `text-white` theme defect in the touched architecture control;
- keep technical-detail and status-style mappings single-source.

## 9. Verification and acceptance

Source-local:

- Focused Vitest for activity projection, workbench, map route, architecture heading, remediation actions, and UX-budget measurements.
- Production `pnpm --filter web build` with zero errors.
- No new hardcoded color or style-drift findings in touched files.
- No migration.

Governed runtime:

- Claim a shared nonproduction lease before preview.
- Exercise degraded and healthy states at desktop and narrow viewport.
- Confirm the first viewport states purpose, health, affected activity, why, and one next action.
- Confirm the activity list requires no horizontal scroll, selecting an item updates one inspector, and no duplicate activity grid remains.
- Confirm provider remediation routes or executes according to candidate type; coworker handoff opens the real panel with selected evidence.
- Run the route UX sweep and axe; clear the three existing axe violations and retire both route exemptions.
- Capture screenshots and runtime evidence against BI-97E5582F / WC-140E3442.

## 10. Documentation impact and rollback

The route’s operator contract changes, so update the activity-routing design’s implementation note to state the owner-first hierarchy and that the deferred nested-card layout has been retired. No install, schema, API, or end-user business workflow documentation changes are required.

Rollback is a source revert. Optional DTO fields are additive, existing actions are reused, and there is no migration or persisted UI preference to unwind.

## 11. Backlog coverage

This is one atomic deliverable: **Operations Map owner-first routing cockpit**. Projection metadata, lead copy, remediation actions, workbench hierarchy, disclosure structure, and UX-budget migration are not independently shippable because partial delivery either preserves the dead-end operator state, renders claims without their evidence, or leaves the route’s enforced usability contract incomplete.

- **Decision:** atomic
- **Umbrella BI:** BI-97E5582F
- **Deliverable key:** `owner-first-routing-cockpit`
- **Depends on:** none
- **Live receipt:** `cmsc30wkx04m501qmmzagpujv`

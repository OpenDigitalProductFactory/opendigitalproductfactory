---
status: draft
---

# Work Atlas implementation plan

- **Backlog item:** BI-B3D87B06 (umbrella)
- **Workroom:** WC-41616420. The design workroom was WC-6EFDA731.
- **Design:**
  - [Work Atlas design](../specs/2026-10-27-work-atlas-design.md): §3–§9, with the scope manifest in §11
  - [Tailoring the picture to the business](../specs/2026-10-27-work-atlas-archetype-tailoring-design.md)
- **Prototype:** [`2026-10-27-work-atlas-prototype.html`](../specs/assets/2026-10-27-work-atlas-prototype.html), with illustrative data
- **Decision:** decomposed into eight independently shippable steps, A0–A6b

## Design grounding

Each step extends existing substrate rather than adding a parallel one.

| Concern | Existing substrate reused | What the Atlas adds |
|---|---|---|
| Room health | `lib/work-capsules/liveness.ts`, `lib/work-management/workroom-flow-state.ts` | One six-state classifier next to them (A0) |
| Local groupings to converge | `lib/work-capsules/workroom-operator-summary.ts`, `components/build/FleetDensityBar.tsx`, `components/build/work-control/DeliveryTaskHub.tsx` | Adapters over the classifier; no new grouping (A0) |
| Room-level read | `lib/work-management/portfolio-activity-projection.ts`, `room-workforce.server.ts`, the workroom drive state | A bounded atlas projection; no new tables (A1) |
| Agent read | `list_workrooms` in `lib/mcp/packs/work-capsules-pack.ts` | `view: "atlas"` (A1) |
| One room's steps | `lib/work-management/workroom-flow-map.server.ts` (`buildWorkroomFlowMap`), shared with `/workspace/cases/[caseKey]` | Inspector rendering only (A3) |
| Standing operations | `packages/storefront-templates/src/standing-rooms.ts`, `lib/work-management/standing-operations-shapes.ts` | Rhythm strip over recorded runs (A4) |
| Usual time per stage | `QueueMetricSnapshot`, `lib/queue/flow-metrics.ts`; the workroom stage emitter BI-4ADFFEDB (flow-map F2) | Stage lens that reads it, with an honest fallback (A5) |
| Business layout | `packages/storefront-templates/src/twin-profile.ts` (`deriveTwinProfile`), leaf vocabulary, workspace-home profiles, compliance overlays | One renderer per twin template (A6a) |
| Refinements | Facet registry, `four-portfolio-archetype-standard-profile-catalog.md` §2 | Organization facet selection and `deriveAtlasProfile()` (A6b, BI-7EE5681A) |
| Styling | `--dpf-*` tokens, `lib/ui-model/statusColors.ts`, report-kit | No new chart library |

**Superseded or absorbed work:**
- BI-55AC9B95 (the inventory table on `/ops/workrooms` does not progressively disclose) is resolved by A2, which replaces that table.
- The spec's §6 table names every surface's outcome. Each step below retires what it replaces in its own PR.

## Backlog coverage

- **Decision:** decomposed
- **Parent:** BI-B3D87B06
- **Receipt:** not yet recorded. A schema-v2 coverage receipt binds to the umbrella's scope baseline, and only an independent reviewer's spec-approval of the design (§11 manifest) can mint that baseline. The coverage is recorded against this plan's pushed blob after that approval, followed by plan review.

| Key | Deliverable | Live BI | Requirements | Contracts | Flows | Verification | Depends on | Independently shippable |
|---|---|---|---|---|---|---|---|---|
| A0 | One health vocabulary; three groupings become adapters; critic calibration | BI-930A4C88 | AC-ONE-VOCABULARY, AC-UX | `AtlasHealth` six-state type; adapter functions | operator summary, Build rail, delivery hub | parity test; guard test; corpus entries recorded | — | yes |
| A1 | Atlas projection and `list_workrooms` `view: "atlas"` | BI-7ACC31F9 | AC-ONE-PROJECTION, AC-ONE-PICTURE | `AtlasRoom` tuple; MCP view | portal loader; MCP read | size test over 1,000 rooms; portal/MCP parity test | A0 | yes |
| A2 | Glyph map and triage filters lead `/ops/workrooms`; replaced surfaces retired | BI-3791FDD8 | AC-ONE-PICTURE, AC-RETIRE, AC-UX | URL filters `portfolio`, `state`, `shape` | `/ops/workrooms`; redirects from retired anchors | served-target run; UX-fit; accessibility; cognitive load | A1 | yes |
| A3 | Room inspector checklist | BI-94C9AFC1 | AC-DISCLOSE, AC-UX | inspector over `buildWorkroomFlowMap` | cell → inspector → room detail | parity test with room detail; served-target run; UX-fit; accessibility | A2 | yes |
| A4 | Rhythm strip for standing rooms | BI-D8A6F0F2 | AC-RHYTHM | run-history read for standing rooms | strip on `/ops/workrooms` | test over recorded runs; non-colour distinction check | A1 | yes |
| A5 | Stage lens with honest fallback | BI-AC930585 | AC-AGE | `wr:` queue key P50/P85 read | "By stage" lens | test with and without telemetry | A1; BI-4ADFFEDB | yes |
| A6a | Business layouts from the twin template, and the Just now feed | BI-B0D8394B | AC-LAYOUT | one renderer per template; lane and slot resolvers | layout per archetype | glyph-identity fixture per template; template-parity test | A2, A3 | yes |
| A6b | Refinements: organization facet selection and `deriveAtlasProfile()` | BI-7EE5681A | AC-REFINE | facet axes `CHN-`, `SEG-`, `SUB-`; `deriveAtlasProfile()` | setup confirmation; layout refinement | derive tests; no per-leaf field | A6a; owner decision + `principle_decide` | yes |

```text
A0 ─► A1 ─┬─► A2 ─► A3 ─► A6a ─► A6b
          ├─► A4
          └─► A5 (+ BI-4ADFFEDB)
```

A4 and A5 can run in parallel with A2 and A3 because they touch different components.

## Phases

### A0: one health vocabulary and critic calibration (BI-930A4C88)

| File | Change |
|---|---|
| `lib/work-management/atlas-health.ts` (new) | Pure `classifyAtlasHealth(liveness, flowState)` returning one of the six states, plus labels |
| `lib/work-capsules/workroom-operator-summary.ts` | Bucket membership derives from `classifyAtlasHealth`; its labels stay |
| `components/build/FleetDensityBar.tsx` and the `/build` rail grouping | The same; labels stay until the owner's §10 decision |
| `components/build/work-control/DeliveryTaskHub.tsx` | The same; "ready" and "complete" map onto the finished and waiting states |
| `lib/work-management/atlas-health.test.ts` | Parity: every liveness × flow-state input maps to exactly one state; the three adapters agree |
| A guard script under `scripts/` | Fails a new local grouping of workrooms by health outside the classifier |

**Calibration.** When the UX Design Critic's findings on the prototype arrive (engagement CE-023F9DDF), each is put to the owner. Verdicts are recorded as calibrated corpus entries for `/ops/workrooms`, and the step is not done until they exist.

**Retires:** nothing visible, only three local definitions.

### A1: the atlas projection (BI-7ACC31F9)

| File | Change |
|---|---|
| `lib/work-management/atlas-projection.server.ts` (new) | One query per install. It returns the §4 tuple per non-archived room and has no 200-row cap; group rows stay paged |
| `lib/work-management/atlas-projection.test.ts` | Health parity with A0; size bound over 1,000 synthetic rooms; null portfolio becomes "not yet placed" |
| `lib/mcp/packs/work-capsules-pack.ts` | `list_workrooms` accepts `view: "atlas"` and returns the same tuples |
| `lib/mcp-tools.test.ts` | Portal loader and MCP view parity |

### A2: the glyph map leads `/ops/workrooms` (BI-3791FDD8)

| File | Change |
|---|---|
| `components/ops/workrooms/atlas/*` (new) | Question, triage counts, glyph map and group rows, on `--dpf-*` tokens and `statusColors.ts` |
| `app/(shell)/ops/workrooms/page.tsx` | Leads with the Atlas; reads A1; honours `?portfolio=&state=&shape=` |
| `components/ops/workrooms/WorkroomInventory.tsx`, `HeldWorkroomsList.tsx`, `PortfolioActivityTree.tsx`, the lead band and operator groups | Removed. Their projections feed the Atlas rows and inspector, and old anchors redirect to the matching filter |
| `components/workspace/*` L0 callout | Shares the question component and links to the Atlas |
| `docs/user-guide/workspace/work-rooms.md`, `docs/user-guide/operations/index.md` | Updated in the same PR |
| `docs/ux-fit/` | UX-fit evidence for the page |

**Gates:**
- `dpf-ux-fit-review` on the served target;
- UX Accessibility review (WCAG 2.2 AA, keyboard, contrast, tokens);
- `principle_decide` on `human_cognitive_load`;
- critic findings judged against the A0 corpus.

### A3: the room inspector (BI-94C9AFC1)

| File | Change |
|---|---|
| `components/ops/workrooms/atlas/AtlasInspector.tsx` | Restyles the PWA-03 inspector as a checklist with the live line, accountable person, time at step, and the need or stuck callout |
| `lib/work-management/workroom-flow-map.server.ts` | Unchanged contract. The inspector reads it, so it cannot disagree with `/workspace/cases/[caseKey]` |
| A parity test | Inspector stages and current step equal the room detail page's for fixture rooms |

**Gates:** as A2.

### A4: rhythm strip (BI-D8A6F0F2)

| File | Change |
|---|---|
| `lib/work-management/standing-run-history.ts` (new, pure) | Last 14 recorded runs per standing room, classed on time, late or missed against its schedule. Nothing is inferred when no run is recorded |
| `components/ops/workrooms/atlas/RhythmStrip.tsx` | Missed uses the stuck mark and late uses the need colour, so missed and late differ without colour |

### A5: stage lens (BI-AC930585)

| File | Change |
|---|---|
| `lib/work-management/atlas-stage-lens.ts` (new, pure) | Reads P50 and P85 from `QueueMetricSnapshot` for the room's `wr:` key. Without telemetry, it returns absolute age and an `unmeasured` flag |
| `components/ops/workrooms/atlas/StageLens.tsx` | Draws bands only when the stage is measured, and labels the column otherwise |

**Dependency.** BI-4ADFFEDB (flow-map F2) supplies the stage telemetry. A5 ships with the fallback whether or not F2 has landed, and its readiness is checked when the step is claimed.

### A6a: business layouts and the Just now feed (BI-B0D8394B)

| File | Change |
|---|---|
| `lib/work-management/atlas-layout.ts` (new, pure) | Maps `deriveTwinProfile`'s template to an Atlas layout, with a lane and slot resolver per template from existing data (tailoring spec §7). A room with no lane or slot goes to "Not yet placed" |
| `components/ops/workrooms/atlas/layouts/*` | FLOOR, TERRITORY, BOOK and ROOMS first; the remaining templates after, each behind its archetype readiness row. Composition is one primary and at most two secondary panels |
| `components/ops/workrooms/atlas/JustNow.tsx` | Recent room changes, from `WorkroomActivity` |
| A fixture test per template | Glyph markup identical to TENANTS; layout equals `deriveTwinProfile`'s template |

**Calibration.** The critic reviews the first layout, and the owner's verdicts calibrate the rest.

### A6b: refinements (BI-7EE5681A)

Starts only after the owner's decision on organization-level facet selection (tailoring spec §6 and §9), scored with `principle_decide` and the verify-substrate-first check. Its own plan covers:
- the facet registry's typed mirror and the three new axes;
- the `BusinessContext` selection;
- `deriveAtlasProfile()`;
- derive-first setup confirmation (consistent with BI-0902BAE9).

This plan only fixes its position and dependency.

## Verification per step

- **Unit tests and package typecheck** run locally for every step. The heavy build runs in the shared governed runtime (AGENTS.md §4).
- **UI steps** (A2, A3, A4, A5, A6a) are exercised on the served target, with results recorded as execution evidence. A hand-built image proves nothing.
- **Infrastructure failures** are reported as unrun, never as passes.
- **Each PR names the surfaces it retires** and shows their old links resolving.

## Risks

| Risk | Mitigation |
|---|---|
| Most rooms have no portfolio placement (BI-C30A4694, BI-FB6389E0), so "Not yet placed" dominates at first | Shown on purpose; it is accurate and puts pressure on placement |
| The critic's corpus is still empty when A2 starts | A0 is not done until owner-verdicted entries exist |
| The `/build` rail decision is still open | A0 converges membership either way; A2 leaves the rail's location to the decision |
| Stage telemetry is absent | A5's honest fallback, and the readiness check at claim |

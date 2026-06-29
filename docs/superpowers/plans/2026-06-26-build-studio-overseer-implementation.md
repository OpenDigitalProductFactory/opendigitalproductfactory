# Build Studio Overseer Layer — Implementation Plan & Status

Implements [`2026-06-22-build-studio-overseer-ux-design.md`](../specs/2026-06-22-build-studio-overseer-ux-design.md) (DESIGN-ONLY spec). This plan tracks the band-by-band build-out and the remaining IA reframe under EP-BUILD-STUDIO-UX.

## Status (2026-06-26)

| Band | Surface | BI | State |
| --- | --- | --- | --- |
| 3 — Decisions & why | `buildDecisionLedger` read-model + `BuildDecisionLedgerBand` | BI-EC934FC6 | **Done** (#2320 + #2325), merged + deployed |
| 1 — What we're building | `BuildSolutionSummaryBand` (from `designDoc`) | BI-90670010 (band part) | **Done** (#2416), merged |
| 4 — Where we need you | plain stop-copy in `deriveBuildStudioWorkflowAction` | BI-FD796419 | **Continuing in this PR**; operator clarity + in-place guided action layer |
| 2 — What's changing | `changeNarrative` field + generator + `BuildChangeSummaryBand` | BI-D93CF6C0 | **This PR** |

## Band 2 — design realized (spec §4.1)

- `FeatureBuild.changeNarrative Json?` (migration `20260626130000_add_change_narrative`) — additive, nullable; older builds fall back to the raw `diffSummary` dive-in.
- `generateChangeNarrative` (`apps/web/lib/integrate/change-narrative.ts`) — `routeAndCall` (taskType `analysis`, so it routes through the platform's standard local/robust provider selection) over goal + plan + diff → a `BuildChangeNarrative`. Best-effort; a null result never blocks completion. The parser is pure + defensive (tolerates code fences / prose, drops non-strings) and is unit-tested.
- Wired into `stepComplete` (`build-pipeline.ts`) — generated once at build completion, alongside `diffSummary`, in a try/catch that can never fail the pipeline step.
- `getBuildChangeNarrativeAction` server action (mirrors `getBuildDecisionLedgerAction`); `BuildStudio` fetches it on a standalone effect (off the hot SSE path) and renders the band between Band 1 and Band 3, gated on a narrative existing.

## IA reframe (keystone, BI-90670010) — implemented

The altitude flip (spec §3.1, Option B) landed: the plain "Solution & Oversight" bands are now the **default first-viewport** of the active-build pane, and the engineer-grade `ProcessGraph` + `AssuranceRow` + `AgentActivityStrip` + `NodeInspector` demote behind a single persisted **"Engineer view"** toggle (`engineerView`, localStorage-backed). A `PhaseMiniRail` stays always-visible for liveness even when the graph is hidden, and the `DetailsDrawer` remains the bands' dive-in either way (`toRailPhase` maps the build's lifecycle phase onto the 5-dot rail). This realizes "plain by default; dive into the engineer surfaces only when something looks off." Live UX verification is performed on the install after deploy (`structural-verification-is-not-functional`).

## Operator clarity correction (2026-06-29)

Live `/build` review showed the reframe was still too technical for a non-technical overseer: the default view exposed FB/BI/WC IDs, branch chips, phase-dot rails, queue glyphs, a "Canonical backlog item" strip, and long design-plan copy. The correction treats the AI Coworker as custodian of the build process and keeps the operator surface to one status, one next action, and a bounded current-work list.

Research anchors:

- NN/g's [visibility of system status](https://www.nngroup.com/articles/visibility-system-status/) guidance says users need the system state in order to know what to do next and trust the system.
- NN/g's [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) guidance says advanced or rarely-used detail belongs behind a secondary request so the primary task stays learnable and less error-prone.
- Atlassian's [WIP limits](https://www.atlassian.com/agile/kanban/wip-limits) guidance frames work-in-progress as a focus and bottleneck signal; the operator UI should show capacity and blocked work without making the human scan every stale item.
- GitHub Actions' [visualization graph](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph) keeps detailed job status available for debugging, but not as the only status surface.

Implemented defaults:

- `ActionBanner` now names the `AI Coworker`, shows the single operator status, and uses first-person custody copy ("I will track the checks", "I will collect the evidence").
- Header `Details` stays human-readable unless `Engineer view` is on; FB/BI IDs, WC IDs, and raw branches remain behind Engineer view.
- The backlog strip is now `Work request` with a short "Why it matters" line; status/triage/size/decision metadata moves to the details drawer.
- `BuildSolutionSummaryBand` caps the operator brief and suppresses technical plan text such as data model/provider/API detail.
- Fleet rows replace phase-dot rails, queue glyphs, and attention dots with plain statuses (`Working`, `Waiting`, `Needs you`, etc.).
- The fleet defaults to the highest-signal four current items and folds the rest under "AI Coworker is tracking N more builds" with a single show-more control.

UX-Fit-Decision: choose the plain custodian view over the technical dashboard or chat-punt recovery. `principle_decide` returned low confidence and a tool-biased edge for the technical dashboard, so the decision was made on merits per the UX-fit rule: reduce human cognitive load, keep governance evidence in drill-down, and make the default action surface clear for non-technical operators.

## Verification

Source-only worktree → typecheck / vitest / production build / migration-apply are CI-gated. Band 2's parser + the band component are unit/render tested. The narrative's *generation quality* depends on the model tier (local vs robust) and is validated by a real build run; the structure ships now so it is ready the moment a build completes.

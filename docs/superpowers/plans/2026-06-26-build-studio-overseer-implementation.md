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

Live `/build` review showed the reframe was still too technical for a non-technical overseer: the default view exposed FB/BI/WC IDs, branch chips, phase-dot rails, queue glyphs, a "Canonical backlog item" strip, and long design-plan / review-decision copy. The correction treats the AI Coworker as custodian of the build process and keeps the operator surface to one status, one next action, and a bounded current-work list.

Research anchors:

- NN/g's [visibility of system status](https://www.nngroup.com/articles/visibility-system-status/) guidance says users need the system state in order to know what to do next and trust the system.
- NN/g's [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) guidance says advanced or rarely-used detail belongs behind a secondary request so the primary task stays learnable and less error-prone.
- Atlassian's [WIP limits](https://www.atlassian.com/agile/kanban/wip-limits) guidance frames work-in-progress as a focus and bottleneck signal; the operator UI should show capacity and blocked work without making the human scan every stale item.
- GitHub Actions' [visualization graph](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph) keeps detailed job status available for debugging, but not as the only status surface.

Implemented defaults:

- `ActionBanner` now names the `AI Coworker`, shows the single operator status, and uses first-person custody copy ("I will track the checks", "I will collect the evidence").
- Header `Details` stays human-readable unless `Engineer view` is on; FB/BI IDs, WC IDs, and raw branches remain behind Engineer view.
- The shared context strip says `Build context` in Build Studio and maps missing-evidence attention to `Waiting on you` when internal IDs are hidden.
- The backlog strip is now `Work request` with a short "Why it matters" line; status/triage/size/decision metadata moves to the details drawer.
- `BuildSolutionSummaryBand` caps the operator brief and suppresses technical plan text such as data model/provider/API detail.
- `BuildDecisionLedgerBand` is compact by default (`AI Coworker decision` + current call + short why); full options and unresolved technical evidence only render in Engineer view.
- Fleet rows replace phase-dot rails, queue glyphs, and attention dots with plain statuses (`Working`, `Waiting`, `Needs you`, etc.).
- The fleet is now an operator focus queue: selected, running, queued, blocked, and needs-you builds stay visible; quiet ideation/planning probes are parked under `AI Coworker is watching N parked builds` and remain available from Details.

UX-Fit-Decision: choose the plain custodian view and focus queue over the technical dashboard, chat-punt recovery, or "show all current builds" rail. `principle_decide` retrieved mostly process-commandment dimensions for the focus-queue decision and recommended "show all current" without scoring operator cognitive load; the decision was made on merits per the UX-fit rule: reduce human cognitive load, keep governance evidence in drill-down, and make the default action surface clear for non-technical operators.

## Proactive custodian extension (2026-06-29)

Mark's follow-up reframes the next step: Build Studio should not merely be simpler after the user asks for help; the AI Coworker should notice when the human-facing flow has gone quiet or confusing and offer to keep the build moving. The live trigger was `Retry UX Verification`: the click enqueued work, but hidden blockers made the page feel inert. That is the exact failure mode the proactive custodian primitive must handle.

Backlog capture:

- Platform primitive: `BI-5B6F666F` under `EP-ATTENTION-SURFACE` — proactive AI Coworker custodian mode.
- Build Studio pilot: `BI-ACB04A21` under `EP-BUILD-STUDIO-UX` — proactive stuck detection and guided next action.

Design anchor: [Attention Surface §3.4](../specs/2026-06-23-human-attention-surface-design.md#34-proactive-custodian-mode--quiet-until-useful). Build Studio remains the pilot surface, but the behavior is cross-coworker: watch source-owned state, interrupt only when useful, explain "why now" in one line, show one recommended action, offer snooze/show-why, and hide internal IDs/branches/diagnostics by default.

WWMD/UX-Fit-Decision: choose the Attention Surface amendment plus Build Studio pilot over a Build-Studio-only addendum or a standalone new spec. `principle_decide` recommended this direction with high confidence (composite 9.479, margin 2.200, commandmentConflict:false). The merits are the deciding rationale: no duplicate queue, no second backlog, no fabricated priority score, and a clear path from a painful Build Studio incident to a reusable coworker primitive.

Implementation slice:

- Add a pure `deriveBuildStudioCustodianPrompt` projection next to the existing workflow-action derivation. It watches the same source-owned build state plus `BuildProgressVisibility` quiet-agent signals; it does not introduce a new table or queue.
- Render `BuildStudioCustodianCallout` only when the prompt is active. In compact mode it replaces the normal `ActionBanner`, so the operator still sees one visible status surface and one primary action rather than a stacked alert plus banner.
- Covered prompt classes: UX-review evidence gaps (including the "retry felt inert" case), quiet review/build states, missing-evidence gates, and existing guided repair paths (`rerun-plan-review`, `resume-implementation`, retry/reset).
- Add session snooze and collapsed "Show why" context. Snooze is intentionally local/session-scoped for the pilot; the platform primitive (`BI-5B6F666F`) owns durable cross-coworker quiet thresholds.
- Primary actions reuse existing plumbing: workflow recovery uses the existing Build Studio primary action handler; coworker custody opens the existing agent panel with a narrowed custodian prompt.

## Verification

Source-only worktree → typecheck / vitest / production build / migration-apply are CI-gated. Band 2's parser + the band component are unit/render tested. The narrative's *generation quality* depends on the model tier (local vs robust) and is validated by a real build run; the structure ships now so it is ready the moment a build completes.
